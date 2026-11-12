// Images pour le générateur de PDF : PNG (8 bits, sans entrelacement, avec ou sans transparence) et JPEG (niveaux de gris ou couleur).
// Le PNG est décodé puis recompressé (couleurs + masque de transparence) ; le JPEG est inséré tel quel. Rien d'externe.
import { deflateSync, inflateSync } from 'node:zlib';

export const MAX_IMAGE_BYTES = 1_500_000;
export const MAX_IMAGE_PIXELS = 4_000_000;

export class ImageError extends Error {
  constructor(message) { super(message); this.name = 'ImageError'; }
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function unfilter(raw, w, h, bpp) {
  const stride = w * bpp;
  const out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (f !== 0) throw new ImageError('Image PNG corrompue');
      out[dst + x] = v & 255;
    }
  }
  return out;
}

function readPng(buf) {
  let off = 8, hdr = null, plte = null, trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') hdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!hdr || !idat.length) throw new ImageError('Image PNG incomplète');
  if (hdr.depth !== 8) throw new ImageError('Seuls les PNG 8 bits sont gérés');
  if (hdr.interlace) throw new ImageError('Les PNG entrelacés ne sont pas gérés');
  if (hdr.w * hdr.h > MAX_IMAGE_PIXELS || !hdr.w || !hdr.h) throw new ImageError('Image trop grande');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[hdr.color];
  if (!channels) throw new ImageError('Type de PNG non géré');
  const px = unfilter(inflateSync(Buffer.concat(idat)), hdr.w, hdr.h, channels);
  const n = hdr.w * hdr.h;
  const rgb = Buffer.alloc(n * 3);
  let alpha = null;
  const hasAlpha = hdr.color === 4 || hdr.color === 6 || (hdr.color === 3 && trns);
  if (hasAlpha) alpha = Buffer.alloc(n, 255);
  for (let i = 0; i < n; i++) {
    if (hdr.color === 2 || hdr.color === 6) { rgb[i * 3] = px[i * channels]; rgb[i * 3 + 1] = px[i * channels + 1]; rgb[i * 3 + 2] = px[i * channels + 2]; if (hdr.color === 6) alpha[i] = px[i * 4 + 3]; }
    else if (hdr.color === 0 || hdr.color === 4) { const g = px[i * channels]; rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = g; if (hdr.color === 4) alpha[i] = px[i * 2 + 1]; }
    else { if (!plte) throw new ImageError('PNG sans palette'); const p = px[i]; rgb[i * 3] = plte[p * 3]; rgb[i * 3 + 1] = plte[p * 3 + 1]; rgb[i * 3 + 2] = plte[p * 3 + 2]; if (alpha) alpha[i] = trns && p < trns.length ? trns[p] : 255; }
  }
  // Une image sans pixel transparent n'a pas besoin de masque
  const opaque = alpha && alpha.every((a) => a === 255);
  return { kind: 'png', width: hdr.w, height: hdr.h, rgb, alpha: opaque ? null : alpha };
}

function readJpeg(buf) {
  let o = 2;
  while (o + 4 < buf.length) {
    if (buf[o] !== 0xff) { o++; continue; }
    const m = buf[o + 1];
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xff) { o += m === 0xff ? 1 : 2; continue; }
    const len = buf.readUInt16BE(o + 2);
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      const [height, width, comps] = [buf.readUInt16BE(o + 5), buf.readUInt16BE(o + 7), buf[o + 9]];
      if (comps !== 1 && comps !== 3) throw new ImageError('JPEG CMJN non géré');
      if (width * height > MAX_IMAGE_PIXELS || !width || !height) throw new ImageError('Image trop grande');
      return { kind: 'jpeg', width, height, comps, data: buf };
    }
    o += 2 + len;
  }
  throw new ImageError('JPEG illisible');
}

/** Fichier PNG ou JPEG → description d'image prête à insérer (erreur lisible sinon). */
export function loadImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) throw new ImageError('Image vide');
  if (buf.length > MAX_IMAGE_BYTES) throw new ImageError('Image trop lourde');
  if (buf.subarray(0, 8).equals(PNG_SIG)) return readPng(buf);
  if (buf[0] === 0xff && buf[1] === 0xd8) return readJpeg(buf);
  throw new ImageError('Format d\'image non géré (PNG ou JPEG attendu)');
}

/** Ajoute l'image comme objet(s) PDF et renvoie le numéro de l'objet. `add` : Buffer|string → numéro d'objet. */
export function embedImage(img, add) {
  const obj = (dict, data) => add(Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]));
  const base = `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /BitsPerComponent 8`;
  if (img.kind === 'jpeg') return obj(`${base} /ColorSpace /${img.comps === 1 ? 'DeviceGray' : 'DeviceRGB'} /Filter /DCTDecode`, img.data);
  const mask = img.alpha ? obj(`/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode`, deflateSync(img.alpha)) : null;
  return obj(`${base} /ColorSpace /DeviceRGB /Filter /FlateDecode${mask ? ` /SMask ${mask} 0 R` : ''}`, deflateSync(img.rgb));
}

/** Retire les marges transparentes d'un PNG (un logo converti d'un SVG en a toujours) ; une image sans transparence est rendue telle quelle. */
export function trimImage(img) {
  if (img.kind !== 'png' || !img.alpha) return img;
  const { width: w, height: h, alpha, rgb } = img;
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[y * w + x] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return img; // entièrement transparente : on ne touche à rien
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1;
  if (nw === w && nh === h) return img;
  const nrgb = Buffer.alloc(nw * nh * 3), nalpha = Buffer.alloc(nw * nh);
  for (let y = 0; y < nh; y++) {
    rgb.copy(nrgb, y * nw * 3, ((y0 + y) * w + x0) * 3, ((y0 + y) * w + x0 + nw) * 3);
    alpha.copy(nalpha, y * nw, (y0 + y) * w + x0, (y0 + y) * w + x0 + nw);
  }
  return { kind: 'png', width: nw, height: nh, rgb: nrgb, alpha: nalpha };
}
