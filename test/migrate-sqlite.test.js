import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openDb, now } from '../src/db.js';
import { migrateSqliteToMysql, TABLES } from '../scripts/migrate-sqlite-to-mysql.js';
import { testDb } from './helpers/db.js';
import { addUser } from './helpers/users.js';

const OWNER = 'tony@x.fr';

// Fabrique une "ancienne" base mono-utilisateur : schéma d'avant les comptes (migration 1), ids non contigus,
// accents, puis marquée user_version 8 (ancien format sans schema_migrations)
async function legacyFile(dir) {
  const file = join(dir, 'aitools.sqlite');
  const db = await openDb({ driver: 'sqlite', file }, { upTo: 1 });
  const t = now();
  await db.prepare('INSERT INTO projects(id, name, git_url, daily_mail_cap, created_at) VALUES(?, ?, ?, ?, ?)').run(7, 'Café Été', 'https://git.x/a.git', 12, t);
  await db.prepare('INSERT INTO projects(id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(42, 'Autre', 'https://git.x/b.git', t);
  await db.prepare('INSERT INTO prospects(id, project_id, company, email, score, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(1001, 7, 'Boulangerie Léa', 'lea@x.fr', 8, t);
  await db.prepare('INSERT INTO prospects(id, project_id, company, email, created_at) VALUES(?, ?, ?, ?, ?)').run(1002, 7, 'Garage', 'g@x.fr', t);
  await db.prepare('INSERT INTO prospect_notes(id, prospect_id, body, created_at) VALUES(?, ?, ?, ?)').run(5, 1001, 'à rappeler 🙂', t);
  await db.prepare('INSERT INTO templates(project_id, kind, subject, body, updated_at) VALUES(?, ?, ?, ?, ?)').run(7, 'initial', 'Objet', 'Corps', t);
  await db.prepare('INSERT INTO jobs(id, project_id, type, status, cost_usd, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(300, 7, 'analyze', 'done', 0.0123, t);
  await db.prepare('INSERT INTO mail_log(id, project_id, prospect_id, email, sent_at, message_id) VALUES(?, ?, ?, ?, ?, ?)').run(9, 7, 1001, 'lea@x.fr', t, '<a@b>');
  await db.prepare('INSERT INTO blacklist(email, reason, created_at) VALUES(?, ?, ?)').run('no@x.fr', 'unsubscribe', t);
  await db.prepare('INSERT INTO metrics_daily(project_id, day, users, clients, revenue) VALUES(?, ?, ?, ?, ?)').run(7, '2026-10-21', 10, 2, 99.5);
  await db.prepare('INSERT INTO settings(`key`, value) VALUES(?, ?)').run('notify_email', 'tony@x.fr');
  await db.prepare('INSERT INTO sessions(id, email, created_at, expires_at) VALUES(?, ?, ?, ?)').run('AbC_d-1', 'tony@x.fr', t, t + 100);
  await db.close();
  // Ancien format : pas de schema_migrations, version dans user_version
  const raw = new DatabaseSync(file);
  raw.exec('DROP TABLE schema_migrations; PRAGMA user_version = 8;');
  raw.close();
  return file;
}

test('migration SQLite → cible : ids conservés, tout rattaché au propriétaire, comptes identiques', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  try {
    const sourcePath = await legacyFile(dir);
    const db = await testDb();
    const lines = [];
    const r = await migrateSqliteToMysql({ sourcePath, db, ownerEmail: OWNER, log: (l) => lines.push(l) });
    assert.deepEqual(r.tables.map((x) => x.table), TABLES);
    for (const x of r.tables) assert.equal(x.source, x.target, x.table);
    assert.equal(r.tables.find((x) => x.table === 'prospects').copied, 2);
    assert.equal(r.total, 11, 'les sessions de l\'ancienne base ne sont pas copiées');
    assert.equal(lines.length, TABLES.length + 1, 'une ligne par table + le propriétaire');

    const owner = await db.prepare('SELECT id, is_admin, status FROM users WHERE email = ?').get(OWNER);
    assert.equal(owner.is_admin, 1);
    assert.equal(owner.id, r.ownerId);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM users').get()).n, 1);
    assert.deepEqual((await db.prepare('SELECT id, name, user_id FROM projects ORDER BY id').all()).map((p) => [p.id, p.name, Number(p.user_id)]),
      [[7, 'Café Été', owner.id], [42, 'Autre', owner.id]]);
    assert.equal((await db.prepare('SELECT user_id FROM jobs WHERE id = 300').get()).user_id, owner.id);
    assert.deepEqual({ ...(await db.prepare('SELECT user_id, `key`, value FROM user_settings').get()) }, { user_id: owner.id, key: 'notify_email', value: 'tony@x.fr' });
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM sessions').get()).n, 0);
    assert.equal((await db.prepare('SELECT company FROM prospects WHERE id = ?').get(1001)).company, 'Boulangerie Léa');
    assert.equal((await db.prepare('SELECT body FROM prospect_notes WHERE id = 5').get()).body, 'à rappeler 🙂');
    assert.equal((await db.prepare('SELECT cost_usd FROM jobs WHERE id = 300').get()).cost_usd, 0.0123);
    assert.equal((await db.prepare('SELECT daily_mail_cap FROM projects WHERE id = 7').get()).daily_mail_cap, 12);
    assert.equal((await db.prepare('SELECT revenue FROM metrics_daily').get()).revenue, 99.5);
    // Les relations survivent à la copie : suppression en cascade
    await db.prepare('DELETE FROM projects WHERE id = 7').run();
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM prospects').get()).n, 0);
    // Les nouvelles lignes continuent après le plus grand id copié
    const next = await db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(owner.id, 'Neuf', 'https://git.x/c.git', now());
    assert.ok(next.lastInsertRowid > 42);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migration : le propriétaire existant (même email) est réutilisé, l\'email est obligatoire', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  try {
    const sourcePath = await legacyFile(dir);
    const db = await testDb();
    const id = await addUser(db, { email: OWNER, admin: false });
    await assert.rejects(migrateSqliteToMysql({ sourcePath, db, ownerEmail: '' }), /ADMIN_EMAILS/);
    const r = await migrateSqliteToMysql({ sourcePath, db, ownerEmail: 'Tony@X.fr' });
    assert.equal(r.ownerId, id);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM users').get()).n, 1);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects WHERE user_id = ?').get(id)).n, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migration : refuse une cible non vide, --force la vide puis copie', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  try {
    const sourcePath = await legacyFile(dir);
    const db = await testDb();
    const u = await addUser(db, { email: OWNER });
    await db.prepare('INSERT INTO projects(id, user_id, name, git_url, created_at) VALUES(?, ?, ?, ?, ?)').run(1, u, 'Déjà là', 'https://git.x/z.git', now());
    await assert.rejects(migrateSqliteToMysql({ sourcePath, db, ownerEmail: OWNER }), /pas vide.*projects \(1\).*--force/s);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects').get()).n, 1, 'rien n\'a été touché');

    const r = await migrateSqliteToMysql({ sourcePath, db, ownerEmail: OWNER, force: true });
    assert.equal(r.total, 11);
    assert.deepEqual((await db.prepare('SELECT id FROM projects ORDER BY id').all()).map((p) => p.id), [7, 42]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migration : une erreur en cours de copie annule tout (transaction), propriétaire compris', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  try {
    const sourcePath = await legacyFile(dir);
    // Source corrompue après coup : un prospect pointe vers un projet qui n'existe pas
    const raw = new DatabaseSync(sourcePath);
    raw.exec('PRAGMA foreign_keys = OFF; UPDATE prospects SET project_id = 999 WHERE id = 1002;');
    raw.close();
    const db = await testDb();
    await assert.rejects(migrateSqliteToMysql({ sourcePath, db, ownerEmail: OWNER }), /FOREIGN KEY|child row/i);
    for (const t of TABLES) assert.equal((await db.prepare(`SELECT COUNT(*) n FROM \`${t === 'settings' ? 'user_settings' : t}\``).get()).n, 0, `${t} doit rester vide`);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM users').get()).n, 0, 'le propriétaire n\'est pas créé non plus');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migration : refuse une source dans une mauvaise version, déjà multi-utilisateur, ou absente', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  try {
    const sourcePath = await legacyFile(dir);
    const raw = new DatabaseSync(sourcePath);
    raw.exec('PRAGMA user_version = 5;');
    raw.close();
    const db = await testDb();
    await assert.rejects(migrateSqliteToMysql({ sourcePath, db, ownerEmail: OWNER }), /version 5/);
    await assert.rejects(migrateSqliteToMysql({ sourcePath: join(dir, 'nope.sqlite'), db, ownerEmail: OWNER }), /introuvable/);

    const current = join(dir, 'current.sqlite');
    await (await openDb({ driver: 'sqlite', file: current })).close();
    await assert.rejects(migrateSqliteToMysql({ sourcePath: current, db, ownerEmail: OWNER }), /multi-utilisateur/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
