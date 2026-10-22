// Adresses des fichiers statiques avec leur empreinte (`?v=…`) : quand un fichier change, son adresse change, et le
// navigateur ne peut plus réutiliser l'ancienne copie qu'il avait en cache (les fichiers sont servis avec max-age).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const cache = new Map();

/** '/static/app.js' devient '/static/app.js?v=1a2b3c4d5e' (empreinte du contenu, lue une fois). */
export function assetUrl(path) {
  if (!cache.has(path)) {
    let v = '0';
    try { v = createHash('sha1').update(readFileSync(join(PUBLIC, path.replace(/^\/static\//, '')))).digest('hex').slice(0, 10); } catch { /* fichier absent : adresse sans empreinte utile */ }
    cache.set(path, `${path}?v=${v}`);
  }
  return cache.get(path);
}
