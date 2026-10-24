// Postes de l'entreprise : lancer une tâche IA (livrable Markdown) et relire son dernier résultat.
// Droits : toute personne qui a accès au projet lance une tâche ; celles qui lisent le dépôt (`repo`) exigent un administrateur, comme l'audit.
import { HttpError, json, readBody } from './http.js';
import { enqueue, latestJobs } from './services/jobs.js';
import { assertCanRunAi } from './claudelink.js';
import { budgetState } from './services/budget.js';
import { needAccess } from './teams.js';
import { renderMarkdown } from './services/markdown.js';
import { roleTaskById, MAX_NOTES } from './services/roles.js';

const taskOf = (ctx) => {
  const task = roleTaskById(ctx.params.task);
  if (!task) throw new HttpError(404, 'Tâche introuvable');
  return task;
};

export function registerPosteRoutes(router, app, { project, aiOpts }) {
  const { db } = app;
  const LIMIT = { limit: 'poste' };

  router.post('/api/projects/:id/poste/:task', async (ctx) => {
    const task = taskOf(ctx);
    const p = await project(ctx);
    const b = await readBody(ctx.req);
    if (!p.profile) throw new HttpError(400, "Analyse le projet d'abord", { expose: true });
    if (task.repo) needAccess(p.access, 'admin', `la tâche « ${task.label} » (elle lit le dépôt)`);
    const notes = String(b.notes ?? '').replace(/\r\n?/g, '\n').trim();
    if (notes.length > MAX_NOTES) throw new HttpError(400, `Précisions trop longues (${MAX_NOTES} caractères au plus).`, { expose: true });
    await assertCanRunAi(db, p.userId, aiOpts);
    const r = await enqueue(db, { userId: p.userId, projectId: p.id, type: task.job, params: { notes } }, aiOpts);
    const budget = await budgetState(db, p.userId);
    json(ctx.res, { ...r, budgetBlocked: budget.blocked ? budget.reason : null });
  }, LIMIT);

  // Dernier résultat d'une tâche. Le Markdown est rendu et échappé ici : le navigateur n'injecte jamais le texte brut de Claude.
  router.get('/api/projects/:id/poste/:task', async (ctx) => {
    const task = taskOf(ctx);
    const p = await project(ctx);
    const job = (await latestJobs(db, p.id))[task.job];
    const r = job?.status === 'done' ? job.result : null;
    if (!r?.markdown) throw new HttpError(404, 'Pas encore de résultat pour cette tâche');
    json(ctx.res, { task: task.id, label: task.label, role: task.roleLabel, finishedAt: job.finishedAt, notes: r.notes || '', markdown: r.markdown, html: `<div class="md">${renderMarkdown(r.markdown)}</div>` });
  });
}
