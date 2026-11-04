// Récapitulatif sans SQL : reconnaissance des tables d'après le schéma, requêtes construites (jamais saisies), refus de tout identifiant inconnu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestTable, pickAmount, suggestKpi, buildQueries, normalizeChoice, describeKpi, explainDbError } from '../src/services/dbschema.js';

const T = (name, cols = [], rows = 10) => ({ key: name, name, rows, columns: cols.map(([n, t]) => ({ name: n, type: t })) });
const schemaOf = (...tables) => ({ tables });

test('les tables sont reconnues par leur nom : anglais, français, préfixes, pluriels', () => {
  const pick = (names, ranked) => bestTable(names.map((n) => T(n)), ranked)?.name;
  const USERS = ['users', 'utilisateurs', 'accounts', 'customers'];
  assert.equal(pick(['logs', 'users', 'sessions'], USERS), 'users');
  assert.equal(pick(['sessions', 'app_users', 'migrations'], USERS), 'app_users', 'préfixe d\'application');
  assert.equal(pick(['logs', 'utilisateurs', 'config'], USERS), 'utilisateurs', 'français');
  assert.equal(pick(['logs', 'config'], USERS), undefined, 'aucune table plausible : pas de proposition inventée');
  assert.equal(pick(['users_backup', 'users'], USERS), 'users', 'le nom exact passe avant « contient »');
});

test('à nom équivalent, une table vide passe après une table qui contient des lignes', () => {
  assert.equal(bestTable([T('users', [], 0), T('utilisateurs', [], 200)], ['users', 'utilisateurs'])?.name, 'utilisateurs');
  assert.equal(bestTable([T('users', [], 0), T('app_users', [], 200)], ['users', 'utilisateurs'])?.name, 'users', 'un nom exact reste préféré à un préfixe, même vide');
});

test('colonne du montant : numérique, nom parlant, jamais une taxe ; centimes quand le nom ou la convention Stripe le dit', () => {
  const pay = T('payments', [['id', 'int'], ['tax_amount', 'int'], ['amount', 'int'], ['currency', 'char'], ['status', 'varchar']]);
  assert.deepEqual(pickAmount(pay), { column: 'amount', cents: true }, 'entier + devise = centimes ; la taxe est écartée');
  assert.deepEqual(pickAmount(T('orders', [['total', 'decimal'], ['note', 'text']])), { column: 'total', cents: false }, 'décimal = euros');
  assert.deepEqual(pickAmount(T('invoices', [['amount_cents', 'bigint']])), { column: 'amount_cents', cents: true }, 'le nom dit centimes');
  assert.equal(pickAmount(T('payments', [['label', 'varchar'], ['tax', 'decimal']])), null, 'pas de colonne de montant plausible');
});

test('suggestKpi : un schéma de SaaS usuel donne les trois tables et la colonne du montant', () => {
  const k = suggestKpi(schemaOf(T('migrations'), T('users', [['id', 'int']]), T('subscriptions', [['status', 'varchar']]), T('payments', [['amount', 'int'], ['currency', 'char']])));
  assert.deepEqual(k, { users: { table: 'users' }, clients: { table: 'subscriptions' }, revenue: { table: 'payments', amountColumn: 'amount', cents: true } });
  assert.deepEqual(suggestKpi(schemaOf(T('foo'), T('bar'))), {}, 'rien de reconnu : aucune proposition');
});

test('requêtes construites : MySQL et PostgreSQL, identifiants entre guillemets, centimes convertis', () => {
  const kpi = { users: { table: 'users' }, clients: { table: 'subscriptions', statusColumn: 'status', statusValues: ['active'] }, revenue: { table: 'payments', amountColumn: 'amount', cents: true, statusColumn: 'status', statusValues: ['succeeded'] } };
  assert.deepEqual(buildQueries('mysql', kpi), {
    users: 'SELECT COUNT(*) FROM `users`',
    clients: "SELECT COUNT(*) FROM `subscriptions` WHERE `status` IN ('active')",
    revenue: "SELECT COALESCE(SUM(`amount`), 0) / 100.0 FROM `payments` WHERE `status` IN ('succeeded')",
  });
  const pg = buildQueries('pg', { users: { table: 'public.users' }, revenue: { table: 'billing.payments', amountColumn: 'amount', cents: false } });
  assert.equal(pg.users, 'SELECT COUNT(*) FROM "public"."users"');
  assert.equal(pg.revenue, 'SELECT COALESCE(SUM("amount"), 0) FROM "billing"."payments"');
  assert.deepEqual(buildQueries('mysql', {}), {}, 'rien de choisi : aucune requête');
});

test('requêtes construites : un identifiant ou une valeur piégés ne sortent jamais de leurs guillemets', () => {
  const sql = buildQueries('mysql', { users: { table: 'a`; DROP TABLE users; --' }, clients: { table: 't', statusColumn: 's`x', statusValues: ["a' OR '1'='1", 'ok'] } });
  assert.equal(sql.users, 'SELECT COUNT(*) FROM `a``; DROP TABLE users; --`', 'le guillemet inverse est doublé');
  assert.equal(sql.clients, "SELECT COUNT(*) FROM `t` WHERE `s``x` IN ('ok')", 'une valeur au format inattendu est écartée');
  const pg = buildQueries('pg', { users: { table: 'x"; DROP TABLE y; --' } });
  assert.equal(pg.users, 'SELECT COUNT(*) FROM "x""; DROP TABLE y; --"');
});

test('normalizeChoice : seules les tables et colonnes qui existent sont acceptées', () => {
  const schema = schemaOf(T('users'), T('payments', [['amount', 'int'], ['currency', 'char'], ['note', 'text']]));
  assert.deepEqual(normalizeChoice(schema, { users_table: 'users', revenue_table: 'payments' }), { users: { table: 'users' }, revenue: { table: 'payments', amountColumn: 'amount', cents: true } });
  assert.deepEqual(normalizeChoice(schema, { revenue_table: 'payments', revenue_column: 'amount', revenue_unit: 'euros' }).revenue, { table: 'payments', amountColumn: 'amount', cents: false }, 'l\'unité choisie l\'emporte');
  assert.throws(() => normalizeChoice(schema, { users_table: 'users; DROP TABLE users' }), (e) => e.status === 400 && /Table introuvable/.test(e.message));
  assert.throws(() => normalizeChoice(schema, { revenue_table: 'payments', revenue_column: 'note' }), (e) => e.status === 400 && /pas un nombre/.test(e.message));
  assert.throws(() => normalizeChoice(schema, { revenue_table: 'nope' }), (e) => e.status === 400);
  assert.deepEqual(normalizeChoice(schema, {}), {}, 'aucune sélection : rien n\'est suivi');
});

test('describeKpi : une phrase par chiffre, avec le filtre et l\'unité', () => {
  const r = describeKpi({ users: { table: 'users' }, clients: { table: 'subs', statusColumn: 'status', statusValues: ['active', 'paid'] }, revenue: { table: 'payments', amountColumn: 'amount', cents: true } });
  assert.equal(r.users, 'Compte les lignes de « users ».');
  assert.equal(r.clients, 'Compte les lignes de « subs » dont « status » vaut « active » ou « paid ».');
  assert.equal(r.revenue, 'Additionne « amount » dans « payments », montants en centimes convertis en euros.');
});

test('explainDbError : ce qui s\'est passé et quoi vérifier, jamais un message brut du pilote', () => {
  assert.match(explainDbError({ code: 'ECONNREFUSED' }), /Connexion refusée.*hôte et le port/);
  assert.match(explainDbError({ code: 'ER_ACCESS_DENIED_ERROR' }), /Identifiants refusés/);
  assert.match(explainDbError({ code: '28P01' }), /Identifiants refusés/);
  assert.match(explainDbError({ code: 'ER_BAD_DB_ERROR' }), /Base introuvable/);
  assert.match(explainDbError({ code: 'ENOTFOUND' }), /Hôte introuvable/);
  assert.match(explainDbError(new Error('connect ETIMEDOUT 10.0.0.1:3306')), /Délai dépassé/);
});
