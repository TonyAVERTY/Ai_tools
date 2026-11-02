// Couche d'accès aux données : une seule API asynchrone, deux drivers.
//   - MySQL / MariaDB (mysql2/promise, pool) en production ;
//   - SQLite en mémoire (node:sqlite) pour les tests locaux, sans serveur à installer.
// Le SQL de l'application est écrit dans un sous-ensemble commun ; translate() ne fait que le strict
// minimum entre dialectes (voir plus bas). Les requêtes vraiment différentes sont réécrites à la source.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './migrations.js';

export { MIGRATIONS };

/** Paramètres de connexion depuis les variables d'environnement (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME). */
export function dbConfigFromEnv(env = process.env, prefix = 'DB_') {
  const get = (k) => env[`${prefix}${k}`];
  if (get('DRIVER') === 'sqlite') return { driver: 'sqlite', file: get('FILE') || ':memory:' };
  for (const k of ['HOST', 'USER', 'NAME']) {
    if (!get(k)) throw new Error(`Variable d'environnement manquante : ${prefix}${k}`);
  }
  return {
    driver: 'mysql', host: get('HOST'), port: Number(get('PORT') || 3306), user: get('USER'),
    password: get('PASSWORD') ?? '', database: get('NAME'),
  };
}

/**
 * Traduit le SQL "canonique" (écrit une seule fois dans le code) vers le dialecte cible.
 * Forme canonique = celle de SQLite : INSERT OR IGNORE, ON CONFLICT(cols) DO UPDATE SET x = excluded.x.
 * Les noms réservés (`key`) sont entre accents graves, acceptés par les deux moteurs.
 */
export function translate(sql, dialect) {
  if (dialect !== 'mysql') return sql;
  return sql
    .replace(/\bINSERT\s+OR\s+IGNORE\b/gi, 'INSERT IGNORE')
    .replace(/\bON\s+CONFLICT\s*\([^)]*\)\s*DO\s+UPDATE\s+SET\b/gi, 'ON DUPLICATE KEY UPDATE')
    .replace(/\bexcluded\.(\w+)/gi, 'VALUES($1)')
    .replace(/\s+COLLATE\s+NOCASE\b/gi, ''); // MySQL compare déjà sans casse (utf8mb4_unicode_ci)
}

// undefined et NaN (Number('abc') dans une route) deviennent NULL, comme avec SQLite
const norm = (params) => params.map((p) => (p === undefined || (typeof p === 'number' && !Number.isFinite(p)) ? null : p));

// API commune : db.prepare(sql).get / all / run(...params), toutes asynchrones.
// Les sous-classes fournissent _exec(sql, params, mode) avec mode = 'get' | 'all' | 'run'.
class Executor {
  prepare(sql) {
    return {
      get: (...params) => this._exec(sql, norm(params), 'get'),
      all: (...params) => this._exec(sql, norm(params), 'all'),
      /** @returns {Promise<{changes: number, lastInsertRowid: number}>} */
      run: (...params) => this._exec(sql, norm(params), 'run'),
    };
  }

  /** Requête libre (renvoie les lignes). */
  query(sql, params = []) { return this._exec(sql, norm(params), 'all'); }
}

// ---------- MySQL / MariaDB ----------

class MysqlExecutor extends Executor {
  constructor(conn) { super(); this.conn = conn; }

  async _exec(sql, params, mode) {
    const [r] = await this.conn.query(translate(sql, 'mysql'), params);
    if (mode === 'get') return r[0];
    if (mode === 'all') return r;
    return { changes: r.affectedRows ?? 0, lastInsertRowid: r.insertId ?? 0 };
  }
}

class MysqlDb extends MysqlExecutor {
  constructor(pool) { super(pool); this.pool = pool; this.dialect = 'mysql'; }

  /** Applique les migrations en attente (jusqu'à `upTo`), avec le contexte { adminEmails }. */
  migrate(opts = {}) { return migrateMysql(this, opts); }

  /** fn(tx) reçoit un exécuteur lié à UNE connexion ; commit si tout va bien, rollback sinon. */
  async transaction(fn) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(new MysqlExecutor(conn));
      await conn.commit();
      return result;
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }

  // Idempotent : une fermeture en double (arrêt de l'application puis nettoyage des tests) ne doit pas échouer
  close() { return (this.closing ??= this.pool.end()); }
}

async function openMysql(cfg, opts) {
  const { default: mysql } = await import('mysql2/promise');
  const pool = mysql.createPool({
    host: cfg.host, port: cfg.port || 3306, user: cfg.user, password: cfg.password, database: cfg.database,
    charset: 'UTF8MB4_UNICODE_CI',
    waitForConnections: true, connectionLimit: cfg.connectionLimit || 10,
    decimalNumbers: true,            // SUM()/AVG() en nombres, pas en chaînes
    supportBigNumbers: true, bigNumberStrings: false,
    flags: ['+FOUND_ROWS'],          // affectedRows = lignes trouvées (comme SQLite), pas seulement modifiées
    timezone: 'Z',
  });
  const db = new MysqlDb(pool);
  try { await db.migrate(opts); }
  catch (e) { await pool.end().catch(() => {}); throw e; }
  return db;
}

// Verrou applicatif (GET_LOCK) : deux instances qui démarrent en même temps ne migrent pas en parallèle.
// Le verrou est lié à la connexion : on garde la même du début à la fin.
async function migrateMysql(db, opts = {}) {
  const conn = await db.pool.getConnection();
  const ctx = migrationContext(opts);
  const q = async (sql, params = []) => (await conn.query(sql, params))[0];
  const LOCK = 'aitools_migrate';
  try {
    const [[lock]] = await conn.query('SELECT GET_LOCK(?, 60) ok', [LOCK]);
    if (lock.ok !== 1) throw new Error('Migrations : verrou non obtenu (une autre instance migre ?)');
    try {
      await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT NOT NULL PRIMARY KEY, name VARCHAR(100) NOT NULL, applied_at BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      const [rows] = await conn.query('SELECT version FROM schema_migrations');
      const done = new Set(rows.map((r) => r.version));
      for (let i = 0; i < Math.min(MIGRATIONS.length, opts.upTo ?? Infinity); i++) {
        const version = i + 1;
        if (done.has(version)) continue;
        await MIGRATIONS[i].check?.(q, ctx);
        for (const st of MIGRATIONS[i].mysql) await runStatement(st, q, ctx);
        await conn.query('INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)',
          [version, MIGRATIONS[i].name, now()]);
      }
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [LOCK]).catch(() => {});
    }
  } finally {
    conn.release();
  }
}

// ---------- SQLite (tests locaux) ----------

class SqliteExecutor extends Executor {
  constructor(raw) { super(); this.raw = raw; this.cache = new Map(); }

  _stmt(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.raw.prepare(translate(sql, 'sqlite')); this.cache.set(sql, s); }
    return s;
  }

  _run(sql, params, mode) {
    const s = this._stmt(sql);
    if (mode === 'get') return s.get(...params);
    if (mode === 'all') return s.all(...params);
    const r = s.run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  async _exec(sql, params, mode) { return this._run(sql, params, mode); }
}

class SqliteDb extends SqliteExecutor {
  constructor(raw) { super(raw); this.dialect = 'sqlite'; this.txLock = null; }

  /** Applique les migrations en attente (jusqu'à `upTo`), avec le contexte { adminEmails }. */
  migrate(opts = {}) { return migrateSqlite(this.raw, opts); }

  // Une seule connexion : pendant une transaction, les autres requêtes attendent sa fin
  // (sinon elles s'exécuteraient DANS la transaction). Ne pas appeler db.* depuis le callback : utiliser tx.*.
  async _exec(sql, params, mode) {
    while (this.txLock) await this.txLock;
    return this._run(sql, params, mode);
  }

  async transaction(fn) {
    while (this.txLock) await this.txLock;
    let release;
    this.txLock = new Promise((r) => { release = r; });
    this.raw.exec('BEGIN');
    try {
      const result = await fn(new SqliteExecutor(this.raw));
      this.raw.exec('COMMIT');
      return result;
    } catch (e) {
      try { this.raw.exec('ROLLBACK'); } catch { /* déjà annulée */ }
      throw e;
    } finally {
      this.txLock = null;
      release();
    }
  }

  async close() { this.raw.close(); }
}

async function openSqlite(file = ':memory:', opts = {}) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const db = new SqliteDb(raw);
  try { await db.migrate(opts); }
  catch (e) { raw.close(); throw e; }
  return db;
}

async function migrateSqlite(raw, opts = {}) {
  raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL
  )`);
  const ctx = migrationContext(opts);
  const q = async (sql, params = []) => raw.prepare(sql).all(...params);
  const done = new Set(raw.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  for (let i = 0; i < Math.min(MIGRATIONS.length, opts.upTo ?? Infinity); i++) {
    const version = i + 1;
    if (done.has(version)) continue;
    const m = MIGRATIONS[i];
    // PRAGMA foreign_keys est sans effet dans une transaction : on le règle avant BEGIN
    if (m.sqliteForeignKeysOff) raw.exec('PRAGMA foreign_keys = OFF');
    try {
      raw.exec('BEGIN');
      try {
        await m.check?.(q, ctx);
        for (const st of m.sqlite) await runStatement(st, q, ctx, (sql, params) => raw.prepare(sql).run(...params));
        if (m.sqliteForeignKeysOff) {
          const bad = raw.prepare('PRAGMA foreign_key_check').all();
          if (bad.length) throw new Error(`Migration ${version} : clés étrangères violées (${bad[0].table} → ${bad[0].parent})`);
        }
        raw.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)').run(version, m.name, now());
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    } finally {
      if (m.sqliteForeignKeysOff) raw.exec('PRAGMA foreign_keys = ON');
    }
  }
}

/**
 * Ouvre la base et applique les migrations en attente.
 * cfg = { driver: 'mysql', host, port, user, password, database } ou { driver: 'sqlite', file } ;
 * sans argument (ou ':memory:') : SQLite en mémoire.
 * opts = { adminEmails } (propriétaire des données existantes, voir migration 2) ; { upTo } limite la version
 * migrée (tests de migration), db.migrate() applique ensuite le reste.
 */
export async function openDb(cfg = ':memory:', opts = {}) {
  if (typeof cfg === 'string') return openSqlite(cfg, opts);
  if (cfg.driver === 'sqlite') return openSqlite(cfg.file, opts);
  return openMysql(cfg, opts);
}

// Contexte des migrations : le propriétaire des données existantes est la première adresse de ADMIN_EMAILS
function migrationContext({ adminEmails } = {}) {
  const list = (Array.isArray(adminEmails) ? adminEmails : String(adminEmails || '').split(','))
    .map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  return { ownerEmail: list[0] || null, now: now() };
}

// Instruction de migration : chaîne SQL, { sql, params(ctx), when(q, ctx) } ou { run(q, ctx, exec) } (étape en JavaScript)
async function runStatement(st, q, ctx, exec = q) {
  if (typeof st === 'string') return exec(st, []);
  if (st.run) return st.run(q, ctx, exec); // étape en JavaScript : q lit, exec écrit
  if (st.when && !(await st.when(q, ctx))) return undefined;
  return exec(st.sql, st.params ? st.params(ctx) : []);
}

export const now = () => Math.floor(Date.now() / 1000);

// Réglages par utilisateur (aucun réglage global : chaque compte a les siens)
function uid(userId) {
  if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) throw new Error('Réglage : utilisateur requis');
  return Number(userId);
}

export async function getSetting(db, userId, key, fallback = null) {
  const row = await db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND `key` = ?').get(uid(userId), key);
  return row ? row.value : fallback;
}

export async function setSetting(db, userId, key, value) {
  await db.prepare('INSERT INTO user_settings(user_id, `key`, value) VALUES(?, ?, ?) ON CONFLICT(user_id, `key`) DO UPDATE SET value = excluded.value')
    .run(uid(userId), key, value);
}
