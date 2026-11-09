// Accès BDD du projet, sans SQL : ce que l'enregistrement garde, efface ou refuse (les connexions réelles sont testées dans dbschema.live.test.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import { saveSecretConfig, getProject } from '../src/projects.js';
import { projectsHtml } from './helpers/pages.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

async function setup(initial = {}) {
  const u = await s.newUser();
  const id = Number(await addProject(s.db, u.id, { name: 'Projet BDD' }));
  if (Object.keys(initial).length) await saveSecretConfig(s.app, id, 'db_enc', { type: 'mysql', host: '', ...initial }, 'password');
  const cfg = async () => (await getProject(s.app, id, { userId: u.id, secrets: true })).dbCfg;
  return { u, id, cfg };
}
const POST = (u, id, path, body) => u.post(`/api/projects/${id}${path}`, body);

test('enregistrer la connexion seule garde les anciennes requêtes et ne touche pas aux tables', async () => {
  const { u, id, cfg } = await setup({ sql_users: 'SELECT COUNT(*) FROM users' });
  const r = await POST(u, id, '/db', { type: 'mysql', database: 'saas', user: 'lecteur', password: 'secret' });
  assert.equal(r.status, 200);
  const c = await cfg();
  assert.equal(c.sql_users, 'SELECT COUNT(*) FROM users', 'l\'ancienne requête continue de fonctionner');
  assert.equal(c.kpi, undefined);
  assert.equal(c.database, 'saas');
});

test('une sélection inchangée n\'ouvre aucune connexion (corriger un mot de passe n\'exige pas une base joignable)', async () => {
  const kpi = { users: { table: 'users' }, revenue: { table: 'payments', amountColumn: 'amount', cents: true } };
  const { u, id, cfg } = await setup({ kpi });
  const r = await POST(u, id, '/db', { type: 'mysql', host: '', database: 'saas', users_table: 'users', clients_table: '', revenue_table: 'payments', revenue_column: 'amount', revenue_unit: 'cents' });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual((await cfg()).kpi, kpi, 'les tables choisies sont gardées telles quelles');
});

test('ne rien suivre efface les tables et les anciennes requêtes', async () => {
  const { u, id, cfg } = await setup({ kpi: { users: { table: 'users' } }, sql_clients: 'SELECT 1' });
  const r = await POST(u, id, '/db', { type: 'mysql', users_table: '', clients_table: '', revenue_table: '', revenue_column: '', revenue_unit: '' });
  assert.equal(r.status, 200);
  const c = await cfg();
  assert.deepEqual(c.kpi, {});
  assert.equal(c.sql_clients, '');
});

test('choisir une table sans base joignable : l\'erreur dit quoi faire, rien n\'est enregistré', async () => {
  const { u, id, cfg } = await setup({ kpi: { users: { table: 'users' } } });
  const r = await POST(u, id, '/db', { type: 'mysql', host: '', users_table: 'clients', clients_table: '', revenue_table: '' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Indique l'hôte de la base/);
  assert.deepEqual((await cfg()).kpi, { users: { table: 'users' } }, 'la sélection enregistrée n\'a pas bougé');
});

test('analyser : l\'hôte est obligatoire, une adresse interne est refusée, une autre personne ne voit pas le projet', async () => {
  const { u, id } = await setup();
  let r = await POST(u, id, '/db/analyze', { type: 'mysql', database: 'saas' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Indique l'hôte/);
  r = await POST(u, id, '/db/analyze', { type: 'mysql', host: '127.0.0.1', database: 'saas', user: 'u', password: 'p' });
  assert.ok(r.status >= 400 && r.status < 500, `adresse interne refusée (${r.status})`);
  assert.doesNotMatch(await r.text(), /ECONN|mysql2|stack/i, 'pas de message brut du pilote');
  const other = await s.newUser();
  assert.equal((await POST(other, id, '/db/analyze', { type: 'mysql', host: 'db.exemple.fr', database: 'x' })).status, 404);
  assert.equal((await s.anon.post(`/api/projects/${id}/db/analyze`, {})).status, 401);
});

test('les anciennes requêtes envoyées par l\'API restent vérifiées (SELECT seulement)', async () => {
  const { u, id } = await setup();
  assert.equal((await POST(u, id, '/db', { type: 'mysql', sql_users: 'DELETE FROM users' })).status, 400);
  assert.equal((await POST(u, id, '/db', { type: 'mysql', sql_users: 'SELECT COUNT(*) FROM users' })).status, 200);
});

test('le formulaire ne contient plus aucun champ SQL : des listes de tables et un bouton pour analyser', async () => {
  const { u } = await setup({ kpi: { users: { table: 'utilisateurs' }, clients: { table: 'abonnements', statusColumn: 'statut', statusValues: ['active'] }, revenue: { table: 'paiements', amountColumn: 'montant', cents: false } } });
  const html = await projectsHtml(u);
  assert.doesNotMatch(html, /name="sql_(users|clients|revenue)"|SELECT COUNT|placeholder="SELECT/, 'aucun champ où écrire du SQL');
  for (const k of ['Table des utilisateurs', 'Table des clients payants', 'Table des paiements', 'Colonne du montant', 'Montants en', 'Se connecter et analyser', 'Enregistrer BDD']) assert.ok(html.includes(k), `« ${k} » dans le formulaire`);
  assert.match(html, /<option value="utilisateurs" selected>utilisateurs<\/option>/, 'la table enregistrée est présélectionnée');
  assert.match(html, /Compte les lignes de « abonnements » dont « statut » vaut « active »\./, 'la règle appliquée est dite en clair');
});

test('un projet qui a encore d\'anciennes requêtes le sait, sans voir de SQL', async () => {
  const { u } = await setup({ sql_users: 'SELECT COUNT(*) FROM users' });
  const html = await projectsHtml(u);
  assert.match(html, /requêtes personnalisées enregistrées avant/);
  assert.doesNotMatch(html, /SELECT COUNT\(\*\) FROM users/, 'la requête n\'est pas réaffichée');
});
