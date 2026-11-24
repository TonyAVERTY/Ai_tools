// Contrôle des licences des dépendances de PRODUCTION (package-lock.json) : échoue si une licence n'est pas dans la liste autorisée
// pour un usage commercial fermé (pas de GPL / AGPL / LGPL / SSPL / licence inconnue). « A OR B » est accepté si l'une des deux est autorisée.
import { existsSync, readFileSync } from 'node:fs';

export const ALLOWED = new Set(['MIT', 'MIT-0', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'CC0-1.0', 'Unlicense', 'BlueOak-1.0.0', 'Python-2.0']);

export const isAllowed = (expr) => String(expr || '').replace(/[()]/g, '').split(/\s+OR\s+/i).some((l) => ALLOWED.has(l.trim()));

export function readLicenses(cwd = process.cwd()) {
  const lock = JSON.parse(readFileSync(`${cwd}/package-lock.json`, 'utf8'));
  const out = [];
  for (const [path, v] of Object.entries(lock.packages || {})) {
    if (!path || v.dev) continue;
    const pj = existsSync(`${cwd}/${path}/package.json`) ? JSON.parse(readFileSync(`${cwd}/${path}/package.json`, 'utf8')) : {};
    out.push({ name: path.replace(/^.*node_modules\//, ''), version: v.version, license: pj.license || v.license || (pj.licenses ? JSON.stringify(pj.licenses) : '') });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = readLicenses();
  const bad = all.filter((p) => !isAllowed(p.license));
  for (const p of bad) console.error(`LICENCE ? ${p.name}@${p.version} : « ${p.license || 'inconnue'} »`);
  console.log(bad.length ? `${bad.length} dépendance(s) à licence non autorisée` : `${all.length} dépendances de production, toutes sous licence autorisée`);
  process.exit(bad.length ? 1 : 0);
}
