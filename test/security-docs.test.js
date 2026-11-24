import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { startApp } from './helpers/server.js';

// Le dossier docs/security/ et les règles permanentes sont des livrables vérifiés : fichiers présents, preuves qui existent, jamais servis au public,
// et tout cookie posé par le code est déclaré dans la politique de confidentialité.

const REQUIRED = ['SECURITY_AUDIT', 'THREAT_MODEL', 'SECURITY_ACTION_PLAN', 'SECURITY_CHANGELOG', 'SECURITY_TESTS', 'RGPD_COMPLIANCE', 'LEGAL_COMPLIANCE', 'DATA_MAPPING',
  'THIRD_PARTY_SERVICES', 'LICENSE_AUDIT', 'INCIDENT_RESPONSE', 'BACKUP_RESTORE', 'PRODUCTION_CHECKLIST', 'DEPLOYMENT_GUIDE', 'MAINTENANCE_PLAN', 'PRODUCTION_READINESS'];
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('les 16 documents de sécurité existent et ne sont pas vides', () => {
  for (const n of REQUIRED) { assert.ok(existsSync(new URL(`../docs/security/${n}.md`, import.meta.url)), `docs/security/${n}.md`); assert.ok(read(`docs/security/${n}.md`).length > 800, `${n} : contenu`); }
});

test('chaque fichier de test ou de script cité comme preuve existe', () => {
  const missing = [];
  for (const f of readdirSync(new URL('../docs/security/', import.meta.url)).filter((x) => x.endsWith('.md'))) {
    for (const m of read(`docs/security/${f}`).matchAll(/`((?:test|scripts|deploy)\/[A-Za-z0-9._-]+\.(?:test\.js|mjs|js|sh))`/g)) if (!existsSync(new URL(`../${m[1]}`, import.meta.url))) missing.push(`${f} → ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('aucun document de sécurité ne contient de secret (les marqueurs « À COMPLÉTER » sont des informations manquantes, pas des valeurs)', async () => {
  const { scanText } = await import('../scripts/secret-scan.js');
  for (const f of readdirSync(new URL('../docs/security/', import.meta.url)).filter((x) => x.endsWith('.md'))) assert.deepEqual(scanText(f, read(`docs/security/${f}`)), [], f);
});

test('les documents internes et les règles ne sont servis par aucune route, quel que soit le chemin', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: true });
    for (const p of ['/docs/security/SECURITY_AUDIT.md', '/docs/security/', '/security/SECURITY_AUDIT.md', '/SECURITY_AUDIT.md', '/CLAUDE.md', '/.claude/rules/securite.md', '/static/../docs/security/SECURITY_AUDIT.md']) {
      for (const c of [s.anon, u]) assert.equal((await c.get(p, { headers: { accept: 'text/html' } })).status, 404, p);
    }
  } finally { await s.close(); }
});

test('les règles permanentes existent et CLAUDE.md y renvoie', () => {
  for (const f of ['securite', 'donnees-personnelles', 'dependances-et-deploiement']) { assert.ok(existsSync(new URL(`../.claude/rules/${f}.md`, import.meta.url)), f); assert.ok(read('CLAUDE.md').includes(f), `CLAUDE.md cite ${f}`); }
  assert.match(read('CLAUDE.md'), /Règle n° 3/);
});

test('tout cookie posé par le code est déclaré dans la politique de confidentialité', () => {
  const names = new Set();
  const walk = (dir) => { for (const e of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
    if (e.isDirectory()) { walk(`${dir}/${e.name}`); continue; }
    if (!e.name.endsWith('.js')) continue;
    for (const m of read(`${dir}/${e.name}`).matchAll(/\b(?:const|export const)\s+[A-Z_]*COOKIE\s*=\s*'([a-z_]+)'/g)) names.add(m[1]);
  } };
  walk('src');
  assert.ok(names.size >= 5, `cookies repérés : ${[...names]}`);
  const legal = read('src/site/legal.js');
  for (const n of names) assert.ok(legal.includes(`<code>${n}</code>`), `le cookie « ${n} » doit figurer dans le tableau des cookies de src/site/legal.js`);
});
