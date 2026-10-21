// Budget IA : plafonds glissants 24 h / 30 j, en équivalent $ API remonté par Claude Code.
// Avec un abonnement Pro rien n'est facturé en plus : c'est un garde-fou pour ne pas épuiser le quota.
import { getSetting, now } from '../db.js';

// Jobs qui appellent Claude (les envois et relances n'en consomment pas)
export const AI_JOBS = new Set(['analyze', 'prospect', 'template', 'followup_template', 'evolution']);

const usd = (n) => `${n.toFixed(2)} $`;

// La dépense compte au moment où le job s'est terminé (un job de nuit compte la nuit)
function spentSince(db, since) {
  return db.prepare('SELECT COALESCE(SUM(cost_usd), 0) c FROM jobs WHERE COALESCE(finished_at, created_at) > ?').get(since).c;
}

function limit(db, key) {
  const v = Number(getSetting(db, key, ''));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** @returns {{day: {used:number, limit:number|null}, month: {used:number, limit:number|null}, blocked: boolean, reason: string|null}} */
export function budgetState(db, { at = now() } = {}) {
  const day = { used: spentSince(db, at - 86400), limit: limit(db, 'budget_day_usd') };
  const month = { used: spentSince(db, at - 30 * 86400), limit: limit(db, 'budget_month_usd') };
  const over = (x) => x.limit != null && x.used >= x.limit;
  const reason = over(day) ? `budget IA des dernières 24 h atteint (${usd(day.used)} / ${usd(day.limit)})`
    : over(month) ? `budget IA des 30 derniers jours atteint (${usd(month.used)} / ${usd(month.limit)})`
      : null;
  return { day, month, blocked: !!reason, reason };
}
