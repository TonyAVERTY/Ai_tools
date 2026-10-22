// Récap : requêtes SELECT en lecture seule sur la BDD de chaque projet.
// Recommandation : utilisateur BDD dédié avec droits SELECT uniquement.

export function validateSelect(sql) {
  const s = String(sql || '').trim().replace(/;\s*$/, '');
  if (!s) return null;
  if (!/^(select|with)\b/i.test(s)) throw new Error('Seules les requêtes SELECT sont autorisées');
  if (s.includes(';')) throw new Error('Une seule requête par champ');
  if (/\b(insert|update|delete|drop|alter|truncate|create|grant|replace|into\s+outfile|load_file|pg_sleep|sleep\s*\()/i.test(s)) {
    throw new Error('Mot-clé interdit dans la requête');
  }
  return s;
}

async function queryMysql(cfg, queries) {
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({
    host: cfg.host, port: Number(cfg.port || 3306), user: cfg.user, password: cfg.password,
    database: cfg.database, connectTimeout: 8000, ssl: cfg.ssl ? { servername: cfg.servername } : undefined,
  });
  try {
    await conn.query('START TRANSACTION READ ONLY');
    const out = {};
    for (const [k, sql] of Object.entries(queries)) {
      const [rows] = await conn.query({ sql, timeout: 10_000 });
      out[k] = firstValue(rows);
    }
    await conn.query('ROLLBACK');
    return out;
  } finally { await conn.end().catch(() => {}); }
}

async function queryPg(cfg, queries) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    host: cfg.host, port: Number(cfg.port || 5432), user: cfg.user, password: cfg.password,
    database: cfg.database, connectionTimeoutMillis: 8000, statement_timeout: 10_000,
    ssl: cfg.ssl ? { rejectUnauthorized: false, servername: cfg.servername } : undefined,
  });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const out = {};
    for (const [k, sql] of Object.entries(queries)) out[k] = firstValue((await client.query(sql)).rows);
    await client.query('ROLLBACK');
    return out;
  } finally { await client.end().catch(() => {}); }
}

export function firstValue(rows) {
  const row = rows?.[0];
  if (!row) return 0;
  const v = Object.values(row)[0];
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

const cache = new Map();
const TTL = 10 * 60_000;

export async function fetchRecap(projectId, cfg, { force = false } = {}) {
  if (!cfg?.type) throw new Error('Accès BDD non configuré pour ce projet');
  const hit = cache.get(projectId);
  if (!force && hit && Date.now() - hit.at < TTL) return { ...hit.data, cached: true };
  const queries = {};
  for (const k of ['users', 'clients', 'revenue']) {
    const s = validateSelect(cfg[`sql_${k}`]);
    if (s) queries[k] = s;
  }
  if (!Object.keys(queries).length) throw new Error('Aucune requête configurée');
  const data = cfg.type === 'pg' ? await queryPg(cfg, queries) : await queryMysql(cfg, queries);
  cache.set(projectId, { at: Date.now(), data });
  return { ...data, cached: false };
}

export function clearRecapCache(projectId) { cache.delete(projectId); }
