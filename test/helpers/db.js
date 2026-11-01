// Base de test : SQLite en mémoire par défaut ; si TEST_DB_HOST est défini, le même test tourne
// contre un vrai MySQL/MariaDB (TEST_DB_PORT, TEST_DB_USER, TEST_DB_PASSWORD, TEST_DB_NAME).
// Chaque appel crée sa propre base temporaire `<TEST_DB_NAME>_<pid>_<n>` (comme un SQLite en mémoire par test) et la supprime en fin
// de fichier : l'utilisateur doit pouvoir créer et supprimer des bases (CREATE, DROP). `TEST_DB_NAME` n'est qu'un préfixe.
import { after } from 'node:test';
import { openDb, dbConfigFromEnv } from '../../src/db.js';

export const USING_MYSQL = !!process.env.TEST_DB_HOST;

const opened = [];
let dbSeq = 0;

async function adminConnection(cfg) {
  const { default: mysql } = await import('mysql2/promise');
  return mysql.createConnection({ host: cfg.host, port: cfg.port || 3306, user: cfg.user, password: cfg.password });
}

if (USING_MYSQL) {
  after(async () => {
    await Promise.all(opened.map(({ db }) => db.close().catch(() => {})));
    const cfg = dbConfigFromEnv(process.env, 'TEST_DB_');
    const admin = await adminConnection(cfg);
    try { for (const { name } of opened) await admin.query(`DROP DATABASE IF EXISTS \`${name}\``); } finally { await admin.end(); }
  });
}

export function testDbConfig() {
  return dbConfigFromEnv(process.env, 'TEST_DB_');
}

/** Base vide, schéma migré. `opts` : { upTo, adminEmails } (voir openDb), pour tester les migrations. */
export async function testDb(opts = {}) {
  if (!USING_MYSQL) return openDb(':memory:', opts);
  const base = testDbConfig();
  const name = `${base.database}_${process.pid}_${++dbSeq}`;
  const admin = await adminConnection(base);
  try { await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`); } finally { await admin.end(); }
  const db = await openDb({ ...base, database: name, connectionLimit: 4 }, opts);
  opened.push({ db, name });
  return db;
}
