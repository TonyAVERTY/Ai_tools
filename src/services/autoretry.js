// Relance automatique (Réglages → Garde-fous → « Relancer automatiquement les tâches IA ») : une tâche IA qui s'arrête parce que l'IA est limitée
// (quota de la session ou de la semaine, surcharge) ou qui ne se termine pas (délai dépassé, arrêt du serveur) repart toute seule, plus tard.
// La tâche en échec reste affichée telle quelle ; la relance est une NOUVELLE tâche (mêmes paramètres), comme le bouton « Réessayer ».
import { getSetting } from '../db.js';
import { enqueue } from './jobs.js';
import { AI_JOBS } from './budget.js';

export const AUTO_RETRY = {
  max: 3,                               // relances au plus pour une même tâche (4 exécutions en tout)
  delays: [15 * 60, 60 * 60, 3 * 3600], // secondes d'attente quand on ne connaît pas l'heure de remise à zéro du quota
  resetMargin: 60,                      // secondes après la remise à zéro annoncée
};

// Erreurs d'authentification et de configuration : relancer ne servirait à rien (la liaison est à refaire)
const NOT_RETRYABLE = /invalid (bearer )?token|api[ _-]?key|authentication|please run \/login|not logged in|unauthori[sz]ed|\b40[13]\b|reconnecte|relie|liaison|compte suspendu|budget ia/i;
// Limite de l'IA, surcharge, délai dépassé, arrêt du serveur
const QUOTA = /quota|rate.?limit|usage limit|limit reached|hit your limit|too many requests|\b429\b|overloaded|surcharg|capacity|try again later|réessaie plus tard/i;
const UNFINISHED = /arrêté sans résultat|interrompu \(redémarrage\)|délai|timed? ?out|réponse a été interrompue|error_max_turns/i;

/** 'quota' (limite de l'IA), 'unfinished' (ne s'est pas terminée) ou null (erreur qu'une relance ne corrigerait pas). */
export function retryReason(message) {
  const m = String(message ?? '');
  if (NOT_RETRYABLE.test(m)) return null;
  if (QUOTA.test(m)) return 'quota';
  if (UNFINISHED.test(m)) return 'unfinished';
  return null;
}

/** Heure (secondes) où repartir : après la remise à zéro des fenêtres de quota saturées, sinon une attente qui s'allonge à chaque essai. */
export function retryAt(rateLimitJson, reason, attempt, at) {
  if (reason === 'quota') {
    let rl = null;
    try { rl = JSON.parse(rateLimitJson || 'null'); } catch { rl = null; }
    const resets = ['fiveHour', 'sevenDay'].map((k) => rl?.[k]).filter((w) => w && w.utilization >= 0.95 && w.resetsAt > at).map((w) => Number(w.resetsAt));
    if (resets.length) return Math.max(...resets) + AUTO_RETRY.resetMargin;
  }
  return at + AUTO_RETRY.delays[Math.min(attempt, AUTO_RETRY.delays.length - 1)];
}

/**
 * Programme la relance d'une tâche IA en erreur. Rien si l'option est coupée, si la tâche n'est pas une tâche IA, si l'erreur n'est pas de celles
 * qu'une relance corrige, ou si le nombre de relances est atteint.
 * @returns {Promise<{id:number, at:number, attempt:number}|null>}
 */
export async function scheduleAutoRetry(db, job, error, { at = Math.floor(Date.now() / 1000), cliModeEnabled = true } = {}) {
  if (!AI_JOBS.has(job.type)) return null;
  if ((await getSetting(db, job.user_id, 'auto_retry', '0')) !== '1') return null;
  const reason = retryReason(error);
  if (!reason) return null;
  const params = JSON.parse(job.params_json || '{}');
  const attempt = Number(params.autoRetry) || 0;
  if (attempt >= AUTO_RETRY.max) return null;
  const when = retryAt(await getSetting(db, job.user_id, 'claude_rate_limit_json', ''), reason, attempt, at);
  try {
    const r = await enqueue(db, { userId: job.user_id, projectId: job.project_id, type: job.type, params: { ...params, autoRetry: attempt + 1 }, runAfter: when }, { cliModeEnabled });
    return r.existing ? null : { id: r.id, at: when, attempt: attempt + 1 };
  } catch { return null; } // plafond de l'offre, liaison perdue, compte suspendu : la relance n'a pas lieu, la tâche reste en erreur
}
