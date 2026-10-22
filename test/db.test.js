import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, translate, dbConfigFromEnv, getSetting, setSetting, now } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { addUser } from './helpers/users.js';
import { MIGRATIONS } from '../src/migrations.js';

test('translate : MySQL reçoit INSERT IGNORE, ON DUPLICATE KEY, VALUES() et pas de NOCASE', () => {
  const up = 'INSERT INTO t(a, b) VALUES(?, ?) ON CONFLICT(a, b) DO UPDATE SET x = excluded.x, y = excluded.y';
  assert.equal(translate('INSERT OR IGNORE INTO t VALUES(?)', 'mysql'), 'INSERT IGNORE INTO t VALUES(?)');
  assert.equal(translate(up, 'mysql'), 'INSERT INTO t(a, b) VALUES(?, ?) ON DUPLICATE KEY UPDATE x = VALUES(x), y = VALUES(y)');
  assert.equal(translate('SELECT * FROM t ORDER BY name COLLATE NOCASE', 'mysql'), 'SELECT * FROM t ORDER BY name');
  // SQLite : la forme canonique passe telle quelle
  assert.equal(translate(up, 'sqlite'), up);
  assert.equal(translate('INSERT OR IGNORE INTO t VALUES(?)', 'sqlite'), 'INSERT OR IGNORE INTO t VALUES(?)');
});

test('dbConfigFromEnv : variables DB_*, port par défaut, erreur claire', () => {
  assert.deepEqual(
    dbConfigFromEnv({ DB_HOST: 'h', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'n' }),
    { driver: 'mysql', host: 'h', port: 3306, user: 'u', password: 'p', database: 'n' },
  );
  assert.equal(dbConfigFromEnv({ DB_HOST: 'h', DB_USER: 'u', DB_NAME: 'n', DB_PORT: '3307' }).port, 3307);
  assert.throws(() => dbConfigFromEnv({ DB_HOST: 'h' }), /DB_USER/);
  assert.deepEqual(dbConfigFromEnv({ DB_DRIVER: 'sqlite' }), { driver: 'sqlite', file: ':memory:' });
});

test('shim : get / all / run asynchrones, run → changes + lastInsertRowid', async () => {
  const db = await testDb();
  const u = await addUser(db);
  const pending = db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(u, 'A', 'u1', now());
  assert.ok(pending instanceof Promise);
  await pending;
  const r1 = await db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(u, 'B', 'u2', now());
  assert.equal(r1.changes, 1);
  assert.ok(r1.lastInsertRowid > 0);
  assert.equal((await db.prepare('SELECT name FROM projects WHERE id = ?').get(r1.lastInsertRowid)).name, 'B');
  assert.equal((await db.prepare('SELECT * FROM projects').all()).length, 2);
  assert.equal(await db.prepare('SELECT * FROM projects WHERE id = ?').get(99999), undefined);
  assert.equal((await db.prepare('UPDATE projects SET name = ? WHERE git_url = ?').run('Z', 'u2')).changes, 1);
  assert.equal((await db.prepare('UPDATE projects SET name = ? WHERE git_url = ?').run('Z', 'nope')).changes, 0);
});

test('shim : undefined et NaN deviennent NULL', async () => {
  const db = await testDb();
  const u = await addUser(db);
  await db.prepare('INSERT INTO projects(user_id, name, git_url, created_at, profile_at) VALUES(?, ?, ?, ?, ?)').run(u, 'A', 'u', now(), Number('abc'));
  await db.prepare('UPDATE projects SET profile_commit = ? WHERE git_url = ?').run(undefined, 'u');
  const p = await db.prepare('SELECT profile_at, profile_commit FROM projects').get();
  assert.equal(p.profile_at, null);
  assert.equal(p.profile_commit, null);
});

test('upsert (ON CONFLICT) et INSERT OR IGNORE dans le sous-ensemble commun', async () => {
  const db = await testDb();
  const u = await addUser(db), v = await addUser(db);
  await setSetting(db, u, 'a', '1'); await setSetting(db, u, 'a', '2');
  assert.equal(await getSetting(db, u, 'a'), '2');
  assert.equal(await getSetting(db, u, 'nope', 'x'), 'x');
  assert.equal(await getSetting(db, v, 'a', 'autre'), 'autre', 'les réglages sont propres à chaque utilisateur');
  await setSetting(db, u, 'a', null);
  assert.equal(await getSetting(db, u, 'a', 'fallback'), null);
  await assert.rejects(setSetting(db, undefined, 'a', '1'), /utilisateur requis/);

  const ins = db.prepare("INSERT OR IGNORE INTO blacklist(email, reason, created_at) VALUES(?, 'x', ?)");
  assert.equal((await ins.run('a@b.fr', now())).changes, 1);
  assert.equal((await ins.run('a@b.fr', now())).changes, 0);
});

test('clés étrangères : supprimer un projet supprime ses dépendances (CASCADE)', async () => {
  const db = await testDb();
  const u = await addUser(db);
  const { lastInsertRowid: pid } = await db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(u, 'A', 'u', now());
  const { lastInsertRowid: prid } = await db.prepare('INSERT INTO prospects(project_id, company, email, created_at) VALUES(?, ?, ?, ?)').run(pid, 'C', 'c@d.fr', now());
  await db.prepare('INSERT INTO prospect_notes(prospect_id, body, created_at) VALUES(?, ?, ?)').run(prid, 'n', now());
  await db.prepare('INSERT INTO jobs(user_id, project_id, type, created_at) VALUES(?, ?, ?, ?)').run(u, pid, 'analyze', now());
  await db.prepare('DELETE FROM projects WHERE id = ?').run(pid);
  for (const t of ['prospects', 'prospect_notes', 'jobs']) assert.equal((await db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).n, 0, t);
});

test('transaction : commit, rollback sur erreur, résultat renvoyé', async () => {
  const db = await testDb();
  const out = await db.transaction(async (tx) => {
    await tx.prepare("INSERT INTO blacklist(email, created_at) VALUES('a@b.fr', ?)").run(now());
    return 42;
  });
  assert.equal(out, 42);
  await assert.rejects(db.transaction(async (tx) => {
    await tx.prepare("INSERT INTO blacklist(email, created_at) VALUES('c@d.fr', ?)").run(now());
    throw new Error('boum');
  }), /boum/);
  const rows = await db.prepare('SELECT email FROM blacklist').all();
  assert.deepEqual(rows.map((r) => r.email), ['a@b.fr']);
});

test('transaction : une requête hors transaction ne voit jamais une écriture annulée', async () => {
  const db = await testDb();
  let seen;
  const tx = db.transaction(async (t) => {
    await t.prepare("INSERT INTO blacklist(email, created_at) VALUES('x@y.fr', ?)").run(now());
    await new Promise((r) => setTimeout(r, 30));
    throw new Error('annulée');
  });
  const outside = new Promise((r) => setTimeout(r, 10)).then(async () => {
    seen = await db.prepare('SELECT COUNT(*) n FROM blacklist').get();
  });
  await assert.rejects(tx, /annulée/);
  await outside;
  assert.equal(seen.n, 0);
});

test('migrations idempotentes : rouvrir une base déjà migrée ne casse rien (SQLite fichier)', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  try {
    const file = join(dir, 't.sqlite');
    const a = await openDb({ driver: 'sqlite', file });
    const u = await addUser(a);
    await setSetting(a, u, 'k', 'v');
    await a.close();
    const b = await openDb({ driver: 'sqlite', file });
    assert.equal(await getSetting(b, u, 'k'), 'v');
    assert.equal((await b.prepare('SELECT COUNT(*) n FROM schema_migrations').get()).n, MIGRATIONS.length);
    await b.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
