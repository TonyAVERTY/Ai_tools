// Écrivain de PDF minimal, sans dépendance : pages A4, texte (polices standard Helvetica et Times), filets et rectangles.
// Assez pour des devis et des factures ; pas d'images, pas de polices intégrées. Le texte est encodé en WinAnsi (cp1252) : les accents français
// et le symbole € passent, tout autre caractère devient « ? ».
import { deflateSync } from 'node:zlib';
import { WIDTHS } from './pdffonts.js';

export const A4 = { w: 595.28, h: 841.89 };

// Caractères Unicode de la plage 0x80-0x9F de Windows-1252
const CP1252 = new Map([[0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98],
  [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f]]);

/** Texte → octets WinAnsi. Les espaces insécables (fines ou non) deviennent des espaces simples, le « − » typographique un tiret. */
export function toWinAnsi(str) {
  const out = [];
  for (const ch of String(str ?? '').replace(/[   ]/g, ' ').replace(/−/g, '-').replace(/[\r\n\t]+/g, ' ')) {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c <= 0x7e) out.push(c);
    else if (c >= 0xa1 && c <= 0xff) out.push(c);
    else if (CP1252.has(c)) out.push(CP1252.get(c));
    else out.push(0x3f);
  }
  return out;
}

const FONT_NAMES = { H: 'Helvetica', HB: 'Helvetica-Bold', T: 'Times-Roman', TB: 'Times-Bold' };
const FONT_KEYS = Object.keys(FONT_NAMES);
const hex = (bytes) => `<${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}>`;
const num = (n) => (Math.round(n * 100) / 100).toString();
const rgb = (c) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c || '');
  const v = m ? m[1] : '000000';
  return [0, 2, 4].map((i) => num(parseInt(v.slice(i, i + 2), 16) / 255)).join(' ');
};

export class Pdf {
  /** @param {{ serif?: boolean, title?: string, author?: string }} opts  serif : Times au lieu d'Helvetica */
  constructor({ serif = false, title = '', author = '' } = {}) {
    this.serif = serif;
    this.title = title;
    this.author = author;
    this.pages = [];
    this.newPage();
  }

  newPage() {
    this.pages.push([]);
    return this.pages.length;
  }

  get pageCount() { return this.pages.length; }

  fontKey(bold) { return this.serif ? (bold ? 'TB' : 'T') : (bold ? 'HB' : 'H'); }

  /** Largeur d'un texte en points. */
  width(str, size, bold = false) {
    const w = WIDTHS[this.fontKey(bold)];
    let sum = 0;
    for (const b of toWinAnsi(str)) sum += w[b - 32] ?? 556;
    return (sum * size) / 1000;
  }

  /** Coupe un texte en lignes qui tiennent dans `maxW` points (les retours à la ligne du texte sont respectés). */
  wrap(str, maxW, size, bold = false) {
    const lines = [];
    for (const para of String(str ?? '').split(/\r?\n/)) {
      let cur = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = cur ? `${cur} ${word}` : word;
        if (this.width(next, size, bold) <= maxW || !cur) {
          // Un mot seul plus large que la ligne est coupé au caractère
          if (!cur && this.width(word, size, bold) > maxW) {
            let piece = '';
            for (const ch of word) {
              if (this.width(piece + ch, size, bold) > maxW && piece) { lines.push(piece); piece = ch; } else piece += ch;
            }
            cur = piece;
          } else cur = next;
        } else { lines.push(cur); cur = word; }
      }
      lines.push(cur);
    }
    return lines;
  }

  _add(op, page = this.pages.length - 1) { this.pages[page].push(op); }

  /** Texte dont l'origine est le coin bas-gauche (y vers le haut). align : left | right | center, par rapport à x. */
  text(x, y, str, { size = 10, bold = false, color = '#000000', align = 'left', spacing = 0, page } = {}) {
    const s = String(str ?? '');
    if (!s) return;
    let w = this.width(s, size, bold);
    if (spacing) w += spacing * s.length;
    const px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this._add(`BT ${rgb(color)} rg /${this.fontKey(bold)} ${num(size)} Tf ${spacing ? `${num(spacing)} Tc ` : ''}${num(px)} ${num(A4.h - y)} Td ${hex(toWinAnsi(s))} Tj ET`, page);
  }

  line(x1, y1, x2, y2, { width = 0.5, color = '#000000' } = {}) {
    this._add(`${num(width)} w ${rgb(color)} RG ${num(x1)} ${num(A4.h - y1)} m ${num(x2)} ${num(A4.h - y2)} l S`);
  }

  /** Rectangle (x, y = coin haut-gauche). */
  rect(x, y, w, h, { fill = null, stroke = null, width = 0.5 } = {}) {
    const parts = [];
    if (fill) parts.push(`${rgb(fill)} rg`);
    if (stroke) parts.push(`${num(width)} w ${rgb(stroke)} RG`);
    parts.push(`${num(x)} ${num(A4.h - y - h)} ${num(w)} ${num(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    this._add(parts.join(' '));
  }

  toBuffer() {
    const objs = []; // chaque objet : Buffer du corps (sans « n 0 obj »)
    const add = (body) => { objs.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1')); return objs.length; };
    const catalog = add(''); // 1 : renseigné plus bas
    const pagesRoot = add(''); // 2
    const fontIds = Object.fromEntries(FONT_KEYS.map((k) => [k, add(`<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_NAMES[k]} /Encoding /WinAnsiEncoding >>`)]));
    const fontRes = FONT_KEYS.map((k) => `/${k} ${fontIds[k]} 0 R`).join(' ');
    const kids = [];
    for (const ops of this.pages) {
      const data = deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
      const contentId = add(Buffer.concat([Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]));
      kids.push(add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << ${fontRes} >> >> /Contents ${contentId} 0 R >>`));
    }
    const pdfDate = (() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`; })();
    const info = add(`<< /Title ${hex(toWinAnsi(this.title))} /Author ${hex(toWinAnsi(this.author))} /Producer ${hex(toWinAnsi('iaboss'))} /CreationDate (${pdfDate}) >>`);
    objs[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`, 'latin1');
    objs[pagesRoot - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`, 'latin1');

    const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    const offsets = [];
    let pos = chunks[0].length;
    objs.forEach((body, i) => {
      offsets.push(pos);
      const head = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
      const tail = Buffer.from('\nendobj\n', 'latin1');
      chunks.push(head, body, tail);
      pos += head.length + body.length + tail.length;
    });
    const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
}
