// Base de test : SQLite en mémoire par défaut ; si TEST_DB_HOST est défini, le même test tourne
// contre un vrai MySQL/MariaDB (TEST_DB_PORT, TEST_DB_USER, TEST_DB_PASSWORD, TEST_DB_NAME).
// ATTENTION : toutes les tables de cette base sont supprimées à chaque ouverture. Utiliser une base
// dédiée aux tests, et lancer avec --test-concurrency=1 (npm run test:mysql) : les fichiers de test
// partagent la même base.
import { after } from 'node:test';
import { openDb, dbConfigFromEnv } from '../../src/db.js';

export const USING_MYSQL = !!process.env.TEST_DB_HOST;

const opened = [];
if (USING_MYSQL) after(() => Promise.all(opened.map((d) => d.close().catch(() => {}))));

async function wipe(db) {
  const tables = (await db.query('SHOW TABLES')).map((r) => Object.values(r)[0]);
  await db.transaction(async (tx) => {
    await tx.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of tables) await tx.query(`DROP TABLE IF EXISTS \`${t}\``);
    await tx.query('SET FOREIGN_KEY_CHECKS = 1');
  });
}

export function testDbConfig() {
  return dbConfigFromEnv(process.env, 'TEST_DB_');
}

/** Base vide, schéma migré. */
export async function testDb() {
  if (!USING_MYSQL) return openDb(':memory:');
  const cfg = { ...testDbConfig(), connectionLimit: 4 };
  const raw = await openDb(cfg);
  await wipe(raw);
  await raw.close();
  const db = await openDb(cfg);
  opened.push(db);
  return db;
}
