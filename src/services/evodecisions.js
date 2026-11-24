// Évolution : décision (acceptée / refusée) et justification pour chaque idée de la liste produite par un job.
import { getSetting, now } from '../db.js';
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

/** Dernière implémentation de chaque idée d'une liste : n → { id, status, error, result }. */
export async function implementationsOf(db, projectId, evoJobId) {
  const rows = await db.prepare("SELECT id, status, error, params_json, result_json FROM jobs WHERE project_id = ? AND type = 'implement' ORDER BY id DESC LIMIT 60").all(projectId);
  const out = new Map();
  for (const r of rows) {
    let params = {}, result = null;
    try { params = JSON.parse(r.params_json || '{}'); } catch { /* ignoré */ }
    if (Number(params.evo) !== Number(evoJobId) || out.has(Number(params.n))) continue;
    try { result = r.result_json ? JSON.parse(r.result_json) : null; } catch { /* ignoré */ }
    out.set(Number(params.n), { id: r.id, status: r.status, error: r.error, result });
  }
  return out;
}


/** Où régler un problème de jeton Git (Réglages → Dépôts Git). */
export const FIX_GIT = { label: 'Ouvrir les Réglages', href: '/settings#git' };

/** Choix de CETTE personne quand elle accepte une idée : 'ask' (poser la question), 'yes' (toujours implémenter, nouvelle branche) ou 'no' (jamais). */
export async function implChoiceOf(db, userId) {
  const v = await getSetting(db, userId, 'evo_impl_choice', null);
  if (['ask', 'yes', 'no'].includes(v)) return v;
  return (await getSetting(db, userId, 'evo_impl_hint', '0')) === '1' ? 'no' : 'ask'; // ancien réglage « Ne plus afficher ce message »
}

const ACTIVE = ['queued', 'running'];

/** Numéros des idées dont l'implémentation est terminée : elles quittent la liste (un récapitulatif les remplace). */
export const implementedOf = (impls) => new Set([...impls].filter(([, i]) => i.status === 'done' && i.result).map(([n]) => n));

/** Récapitulatif d'une idée implémentée (texte échappé) : la fonctionnalité, la branche, le commit, les fichiers. */
export function recapLine(title, impl) {
  const r = impl.result || {};
  const where = r.target === 'default' ? `la branche principale <code>${esc(r.branch)}</code>` : `la branche <code>${esc(r.branch)}</code>`;
  const files = (r.files || []).slice(0, 40).map((f) => `<li><code>${esc(f)}</code></li>`).join('');
  return `<div class="evo-recap" role="status" data-recap-n="${Number(impl.n ?? 0)}">
  <p><strong>La fonctionnalité « ${esc(title)} » est bien implémentée</strong> sur ${where} (commit <code>${esc(String(r.commit ?? '').slice(0, 7))}</code>, ${(r.files || []).length} fichier(s)).${r.url ? ` <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Voir sur ton serveur Git</a>` : ''}</p>
  ${r.summary ? `<p class="small">${esc(r.summary)}</p>` : ''}${files ? `<details class="small"><summary>Fichiers modifiés</summary><ul class="evo-files">${files}</ul></details>` : ''}
  <p class="muted small">Code écrit par l'IA : relis-le et lance tes tests avant de le fusionner.</p>
</div>`;
}

/** Tous les récapitulatifs d'une liste, dans l'ordre des idées. */
export const recapsHtml = (ideas, impls) => ideas.filter((e) => impls.get(e.n)?.status === 'done' && impls.get(e.n).result).map((e) => recapLine(e.title, { ...impls.get(e.n), n: e.n })).join('');

/** État de l'implémentation d'une idée acceptée (texte échappé). Elle se lance à l'acceptation ; pour recommencer après un échec, on clique de nouveau sur « Accepter ». */
function implHtml(impl) {
  if (impl && ACTIVE.includes(impl.status)) return `<p class="evo-impl s-running" data-evo-running><span class="loading small" role="status"><span class="spin-inline" aria-hidden="true"></span><span>Implémentation en cours : l'IA écrit le code, puis il est poussé sur ton dépôt…</span></span></p>`;
  if (impl?.status === 'done' && impl.result) {
    const r = impl.result;
    const where = r.target === 'default' ? `la branche principale <code>${esc(r.branch)}</code>` : `la nouvelle branche <code>${esc(r.branch)}</code>`;
    const files = (r.files || []).slice(0, 40).map((f) => `<li><code>${esc(f)}</code></li>`).join('');
    return `<div class="evo-impl s-done"><p><strong>Implémentée</strong> sur ${where} (commit <code>${esc(String(r.commit).slice(0, 7))}</code>, ${(r.files || []).length} fichier(s)).${r.url ? ` <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Voir sur ton serveur Git</a>` : ''}</p>
  ${r.summary ? `<p class="small">${esc(r.summary)}</p>` : ''}<ul class="small evo-files">${files}</ul>
  <p class="muted small">Code écrit par l'IA : relis-le et lance tes tests avant de le fusionner.</p></div>`;
  }
  if (impl?.status === 'error') {
    // Un problème de jeton Git se règle dans les Réglages : un bouton y mène
    const fix = /token/i.test(impl.error || '') ? ` <a class="evo-fix" href="${FIX_GIT.href}">${FIX_GIT.label}</a>` : '';
    return `<p class="evo-impl s-error error small">Implémentation en échec : ${esc(impl.error || 'erreur inconnue')}${fix}</p><p class="muted small">Clique sur « Accepter » pour la relancer.</p>`;
  }
  return impl?.status === 'cancelled' ? '<p class="muted small">Implémentation annulée. Clique sur « Accepter » pour la relancer.</p>' : '';
}

/** Bloc « décision » d'une idée : état, boutons, formulaire de justification d'un refus (replié) et, si acceptée, état de l'implémentation. */
export function decisionHtml(jobId, n, d, impl = null) {
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
  ${d?.status === 'accepted' ? implHtml(impl) : ''}
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

/** L'idée n° `n` de la liste du job `evoJobId`, si elle est ACCEPTÉE sur ce projet : { title, body, reason }. */
export async function acceptedIdea(db, projectId, evoJobId, n) {
  const row = await db.prepare(`SELECT d.reason, j.result_json FROM evolution_decisions d JOIN jobs j ON j.id = d.job_id
    WHERE d.job_id = ? AND d.n = ? AND d.project_id = ? AND j.project_id = ? AND d.status = 'accepted' AND j.type = 'evolution'`).get(evoJobId, n, projectId, projectId);
  if (!row) return null;
  let md = '';
  try { md = JSON.parse(row.result_json || '{}').markdown; } catch { return null; }
  const idea = parseEvolutions(md).find((e) => e.n === n);
  return idea ? { title: idea.title, body: idea.body, reason: row.reason } : null;
}
