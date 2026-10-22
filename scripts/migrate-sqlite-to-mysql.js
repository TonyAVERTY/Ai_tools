// Copie une ancienne base SQLite (data/aitools.sqlite) vers la base MySQL/MariaDB, ids conservés.
//
//   node --env-file=.env scripts/migrate-sqlite-to-mysql.js data/aitools.sqlite [--force]
//
// - cible = variables DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME (les migrations sont appliquées avant la copie) ;
// - l'ancienne base est mono-utilisateur : toutes ses données sont rattachées au propriétaire, c'est-à-dire la
//   première adresse de ADMIN_EMAILS (compte créé s'il n'existe pas) ; les anciens réglages deviennent ses réglages ;
// - les sessions et les états OAuth de l'ancienne base ne sont pas copiés (éphémères, liés à l'ancien modèle) ;
// - tout se passe dans UNE transaction : en cas d'erreur ou de comptes différents, rien n'est écrit ;
// - refuse si la cible contient déjà des données, sauf --force (qui VIDE alors les tables cibles avant la copie) ;
// - la source est ouverte en lecture seule. Arrête l'ancien service avant, pour copier une base figée.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, dbConfigFromEnv, now } from '../src/db.js';

// Ordre de copie : parents avant enfants (clés étrangères). La suppression (--force) suit l'ordre inverse.
// `settings` (clé/valeur globale) devient `user_settings` du propriétaire.
export const TABLES = [
  'settings', 'projects', 'templates', 'prospects', 'blacklist',
  'jobs', 'mail_log', 'prospect_notes', 'metrics_daily',
];
export const SKIPPED = ['sessions', 'oauth_states'];
const TARGET_TABLE = { settings: 'user_settings' };
const OWNED = new Set(['settings', 'projects', 'jobs']); // tables de la cible qui portent un user_id
const LEGACY_USER_VERSION = 8; // dernière version du schéma de l'ancienne base SQLite à user_version
const LEGACY_MIGRATION = 1;    // schéma consolidé de la migration 1 (avant les comptes)
const BATCH = 200;

const q = (name) => `\`${name}\``;

// Vérifie que la source est au schéma attendu (sinon des colonnes manqueraient en silence)
function checkSourceVersion(src) {
  const hasTable = (n) => src.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(n);
  if (hasTable('schema_migrations')) {
    const v = src.prepare('SELECT MAX(version) v FROM schema_migrations').get().v;
    if (v !== LEGACY_MIGRATION) {
      throw new Error(`Schéma source en version ${v}, attendu ${LEGACY_MIGRATION} (base d'avant les comptes). Une base déjà au schéma multi-utilisateur ne se copie pas avec ce script.`);
    }
    return;
  }
  const { user_version: uv } = src.prepare('PRAGMA user_version').get();
  if (uv !== LEGACY_USER_VERSION) {
    throw new Error(`Base SQLite en version ${uv}, attendue ${LEGACY_USER_VERSION} : lance d'abord l'ancienne version de l'application pour la mettre à jour.`);
  }
}

async function targetColumns(dialect, db, table) {
  if (dialect === 'sqlite') return (await db.query(`PRAGMA table_info(${table})`)).map((c) => c.name);
  const rows = await db.query('SELECT column_name c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?', [table]);
  return rows.map((r) => r.c ?? r.COLUMN_NAME);
}

/**
 * @param {{ sourcePath: string, db: object, ownerEmail: string, force?: boolean, log?: (line: string) => void }} o
 * @returns {Promise<{ tables: {table: string, source: number, copied: number, target: number}[], total: number, ownerId: number }>}
 */
export async function migrateSqliteToMysql({ sourcePath, db, ownerEmail, force = false, log = () => {} }) {
  const owner = String(ownerEmail || '').trim().toLowerCase();
  if (!owner) throw new Error('Propriétaire des données manquant : définis ADMIN_EMAILS (la première adresse est utilisée).');
  if (!existsSync(sourcePath)) throw new Error(`Fichier introuvable : ${sourcePath}`);
  const src = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    checkSourceVersion(src);

    // Cible vide ?
    const filled = [];
    for (const t of TABLES) {
      const target = TARGET_TABLE[t] || t;
      const n = (await db.prepare(`SELECT COUNT(*) n FROM ${q(target)}`).get()).n;
      if (n > 0) filled.push(`${target} (${n})`);
    }
    if (filled.length && !force) {
      throw new Error(`La base cible n'est pas vide : ${filled.join(', ')}. Relance avec --force pour la vider avant la copie.`);
    }

    const report = [];
    let ownerId;
    await db.transaction(async (tx) => {
      if (filled.length) {
        log(`--force : vidage de la cible (${filled.join(', ')})`);
        for (const t of [...TABLES].reverse()) await tx.prepare(`DELETE FROM ${q(TARGET_TABLE[t] || t)}`).run();
      }
      // Le propriétaire : compte existant (même email) ou créé ici, administrateur
      const found = await tx.prepare('SELECT id FROM users WHERE email = ?').get(owner);
      ownerId = found
        ? Number(found.id)
        : Number((await tx.prepare("INSERT INTO users(email, status, is_admin, plan, created_at) VALUES(?, 'active', 1, 'free', ?)").run(owner, now())).lastInsertRowid);
      log(`propriétaire       ${owner} (id ${ownerId})`);

      for (const table of TABLES) {
        const targetTable = TARGET_TABLE[table] || table;
        const srcCols = src.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
        if (!srcCols.length) throw new Error(`Table source absente : ${table}`);
        const dstCols = new Set(await targetColumns(db.dialect, tx, targetTable));
        const lost = srcCols.filter((c) => !dstCols.has(c));
        if (lost.length) throw new Error(`${table} : colonnes sans équivalent dans la cible (${lost.join(', ')})`);

        const owned = OWNED.has(table);
        const cols = owned ? ['user_id', ...srcCols] : srcCols;
        const rows = src.prepare(`SELECT ${srcCols.map(q).join(', ')} FROM ${q(table)}`).all();
        const sqlHead = `INSERT INTO ${q(targetTable)} (${cols.map(q).join(', ')}) VALUES `;
        const one = `(${cols.map(() => '?').join(', ')})`;
        let copied = 0;
        for (let i = 0; i < rows.length; i += BATCH) {
          const chunk = rows.slice(i, i + BATCH);
          const values = chunk.flatMap((r) => (owned ? [ownerId] : []).concat(srcCols.map((c) => r[c])));
          const res = await tx.prepare(sqlHead + chunk.map(() => one).join(', ')).run(...values);
          copied += res.changes;
        }
        const target = (await tx.prepare(`SELECT COUNT(*) n FROM ${q(targetTable)}${owned ? ' WHERE user_id = ?' : ''}`).get(...(owned ? [ownerId] : []))).n;
        report.push({ table, source: rows.length, copied, target });
        log(`${table.padEnd(16)} source ${String(rows.length).padStart(6)}  copiées ${String(copied).padStart(6)}  cible ${String(target).padStart(6)}`);
        // Toute différence annule la transaction : on ne laisse jamais une copie partielle
        if (copied !== rows.length || target !== rows.length) {
          throw new Error(`${table} : ${rows.length} lignes en source, ${copied} copiées, ${target} en cible. Copie annulée.`);
        }
      }
    });
    return { tables: report, total: report.reduce((t, r) => t + r.copied, 0), ownerId };
  } finally {
    src.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const sourcePath = args.find((a) => !a.startsWith('--'));
  if (!sourcePath) {
    console.error('Usage : node --env-file=.env scripts/migrate-sqlite-to-mysql.js <chemin/aitools.sqlite> [--force]');
    process.exit(2);
  }
  const cfg = dbConfigFromEnv();
  if (cfg.driver !== 'mysql') throw new Error('La cible doit être MySQL/MariaDB (DB_HOST, DB_USER, DB_NAME).');
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  console.log(`Source : ${sourcePath}\nCible  : ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}${force ? '  (--force)' : ''}\n`);
  const db = await openDb(cfg, { adminEmails });
  try {
    const { total } = await migrateSqliteToMysql({ sourcePath, db, ownerEmail: adminEmails[0], force, log: console.log });
    console.log(`\nTerminé : ${total} lignes copiées, comptes identiques entre source et cible. Sessions de l'ancienne base non copiées : reconnecte-toi.`);
  } finally {
    await db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`\nÉchec : ${e.message}`); process.exit(1); });
}
