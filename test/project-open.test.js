// Page des projets : un projet unique s'ouvre tout seul, dès qu'il y en a plusieurs les listes restent fermées.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });
const page = async (u) => (await u.get('/', { headers: { accept: 'text/html' } })).text();
const openOf = (html) => [...html.matchAll(/<details class="project anim" data-id="(\d+)"( open)?>/g)].map((m) => [Number(m[1]), !!m[2]]);

test('un seul projet : ouvert par défaut', async () => {
  const u = await s.newUser();
  const a = await addProject(s.db, u.id, { name: 'Seul', gitUrl: 'https://github.com/u/seul.git' });
  assert.deepEqual(openOf(await page(u)), [[a, true]]);
});

test('deux projets ou plus : tous fermés par défaut', async () => {
  const u = await s.newUser();
  const a = await addProject(s.db, u.id, { name: 'Un', gitUrl: 'https://github.com/u/un.git' });
  const b = await addProject(s.db, u.id, { name: 'Deux', gitUrl: 'https://github.com/u/deux.git' });
  assert.deepEqual(openOf(await page(u)).sort((x, y) => x[0] - y[0]), [[a, false], [b, false]]);
  const c = await addProject(s.db, u.id, { name: 'Trois', gitUrl: 'https://github.com/u/trois.git' });
  const states = openOf(await page(u));
  assert.equal(states.length, 3);
  assert.ok(states.every(([, open]) => !open));
  assert.ok(states.some(([id]) => id === c));
});

test('aucun projet : pas de liste, état vide', async () => {
  const u = await s.newUser();
  const html = await page(u);
  assert.deepEqual(openOf(html), []);
  assert.match(html, /class="empty"/);
});

test('le navigateur ne rouvre pas le dernier projet consulté : seuls un rechargement voulu par l\'application et « Voir » le font, une seule fois', () => {
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /sessionStorageSet\('openProject'/, 'plus de mémoire permanente du dernier projet ouvert');
  assert.match(js, /sessionStorage\.removeItem\('reopenProject'\)/, 'la réouverture est à usage unique');
  assert.match(js, /const reload = \(\) => \{ rememberOpen\(\);/, 'un rechargement voulu garde le projet ouvert');
});
