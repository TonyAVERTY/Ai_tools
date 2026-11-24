// Évolution : accepter ou refuser une idée de la liste, avec une justification.
// Droits : toute personne qui a accès au projet (un membre agit comme le propriétaire). Le job doit appartenir au projet.
import { HttpError, json, readBody } from './http.js';
import { LEN } from './inputlimits.js';
import { parseEvolutions } from './services/markdown.js';
import { DECISIONS, decisionHtml, saveDecision } from './services/evodecisions.js';

export function registerEvolutionRoutes(router, app, { project }) {
  const { db } = app;

  router.post('/api/projects/:id/evolution/:job/:n/decision', async (ctx) => {
    const p = await project(ctx);
    const jobId = Number(ctx.params.job), n = Number(ctx.params.n);
    const job = Number.isInteger(jobId) ? await db.prepare("SELECT id, result_json FROM jobs WHERE id = ? AND project_id = ? AND type = 'evolution' AND status = 'done'").get(jobId, p.id) : null;
    const ideas = job ? parseEvolutions(JSON.parse(job.result_json || '{}').markdown) : [];
    if (!job || !ideas.some((e) => e.n === n)) throw new HttpError(404, 'Idée introuvable');
    const b = await readBody(ctx.req);
    const status = b.status === 'pending' ? null : String(b.status ?? '');
    if (status !== null && !DECISIONS[status]) throw new HttpError(400, 'Décision inconnue : choisis Accepter ou Refuser', { expose: true });
    const reason = String(b.reason ?? '').replace(/\r\n?/g, '\n').trim();
    if (reason.length > LEN.reason) throw new HttpError(400, `Justification trop longue : ${LEN.reason} caractères au plus`, { expose: true });
    if (status === 'refused' && !reason) throw new HttpError(400, 'Justification manquante : dis pourquoi tu refuses cette idée', { expose: true });
    const userId = ctx.session.userId;
    await saveDecision(db, { jobId, projectId: p.id, ownerId: p.userId, userId, n, status, reason: status ? reason : '' });
    // Une idée refusée quitte la liste (sa raison reste gardée) ; les autres états renvoient le bloc à jour
    json(ctx.res, status === 'refused' ? { ok: true, removed: true } : { ok: true, html: decisionHtml(jobId, n, status ? { status, reason } : null) });
  }, { limit: 'evo_decision' });
}
