// Récapitulatif sans SQL, sur une VRAIE base MySQL / MariaDB (celle du job « mysql » de la CI, ou TEST_DB_* en local) : lecture du schéma, tables proposées,
// aperçu chiffré, lecture seule, erreurs de connexion dites clairement. Ignoré sans TEST_DB_HOST.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDb, explainDbError } from '../src/services/dbschema.js';
import { withReadOnly } from '../src/services/dbconn.js';
import { fetchRecap, clearRecapCache } from '../src/services/recap.js';

const skip = !process.env.TEST_DB_HOST && 'MySQL non configuré (TEST_DB_HOST)';
const base = { type: 'mysql', host: process.env.TEST_DB_HOST, port: Number(process.env.TEST_DB_PORT || 3306), user: process.env.TEST_DB_USER, password: process.env.TEST_DB_PASSWORD };
const name = `aitools_bdd_${process.pid}_${Date.now() % 100000}`;
let admin;
const cfg = () => ({ ...base, database: name });

before(async () => {
  if (skip) return;
  const mysql = await import('mysql2/promise');
  admin = await mysql.createConnection({ host: base.host, port: base.port, user: base.user, password: base.password, multipleStatements: true });
  await admin.query(`CREATE DATABASE \`${name}\`; USE \`${name}\`;
    CREATE TABLE migrations (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(80));
    CREATE TABLE utilisateurs (id INT PRIMARY KEY AUTO_INCREMENT, email VARCHAR(100));
    CREATE TABLE abonnements (id INT PRIMARY KEY AUTO_INCREMENT, statut VARCHAR(20));
    CREATE TABLE paiements (id INT PRIMARY KEY AUTO_INCREMENT, montant DECIMAL(10,2), tva DECIMAL(10,2), statut VARCHAR(20));
    INSERT INTO utilisateurs(email) VALUES ('a@x.fr'),('b@x.fr'),('c@x.fr');
    INSERT INTO abonnements(statut) VALUES ('active'),('active'),('resiliee');
    INSERT INTO paiements(montant, tva, statut) VALUES (49.00, 8.17, 'paye'),(49.00, 8.17, 'paye'),(99.50, 16.58, 'paye'),(10.00, 1.67, 'echoue');`);
  await admin.query('ANALYZE TABLE utilisateurs, abonnements, paiements').catch(() => {});
});
after(async () => { if (admin) { await admin.query(`DROP DATABASE IF EXISTS \`${name}\``).catch(() => {}); await admin.end().catch(() => {}); } });

test('une base française : les tables, le montant (décimal = euros) et les filtres de statut sont reconnus, l\'aperçu est juste', { skip }, async () => {
  const r = await analyzeDb(cfg());
  assert.deepEqual(r.tables.map((t) => t.name), ['abonnements', 'migrations', 'paiements', 'utilisateurs']);
  assert.deepEqual(r.recommended, { users: 'utilisateurs', clients: 'abonnements', revenue: 'paiements' });
  assert.deepEqual(r.kpi.revenue, { table: 'paiements', amountColumn: 'montant', cents: false, statusColumn: 'statut', statusValues: ['paye'] }, 'la TVA est écartée, « echoue » n\'est pas compté');
  assert.deepEqual(r.kpi.clients, { table: 'abonnements', statusColumn: 'statut', statusValues: ['active'] });
  assert.deepEqual(r.preview, { users: 3, clients: 2, revenue: 197.5 });
  assert.equal(r.suggested, true);
  assert.deepEqual(r.tables.find((t) => t.name === 'paiements').numeric, ['id', 'montant', 'tva']);
});

test('un choix explicite est chiffré ; la recommandation reste renvoyée', { skip }, async () => {
  const r = await analyzeDb(cfg(), { users_table: 'migrations', revenue_table: 'paiements', revenue_column: 'tva', revenue_unit: 'euros' });
  assert.equal(r.suggested, false);
  assert.equal(r.recommended.users, 'utilisateurs', '« (recommandé) » reste affiché sur la bonne table');
  assert.deepEqual(r.kpi.users, { table: 'migrations' });
  assert.equal(r.preview.revenue, 32.92, 'somme de la TVA des 3 paiements payés (8,17 + 8,17 + 16,58)');
});

test('un nom de table qui n\'existe pas est refusé (aucune requête construite avec)', { skip }, async () => {
  await assert.rejects(() => analyzeDb(cfg(), { users_table: 'utilisateurs`; DROP TABLE paiements; --' }), (e) => e.status === 400 && /Table introuvable/.test(e.message));
  await assert.rejects(() => analyzeDb(cfg(), { revenue_table: 'paiements', revenue_column: 'statut' }), (e) => e.status === 400 && /pas un nombre/.test(e.message));
});

test('la connexion est en lecture seule : une écriture est refusée par la base elle-même', { skip }, async () => {
  await assert.rejects(() => withReadOnly(cfg(), (q) => q('INSERT INTO utilisateurs(email) VALUES (\'pirate@x.fr\')')), /read only/i);
  await withReadOnly(cfg(), async (q) => assert.equal(Number((await q('SELECT COUNT(*) AS n FROM utilisateurs'))[0].n), 3, 'rien n\'a été écrit'));
});

test('erreurs de connexion : dites en français, avec quoi vérifier', { skip }, async () => {
  const fail = (patch) => analyzeDb({ ...cfg(), ...patch }).then(() => assert.fail('devait échouer'), (e) => e);
  assert.match(explainDbError(await fail({ password: 'mauvais-mot-de-passe' })), /Identifiants refusés/);
  assert.match(explainDbError(await fail({ database: 'base_qui_nexiste_pas' })), /Base introuvable|pas le droit de lire/);
  assert.match(explainDbError(await fail({ port: 1 })), /Connexion refusée/);
  await assert.rejects(() => analyzeDb({ ...cfg(), database: '' }), (e) => e.status === 400 && /nom de la base/.test(e.message));
});

test('le Récapitulatif lit les tables choisies ; elles passent avant d\'anciennes requêtes, qui marchent encore seules', { skip }, async () => {
  clearRecapCache(901); clearRecapCache(902);
  const analysed = await analyzeDb(cfg());
  const withTables = await fetchRecap(901, { ...cfg(), kpi: analysed.kpi, sql_users: 'SELECT 999' }, { force: true });
  assert.deepEqual({ users: withTables.users, clients: withTables.clients, revenue: withTables.revenue }, { users: 3, clients: 2, revenue: 197.5 }, 'les tables choisies l\'emportent sur l\'ancienne requête');
  const legacy = await fetchRecap(902, { ...cfg(), sql_users: 'SELECT COUNT(*) FROM utilisateurs' }, { force: true });
  assert.equal(legacy.users, 3, 'une requête écrite à la main avant continue de fonctionner');
  await assert.rejects(() => fetchRecap(903, { ...cfg(), kpi: {} }, { force: true }), /Aucune table choisie/);
});
