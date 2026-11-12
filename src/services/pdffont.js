// Police TrueType pour le générateur de PDF : lecture des tables utiles (cmap, hmtx, head, hhea, name), largeurs pour la mise en page,
// et objets PDF d'une police Type0 / CIDFontType2 (Identity-H) qui embarque le fichier entier. Rien d'externe.
// Acceptés : TrueType (.ttf, y compris variable : l'instance par défaut) et WOFF 1. Refusés : OpenType à contours CFF, WOFF2, collections.
import { deflateSync, inflateSync } from 'node:zlib';

export const MAX_FONT_BYTES = 1_500_000;

export class FontError extends Error {
  constructor(message) { super(message); this.name = 'FontError'; }
}

/** WOFF 1 → sfnt (chaque table est compressée avec zlib). */
function woffToSfnt(buf) {
  const flavor = buf.readUInt32BE(4);
  const n = buf.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20;
    const [offset, compLen, origLen] = [buf.readUInt32BE(o + 4), buf.readUInt32BE(o + 8), buf.readUInt32BE(o + 12)];
    if (offset + compLen > buf.length) throw new FontError('Police WOFF tronquée');
    const raw = buf.subarray(offset, offset + compLen);
    const data = compLen < origLen ? inflateSync(raw) : raw;
    if (data.length !== origLen) throw new FontError('Police WOFF corrompue');
    tables.push({ tag: buf.subarray(o, o + 4), data });
  }
  const head = Buffer.alloc(12 + n * 16);
  head.writeUInt32BE(flavor, 0); head.writeUInt16BE(n, 4);
  let off = head.length;
  const body = [];
  tables.forEach((t, i) => {
    t.tag.copy(head, 12 + i * 16);
    head.writeUInt32BE(off, 12 + i * 16 + 8); head.writeUInt32BE(t.data.length, 12 + i * 16 + 12);
    const pad = (4 - (t.data.length % 4)) % 4;
    body.push(t.data, Buffer.alloc(pad));
    off += t.data.length + pad;
  });
  return Buffer.concat([head, ...body]);
}

const toPsName = (s) => String(s || 'Font').normalize('NFD').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || 'Font';
const hex4 = (n) => n.toString(16).padStart(4, '0');

export class TrueTypeFont {
  /** @param {Buffer} input un fichier .ttf ou .woff */
  constructor(input) {
    if (!Buffer.isBuffer(input) || input.length < 64) throw new FontError('Fichier de police vide');
    if (input.length > MAX_FONT_BYTES) throw new FontError('Police trop lourde');
    let buf = input;
    const sig = buf.toString('latin1', 0, 4);
    if (sig === 'wOFF') buf = woffToSfnt(buf);
    else if (sig === 'wOF2') throw new FontError('Les polices WOFF2 ne sont pas gérées');
    else if (sig === 'OTTO') throw new FontError('Les polices OpenType à contours CFF ne sont pas gérées');
    else if (sig === 'ttcf') throw new FontError('Les collections de polices ne sont pas gérées');
    else if (buf.readUInt32BE(0) !== 0x00010000 && sig !== 'true') throw new FontError('Ce fichier n\'est pas une police TrueType');
    this.data = buf;
    const n = buf.readUInt16BE(4);
    this.t = {};
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16;
      this.t[buf.toString('latin1', o, o + 4)] = { off: buf.readUInt32BE(o + 8), len: buf.readUInt32BE(o + 12) };
    }
    for (const need of ['head', 'hhea', 'hmtx', 'cmap', 'maxp', 'glyf', 'loca']) if (!this.t[need]) throw new FontError(`Police sans table « ${need} »`);
    const head = this.t.head.off;
    this.unitsPerEm = buf.readUInt16BE(head + 18) || 1000;
    this.bbox = [buf.readInt16BE(head + 36), buf.readInt16BE(head + 38), buf.readInt16BE(head + 40), buf.readInt16BE(head + 42)];
    const hhea = this.t.hhea.off;
    this.ascent = buf.readInt16BE(hhea + 4);
    this.descent = buf.readInt16BE(hhea + 6);
    this.numHMetrics = buf.readUInt16BE(hhea + 34);
    this.numGlyphs = buf.readUInt16BE(this.t.maxp.off + 4);
    this.family = this._name(16) || this._name(1) || 'Police';
    this.ps = toPsName(this.family);
    this.cmap = this._cmap();
    this.used = new Map(); // glyphe → caractère (pour la largeur et le texte copiable)
  }

  _name(id) {
    const tb = this.t.name;
    if (!tb) return '';
    const b = this.data;
    const count = b.readUInt16BE(tb.off + 2), strOff = tb.off + b.readUInt16BE(tb.off + 4);
    for (let i = 0; i < count; i++) {
      const o = tb.off + 6 + i * 12;
      if (b.readUInt16BE(o + 6) !== id) continue;
      const pid = b.readUInt16BE(o);
      const raw = b.subarray(strOff + b.readUInt16BE(o + 10), strOff + b.readUInt16BE(o + 10) + b.readUInt16BE(o + 8));
      if (pid === 3 || pid === 0) { const s = Buffer.from(raw).swap16().toString('utf16le'); if (s) return s; } else { const s = raw.toString('latin1'); if (s) return s; }
    }
    return '';
  }

  _cmap() {
    const b = this.data, base = this.t.cmap.off;
    const n = b.readUInt16BE(base + 2);
    let pick = null;
    for (let i = 0; i < n; i++) {
      const pid = b.readUInt16BE(base + 4 + i * 8), eid = b.readUInt16BE(base + 6 + i * 8), off = base + b.readUInt32BE(base + 8 + i * 8);
      const fmt = b.readUInt16BE(off);
      const score = (pid === 3 && eid === 10 && fmt === 12) ? 4 : (pid === 3 && eid === 1 && fmt === 4) ? 3 : (pid === 0 && (fmt === 4 || fmt === 12)) ? 2 : 0;
      if (score && (!pick || score > pick.score)) pick = { score, off, fmt };
    }
    if (!pick) throw new FontError('Police sans table de caractères Unicode');
    const { off, fmt } = pick;
    if (fmt === 12) {
      const groups = b.readUInt32BE(off + 12);
      return (cp) => {
        let lo = 0, hi = groups - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1, g = off + 16 + mid * 12;
          const [s, e, gid] = [b.readUInt32BE(g), b.readUInt32BE(g + 4), b.readUInt32BE(g + 8)];
          if (cp < s) hi = mid - 1; else if (cp > e) lo = mid + 1; else return gid + (cp - s);
        }
        return 0;
      };
    }
    const segX2 = b.readUInt16BE(off + 6), ends = off + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    return (cp) => {
      if (cp > 0xffff) return 0;
      for (let i = 0; i < segX2; i += 2) {
        if (cp > b.readUInt16BE(ends + i)) continue;
        const start = b.readUInt16BE(starts + i);
        if (cp < start) return 0;
        const delta = b.readUInt16BE(deltas + i), ro = b.readUInt16BE(ranges + i);
        if (!ro) return (cp + delta) & 0xffff;
        const g = b.readUInt16BE(ranges + i + ro + (cp - start) * 2);
        return g ? (g + delta) & 0xffff : 0;
      }
      return 0;
    };
  }

  advance(gid) {
    const i = Math.min(gid, this.numHMetrics - 1);
    return this.data.readUInt16BE(this.t.hmtx.off + i * 4);
  }

  /** Glyphe d'un caractère ; un caractère absent de la police devient « ? » puis le glyphe vide. */
  glyph(ch) {
    const cp = ch.codePointAt(0);
    if (cp === 0xa0 || cp === 0x202f || cp === 0x2009) return this.cmap(0x20);
    return this.cmap(cp) || this.cmap(0x3f) || 0;
  }

  /** Largeur en points. */
  width(str, size) {
    let sum = 0;
    for (const ch of String(str ?? '').replace(/[\r\n\t]+/g, ' ')) sum += this.advance(this.glyph(ch));
    return (sum * size) / this.unitsPerEm;
  }

  /** Texte → glyphes (2 octets chacun, en hexadécimal) ; mémorise ceux qui servent. */
  encode(str) {
    let out = '';
    for (const ch of String(str ?? '').replace(/[\r\n\t]+/g, ' ')) {
      const gid = this.glyph(ch);
      if (!this.used.has(gid)) this.used.set(gid, ch.codePointAt(0) === 0xa0 || ch.codePointAt(0) === 0x202f ? 0x20 : ch.codePointAt(0));
      out += hex4(gid);
    }
    return `<${out}>`;
  }

  /** Ajoute les objets PDF de la police ; renvoie le numéro de l'objet Type0. `add` : Buffer|string → numéro d'objet. */
  embed(add) {
    const stream = (dict, data) => add(Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]));
    const file = stream(`/Length1 ${this.data.length}`, deflateSync(this.data));
    const k = 1000 / this.unitsPerEm;
    const name = `${this.ps}`;
    const desc = add(`<< /Type /FontDescriptor /FontName /${name} /Flags 32 /FontBBox [${this.bbox.map((v) => Math.round(v * k)).join(' ')}] /ItalicAngle 0 /Ascent ${Math.round(this.ascent * k)} /Descent ${Math.round(this.descent * k)} /CapHeight ${Math.round(this.ascent * k * 0.7)} /StemV 80 /FontFile2 ${file} 0 R >>`);
    const gids = [...this.used.keys()].sort((a, b) => a - b);
    const w = gids.map((g) => `${g} [${Math.round(this.advance(g) * k)}]`).join(' ');
    const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /DW 600 /W [${w}] /CIDToGIDMap /Identity >>`);
    const map = gids.filter((g) => g).map((g) => `<${hex4(g)}> <${hex4(Math.min(this.used.get(g), 0xffff))}>`);
    const chunks = [];
    for (let i = 0; i < map.length; i += 100) chunks.push(`${Math.min(100, map.length - i)} beginbfchar\n${map.slice(i, i + 100).join('\n')}\nendbfchar`);
    const cmapText = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n${chunks.join('\n')}\nendcmap CMapName currentdict /CMap defineresource pop end end`;
    const toUni = stream('', deflateSync(Buffer.from(cmapText, 'latin1')));
    return add(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUni} 0 R >>`);
  }
}
