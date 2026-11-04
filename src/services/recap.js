// Récap : requêtes SELECT en lecture seule sur la BDD de chaque projet.
// Recommandation : utilisateur BDD dédié avec droits SELECT uniquement.
import { withReadOnly } from './dbconn.js';
import { buildQueries } from './dbschema.js';

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

async function runQueries(cfg, queries) {
  return withReadOnly(cfg, async (q) => {
    const out = {};
    for (const [k, sql] of Object.entries(queries)) out[k] = firstValue(await q(sql));
    return out;
  });
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
  // Tables choisies par la personne (requêtes construites par AiTools) ; à défaut, d'anciennes requêtes écrites à la main restent exécutées telles quelles
  const queries = cfg.kpi && Object.keys(cfg.kpi).length ? buildQueries(cfg.type === 'pg' ? 'pg' : 'mysql', cfg.kpi) : {};
  if (!Object.keys(queries).length) {
    for (const k of ['users', 'clients', 'revenue']) {
      const s = validateSelect(cfg[`sql_${k}`]);
      if (s) queries[k] = s;
    }
  }
  if (!Object.keys(queries).length) throw new Error('Aucune table choisie : ouvre « Configuration du projet » et choisis tes tables.');
  const data = await runQueries(cfg, queries);
  cache.set(projectId, { at: Date.now(), data });
  return { ...data, cached: false };
}

export function clearRecapCache(projectId) { cache.delete(projectId); }
