// Évolution : décision (acceptée / refusée) et justification pour chaque idée de la liste produite par un job.
import { now } from '../db.js';
import { LEN } from '../inputlimits.js';
import { esc } from '../http.js';

export const DECISIONS = { accepted: 'Acceptée', refused: 'Refusée' };

export async function decisionsOf(db, jobId) {
  const rows = await db.prepare('SELECT n, status, reason, decided_at FROM evolution_decisions WHERE job_id = ?').all(jobId);
  return new Map(rows.map((r) => [Number(r.n), r]));
}

export async function saveDecision(db, { jobId, projectId, ownerId, userId, n, status, reason }) {
  await db.prepare('DELETE FROM evolution_decisions WHERE job_id = ? AND n = ?').run(jobId, n);
  if (!status) return;
  await db.prepare('INSERT INTO evolution_decisions (job_id, n, user_id, project_id, status, reason, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(jobId, n, ownerId, projectId, status, reason, userId, now());
}

/** Bloc « décision » d'une idée : état, justification, boutons et formulaire de justification (replié). */
export function decisionHtml(jobId, n, d) {
  const state = d
    ? `<p class="evo-state s-${d.status}"><strong>${DECISIONS[d.status]}</strong>${d.reason ? ` : ${esc(d.reason)}` : ''}</p>`
    : '';
  const btn = (status, label) => `<button type="button" class="btn small" data-evo-open="${status}">${label}</button>`;
  return `<div class="evo-decide" data-job="${jobId}" data-n="${n}">
  ${state}
  <div class="evo-actions">${btn('accepted', 'Accepter')}${btn('refused', 'Refuser')}${d ? '<button type="button" class="btn small" data-evo-clear>Remettre en attente</button>' : ''}</div>
  <form class="evo-form" data-evo-form hidden>
    <label>Pourquoi ?<textarea name="reason" rows="2" maxlength="${LEN.reason}"></textarea></label>
    <div class="evo-actions"><button type="submit" class="btn small primary">Enregistrer</button><button type="button" class="btn small" data-evo-cancel>Annuler</button></div>
  </form>
</div>`;
}
