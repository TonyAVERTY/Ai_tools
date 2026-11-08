// Sections d'un projet : quelles sections d'un projet sont ouvertes à l'arrivée, et où se trouve « En-tête », selon l'étape où en est le projet.
// Pas analysé : En-tête en haut et ouvert (c'est là que l'analyse démarre et s'affiche). Analysé : En-tête replié, juste avant « Configuration ».
// Cible à valider : Cible ouverte. Cible validée : Prospecter ouvert (c'est l'étape suivante).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });
const html = (u, p) => u.get(p, { headers: { accept: 'text/html' } }).then((r) => r.text());

const PROFILE = JSON.stringify({ resume: 'Un outil de devis pour artisans.', proposition_valeur: 'Gagnez du temps.', arguments: ['a'], stack: 'node' });
const TARGET = JSON.stringify({ description: 'TPE du bâtiment', secteurs: ['plomberie'], zone: 'Bretagne', requetes: ['q'] });

/** Crée un projet unique pour un nouveau compte, au stade demandé, et renvoie la page Projets. */
async function pageAt(stage) {
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: `Projet ${stage}`, gitUrl: `https://github.com/u${u.id}/${stage}.git` });
  if (stage !== 'brut') await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = ? WHERE id = ?').run(PROFILE, TARGET, stage === 'cible-validee' ? 1 : 0, pid);
  return html(u, '/projets');
}
const tag = (page, key) => page.match(new RegExp(`<details class="acc anim [^"]*" data-acc="${key}"[^>]*>`))?.[0] || null;
const isOpen = (page, key) => { const t = tag(page, key); assert.ok(t, `section « ${key} » absente`); return /\sopen>$/.test(t); };
const at = (page, key) => { const i = page.indexOf(`data-acc="${key}"`); assert.ok(i > 0, `section « ${key} » absente`); return i; };

test('projet pas encore analysé : En-tête en haut et ouvert, rien d\'autre n\'est ouvert', async () => {
  const page = await pageAt('brut');
  assert.equal(isOpen(page, 'header'), true, 'En-tête ouvert : l\'analyse démarre et s\'affiche là');
  assert.ok(at(page, 'header') < at(page, 'prospect'), 'En-tête avant Prospecter');
  assert.equal(tag(page, 'target'), null, 'pas de Cible avant l\'analyse');
  assert.equal(isOpen(page, 'prospect'), false);
});

test('projet analysé, cible à valider : Cible ouverte, En-tête replié et descendu avant Configuration', async () => {
  const page = await pageAt('cible-a-valider');
  assert.equal(isOpen(page, 'target'), true, 'la cible à valider est l\'étape en cours');
  assert.equal(isOpen(page, 'header'), false, 'En-tête replié une fois le projet analysé');
  assert.equal(isOpen(page, 'prospect'), false, 'Prospecter attend la validation de la cible');
  assert.ok(at(page, 'target') < at(page, 'prospect'), 'Cible avant Prospecter');
  assert.ok(at(page, 'prospect') < at(page, 'header'), 'En-tête après les sections de travail');
  assert.ok(at(page, 'header') < at(page, 'config'), 'En-tête juste avant Configuration');
});

test('projet analysé, cible validée : Prospecter ouvert, Cible et En-tête repliés', async () => {
  const page = await pageAt('cible-validee');
  assert.equal(isOpen(page, 'prospect'), true, 'Prospecter est l\'étape suivante');
  assert.equal(isOpen(page, 'target'), false, 'une cible validée n\'a plus besoin d\'être ouverte');
  assert.equal(isOpen(page, 'header'), false);
  assert.ok(at(page, 'header') < at(page, 'config'));
  // la section Prospecter ouverte montre sa première étape (la recherche)
  assert.equal(isOpen(page, 'search'), true);
});

test('En-tête reste présent et complet à sa nouvelle place (dépôt, site, analyse)', async () => {
  const page = await pageAt('cible-validee');
  const from = at(page, 'header');
  const body = page.slice(from, at(page, 'config'));
  for (const piece of ['Dépôt Git', 'Site du produit', 'Enregistrer le site', 'Fiche projet', 'data-job="analyze"']) assert.ok(body.includes(piece), `« ${piece} » dans En-tête`);
});
