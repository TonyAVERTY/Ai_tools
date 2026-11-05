// Récapitulatif : l'utilisateur ne tape jamais de SQL. iaboss se connecte à la base du projet (lecture seule), lit son schéma, propose les bonnes tables
// (utilisateurs, clients payants, paiements) et la colonne du montant, montre un aperçu chiffré ; la personne ne fait que choisir ses tables.
// Les requêtes sont CONSTRUITES ici à partir d'identifiants lus dans le schéma (jamais saisis) : un nom de table ou de colonne n'est accepté que s'il existe.
//
// Forme enregistrée (db_enc.kpi) :
//   { users:   { table },
//     clients: { table, statusColumn?, statusValues? },
//     revenue: { table, amountColumn, cents, statusColumn?, statusValues? } }
// Une table est désignée par sa clé : « nom » (MySQL) ou « schéma.nom » (PostgreSQL).
import { withReadOnly } from './dbconn.js';

const bad = (message) => Object.assign(new Error(message), { status: 400 });

const MAX_TABLES = 400;
const MAX_NUMERIC = 40;
const MAX_VALUES = 20;

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Heuristiques (fonctions pures)

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const tokens = (name) => norm(name).split(/[_.\-\s]+/).filter(Boolean);

// Noms de tables probables, du plus probable au moins probable (français et anglais)
const USERS = ['users', 'user', 'utilisateurs', 'utilisateur', 'accounts', 'account', 'comptes', 'compte', 'members', 'member', 'membres', 'membre', 'profiles', 'profile', 'customers', 'customer', 'clients', 'client', 'people', 'persons'];
const CLIENTS = ['subscriptions', 'subscription', 'abonnements', 'abonnement', 'memberships', 'membership', 'subscribers', 'subscriber', 'customers', 'customer', 'clients', 'client', 'plans'];
const REVENUE = ['payments', 'payment', 'paiements', 'paiement', 'transactions', 'transaction', 'invoices', 'invoice', 'factures', 'facture', 'charges', 'charge', 'orders', 'order', 'commandes', 'commande', 'purchases', 'purchase', 'sales', 'ventes', 'vente'];
const AMOUNT = ['amount', 'amount_paid', 'amount_total', 'total', 'total_amount', 'montant', 'montant_ttc', 'montant_ht', 'price', 'prix', 'revenue', 'gross'];
const STATUS = ['status', 'state', 'statut', 'etat', 'payment_status', 'subscription_status'];
const ACTIVE = ['active', 'actif', 'paid', 'paye', 'subscribed', 'premium'];
const PAID = ['succeeded', 'paid', 'paye', 'complete', 'completed', 'success', 'successful', 'captured', 'settled', 'confirmed', 'done', 'accepted'];
const NOT_AN_AMOUNT = /(tax|tva|vat|discount|remise|fee|frais|refund|rembours|(^|_)id$|count|qty|quantity|quantite)/;
const NUMERIC_TYPES = /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|double precision|real|money)$/;
const INTEGER_TYPES = /^(tinyint|smallint|mediumint|int|integer|bigint)$/;

export const isNumericType = (t) => NUMERIC_TYPES.test(norm(t));
const isIntegerType = (t) => INTEGER_TYPES.test(norm(t));

/** Note d'un nom de table pour une liste de noms probables : le nom exact vaut plus que « se termine par » (app_users), qui vaut plus que « contient ». */
function tableScore(name, ranked) {
  const full = norm(name).replace(/[\s.\-]+/g, '_');
  const toks = tokens(name);
  let best = 0;
  ranked.forEach((w, i) => {
    const bonus = ranked.length - i;
    if (full === w || toks.join('_') === w) best = Math.max(best, 1000 + bonus);
    else if (toks[toks.length - 1] === w) best = Math.max(best, 500 + bonus);
    else if (toks.includes(w)) best = Math.max(best, 300 + bonus);
    else if (full.includes(w) && w.length >= 5) best = Math.max(best, 100 + bonus);
  });
  return best;
}

/** La meilleure table d'une liste de noms probables, ou null. Les tables vides ne passent qu'après celles qui contiennent des lignes. */
export function bestTable(tables, ranked) {
  let pick = null;
  for (const t of tables) {
    const s = tableScore(t.name, ranked);
    if (!s) continue;
    const score = s + (t.rows > 0 ? 150 : 0); // à nom équivalent, la table qui contient des lignes l'emporte
    if (!pick || score > pick.score) pick = { score, table: t };
  }
  return pick?.table || null;
}

/** La colonne du montant d'une table (numérique, nom parlant, pas une taxe ni une remise) et si elle est probablement en centimes. */
export function pickAmount(table) {
  const numeric = table.columns.filter((c) => isNumericType(c.type) && !NOT_AN_AMOUNT.test(norm(c.name)));
  let col = null;
  for (const want of AMOUNT) { col = numeric.find((c) => norm(c.name) === want); if (col) break; }
  col ||= numeric.find((c) => /amount|montant|total|price|prix/.test(norm(c.name)));
  if (!col) return null;
  // En centimes : le nom le dit, ou c'est un entier à côté d'une devise (la convention de Stripe et de la plupart des passerelles de paiement)
  const cents = /cent/.test(norm(col.name)) || (isIntegerType(col.type) && table.columns.some((c) => /^(currency|devise)$/.test(norm(c.name))));
  return { column: col.name, cents };
}

export const statusColumnOf = (table) => table.columns.find((c) => STATUS.includes(norm(c.name)) && !isNumericType(c.type))?.name || null;

/** Propose les tables et la colonne du montant d'après le schéma seul (les filtres de statut sont ajoutés ensuite, d'après les valeurs réelles). */
export function suggestKpi(schema) {
  const find = (ranked) => bestTable(schema.tables, ranked);
  const kpi = {};
  const u = find(USERS); if (u) kpi.users = { table: u.key };
  const c = find(CLIENTS); if (c) kpi.clients = { table: c.key };
  const r = find(REVENUE);
  if (r) { const a = pickAmount(r); if (a) kpi.revenue = { table: r.key, amountColumn: a.column, cents: a.cents }; }
  return kpi;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Construction des requêtes (fonctions pures). Identifiants entre guillemets selon le moteur ; valeurs échappées ; jamais de saisie libre.

const quoteId = (type, id) => (type === 'pg' ? `"${String(id).replace(/"/g, '""')}"` : `\`${String(id).replace(/`/g, '``')}\``);
const lit = (type, v) => { const s = String(v).replace(/'/g, "''"); return `'${type === 'pg' ? s : s.replace(/\\/g, '\\\\')}'`; };
const SAFE_VALUE = /^[\p{L}\p{N} _.\-]{1,40}$/u;

function tableRef(type, key) {
  if (type !== 'pg') return quoteId(type, key);
  const i = String(key).indexOf('.');
  return i < 0 ? quoteId(type, key) : `${quoteId(type, key.slice(0, i))}.${quoteId(type, key.slice(i + 1))}`;
}

function where(type, spec) {
  const vals = (spec.statusValues || []).filter((v) => SAFE_VALUE.test(v));
  if (!spec.statusColumn || !vals.length) return '';
  return ` WHERE ${quoteId(type, spec.statusColumn)} IN (${vals.map((v) => lit(type, v)).join(', ')})`;
}

/** Les requêtes du Récapitulatif pour une sélection de tables. */
export function buildQueries(type, kpi) {
  const q = {};
  if (kpi?.users?.table) q.users = `SELECT COUNT(*) FROM ${tableRef(type, kpi.users.table)}`;
  if (kpi?.clients?.table) q.clients = `SELECT COUNT(*) FROM ${tableRef(type, kpi.clients.table)}${where(type, kpi.clients)}`;
  if (kpi?.revenue?.table && kpi.revenue.amountColumn) {
    const sum = `COALESCE(SUM(${quoteId(type, kpi.revenue.amountColumn)}), 0)`;
    q.revenue = `SELECT ${kpi.revenue.cents ? `${sum} / 100.0` : sum} FROM ${tableRef(type, kpi.revenue.table)}${where(type, kpi.revenue)}`;
  }
  return q;
}

/** Ce que fait chaque chiffre, en une phrase pour la personne (« Compte les lignes de « subscriptions » dont « status » vaut « active » »). */
export function describeKpi(kpi) {
  const filt = (s) => (s.statusColumn && s.statusValues?.length ? ` dont « ${s.statusColumn} » vaut ${s.statusValues.map((v) => `« ${v} »`).join(' ou ')}` : '');
  const out = {};
  if (kpi?.users?.table) out.users = `Compte les lignes de « ${kpi.users.table} ».`;
  if (kpi?.clients?.table) out.clients = `Compte les lignes de « ${kpi.clients.table} »${filt(kpi.clients)}.`;
  if (kpi?.revenue?.table) out.revenue = `Additionne « ${kpi.revenue.amountColumn} » dans « ${kpi.revenue.table} »${filt(kpi.revenue)}${kpi.revenue.cents ? ', montants en centimes convertis en euros' : ''}.`;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Lecture du schéma (connexion en lecture seule)

const IGNORED_PG = "('pg_catalog', 'information_schema')";

async function readSchema(type, q) {
  let cols, counts;
  if (type === 'pg') {
    cols = await q(`SELECT c.table_schema AS s, c.table_name AS t, c.column_name AS c, c.data_type AS d FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema NOT IN ${IGNORED_PG} ORDER BY c.table_schema, c.table_name, c.ordinal_position LIMIT 30000`);
    counts = await q(`SELECT n.nspname AS s, c.relname AS t, c.reltuples::bigint AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname NOT IN ${IGNORED_PG}`);
  } else {
    cols = await q(`SELECT c.table_name AS t, c.column_name AS c, c.data_type AS d FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = DATABASE() ORDER BY c.table_name, c.ordinal_position LIMIT 30000`);
    counts = await q("SELECT table_name AS t, table_rows AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'");
  }
  const key = (r) => (type === 'pg' ? `${r.s}.${r.t}` : r.t);
  const rows = new Map(counts.map((r) => [key(r), Number(r.n) || 0]));
  const byKey = new Map();
  for (const r of cols) {
    const k = key(r);
    if (!byKey.has(k)) byKey.set(k, { key: k, name: type === 'pg' && r.s === 'public' ? r.t : k, rows: rows.get(k) || 0, columns: [] });
    byKey.get(k).columns.push({ name: String(r.c), type: String(r.d) });
  }
  const tables = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_TABLES);
  return { tables };
}

/** Valeurs distinctes d'une colonne (les plus fréquentes), pour reconnaître « active » ou « paid ». Une erreur n'empêche rien : pas de filtre. */
async function distinctValues(type, q, table, column) {
  try {
    const rows = await q(`SELECT ${quoteId(type, column)} AS v, COUNT(*) AS n FROM ${tableRef(type, table)} GROUP BY ${quoteId(type, column)} ORDER BY n DESC LIMIT ${MAX_VALUES}`);
    return rows.map((r) => r.v).filter((v) => v !== null && v !== undefined).map(String);
  } catch { return []; }
}

/** Ajoute le filtre de statut (« status = active », « status = paid »…) quand la colonne existe ET contient une valeur reconnue. Sinon : toutes les lignes comptent. */
async function addStatusFilters(type, q, schema, kpi) {
  const byKey = new Map(schema.tables.map((t) => [t.key, t]));
  for (const [name, known] of [['clients', ACTIVE], ['revenue', PAID]]) {
    const spec = kpi[name];
    const t = spec && byKey.get(spec.table);
    if (!t) continue;
    delete spec.statusColumn; delete spec.statusValues;
    const col = statusColumnOf(t);
    if (!col) continue;
    const present = (await distinctValues(type, q, t.key, col)).filter((v) => known.includes(norm(v)));
    if (present.length) { spec.statusColumn = col; spec.statusValues = present; }
  }
  return kpi;
}

/**
 * Valide une sélection (venue du navigateur) contre le schéma : chaque table et colonne doit exister, le montant doit être numérique.
 * Seuls la table, la colonne du montant et l'unité viennent de la personne ; les filtres de statut sont déduits des valeurs réelles.
 */
export function normalizeChoice(schema, input) {
  const byKey = new Map(schema.tables.map((t) => [t.key, t]));
  const table = (k) => (k ? byKey.get(String(k)) : null);
  const kpi = {};
  for (const name of ['users', 'clients']) {
    const k = input?.[`${name}_table`];
    if (!k) continue;
    const t = table(k);
    if (!t) throw bad(`Table introuvable dans la base : « ${String(k).slice(0, 80)} »`);
    kpi[name] = { table: t.key };
  }
  if (input?.revenue_table) {
    const t = table(input.revenue_table);
    if (!t) throw bad(`Table introuvable dans la base : « ${String(input.revenue_table).slice(0, 80)} »`);
    let col = input.revenue_column ? t.columns.find((c) => c.name === String(input.revenue_column)) : null;
    let cents;
    if (!col) { const a = pickAmount(t); if (!a) throw bad(`Aucune colonne de montant dans « ${t.name} » : choisis-en une.`); col = t.columns.find((c) => c.name === a.column); cents = a.cents; }
    if (!isNumericType(col.type)) throw bad(`« ${col.name} » n'est pas un nombre : choisis une colonne de montant.`);
    if (input.revenue_unit === 'cents') cents = true; else if (input.revenue_unit === 'euros') cents = false;
    kpi.revenue = { table: t.key, amountColumn: col.name, cents: !!cents };
  }
  return kpi;
}

/**
 * Se connecte (lecture seule), lit le schéma, applique la sélection (ou, sans sélection, la proposition), déduit les filtres de statut et renvoie un aperçu chiffré.
 * @param {object} cfg connexion déjà vérifiée par netguard.pinDb
 * @param {object} [choice] { users_table, clients_table, revenue_table, revenue_column, revenue_unit } ; absent : proposition automatique
 */
export async function analyzeDb(cfg, choice = null) {
  if (!cfg?.host) throw bad('Indique l\'hôte de la base.');
  if (cfg.type !== 'pg' && !String(cfg.database || '').trim()) throw bad('Indique le nom de la base à analyser.');
  return withReadOnly(cfg, async (q) => {
    const schema = await readSchema(cfg.type === 'pg' ? 'pg' : 'mysql', q);
    if (!schema.tables.length) throw bad('Aucune table trouvée : vérifie le nom de la base et les droits de lecture du compte.');
    const type = cfg.type === 'pg' ? 'pg' : 'mysql';
    const proposal = suggestKpi(schema); // toujours calculée : « (recommandé) » reste affiché même quand la personne a choisi autre chose
    const kpi = await addStatusFilters(type, q, schema, choice ? normalizeChoice(schema, choice) : structuredClone(proposal));
    const preview = {};
    for (const [k, sql] of Object.entries(buildQueries(type, kpi))) {
      try { const r = (await q(sql))[0]; const v = Number(Object.values(r || {})[0]); preview[k] = Number.isFinite(v) ? v : null; } catch { preview[k] = null; }
    }
    return {
      tables: schema.tables.map((t) => ({ key: t.key, name: t.name, rows: t.rows, numeric: t.columns.filter((c) => isNumericType(c.type)).slice(0, MAX_NUMERIC).map((c) => c.name) })),
      kpi, rules: describeKpi(kpi), preview, suggested: !choice,
      recommended: { users: proposal.users?.table || null, clients: proposal.clients?.table || null, revenue: proposal.revenue?.table || null },
    };
  });
}

/** Valide la sélection au moment d'enregistrer (même chemin que l'aperçu) et renvoie ce qu'il faut stocker. */
export async function resolveKpi(cfg, choice) {
  return (await analyzeDb(cfg, choice)).kpi;
}

/** Une erreur de connexion dite pour la personne : ce qui s'est passé et quoi vérifier (jamais le message brut du pilote). */
export function explainDbError(e) {
  const code = String(e?.code || '');
  if (code === 'ECONNREFUSED') return 'Connexion refusée : vérifie l\'hôte et le port de la base.';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Hôte introuvable : vérifie l\'adresse de la base.';
  if (code === 'ETIMEDOUT' || code === 'PROTOCOL_SEQUENCE_TIMEOUT' || /timeout|timed out|ETIMEDOUT/i.test(String(e?.message))) return 'Délai dépassé : la base ne répond pas (pare-feu ou mauvais port ?).';
  if (code === 'ER_ACCESS_DENIED_ERROR' || code === '28P01' || code === '28000') return 'Identifiants refusés : vérifie l\'utilisateur et le mot de passe.';
  if (code === 'ER_BAD_DB_ERROR' || code === '3D000') return 'Base introuvable : vérifie son nom.';
  if (code === 'ER_DBACCESS_DENIED_ERROR') return 'Ce compte n\'a pas le droit de lire cette base.';
  if (/ssl|tls|certificate/i.test(String(e?.message))) return 'Connexion sécurisée impossible : vérifie la case SSL.';
  return String(e?.message || 'Connexion impossible').replace(/\s+/g, ' ').slice(0, 160);
}
