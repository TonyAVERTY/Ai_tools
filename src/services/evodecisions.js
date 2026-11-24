// Évolution : décision (acceptée / refusée) et justification pour chaque idée de la liste produite par un job.
import { now } from '../db.js';
import { LEN } from '../inputlimits.js';
import { esc } from '../http.js';
import { parseEvolutions } from './markdown.js';

export const HISTORY_MAX = 30;

export const DECISIONS = { accepted: 'Acceptée', refused: 'Refusée' };

export async function decisionsOf(db, jobId) {
  const rows = await db.prepare('SELECT n, status, reason, decided_at FROM evolution_decisions WHERE job_id = ?').all(jobId);
  return new Map(rows.map((r) => [Number(r.n), r]));
}

/** Numéros des idées refusées : elles ne sont plus affichées (leur titre et leur raison restent gardés pour ne pas être reproposées). */
export const refusedOf = (decided) => new Set([...decided].filter(([, d]) => d.status === 'refused').map(([n]) => n));

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

/** Les décisions les plus récentes du projet, toutes listes confondues, avec le titre de l'idée : de quoi ne pas reproposer ce qui a été refusé. */
export async function decisionHistory(db, projectId, limit = HISTORY_MAX) {
  const rows = await db.prepare(`SELECT d.job_id, d.n, d.status, d.reason, j.result_json FROM evolution_decisions d JOIN jobs j ON j.id = d.job_id
    WHERE d.project_id = ? AND j.project_id = ? ORDER BY d.decided_at DESC, d.job_id DESC LIMIT ?`).all(projectId, projectId, limit);
  const titles = new Map();
  const titleOf = (r) => {
    if (!titles.has(r.job_id)) {
      let md = '';
      try { md = JSON.parse(r.result_json || '{}').markdown; } catch { /* résultat illisible : pas de titre */ }
      titles.set(r.job_id, new Map(parseEvolutions(md).map((e) => [e.n, e.title])));
    }
    return titles.get(r.job_id).get(Number(r.n));
  };
  return rows.map((r) => ({ title: titleOf(r), status: r.status, reason: r.reason })).filter((d) => d.title);
}
