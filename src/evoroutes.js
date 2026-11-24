// Évolution : accepter ou refuser une idée de la liste (avec une justification), puis implémenter une idée acceptée.
// Droits : décider = toute personne qui a accès au projet (un membre agit comme le propriétaire) ; implémenter écrit dans le dépôt : propriétaire ou administrateur.
// Le job doit appartenir au projet.
import { HttpError, json, readBody } from './http.js';
import { LEN } from './inputlimits.js';
import { parseEvolutions } from './services/markdown.js';
import { DECISIONS, acceptedIdea, decisionHtml, decisionsOf, implementationsOf, saveDecision } from './services/evodecisions.js';
import { enqueue } from './services/jobs.js';
import { assertCanRunAi } from './claudelink.js';
import { budgetState } from './services/budget.js';
import { gitCredentialFor } from './gitservers.js';
import { needAccess } from './teams.js';
import { getSetting, setSetting } from './db.js';

export function registerEvolutionRoutes(router, app, { project, aiOpts }) {
  const { db } = app;

  /** Le projet, la liste d'idées (job `evolution` terminé de CE projet) et l'idée n : sinon 404. */
  async function idea(ctx) {
    const p = await project(ctx);
    const jobId = Number(ctx.params.job), n = Number(ctx.params.n);
    const job = Number.isInteger(jobId) ? await db.prepare("SELECT id, result_json FROM jobs WHERE id = ? AND project_id = ? AND type = 'evolution' AND status = 'done'").get(jobId, p.id) : null;
    const ideas = job ? parseEvolutions(JSON.parse(job.result_json || '{}').markdown) : [];
    if (!job || !ideas.some((e) => e.n === n)) throw new HttpError(404, 'Idée introuvable');
    return { p, jobId, n };
  }

  /** Bloc de décision à jour d'une idée (décision + état de l'implémentation). */
  async function blockOf({ p, jobId, n }) {
    const d = (await decisionsOf(db, jobId)).get(n) || null;
    const impl = (await implementationsOf(db, p.id, jobId)).get(n) || null;
    return decisionHtml(jobId, n, d, impl, ['owner', 'admin'].includes(p.access));
  }

  router.get('/api/projects/:id/evolution/:job/:n/decision', async (ctx) => {
    json(ctx.res, { html: await blockOf(await idea(ctx)) });
  });

  /** Lance le job d'implémentation d'une idée acceptée. Lève une HttpError (message affichable) si quelque chose manque. */
  async function startImplementation(p, jobId, n, target) {
    if (!(await acceptedIdea(db, p.id, jobId, n))) throw new HttpError(400, "Accepte d'abord l'idée", { expose: true });
    const cred = await gitCredentialFor(app, p.userId, p.gitUrl);
    if (!cred?.token) throw new HttpError(400, "Aucun token Git pour ce dépôt : ajoute-en un, avec le droit d'écriture, dans Réglages → Dépôts Git", { expose: true });
    await assertCanRunAi(db, p.userId, aiOpts);
    const r = await enqueue(db, { userId: p.userId, projectId: p.id, type: 'implement', params: { evo: jobId, n, target } }, aiOpts);
    if (r.existing) throw new HttpError(409, 'Une implémentation est déjà en cours sur ce projet : attends sa fin', { expose: true });
    const budget = await budgetState(db, p.userId);
    return { id: r.id, budgetBlocked: budget?.blocked ? budget.reason : null };
  }

  router.post('/api/projects/:id/evolution/:job/:n/decision', async (ctx) => {
    const ref = await idea(ctx);
    const { p, jobId, n } = ref;
    const b = await readBody(ctx.req);
    const status = b.status === 'pending' ? null : String(b.status ?? '');
    if (status !== null && !DECISIONS[status]) throw new HttpError(400, 'Décision inconnue : choisis Accepter ou Refuser', { expose: true });
    const reason = String(b.reason ?? '').replace(/\r\n?/g, '\n').trim();
    if (reason.length > LEN.reason) throw new HttpError(400, `Justification trop longue : ${LEN.reason} caractères au plus`, { expose: true });
    if (status === 'refused' && !reason) throw new HttpError(400, 'Justification manquante : dis pourquoi tu refuses cette idée', { expose: true });
    const userId = ctx.session.userId;
    const before = (await decisionsOf(db, jobId)).get(n);
    await saveDecision(db, { jobId, projectId: p.id, ownerId: p.userId, userId, n, status, reason: status ? reason : '' });
    // Une idée refusée quitte la liste (sa raison reste gardée)
    if (status === 'refused') return json(ctx.res, { ok: true, removed: true });
    // Une idée acceptée : réglage du propriétaire « Implémenter automatiquement » → le code est écrit et poussé tout de suite (nouvelle branche) ;
    // sinon `next: 'ask'` : l'écran demande « Veux-tu que l'IA écrive le code ? » (sauf si cette personne a coché « Ne plus afficher »).
    // Seuls le propriétaire et les administrateurs implémentent (le code est écrit dans le dépôt) ; ré-accepter ne relance rien.
    let next = null, warn = null;
    if (status === 'accepted' && ['owner', 'admin'].includes(p.access) && before?.status !== 'accepted') {
      if ((await getSetting(db, p.userId, 'ai_code_edit', '0')) === '1') {
        try {
          const r = await startImplementation(p, jobId, n, 'branch');
          next = 'started';
          if (r.budgetBlocked) warn = `En file, mais ${r.budgetBlocked}`;
        } catch (e) { if (!(e instanceof HttpError)) throw e; warn = e.message; }
      } else if ((await getSetting(db, userId, 'evo_impl_hint', '0')) !== '1') next = 'ask';
    }
    json(ctx.res, { ok: true, html: await blockOf(ref), next, warn });
  }, { limit: 'evo_decision' });

  // « Ne plus afficher ce message » (et sa remise en route dans Réglages) : préférence de CETTE personne
  router.post('/api/evolution/implement-hint', async (ctx) => {
    const b = await readBody(ctx.req);
    await setSetting(db, ctx.session.userId, 'evo_impl_hint', b.hide === true ? '1' : '0');
    json(ctx.res, { ok: true });
  }, { limit: 'evo_decision' });

  // Implémentation d'une idée ACCEPTÉE (bouton « Implémenter », ou « Oui » de la question posée à l'acceptation)
  router.post('/api/projects/:id/evolution/:job/:n/implement', async (ctx) => {
    const ref = await idea(ctx);
    const { p, jobId, n } = ref;
    needAccess(p.access, 'admin', "l'implémentation d'une idée (elle écrit dans le dépôt)");
    const b = await readBody(ctx.req);
    const target = b.target === 'default' ? 'default' : 'branch';
    if (target === 'default' && b.confirm !== true) throw new HttpError(400, 'Confirmation requise pour pousser sur la branche principale', { expose: true });
    const r = await startImplementation(p, jobId, n, target);
    json(ctx.res, { ok: true, id: r.id, budgetBlocked: r.budgetBlocked, html: await blockOf(ref) });
  }, { limit: 'evo_impl' });
}
