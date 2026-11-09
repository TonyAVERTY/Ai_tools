// Page des projets : un projet unique s'ouvre tout seul, dès qu'il y en a plusieurs les listes restent fermées.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });
const page = async (u, path = '/projets') => (await u.get(path, { headers: { accept: 'text/html' } })).text();
const openOf = (html) => [...html.matchAll(/<details class="project tab-project" data-id="(\d+)"[^>]*?( open)?>/g)].map((m) => [Number(m[1]), !!m[2]]);

test('la liste des projets est faite de cartes : aucun projet n\'y est déplié, chaque carte mène à sa page', async () => {
  const u = await s.newUser();
  const a = await addProject(s.db, u.id, { name: 'Un', gitUrl: 'https://github.com/u/un.git' });
  const b = await addProject(s.db, u.id, { name: 'Deux', gitUrl: 'https://github.com/u/deux.git' });
  const html = await page(u);
  assert.deepEqual(openOf(html), []);
  assert.match(html, new RegExp(`<a class="sheet pj-card" href="/p/${a}">`));
  assert.match(html, new RegExp(`<a class="sheet pj-card" href="/p/${b}">`));
});

test('la page d\'un projet : le projet est ouvert d\'office (son résumé est masqué, la page est le projet)', async () => {
  const u = await s.newUser();
  const a = await addProject(s.db, u.id, { name: 'Seul', gitUrl: 'https://github.com/u/seul.git' });
  assert.deepEqual(openOf(await page(u, `/p/${a}`)), [[a, true]]);
  assert.deepEqual(openOf(await page(u, `/p/${a}/envoi`)), [[a, true]]);
});

test('aucun projet : pas de carte, état vide', async () => {
  const u = await s.newUser();
  const html = await page(u);
  assert.deepEqual(openOf(html), []);
  assert.doesNotMatch(html, /class="sheet pj-card"/);
  assert.match(html, /class="empty"/);
});

test('le navigateur ne rouvre pas le dernier projet consulté : seuls un rechargement voulu par l\'application et « Voir » le font, une seule fois', () => {
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /sessionStorageSet\('openProject'/, 'plus de mémoire permanente du dernier projet ouvert');
  assert.match(js, /sessionStorage\.removeItem\('reopenProject'\)/, 'la réouverture est à usage unique');
  assert.match(js, /const reload = \(\) => \{ rememberOpen\(\);/, 'un rechargement voulu garde le projet ouvert');
});
