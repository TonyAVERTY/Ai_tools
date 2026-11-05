// Limites du compte ChatGPT (fenêtre de 5 h et fenêtre de la semaine, avec leur heure de remise à zéro), relevées EN DIRECT chez OpenAI avec le jeton
// du compte relié. Elles comptent tout ce que la personne fait avec son ChatGPT / Codex, y compris hors iaboss.
// ATTENTION : /backend-api/wham/usage n'est pas une API documentée par OpenAI (c'est celle qu'utilise la commande /status de Codex). Son format peut
// changer : toute réponse inattendue retombe sur la dernière mesure connue, jamais sur une valeur inventée. Ce relevé n'a PAS pu être testé avec un
// vrai compte lors de son écriture : seul le décodage d'un format attendu est testé (test/usage-chatgpt.test.js).
// Le jeton n'est JAMAIS renouvelé ici : son renouvellement est à usage unique et appartient à Codex pendant un job (voir saveRefreshedAuth).
// Jeton expiré : on garde la dernière mesure, et le prochain job renouvelle le jeton.
import { getSetting, setSetting, now } from '../db.js';
import { resolveCredentials, MODES } from '../claudelink.js';

const URL_USAGE = 'https://chatgpt.com/backend-api/wham/usage';
const KEY = 'chatgpt_rate_limit_json';
const EVERY = 120; // s entre deux relevés (réussis ou non) : on ne sollicite pas OpenAI à chaque rafraîchissement de la page

const num = (v) => { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : null; };

/** « session 5 h », « semaine », sinon la durée de la fenêtre. */
export function windowLabel(minutes) {
  if (!minutes) return 'limite';
  if (Math.abs(minutes - 300) <= 30) return 'session 5 h';
  if (Math.abs(minutes - 10080) <= 720) return 'semaine';
  return minutes < 2880 ? `fenêtre de ${Math.max(1, Math.round(minutes / 60))} h` : `fenêtre de ${Math.round(minutes / 1440)} j`;
}

/**
 * Deux formes connues : { rate_limit: { primary_window: { used_percent, limit_window_seconds, reset_after_seconds | reset_at }, secondary_window } }
 * et { rate_limits: { primary: { used_percent, window_minutes, resets_in_seconds | resets_at }, secondary } } (pourcentages 0-100).
 * @returns {{ windows: {key: string, label: string, utilization: number, resetsAt: number|null}[] }|null}
 */
export function parseLimits(body, at = now()) {
  if (!body || typeof body !== 'object') return null;
  const box = body.rate_limit || body.rate_limits || body;
  const windows = [];
  for (const [key, ...names] of [['primary', 'primary_window', 'primary'], ['secondary', 'secondary_window', 'secondary']]) {
    const w = names.map((n) => box[n]).find((x) => x && typeof x === 'object');
    const used = num(w?.used_percent);
    if (used === null) continue;
    const minutes = num(w.window_minutes) ?? (num(w.limit_window_seconds) != null ? num(w.limit_window_seconds) / 60 : null);
    const after = num(w.reset_after_seconds) ?? num(w.resets_in_seconds);
    const resetsAt = num(w.reset_at) ?? num(w.resets_at) ?? (after != null ? at + Math.round(after) : null);
    windows.push({ key, label: windowLabel(minutes), utilization: Math.max(0, Math.min(1, used / 100)), resetsAt: resetsAt ? Math.round(resetsAt > 1e12 ? resetsAt / 1000 : resetsAt) : null });
  }
  return windows.length ? { windows } : null;
}

/** Jeton d'accès et identifiant du compte dans le fichier de connexion ; `expired` si la date d'expiration du jeton (JWT) est passée. */
export function tokenOf(authFile, at = now()) {
  let t;
  try { t = JSON.parse(authFile)?.tokens; } catch { return null; }
  if (!t || typeof t.access_token !== 'string' || t.access_token.length < 8) return null;
  let exp = null;
  try { exp = JSON.parse(Buffer.from(t.access_token.split('.')[1] || '', 'base64url').toString('utf8')).exp; } catch { /* jeton opaque : pas de date connue */ }
  return { token: t.access_token, accountId: typeof t.account_id === 'string' ? t.account_id : null, expired: typeof exp === 'number' && exp < at + 30 };
}

const REASON = (status) => (status === 401 || status === 403 ? 'denied' : status === 429 ? 'rate' : 'unavailable');

async function fetchLive(app, cred, at) {
  const t = tokenOf(cred.authFile, at);
  if (!t) return { error: 'format' };
  if (t.expired) return { error: 'expired' };
  let r;
  try {
    r = await (app.fetch || fetch)(URL_USAGE, {
      headers: { Authorization: `Bearer ${t.token}`, ...(t.accountId ? { 'ChatGPT-Account-Id': t.accountId } : {}), Accept: 'application/json', 'User-Agent': 'iaboss' },
      signal: AbortSignal.timeout(8000),
    });
  } catch { return { error: 'network' }; }
  if (!r.ok) return { error: REASON(r.status) };
  const parsed = parseLimits(await r.json().catch(() => null), at);
  return parsed || { error: 'format' };
}

const expire = (w, at) => (w.resetsAt && w.resetsAt < at ? { ...w, expired: true } : w);

/**
 * Limites à afficher pour un compte ChatGPT : relevé en direct si possible (au plus un toutes les 2 minutes), sinon dernière mesure connue, clairement marquée
 * (`source`, `at`, `error`). `null` pour tout autre mode (clé API, autre fournisseur) ou tant que rien n'a pu être mesuré sans erreur à dire.
 */
export async function currentChatgptLimits(app, userId, { at = now() } = {}) {
  const { db } = app;
  let cred = null;
  try { cred = await resolveCredentials(app, userId); } catch { return null; }
  if (cred?.provider !== 'openai' || cred.mode !== MODES.chatgpt_account || !cred.authFile) return null;
  let stored = null;
  try { stored = JSON.parse(await getSetting(db, userId, KEY) || 'null'); } catch { /* valeur corrompue : ignorée */ }
  if (stored && stored.linkedAt !== (cred.linkedAt ?? null)) stored = null; // autre compte ChatGPT relié depuis : la mesure n'est plus la sienne
  let error = null;
  const tried = (app.chatgptUsageTried ||= new Map()); // userId -> { at, error }
  const last = tried.get(userId);
  if (last && at - last.at < EVERY) error = last.error;
  else {
    const r = await fetchLive(app, cred, at);
    tried.set(userId, { at, error: r.error ?? null });
    if (r.windows) {
      stored = { at, linkedAt: cred.linkedAt ?? null, windows: r.windows };
      await setSetting(db, userId, KEY, JSON.stringify(stored));
    } else {
      error = r.error;
      if (error !== 'expired') console.warn(`[usage] relevé ChatGPT impossible pour l'utilisateur ${Number(userId)} (${error})`);
    }
  }
  if (!stored) return { windows: [], at: null, source: null, error };
  return { windows: stored.windows.map((w) => expire(w, at)), at: stored.at, source: error ? 'stored' : 'live', error };
}
