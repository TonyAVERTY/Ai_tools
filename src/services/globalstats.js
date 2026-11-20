// Statistiques globales de l'application, pour les administrateurs (ADMIN_EMAILS) : requêtes IA, mails, réponses, temps de réponse, erreurs, consommation par modèle.
// Ce sont des totaux : aucune donnée d'un compte en particulier (ni adresse, ni contenu, ni nom de projet).
import { now } from '../db.js';
import { modelLabel } from './models.js';

export const PERIODS = { '24h': { label: '24 heures', seconds: 86400 }, '7j': { label: '7 jours', seconds: 7 * 86400 }, '30j': { label: '30 jours', seconds: 30 * 86400 } };
export const DEFAULT_PERIOD = '7j';

/** Percentile (méthode du rang le plus proche) d'une liste déjà triée ; null si la liste est vide. */
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export async function globalStats(db, period = DEFAULT_PERIOD, at = now()) {
  const key = PERIODS[period] ? period : DEFAULT_PERIOD;
  const since = at - PERIODS[key].seconds;
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);

  const jobs = await one(`SELECT COUNT(*) total,
      COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) done,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) errors,
      COALESCE(SUM(cost_usd), 0) cost, COALESCE(SUM(tokens_in), 0) tin, COALESCE(SUM(tokens_out), 0) tout
    FROM jobs WHERE created_at >= ?`, since);
  const chat = await one("SELECT COUNT(*) n, COALESCE(SUM(cost_usd), 0) cost FROM chat_messages WHERE role = 'assistant' AND created_at >= ?", since);
  const mails = await one(`SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN error IS NULL OR error = '' THEN 1 ELSE 0 END), 0) sent
    FROM mail_log WHERE sent_at >= ?`, since);
  const replies = await one('SELECT COUNT(*) n FROM replies WHERE received_at >= ?', since);

  // Temps de réponse d'une tâche IA = de son démarrage à sa fin (les tâches terminées avec succès seulement), sur les 5 000 plus récentes de la période
  const durations = (await all("SELECT finished_at - started_at d FROM jobs WHERE status = 'done' AND started_at IS NOT NULL AND finished_at IS NOT NULL AND created_at >= ? ORDER BY id DESC LIMIT 5000", since))
    .map((r) => Number(r.d)).filter((d) => Number.isFinite(d) && d >= 0).sort((a, b) => a - b);

  const errorsByType = await all("SELECT type, COUNT(*) n FROM jobs WHERE status = 'error' AND created_at >= ? GROUP BY type ORDER BY n DESC LIMIT 8", since);
  const mailErrors = Number(mails.total) - Number(mails.sent);
  const byModelJobs = await all(`SELECT COALESCE(NULLIF(model, ''), 'inconnu') model, COUNT(*) n, COALESCE(SUM(tokens_in), 0) tin, COALESCE(SUM(tokens_out), 0) tout, COALESCE(SUM(cost_usd), 0) cost
    FROM jobs WHERE created_at >= ? GROUP BY COALESCE(NULLIF(model, ''), 'inconnu')`, since);
  const byModelChat = await all(`SELECT COALESCE(NULLIF(model, ''), 'inconnu') model, COUNT(*) n, COALESCE(SUM(cost_usd), 0) cost
    FROM chat_messages WHERE role = 'assistant' AND created_at >= ? GROUP BY COALESCE(NULLIF(model, ''), 'inconnu')`, since);
  const models = new Map();
  for (const r of byModelJobs) models.set(r.model, { model: r.model, requests: Number(r.n), tokensIn: Number(r.tin), tokensOut: Number(r.tout), cost: Number(r.cost) });
  for (const r of byModelChat) {
    const m = models.get(r.model) || { model: r.model, requests: 0, tokensIn: 0, tokensOut: 0, cost: 0 };
    m.requests += Number(r.n); m.cost += Number(r.cost); models.set(r.model, m);
  }

  const aiRequests = Number(jobs.total) + Number(chat.n);
  return {
    period: key, since, until: at,
    ai: { requests: aiRequests, jobs: Number(jobs.total), chats: Number(chat.n), done: Number(jobs.done), errors: Number(jobs.errors), cost: Number(jobs.cost) + Number(chat.cost), tokensIn: Number(jobs.tin), tokensOut: Number(jobs.tout) },
    mails: { total: Number(mails.total), sent: Number(mails.sent), errors: Number(mailErrors) || 0 },
    replies: { total: Number(replies.n), rate: Number(mails.sent) ? Number(replies.n) / Number(mails.sent) : null },
    response: { count: durations.length, avg: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null, p50: percentile(durations, 50), p95: percentile(durations, 95) },
    errorsByType: errorsByType.map((r) => ({ type: r.type, n: Number(r.n) })),
    models: [...models.values()].map((m) => ({ ...m, label: m.model === 'inconnu' ? 'Modèle non enregistré' : modelLabel(m.model) })).sort((a, b) => b.requests - a.requests),
  };
}
