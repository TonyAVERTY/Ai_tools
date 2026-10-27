// Archive ZIP écrite à la main (méthode « stockée », sans compression) : les justificatifs sont des PDF et des images déjà compressés.
// Un fichier à la fois en mémoire (10 Mo au plus par justificatif), l'archive part au fil de l'eau. Noms en UTF-8. Pas de ZIP64 : moins de 4 Go.
import { crc32 } from 'node:zlib';

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

/** Date et heure au format DOS (heure locale du serveur, à la seconde paire près). */
function dosStamp(date) {
  const d = new Date(date);
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Nom sûr dans l'archive : jamais de chemin absolu, de « .. », de barre oblique inverse ni de caractère de contrôle. */
export function zipName(name) {
  return String(name).replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..')
    .map((p) => p.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim()).filter(Boolean).join('/').slice(0, 200) || 'fichier';
}

/**
 * Écrit l'archive dans `out` (une réponse HTTP ou tout flux inscriptible).
 * @param {import('node:stream').Writable} out
 * @param {Array<{name: string, read: () => Promise<Buffer>|Buffer, mtime?: Date|number}>} files
 * @returns {Promise<number>} nombre de fichiers écrits
 */
export async function writeZip(out, files) {
  const central = [];
  let offset = 0;
  const put = (buf) => new Promise((ok, ko) => { if (out.write(buf)) ok(); else { out.once('drain', ok); out.once('error', ko); } });
  for (const f of files) {
    const data = Buffer.from(await f.read());
    const name = Buffer.from(zipName(f.name), 'utf8');
    const crc = crc32(data);
    const { time, day } = dosStamp(f.mtime ?? Date.now());
    const head = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(day), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name]);
    central.push({ name, crc, size: data.length, time, day, offset });
    await put(head);
    await put(data);
    offset += head.length + data.length;
    if (offset > 0xfff00000) throw new Error('Archive trop volumineuse');
  }
  const dir = [];
  for (const c of central) {
    dir.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(c.time), u16(c.day), u32(c.crc), u32(c.size), u32(c.size),
      u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset), c.name]));
  }
  const cd = Buffer.concat(dir);
  await put(cd);
  await put(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cd.length), u32(offset), u16(0)]));
  return central.length;
}

/** Lecture d'une archive (pour les tests et les vérifications) : { name, data } pour chaque entrée, CRC contrôlé. */
export function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Pas une archive ZIP');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Répertoire central abîmé');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method !== 0) throw new Error('Méthode non prise en charge');
    if (crc32(data) !== crc) throw new Error(`CRC faux : ${name}`);
    out.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
