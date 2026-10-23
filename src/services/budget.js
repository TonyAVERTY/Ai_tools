// Budget IA : plafonds glissants 24 h / 30 j, en équivalent $ API remonté par Claude Code.
// Avec un abonnement Pro rien n'est facturé en plus : c'est un garde-fou pour ne pas épuiser le quota.
import { getSetting, setSetting, now } from '../db.js';
import { getLinkState, MODES } from '../claudelink.js';

// Jobs qui appellent Claude (les envois et relances n'en consomment pas)
export const AI_JOBS = new Set(['analyze', 'prospect', 'template', 'followup_template', 'evolution', 'linkedin_post', 'audit', 'hook']);

const usd = (n) => `${n.toFixed(2)} $`;

// La dépense compte au moment où le job s'est terminé (un job de nuit compte la nuit). Budget propre à chaque utilisateur.
async function spentSince(db, userId, since) {
  return (await db.prepare('SELECT COALESCE(SUM(cost_usd), 0) c FROM jobs WHERE user_id = ? AND COALESCE(finished_at, created_at) > ?').get(userId, since)).c;
}

async function limit(db, userId, key) {
  const v = Number(await getSetting(db, userId, key, ''));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** @returns {{day: {used:number, limit:number|null}, month: {used:number, limit:number|null}, blocked: boolean, reason: string|null}} */
export async function budgetState(db, userId, { at = now() } = {}) {
  // Un plafond en $ n'a de sens qu'avec une clé API (c'est elle qui est facturée à l'usage) : avec un abonnement, rien n'est
  // facturé en plus, le garde-fou est le quota Claude. Un ancien plafond resté en base ne bloque donc jamais un abonnement.
  const priced = (await getLinkState(db, userId))?.mode === MODES.api_key;
  const day = { used: await spentSince(db, userId, at - 86400), limit: priced ? await limit(db, userId, 'budget_day_usd') : null };
  const month = { used: await spentSince(db, userId, at - 30 * 86400), limit: priced ? await limit(db, userId, 'budget_month_usd') : null };
  const over = (x) => x.limit != null && x.used >= x.limit;
  const reason = over(day) ? `budget IA des dernières 24 h atteint (${usd(day.used)} / ${usd(day.limit)})`
    : over(month) ? `budget IA des 30 derniers jours atteint (${usd(month.used)} / ${usd(month.limit)})`
      : null;
  return { day, month, blocked: !!reason, reason };
}

// Jobs IA non urgents : on peut les retarder sans perdre une occasion commerciale.
// La prospection et l'envoi (y compris les relances) continuent même quota serré.
const QUOTA_SENSITIVE_JOBS = new Set(['analyze', 'evolution', 'audit']);
export const isQuotaSensitive = (type) => QUOTA_SENSITIVE_JOBS.has(type);

// Palier à partir duquel on reporte : garde de la marge sur le quota du compte Claude
// lui-même (pas le budget $ ci-dessus) pour les tâches qui comptent vraiment.
export const QUOTA_PAUSE_THRESHOLD = 0.85;

const WINDOW_LABELS = { fiveHour: 'session Claude (5 h)', sevenDay: 'semaine Claude' };

/** @returns {{blocked: boolean, reason: string|null}} */
export async function quotaState(db, userId) {
  const raw = await getSetting(db, userId, 'claude_rate_limit_json');
  if (!raw) return { blocked: false, reason: null };
  let rl;
  try { rl = JSON.parse(raw); } catch { return { blocked: false, reason: null }; }
  for (const [key, label] of Object.entries(WINDOW_LABELS)) {
    const w = rl[key];
    // Une mesure dont la fenêtre a été remise à zéro depuis ne bloque plus rien
    if (w?.utilization >= QUOTA_PAUSE_THRESHOLD && !(w.resetsAt && w.resetsAt < now())) {
      return { blocked: true, reason: `quota de la ${label} à ${Math.round(w.utilization * 100)} %` };
    }
  }
  return { blocked: false, reason: null };
}

// Alerte Discord à 80 % puis 95 % d'utilisation, une seule fois par fenêtre (jusqu'au reset).
const ALERT_LEVELS = [0.95, 0.80];

/** Renvoie les paliers nouvellement franchis et enregistre l'état pour ne pas re-notifier. */
export async function quotaAlerts(db, userId, windows) {
  if (!windows) return [];
  let prev = {};
  try { prev = JSON.parse((await getSetting(db, userId, 'claude_quota_notified_json', '{}')) || '{}'); } catch { prev = {}; }
  const next = { ...prev };
  const alerts = [];
  for (const [key, label] of Object.entries(WINDOW_LABELS)) {
    const w = windows[key];
    if (!w) continue;
    // Une fenêtre qui a tourné (reset passé) repart de zéro : les mêmes paliers peuvent re-sonner
    const state = prev[key]?.resetsAt === w.resetsAt ? prev[key] : { resetsAt: w.resetsAt, level: 0 };
    const crossed = ALERT_LEVELS.find((l) => w.utilization >= l && state.level < Math.round(l * 100));
    if (crossed) alerts.push({ label, level: Math.round(crossed * 100), utilization: w.utilization });
    next[key] = { resetsAt: w.resetsAt, level: crossed ? Math.round(crossed * 100) : state.level };
  }
  await setSetting(db, userId, 'claude_quota_notified_json', JSON.stringify(next));
  return alerts;
}
