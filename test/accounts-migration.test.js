import { test } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../src/db.js';
import { MIGRATIONS } from '../src/migrations.js';
import { loginIdentity } from '../src/users.js';
import { testDb, USING_MYSQL } from './helpers/db.js';

// Migration 2 (comptes et multi-tenant) : une instance existante, mono-utilisateur, passe au schéma multi-utilisateur
// et ses données sont rattachées à l'utilisateur propriétaire (première adresse de ADMIN_EMAILS), sans perte.

const TABLES = ['projects', 'templates', 'prospects', 'prospect_notes', 'mail_log', 'metrics_daily', 'jobs', 'blacklist'];

/** Base à la version 1 avec des données « d'avant les comptes ». */
async function legacy() {
  const db = await testDb({ upTo: 1 });
  const t = now();
  await db.prepare('INSERT INTO projects(id, name, git_url, smtp_enc, daily_mail_cap, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(7, 'Café Été', 'https://git.x/a.git', 'v1:smtp:chiffré', 12, t);
  await db.prepare('INSERT INTO projects(id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(42, 'Autre', 'https://git.x/b.git', t);
  await db.prepare('INSERT INTO prospects(id, project_id, company, email, created_at) VALUES(?, ?, ?, ?, ?)').run(1001, 7, 'Léa', 'lea@x.fr', t);
  await db.prepare('INSERT INTO prospect_notes(id, prospect_id, body, created_at) VALUES(?, ?, ?, ?)').run(5, 1001, 'à rappeler', t);
  await db.prepare('INSERT INTO templates(project_id, kind, subject, body, updated_at) VALUES(?, ?, ?, ?, ?)').run(7, 'initial', 'Objet', 'Corps', t);
  await db.prepare('INSERT INTO mail_log(id, project_id, prospect_id, email, sent_at) VALUES(?, ?, ?, ?, ?)').run(9, 7, 1001, 'lea@x.fr', t);
  await db.prepare('INSERT INTO metrics_daily(project_id, day, users) VALUES(?, ?, ?)').run(7, '2026-10-21', 10);
  await db.prepare('INSERT INTO jobs(id, project_id, type, status, cost_usd, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(300, 7, 'analyze', 'done', 0.5, t);
  await db.prepare('INSERT INTO jobs(id, project_id, type, status, created_at) VALUES(?, NULL, ?, ?, ?)').run(301, 'send', 'done', t); // job sans projet
  await db.prepare('INSERT INTO blacklist(email, reason, created_at) VALUES(?, ?, ?)').run('no@x.fr', 'unsubscribe', t);
  await db.prepare('INSERT INTO settings(`key`, value) VALUES(?, ?)').run('notify_email', 'tony@x.fr');
  await db.prepare('INSERT INTO settings(`key`, value) VALUES(?, ?)').run('budget_day_usd', '3');
  await db.prepare('INSERT INTO sessions(id, email, created_at, expires_at) VALUES(?, ?, ?, ?)').run('ancienne', 'tony@x.fr', t, t + 100);
  return db;
}

const count = async (db, t) => (await db.prepare(`SELECT COUNT(*) n FROM \`${t}\``).get()).n;

test('rattachement : toutes les données au propriétaire (1re adresse de ADMIN_EMAILS), sans perte', async () => {
  const db = await legacy();
  const before = Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await count(db, t)])));
  await db.migrate({ adminEmails: ' Tony@X.fr , autre@x.fr' });

  const users = await db.prepare('SELECT * FROM users').all();
  assert.equal(users.length, 1, 'un seul compte créé : le propriétaire');
  const owner = users[0];
  assert.deepEqual({ email: owner.email, admin: owner.is_admin, status: owner.status, plan: owner.plan, provider: owner.provider, sub: owner.provider_sub },
    { email: 'tony@x.fr', admin: 1, status: 'active', plan: 'free', provider: null, sub: null });
  assert.equal(owner.claude_link_json, null);

  for (const t of TABLES) assert.equal(await count(db, t), before[t], `${t} : aucune ligne perdue`);
  assert.deepEqual((await db.prepare('SELECT id, name, user_id, daily_mail_cap, smtp_enc FROM projects ORDER BY id').all()).map((p) => [p.id, p.name, Number(p.user_id), p.daily_mail_cap, p.smtp_enc]),
    [[7, 'Café Été', owner.id, 12, 'v1:smtp:chiffré'], [42, 'Autre', owner.id, 30, null]]);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM jobs WHERE user_id = ?').get(owner.id)).n, 2, 'tous les jobs, y compris celui sans projet');
  assert.equal((await db.prepare('SELECT project_id FROM jobs WHERE id = 301').get()).project_id, null);
  assert.equal((await db.prepare('SELECT cost_usd FROM jobs WHERE id = 300').get()).cost_usd, 0.5);
  assert.equal((await db.prepare('SELECT body FROM prospect_notes WHERE id = 5').get()).body, 'à rappeler');

  // réglages globaux → réglages du propriétaire ; ancienne table supprimée ; sessions éphémères repartent de zéro
  assert.deepEqual((await db.prepare('SELECT `key`, value FROM user_settings WHERE user_id = ? ORDER BY `key`').all(owner.id)).map((r) => [r.key, r.value]),
    [['budget_day_usd', '3'], ['notify_email', 'tony@x.fr']]);
  await assert.rejects(db.prepare('SELECT 1 FROM settings').get(), /settings/);
  assert.equal(await count(db, 'sessions'), 0);
  await db.prepare('INSERT INTO sessions(id, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)').run('nouvelle', owner.id, now(), now() + 10); // le nouveau format lie la session à un compte
  assert.equal((await db.prepare('SELECT MAX(version) v, COUNT(*) n FROM schema_migrations').get()).v, MIGRATIONS.length);

  // contraintes du nouveau schéma : unicité du dépôt PAR utilisateur, cascade depuis l'utilisateur
  const other = Number((await db.prepare("INSERT INTO users(email, status, is_admin, plan, created_at) VALUES('b@x.fr', 'active', 0, 'free', ?)").run(now())).lastInsertRowid);
  await assert.rejects(db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(owner.id, 'Doublon', 'https://git.x/a.git', now()));
  await db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(other, 'Même dépôt', 'https://git.x/a.git', now());
  await assert.rejects(db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(999, 'Orphelin', 'https://git.x/z.git', now()), 'user_id doit exister');
  await assert.rejects(db.prepare('INSERT INTO projects(name, git_url, created_at) VALUES(?, ?, ?)').run('Sans propriétaire', 'https://git.x/y.git', now()), 'user_id obligatoire');
  await assert.rejects(db.prepare('INSERT INTO jobs(type, created_at) VALUES(?, ?)').run('send', now()), 'jobs.user_id obligatoire');

  if (db.dialect === 'sqlite') {
    assert.deepEqual(await db.query('PRAGMA foreign_key_check'), [], 'aucune clé étrangère violée');
    assert.equal((await db.prepare('PRAGMA foreign_keys').get()).foreign_keys, 1, 'clés étrangères réactivées après la migration');
  }
  await db.prepare('DELETE FROM users WHERE id = ?').run(owner.id);
  for (const t of ['projects', 'templates', 'prospects', 'prospect_notes', 'mail_log', 'metrics_daily', 'user_settings']) {
    const n = await count(db, t);
    assert.equal(n, t === 'projects' ? 1 : 0, `${t} : supprimé avec le propriétaire (reste le projet de l'autre compte)`);
  }
  assert.equal(await count(db, 'jobs'), 0);
  assert.equal(await count(db, 'blacklist'), 1, 'la liste d\'opposition ne dépend d\'aucun compte');
});

test('rattachement : le propriétaire se connecte et retrouve ses données par son email', async () => {
  const db = await legacy();
  await db.migrate({ adminEmails: ['tony@x.fr'] });
  const prepared = (await db.prepare('SELECT id FROM users').get()).id;
  const user = await loginIdentity(db, { adminEmails: ['tony@x.fr'] }, { provider: 'google', sub: 'g-tony', email: 'Tony@X.fr', name: 'Tony' });
  assert.equal(user.id, Number(prepared), 'même compte : pas de doublon');
  assert.equal(user.isAdmin, true);
  assert.equal(user.provider, 'google');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects WHERE user_id = ?').get(user.id)).n, 2);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM users').get()).n, 1);
});

test('rattachement : refusé sans ADMIN_EMAILS quand des données existent (la base reste en version 1)', async () => {
  const db = await legacy();
  await assert.rejects(db.migrate({}), /ADMIN_EMAILS/);
  await assert.rejects(db.migrate({ adminEmails: '  , ' }), /ADMIN_EMAILS/);
  assert.equal((await db.prepare('SELECT MAX(version) v FROM schema_migrations').get()).v, 1);
  assert.equal(await count(db, 'projects'), 2, 'rien n\'a été touché');
  if (!USING_MYSQL) await assert.rejects(db.prepare('SELECT 1 FROM users').get(), /users/);
  // une fois ADMIN_EMAILS défini, la migration passe
  await db.migrate({ adminEmails: 'tony@x.fr' });
  assert.equal((await db.prepare('SELECT MAX(version) v FROM schema_migrations').get()).v, MIGRATIONS.length);
});

test('rattachement : base vide sans ADMIN_EMAILS → migration sans propriétaire, premier admin créé à sa connexion', async () => {
  const db = await testDb({ upTo: 1 });
  await db.migrate({});
  assert.equal(await count(db, 'users'), 0);
  const admin = await loginIdentity(db, { adminEmails: ['tony@x.fr'] }, { provider: 'google', sub: 'g1', email: 'tony@x.fr' });
  assert.equal(admin.isAdmin, true);
  const user = await loginIdentity(db, { adminEmails: ['tony@x.fr'] }, { provider: 'apple', sub: 'a1', email: 'visiteur@x.fr' });
  assert.equal(user.isAdmin, false);
  assert.equal(user.plan, 'free');
});

test('rattachement : la migration rejouée ne change rien (déjà appliquée)', async () => {
  const db = await legacy();
  await db.migrate({ adminEmails: 'tony@x.fr' });
  await db.migrate({ adminEmails: 'tony@x.fr' });
  assert.equal(await count(db, 'users'), 1);
  assert.equal(await count(db, 'projects'), 2);
});
