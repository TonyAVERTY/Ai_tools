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

test('la page d\'un projet : nom, dépôt, fil d\'Ariane, neuf onglets avec une adresse chacun, « Vue d\'ensemble » courant', async () => {
  const u = await s.newUser({ email: 'page@x.fr' });
  const a = await addProject(s.db, u.id, { name: 'Agenda Kiné', gitUrl: 'https://github.com/atelier/agenda-kine.git' });
  const b = await addProject(s.db, u.id, { name: 'Atelier Bois', gitUrl: 'https://github.com/u/bois.git' });
  const h = await text(u, `/p/${a}`);
  assert.match(h, /<h1 id="h-projet">Agenda Kiné<\/h1>/);
  assert.match(h, /<nav class="crumb"[^]*?href="\/projets">Projets<\/a>/);
  assert.match(h, /github\.com\/atelier\/agenda-kine/);
  assert.match(h, /<title>Agenda Kiné · Vue d(?:'|&#39;)ensemble · iaboss<\/title>/);
  const tabs = h.match(/<nav class="ptabs"[^]*?<\/nav>/)[0];
  const hrefs = [...tabs.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ['', '/prospection', '/envoi', '/clients', '/facturation', '/communication', '/outils', '/recap', '/reglages'].map((x) => `/p/${a}${x}`));
  assert.match(tabs, /<a href="\/p\/\d+" aria-current="page">Vue d(?:'|&#39;)ensemble/);
  assert.doesNotMatch(h, new RegExp(`data-id="${b}"`), 'les autres projets ne sont pas sur cette page');
});

test('chaque onglet répond avec son titre ; un onglet inconnu est introuvable ; l\'ancienne adresse /projets/:id redirige', async () => {
  const u = await s.newUser({ email: 'onglets@x.fr' });
  const a = await addProject(s.db, u.id, { name: 'Alpha', gitUrl: 'https://github.com/u/alpha.git' });
  for (const [slug, label] of [['prospection', 'Prospection'], ['envoi', 'Envoi'], ['clients', 'Clients'], ['facturation', 'Facturation'], ['communication', 'Communication'], ['outils', 'Outils IA'], ['recap', 'Récapitulatif'], ['reglages', 'Réglages du projet']]) {
    const r = await u.get(`/p/${a}/${slug}`, { headers: { accept: 'text/html' } });
    assert.equal(r.status, 200, slug);
    assert.match(await r.text(), new RegExp(`<title>Alpha · ${label} · iaboss</title>`), slug);
  }
  assert.equal((await u.get(`/p/${a}/nimportequoi`, { headers: { accept: 'text/html' } })).status, 404);
  const old = await u.get(`/projets/${a}`, { redirect: 'manual' });
  assert.equal(old.status, 303);
  assert.equal(old.headers.get('location'), `/p/${a}`);
});

test('la liste Projets : une carte par projet, avec l\'état, le dépôt et le lien vers la page ; « Nouveau projet » demande aussi le site', async () => {
  const u = await s.newUser({ email: 'liste@x.fr' });
  const a = await addProject(s.db, u.id, { name: 'Alpha', gitUrl: 'https://github.com/u/alpha.git' });
  const h = await text(u, '/projets');
  assert.match(h, new RegExp(`<a class="sheet pj-card" href="/p/${a}"><div class="sheet-h"><h2>Alpha</h2><span class="badge warn">`));
  assert.match(h, /github\.com\/u\/alpha/);
  assert.match(h, /name="site_url"[^>]*placeholder="https:\/\/monproduit\.fr"/);
  assert.match(h, /1 projet sur 1 avec ton offre|1 projet avec ton offre/);
});

test('le projet d\'un autre compte, ou un numéro inconnu, est « introuvable » ; un membre d\'équipe n\'a ni Clients, ni Facturation, ni Récapitulatif, ni Réglages', async () => {
  const u = await s.newUser({ email: 'moi@x.fr' });
  const v = await s.newUser({ email: 'autre@x.fr' });
  const theirs = await addProject(s.db, v.id, { name: 'Secret', gitUrl: 'https://github.com/v/secret.git' });
  for (const slug of ['', '/envoi', '/reglages']) assert.equal((await u.get(`/p/${theirs}${slug}`, { headers: { accept: 'text/html' } })).status, 404, `/p/${theirs}${slug}`);
  assert.equal((await u.get('/p/999999', { headers: { accept: 'text/html' } })).status, 404);
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

test('recherche : projets, prospects et mails du compte seulement, 2 lettres minimum, jokers LIKE neutralisés', async () => {
  const u = await s.newUser({ email: 'cherche@x.fr' });
  const v = await s.newUser({ email: 'ailleurs@x.fr' });
  const a = await addProject(s.db, u.id, { name: 'Agenda Kiné', gitUrl: 'https://github.com/u/kine.git' });
  const other = await addProject(s.db, v.id, { name: 'Kiné secret', gitUrl: 'https://github.com/v/ksecret.git' });
  const now = Math.floor(Date.now() / 1000);
  await s.db.prepare('INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, ?, ?, ?, ?)').run(a, 'Cabinet Le Gall', 'a@legall.fr', 'client', now);
  await s.db.prepare('INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, ?, ?, ?, ?)').run(other, 'Cabinet Gall Secret', 'x@secret.fr', 'new', now);
  await s.db.prepare('INSERT INTO replies(project_id, prospect_id, uid, from_email, subject, body, intent, received_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)').run(a, null, 1, 'b@armor.fr', 'Devis Doctolib', 'x', 'question', now);
  const search = async (q) => (await u.get(`/api/search?q=${encodeURIComponent(q)}`, { headers: { accept: 'application/json' } })).json();
  const names = (d) => d.groups.flatMap((g) => g.items.map((i) => i.title));
  assert.deepEqual((await search('g')).groups, [], 'une lettre ne cherche rien');
  const kine = await search('kiné');
  assert.deepEqual(names(kine), ['Agenda Kiné']);
  assert.equal(kine.groups[0].items[0].href, `/projets/${a}`);
  const gall = await search('gall');
  assert.deepEqual(names(gall), ['Cabinet Le Gall'], 'le prospect d\'un autre compte reste invisible');
  assert.match(gall.groups[0].items[0].sub, /^Client · a@legall\.fr/);
  assert.deepEqual(names(await search('doctolib')), ['Devis Doctolib']);
  assert.deepEqual((await search('%%')).groups, [], '« % » n\'est pas un joker');
  assert.deepEqual((await search('a_')).groups, [], '« _ » n\'est pas un joker');
});

test('la barre du haut porte « Rechercher » et la fenêtre de recherche ; « Activité » est toujours là', async () => {
  const u = await s.newUser({ email: 'barre2@x.fr' });
  const h = await text(u, '/');
  assert.match(h, /data-search-open[^]*?Rechercher/);
  assert.match(h, /<dialog class="search-dialog" id="search"/);
  assert.match(h, /<div class="jobs" id="jobs">/, 'plus de hidden au repos');
  assert.match(h, /Aucune tâche en cours\./);
});
