// Bouton « Accès site internet » du tableau de bord : mène au site d'accueil, y compris pour un compte connecté.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { projectsHtml } from './helpers/pages.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });
const html = (c, p) => c.get(p, { headers: { accept: 'text/html' } }).then((r) => r.text());

test('le tableau de bord a un bouton vers le site internet', async () => {
  const u = await s.newUser();
  const page = await projectsHtml(u);
  assert.match(page, /<a class="ia-link site-link" href="\/accueil" data-noajax aria-label="Accès au site internet"[^>]*>[\s\S]*?Site internet<\/span><\/a>/);
  assert.match(page, /<svg class="ic" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-globe">/);
});

test('/accueil : le site d\'accueil, avec « Dashboard » pour un compte connecté et « Connexion » pour un visiteur', async () => {
  const u = await s.newUser();
  const member = await html(u, '/accueil');
  assert.match(member, /<link rel="canonical" href="https:\/\/ai\.tony-averty\.dev\/">/, 'la page de référence reste la racine');
  assert.match(member, /href="\/">Dashboard/);
  assert.doesNotMatch(member, /Créer mon compte/);
  const guest = await html(s.anon, '/accueil');
  assert.match(guest, /Créer mon compte/);
  assert.equal((await s.anon.get('/accueil', { headers: { accept: 'text/html' } })).status, 200);
});
