// Connexion à la base d'un projet, toujours en LECTURE SEULE : une transaction « read only » annulée à la fin, un délai court, une seule connexion.
// Partagé par le Récapitulatif (recap.js) et l'analyse des tables (dbschema.js). L'adresse a déjà été vérifiée et fixée par netguard.pinDb.
//   await withReadOnly(cfg, async (q) => { const rows = await q('SELECT …'); … });

const TIMEOUT_MS = 10_000;

async function withMysql(cfg, fn) {
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({
    host: cfg.host, port: Number(cfg.port || 3306), user: cfg.user, password: cfg.password,
    database: cfg.database || undefined, connectTimeout: 8000, ssl: cfg.ssl ? { servername: cfg.servername } : undefined,
  });
  try {
    await conn.query('START TRANSACTION READ ONLY');
    const out = await fn(async (sql) => (await conn.query({ sql, timeout: TIMEOUT_MS }))[0]);
    await conn.query('ROLLBACK');
    return out;
  } finally { await conn.end().catch(() => {}); }
}

async function withPg(cfg, fn) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    host: cfg.host, port: Number(cfg.port || 5432), user: cfg.user, password: cfg.password,
    database: cfg.database, connectionTimeoutMillis: 8000, statement_timeout: TIMEOUT_MS,
    ssl: cfg.ssl ? { rejectUnauthorized: false, servername: cfg.servername } : undefined,
  });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const out = await fn(async (sql) => (await client.query(sql)).rows);
    await client.query('ROLLBACK');
    return out;
  } finally { await client.end().catch(() => {}); }
}

export const withReadOnly = (cfg, fn) => (cfg.type === 'pg' ? withPg(cfg, fn) : withMysql(cfg, fn));
