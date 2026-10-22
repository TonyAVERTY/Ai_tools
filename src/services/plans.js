// Plafonds des plans, appliqués côté serveur. Les valeurs vivent dans src/limits.js (PLAN_LIMITS).
//
//  - projets et prospects : totaux du compte, recomptés dans leurs tables ;
//  - mails et jobs IA : par mois calendaire (heure de Paris), recomptés depuis le journal d'usage (usage_events).
// Aucun compteur n'est stocké : chaque consommation est une ligne, et l'usage est une somme. Le journal d'usage survit à la
// suppression d'un projet (sinon supprimer puis recréer le projet remettrait le mois à zéro).
// Un dépassement refuse l'action avec un message clair et un lien vers /tarifs ; il ne supprime ni ne tronque jamais de données.
import { now } from '../db.js';
import { HttpError } from '../http.js';
import { PLAN_LIMITS, PLAN_LABELS } from '../limits.js';
import { parisParts, parisTime } from './paris-time.js';

export const USAGE_KINDS = ['projects', 'prospects', 'mails', 'aiJobs'];

const NOUNS = { projects: ['projet', 'projets'], prospects: ['prospect', 'prospects'], mails: ['mail', 'mails'], aiJobs: ['job IA', 'jobs IA'] };
export const KIND_LABELS = { projects: 'Projets', prospects: 'Prospects', mails: 'Mails ce mois-ci', aiJobs: 'Jobs IA ce mois-ci' };
const MONTHLY = new Set(['mails', 'aiJobs']);

/** Clé du plan appliqué : un administrateur n'a aucune limite ; un plan inconnu retombe sur « gratuit » (jamais sur illimité). */
export function planOf(user) {
  if (user?.isAdmin || user?.plan === 'admin') return 'admin';
  return PLAN_LIMITS[user?.plan] ? user.plan : 'free';
}
export const limitsFor = (user) => PLAN_LIMITS[planOf(user)];

/** Bornes [début, fin[ du mois calendaire à Paris, en secondes. */
export function monthBounds(at = now()) {
  const p = parisParts(new Date(at * 1000));
  const [ny, nm] = p.month === 12 ? [p.year + 1, 1] : [p.year, p.month + 1];
  return {
    start: Math.floor(parisTime(p.year, p.month, 1, 0).getTime() / 1000),
    end: Math.floor(parisTime(ny, nm, 1, 0).getTime() / 1000),
  };
}

/**
 * Usage d'un compte, recalculé depuis les tables.
 * Un job IA compte dès sa mise en file, sauf s'il a été annulé ou refusé sans jamais démarrer.
 */
export async function usageOf(db, userId, { at = now() } = {}) {
  const { start, end } = monthBounds(at);
  const n = async (sql, ...p) => Number((await db.prepare(sql).get(...p)).n);
  const id = Number(userId);
  return {
    projects: await n('SELECT COUNT(*) n FROM projects WHERE user_id = ?', id),
    prospects: await n('SELECT COUNT(*) n FROM prospects x JOIN projects p ON p.id = x.project_id WHERE p.user_id = ?', id),
    mails: await n("SELECT COUNT(*) n FROM usage_events WHERE user_id = ? AND kind = 'mail' AND at >= ? AND at < ?", id, start, end),
    aiJobs: await n(`SELECT COUNT(*) n FROM usage_events e LEFT JOIN jobs j ON j.id = e.ref
      WHERE e.user_id = ? AND e.kind = 'ai_job' AND e.at >= ? AND e.at < ?
      AND NOT (j.id IS NOT NULL AND j.started_at IS NULL AND j.status IN ('cancelled', 'error'))`, id, start, end),
    period: { start, end },
  };
}

/** Une consommation du mois : un mail parti, un job IA mis en file. */
export async function recordUsage(db, userId, kind, { ref = null, at = now() } = {}) {
  if (kind !== 'mail' && kind !== 'ai_job') throw new Error(`Type d'usage inconnu : ${kind}`);
  await db.prepare('INSERT INTO usage_events(user_id, kind, ref, at) VALUES(?, ?, ?, ?)').run(Number(userId), kind, ref, at);
}

/** @returns {{kind: string, used: number, limit: number|null, remaining: number|null, unlimited: boolean}} */
export async function quotaFor(db, user, kind, { at = now() } = {}) {
  if (!USAGE_KINDS.includes(kind)) throw new Error(`Plafond inconnu : ${kind}`);
  const limit = limitsFor(user)[kind];
  const used = (await usageOf(db, user.id, { at }))[kind];
  return { kind, used, limit, remaining: limit == null ? null : Math.max(0, limit - used), unlimited: limit == null };
}

const plural = (n, kind) => NOUNS[kind][n > 1 ? 1 : 0];

/** Message destiné à l'écran quand un plafond bloque une action. Toujours : ce qui est atteint, ce qui reste intact, où voir les offres. */
export function planLimitMessage(user, quota, { wanted = 1, note = '' } = {}) {
  const { kind, used, limit, remaining } = quota;
  const period = MONTHLY.has(kind) ? ' ce mois-ci' : '';
  const where = remaining > 0 && wanted > remaining
    ? `Il te reste ${remaining} ${plural(remaining, kind)}${period} sur ${limit}.`
    : `Tu as atteint le plafond du plan ${PLAN_LABELS[planOf(user)]} : ${used} ${plural(used, kind)}${period} sur ${limit}.`;
  return `${where}${note ? ` ${note}` : ''} Rien n'est supprimé ni perdu. Voir les tarifs : /tarifs`;
}

export function planLimitError(user, quota, opts) {
  return new HttpError(403, planLimitMessage(user, quota, opts), {
    expose: true, code: 'plan_limit',
    data: { kind: quota.kind, used: quota.used, limit: quota.limit, upgradeUrl: '/tarifs' },
  });
}

/** Refuse (403, code plan_limit) si `wanted` unités ne tiennent pas dans le plafond. Renvoie le quota sinon. */
export async function assertRoom(db, user, kind, wanted = 1, { at = now(), note = '' } = {}) {
  const q = await quotaFor(db, user, kind, { at });
  if (!q.unlimited && q.remaining < wanted) throw planLimitError(user, q, { wanted, note });
  return q;
}

/** Types de jobs qui envoient des mails de prospection (comptés dans le plafond mensuel de mails). */
export const MAIL_JOBS = new Set(['send', 'followup']);

// Section critique par compte : « compter puis écrire » ne doit pas être entrelacé par deux requêtes simultanées du même
// compte (sinon deux créations de projet passeraient toutes deux sous le plafond). Un seul processus : le verrou est en mémoire.
const chains = new Map();
export async function withUserLock(userId, fn) {
  const key = Number(userId);
  const prev = chains.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((r) => { release = r; });
  const tail = prev.then(() => gate);
  chains.set(key, tail);
  await prev;
  try { return await fn(); } finally {
    release();
    if (chains.get(key) === tail) chains.delete(key);
  }
}

/** Données d'affichage de l'usage du mois (barres de Mon compte et du tableau de bord). */
export async function usageView(db, user, { at = now() } = {}) {
  const usage = await usageOf(db, user.id, { at });
  const limits = limitsFor(user);
  return {
    plan: planOf(user), planLabel: PLAN_LABELS[planOf(user)],
    items: USAGE_KINDS.map((kind) => {
      const used = usage[kind], limit = limits[kind];
      return { kind, label: KIND_LABELS[kind], used, limit, pct: limit == null ? 0 : Math.min(100, Math.round((used / limit) * 100)), full: limit != null && used >= limit };
    }),
    period: usage.period,
  };
}
