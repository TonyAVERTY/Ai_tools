// Page dédiée d'un projet (/projets/:id) et barre du haut : lien depuis la liste, isolation entre comptes, entrées déplacées dans le menu du compte.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import { NAV, MORE_PAGES } from '../src/views.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });
const text = async (u, p) => (await u.get(p, { headers: { accept: 'text/html' } })).text();

test('la page d\'un projet montre ce projet seul, avec un fil d\'Ariane vers Projets', async () => {
  const u = await s.newUser({ email: 'page@x.fr' });
  const a = await addProject(s.db, u.id, { name: 'Agenda Kiné', gitUrl: 'https://github.com/u/kine.git' });
  const b = await addProject(s.db, u.id, { name: 'Atelier Bois', gitUrl: 'https://github.com/u/bois.git' });
  const h = await text(u, `/projets/${a}`);
  assert.match(h, /<h1 id="h-projet">Agenda Kiné<\/h1>/);
  assert.match(h, /<nav class="crumb"[^]*?href="\/projets">Projets<\/a>/);
  assert.match(h, new RegExp(`<details class="project anim" data-id="${a}" open>`), 'le projet est ouvert');
  assert.doesNotMatch(h, new RegExp(`data-id="${b}"`), 'les autres projets ne sont pas sur cette page');
  assert.doesNotMatch(h, /class="pname-l"/, 'pas de lien vers soi-même');
  assert.match(h, /<title>Agenda Kiné · iaboss<\/title>/);
});

test('la liste Projets renvoie vers la page de chaque projet', async () => {
  const u = await s.newUser({ email: 'liste@x.fr' });
  const a = await addProject(s.db, u.id, { name: 'Alpha', gitUrl: 'https://github.com/u/alpha.git' });
  const h = await text(u, '/projets');
  assert.match(h, new RegExp(`<a class="pname-l" href="/projets/${a}" aria-label="Ouvrir la page de Alpha"`));
});

test('le projet d\'un autre compte, ou un numéro inconnu, est « introuvable »', async () => {
  const u = await s.newUser({ email: 'moi@x.fr' });
  const v = await s.newUser({ email: 'autre@x.fr' });
  const theirs = await addProject(s.db, v.id, { name: 'Secret', gitUrl: 'https://github.com/v/secret.git' });
  assert.equal((await u.get(`/projets/${theirs}`, { headers: { accept: 'text/html' } })).status, 404);
  assert.equal((await u.get('/projets/999999', { headers: { accept: 'text/html' } })).status, 404);
  assert.doesNotMatch(await text(u, '/projets'), /Secret/);
});

test('barre du haut : Aujourd\'hui, Projets, Mails, Agenda, Compta ; Facturation, Clients et Équipe dans le menu du compte', async () => {
  assert.deepEqual(NAV.map(([, , l]) => l), ["Aujourd'hui", 'Projets', 'Mails', 'Agenda', 'Compta']);
  assert.deepEqual(MORE_PAGES.map(([h]) => h), ['/facturation', '/clients', '/team']);
  const u = await s.newUser({ email: 'barre@x.fr' });
  const h = await text(u, '/');
  const pills = h.match(/<nav class="pills"[^]*?<\/nav>/)[0];
  for (const [href] of MORE_PAGES) assert.doesNotMatch(pills, new RegExp(`href="${href}"`), `${href} n'est plus dans la barre`);
  const pop = h.match(/<div class="user-pop">[^]*?<\/div>/)[0];
  for (const [href] of MORE_PAGES) assert.match(pop, new RegExp(`href="${href}"`), `${href} est dans le menu du compte`);
});
