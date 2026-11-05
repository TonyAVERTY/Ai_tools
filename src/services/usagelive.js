// Quota réel du compte Claude (session de 5 h + semaine de 7 j), relevé EN DIRECT auprès d'Anthropic avec le jeton d'abonnement
// de l'utilisateur. Il compte tout ce que la personne fait avec son Claude, y compris en dehors d'iaboss (claude.ai, Claude Code
// sur sa machine) : c'est ce qui distingue ce relevé de la mesure que la CLI remonte seulement pendant un job.
// ATTENTION : /api/oauth/usage n'est pas une API documentée par Anthropic (c'est celle qu'utilise la commande /usage de Claude Code).
// Son format peut changer : toute réponse inattendue retombe sur la dernière mesure connue, jamais sur une valeur inventée.
import { getSetting, setSetting, now } from '../db.js';
import { resolveCredentials, MODES } from '../claudelink.js';

const URL_USAGE = 'https://api.anthropic.com/api/oauth/usage';
const URL_MESSAGES = 'https://api.anthropic.com/v1/messages';
const PROBE_MODEL = 'claude-haiku-5-5';
const EVERY = { usage: 60, probe: 300, error: 60 }; // s entre deux relevés : Anthropic limite ces appels (429) et la requête minimale consomme quelques jetons

const toSeconds = (v) => {
  if (v == null) return null;
  const t = typeof v === 'number' ? (v > 1e12 ? v / 1000 : v) : Date.parse(v) / 1000;
  return Number.isFinite(t) ? Math.round(t) : null;
};
const pct01 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v / 100)) : null);

/**
 * Deux formes observées : { five_hour: { utilization, resets_at }, seven_day: {…} } (pourcentages 0-100),
 * ou un tableau `limits` [{ kind: 'session' | 'weekly_all' | …, percent, resets_at }].
 * @returns {{fiveHour:object|null, sevenDay:object|null}|null}
 */
export function parseUsage(body) {
  if (!body || typeof body !== 'object') return null;
  const win = (u, r) => { const x = pct01(u); return x === null ? null : { utilization: x, resetsAt: toSeconds(r) }; };
  let fiveHour = body.five_hour ? win(body.five_hour.utilization, body.five_hour.resets_at) : null;
  let sevenDay = body.seven_day ? win(body.seven_day.utilization, body.seven_day.resets_at) : null;
  if (Array.isArray(body.limits)) {
    const by = (kind) => body.limits.find((l) => l?.kind === kind);
    const s = by('session'); const w = by('weekly_all');
    fiveHour ||= s ? win(s.percent, s.resets_at) : null;
    sevenDay ||= w ? win(w.percent, w.resets_at) : null;
  }
  return fiveHour || sevenDay ? { fiveHour, sevenDay } : null;
}

const BETA = 'oauth-2025-04-20';
const authHeaders = (token) => ({ Authorization: `Bearer ${token}`, 'anthropic-beta': BETA, 'User-Agent': 'iaboss' });
const REASON = (status) => (status === 401 || status === 403 ? 'denied' : status === 429 ? 'rate' : 'unavailable');

/** Méthode 1, gratuite : le point d'accès « usage » de Claude Code. Un jeton de type `setup-token` n'y a souvent pas accès (403). */
async function viaUsageEndpoint(app, token) {
  let r;
  try { r = await (app.fetch || fetch)(URL_USAGE, { headers: { ...authHeaders(token), Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }); }
  catch { return { error: 'network' }; }
  if (!r.ok) return { error: REASON(r.status), status: r.status };
  const w = parseUsage(await r.json().catch(() => null));
  return w ? { windows: w } : { error: 'format' };
}

const frac = (v) => { const n = Number(v); return Number.isFinite(n) && v !== null && v !== '' ? Math.max(0, Math.min(1, n > 1 ? n / 100 : n)) : null; };
const headerWindow = (h, key) => {
  const u = frac(h.get(`anthropic-ratelimit-unified-${key}-utilization`));
  return u === null ? null : { utilization: u, resetsAt: toSeconds(Number(h.get(`anthropic-ratelimit-unified-${key}-reset`)) || null) };
};
/** Fenêtres lues dans les en-têtes `anthropic-ratelimit-unified-*` d'une réponse (les mêmes que la CLI affiche : état du COMPTE entier). */
export function windowsFromHeaders(h) {
  if (!h?.get) return null;
  const fiveHour = headerWindow(h, '5h');
  const sevenDay = headerWindow(h, '7d');
  return fiveHour || sevenDay ? { fiveHour, sevenDay } : null;
}

/**
 * Méthode 2 : une requête minimale (1 jeton de sortie, le plus petit modèle) avec le jeton de la personne. Chaque réponse d'Anthropic
 * porte l'état du quota de tout le compte dans ses en-têtes, même en cas de refus 429. Coût : quelques jetons ; effet de bord : elle peut
 * ouvrir la fenêtre de 5 h si aucune n'était en cours (c'est pourquoi elle n'a lieu qu'une fois toutes les 5 minutes, tableau de bord ouvert).
 */
async function viaProbe(app, token) {
  let r;
  try {
    r = await (app.fetch || fetch)(URL_MESSAGES, {
      method: 'POST',
      headers: { ...authHeaders(token), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      // Un jeton d'abonnement n'est accepté que pour Claude Code : la requête s'annonce comme telle
      body: JSON.stringify({ model: PROBE_MODEL, max_tokens: 1, system: [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }], messages: [{ role: 'user', content: '.' }] }),
      signal: AbortSignal.timeout(15000),
    });
  } catch { return { error: 'network' }; }
  const w = windowsFromHeaders(r.headers);
  if (w) return { windows: w };
  return { error: r.ok ? 'format' : REASON(r.status), status: r.status };
}

async function fetchLive(app, userId, token, at) {
  const st = (app.usageState ||= new Map()).get(userId) || {};
  app.usageState.set(userId, st);
  // Le point d'accès gratuit d'abord ; s'il refuse ce jeton, on ne le réessaie qu'une fois par heure
  if (!st.skipUsageUntil || at >= st.skipUsageUntil) {
    const r = await viaUsageEndpoint(app, token);
    if (r.windows) { st.skipUsageUntil = 0; return { ...r, method: 'usage' }; }
    if (r.error === 'denied' || r.error === 'format') {
      st.skipUsageUntil = at + 3600;
      console.warn(`[usage] relevé gratuit impossible pour l'utilisateur ${userId} (${r.error}${r.status ? `, HTTP ${r.status}` : ''}) : repli sur la requête minimale`);
    } else return r;
  }
  const r = await viaProbe(app, token);
  if (!r.windows) console.warn(`[usage] relevé impossible pour l'utilisateur ${userId} (${r.error}${r.status ? `, HTTP ${r.status}` : ''})`);
  return { ...r, method: 'probe' };
}

/** Une fenêtre dont l'heure de remise à zéro est passée n'est plus d'actualité : on ne la montre plus comme une mesure. */
const expire = (w, at) => (w && w.resetsAt && w.resetsAt < at ? { ...w, expired: true } : w);

/**
 * Quota à afficher : relevé en direct si possible (toutes les minutes, ou 5 minutes pour la requête minimale), sinon dernière mesure connue (celle d'un job),
 * clairement marquée (`source`, `at`, `error`). Jamais de quota en mode clé API.
 */
export async function currentClaudeQuota(app, userId, { at = now() } = {}) {
  const { db } = app;
  let stored = null;
  try { stored = JSON.parse(await getSetting(db, userId, 'claude_rate_limit_json') || 'null'); } catch { /* valeur corrompue : ignorée */ }
  let cred = null;
  try { cred = await resolveCredentials(app, userId); } catch { /* liaison absente ou invalide */ }
  let error = null;
  if (cred && cred.mode === MODES.subscription_token) {
    const tried = (app.usageTried ||= new Map()); // userId -> { at, error } : un relevé par minute au plus
    const last = tried.get(userId);
    if (last && at - last.at < last.every) error = last.error;
    else {
      const r = await fetchLive(app, userId, Object.values(cred.secretEnv)[0], at);
      tried.set(userId, { at, error: r.error ?? null, every: r.windows ? EVERY[r.method] : EVERY.error });
      if (r.windows) {
        stored = { at, source: 'live', ...r.windows };
        await setSetting(db, userId, 'claude_rate_limit_json', JSON.stringify(stored));
      } else error = r.error;
    }
  }
  if (!stored) return error ? { fiveHour: null, sevenDay: null, at: null, source: null, error } : null;
  return { fiveHour: expire(stored.fiveHour, at), sevenDay: expire(stored.sevenDay, at), at: stored.at ?? null, source: stored.source || 'jobs', error };
}
