// Sections d'un projet selon l'étape où il en est : depuis la refonte (docs/REFONTE-UI.md), chaque section vit dans l'onglet de son sujet et reste ouverte.
// Pas analysé : pas de Cible, la mise en route commence par « Analyser le projet ». Analysé : la Cible (à valider, puis validée) est dans Prospection ; dépôt et site sont dans Réglages du projet.
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

/** Crée un projet pour un nouveau compte, au stade demandé, et renvoie l'accès aux onglets. */
async function at(stage) {
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: `Projet ${stage}`, gitUrl: `https://github.com/u${u.id}/${stage}.git` });
  if (stage !== 'brut') await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = ? WHERE id = ?').run(PROFILE, TARGET, stage === 'cible-validee' ? 1 : 0, pid);
  return (tab = '') => html(u, `/p/${pid}${tab ? `/${tab}` : ''}`);
}
const tag = (page, key) => page.match(new RegExp(`<details class="acc anim [^"]*" id="acc-${key}" data-acc="${key}"[^>]*>`))?.[0] || null;

test('projet pas encore analysé : pas de Cible, la mise en route commence par l\'analyse', async () => {
  const tab = await at('brut');
  assert.equal(tag(await tab('prospection'), 'target'), null, 'pas de Cible avant l\'analyse');
  const overview = await tab();
  assert.match(overview, /<li class="cur">\s*<span class="n" aria-hidden="true">1<\/span>\s*<span class="st"><b>Analyser le projet<\/b>/);
  assert.match(overview, /Le dépôt n'est pas encore analysé/);
});

test('projet analysé, cible à valider : la Cible est dans Prospection, ouverte, avec son badge', async () => {
  const tab = await at('cible-a-valider');
  const page = await tab('prospection');
  assert.match(tag(page, 'target') || '', /\sopen>$/, 'la cible à valider est ouverte');
  assert.match(page, /Cible <span class="badge warn">à valider<\/span>/);
  assert.ok(page.indexOf('id="acc-target"') < page.indexOf('id="acc-search"'), 'Cible avant Recherche');
  assert.ok(page.indexOf('id="acc-search"') < page.indexOf('id="acc-prospects"'), 'Recherche avant Prospects');
});

test('projet analysé, cible validée : Prospection montre cible, recherche et prospects, ouverts', async () => {
  const tab = await at('cible-validee');
  const page = await tab('prospection');
  for (const key of ['target', 'search', 'prospects']) assert.match(tag(page, key) || '', /\sopen>$/, `« ${key} » est ouvert`);
  assert.doesNotMatch(page, /Cible <span class="badge warn">à valider/);
});

test('Réglages du projet : SMTP, IMAP, dépôt et site, base de données, partage, zone de danger, dans l\'ordre du menu', async () => {
  const tab = await at('cible-validee');
  const page = await tab('reglages');
  const order = ['id="set-smtp"', 'id="set-imap"', 'id="acc-header"', 'id="set-db"', 'id="set-share"', 'id="set-danger"'].map((k) => page.indexOf(k));
  assert.ok(order.every((x) => x > 0), `toutes les rubriques sont là (${order.join(', ')})`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'ordre du menu : SMTP, IMAP, dépôt et site, base de données, partage, zone de danger');
  const body = page.slice(page.indexOf('id="acc-header"'), page.indexOf('id="set-db"'));
  for (const piece of ['Dépôt Git', 'Site du produit', 'Enregistrer le site', 'Fiche projet', 'data-job="analyze"']) assert.ok(body.includes(piece), `« ${piece} » dans « Dépôt et site »`);
});

test('chaque onglet ne montre que ses sections', async () => {
  const tab = await at('cible-validee');
  const only = { prospection: ['target', 'search', 'prospects'], envoi: ['template', 'followuptpl'], communication: ['linkedin', 'promo'], outils: ['evolution', 'audit', 'postes'], recap: ['recap'], reglages: ['header', 'config'] };
  const all = [...new Set(Object.values(only).flat())];
  for (const [slug, keys] of Object.entries(only)) {
    const page = await tab(slug);
    for (const k of keys) assert.ok(tag(page, k), `« ${k} » dans l'onglet ${slug}`);
    for (const k of all.filter((x) => !keys.includes(x))) assert.equal(tag(page, k), null, `« ${k} » n'est pas dans l'onglet ${slug}`);
  }
});
