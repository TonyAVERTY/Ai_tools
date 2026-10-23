// Quota réel du compte Claude (session de 5 h + semaine de 7 j), relevé EN DIRECT auprès d'Anthropic avec le jeton d'abonnement
// de l'utilisateur. Il compte tout ce que la personne fait avec son Claude, y compris en dehors d'AiTools (claude.ai, Claude Code
// sur sa machine) : c'est ce qui distingue ce relevé de la mesure que la CLI remonte seulement pendant un job.
// ATTENTION : /api/oauth/usage n'est pas une API documentée par Anthropic (c'est celle qu'utilise la commande /usage de Claude Code).
// Son format peut changer : toute réponse inattendue retombe sur la dernière mesure connue, jamais sur une valeur inventée.
import { getSetting, setSetting, now } from '../db.js';
import { resolveCredentials, MODES } from '../claudelink.js';

const URL_USAGE = 'https://api.anthropic.com/api/oauth/usage';
const REFRESH_EVERY = 60; // s : la barre se rafraîchit souvent, Anthropic limite ce point d'accès (429)

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

async function fetchLive(app, token) {
  let r;
  try {
    r = await (app.fetch || fetch)(URL_USAGE, {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json', 'User-Agent': 'AiTools' },
      signal: AbortSignal.timeout(8000),
    });
  } catch { return { error: 'network' }; }
  if (r.status === 401 || r.status === 403) return { error: 'denied' };
  if (r.status === 429) return { error: 'rate' };
  if (!r.ok) return { error: 'unavailable' };
  const w = parseUsage(await r.json().catch(() => null));
  return w ? { windows: w } : { error: 'format' };
}

/** Une fenêtre dont l'heure de remise à zéro est passée n'est plus d'actualité : on ne la montre plus comme une mesure. */
const expire = (w, at) => (w && w.resetsAt && w.resetsAt < at ? { ...w, expired: true } : w);

/**
 * Quota à afficher : relevé en direct si possible (au plus une fois par minute), sinon dernière mesure connue (celle d'un job),
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
    if (last && at - last.at < REFRESH_EVERY) error = last.error;
    else {
      const r = await fetchLive(app, Object.values(cred.secretEnv)[0]);
      tried.set(userId, { at, error: r.error ?? null });
      if (r.windows) {
        stored = { at, source: 'live', ...r.windows };
        await setSetting(db, userId, 'claude_rate_limit_json', JSON.stringify(stored));
      } else error = r.error;
    }
  }
  if (!stored) return error ? { fiveHour: null, sevenDay: null, at: null, source: null, error } : null;
  return { fiveHour: expire(stored.fiveHour, at), sevenDay: expire(stored.sevenDay, at), at: stored.at ?? null, source: stored.source || 'jobs', error };
}
