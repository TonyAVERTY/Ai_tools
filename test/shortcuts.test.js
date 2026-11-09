import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp } from './helpers/server.js';
import { GO, OTHERS, goAttr } from '../src/shortcutdata.js';

// Raccourcis clavier : une seule liste (src/shortcutdata.js) pour la page, l'attribut data-go lu par le navigateur et la documentation du Support.
let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });
const text = (u, p) => u.get(p, { headers: { accept: 'text/html' } }).then((r) => r.text());

test('la liste : une lettre par page, pas de doublon, toutes les adresses existent', async () => {
  assert.equal(new Set(GO.map(([k]) => k)).size, GO.length, 'une lettre ne mène qu\'à une page');
  for (const [k, href] of GO) { assert.match(k, /^[a-z]$/); assert.match(href, /^\/[a-z-]*$/, `${k} : adresse simple (le « ; » et le « : » séparent l'attribut)`); }
  const u = await s.newUser({ email: 'sc@x.fr' });
  for (const [, href, label] of GO) assert.equal((await u.get(href, { headers: { accept: 'text/html' } })).status, 200, `${label} (${href}) existe`);
});

test('chaque page de l\'application porte la liste (data-go), le script et le lien du menu du compte', async () => {
  const u = await s.newUser({ email: 'sc2@x.fr' });
  const h = await text(u, '/projets');
  assert.ok(h.includes(`data-go="${goAttr()}"`));
  assert.match(h, /\/static\/app-shortcuts\.js\?v=\w+/);
  assert.match(h, /<a href="\/raccourcis"><svg[^>]*>[^]*?<\/svg>Raccourcis clavier<\/a>/);
  assert.equal((await u.get('/static/app-shortcuts.js', { headers: { accept: '*/*' } })).status, 200);
});

test('la page /raccourcis liste tous les raccourcis, et s\'ouvre sans IA reliée', async () => {
  const u = await s.newUser({ email: 'sc3@x.fr', admin: false }); // non administrateur, sans IA reliée
  const r = await u.get('/raccourcis', { headers: { accept: 'text/html' } });
  assert.equal(r.status, 200, 'page d\'aide : jamais bloquée par la liaison de l\'IA');
  const h = await r.text();
  assert.match(h, /<h1>Raccourcis clavier<\/h1>/);
  for (const [k, , label] of GO) assert.match(h, new RegExp(`<kbd>g</kbd> <kbd>${k}</kbd></td><td>${label.replace("'", '(?:\'|&#39;)')}</td>`), `g ${k} → ${label}`);
  for (const [keys, label] of OTHERS) { for (const k of keys) assert.ok(h.includes(`<kbd>${k}</kbd>`), k); assert.ok(h.includes(label.replace(/'/g, '&#39;')) || h.includes(label), label); }
  assert.equal((await s.anon.get('/raccourcis', { headers: { accept: 'text/html' }, redirect: 'manual' })).status, 303, 'connecté obligatoire (redirigé vers la connexion)');
});

test('la documentation du Support cite chaque raccourci', () => {
  const doc = readFileSync('docs/support/29-raccourcis-clavier.md', 'utf8');
  for (const [k, , label] of GO) assert.ok(doc.includes(`| g ${k} | ${label} |`), `g ${k} → ${label}`);
  for (const [keys] of OTHERS) for (const k of keys) assert.ok(doc.includes(k), `${k} dans la documentation`);
});
