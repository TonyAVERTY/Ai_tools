// Évolution : accepter ou refuser une idée de la liste (avec une justification), puis implémenter une idée acceptée.
// Droits : décider = toute personne qui a accès au projet (un membre agit comme le propriétaire) ; implémenter écrit dans le dépôt : propriétaire ou administrateur.
// Le job doit appartenir au projet.
import { HttpError, json, readBody } from './http.js';
import { LEN } from './inputlimits.js';
import { parseEvolutions } from './services/markdown.js';
import { DECISIONS, FIX_GIT, acceptedIdea, decisionHtml, decisionsOf, implChoiceOf, implementationsOf, recapLine, saveDecision } from './services/evodecisions.js';
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
    const found = ideas.find((e) => e.n === n);
    if (!job || !found) throw new HttpError(404, 'Idée introuvable');
    return { p, jobId, n, title: found.title };
  }

  /** Bloc de décision à jour d'une idée (décision + état de l'implémentation). */
  async function blockOf({ p, jobId, n }) {
    const d = (await decisionsOf(db, jobId)).get(n) || null;
    const impl = (await implementationsOf(db, p.id, jobId)).get(n) || null;
    return decisionHtml(jobId, n, d, impl);
  }

  router.get('/api/projects/:id/evolution/:job/:n/decision', async (ctx) => {
    const ref = await idea(ctx);
    // Implémentation terminée : l'idée quitte la liste, l'écran ajoute ce récapitulatif à la place
    const impl = (await implementationsOf(db, ref.p.id, ref.jobId)).get(ref.n);
    if (impl?.status === 'done' && impl.result) return json(ctx.res, { done: true, title: ref.title, recap: recapLine(ref.title, { ...impl, n: ref.n }) });
    json(ctx.res, { html: await blockOf(ref) });
  });

  /** Lance le job d'implémentation d'une idée acceptée. Lève une HttpError (message affichable) si quelque chose manque. */
  async function startImplementation(p, jobId, n, target) {
    if (!(await acceptedIdea(db, p.id, jobId, n))) throw new HttpError(400, "Accepte d'abord l'idée", { expose: true });
    const cred = await gitCredentialFor(app, p.userId, p.gitUrl);
    if (!cred?.token) throw new HttpError(400, "Aucun token Git pour ce dépôt : ajoute-en un, avec le droit d'écriture, dans Réglages → Dépôts Git", { expose: true, data: { fix: FIX_GIT } });
    await assertCanRunAi(db, p.userId, aiOpts);
    const r = await enqueue(db, { userId: p.userId, projectId: p.id, type: 'implement', params: { evo: jobId, n, target } }, aiOpts);
    if (r.existing) throw new HttpError(409, 'Cette idée est déjà en cours d\'implémentation', { expose: true });
    const budget = await budgetState(db, p.userId);
    // Les implémentations s'enchaînent : s'il y en a avant celle-ci, elle attend son tour
    const ahead = Number((await db.prepare("SELECT COUNT(*) n FROM jobs WHERE project_id = ? AND type = 'implement' AND status IN ('queued','running') AND id < ?").get(p.id, r.id)).n);
    return { id: r.id, ahead, budgetBlocked: budget?.blocked ? budget.reason : null };
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
    await saveDecision(db, { jobId, projectId: p.id, ownerId: p.userId, userId, n, status, reason: status ? reason : '' });
    // Une idée refusée quitte la liste (sa raison reste gardée)
    if (status === 'refused') return json(ctx.res, { ok: true, removed: true });
    // Une idée acceptée : l'implémentation démarre toute seule (nouvelle branche) si le propriétaire a activé « Implémenter automatiquement » ou si cette
    // personne a retenu « oui » ; elle n'est jamais lancée si elle a retenu « non » ; sinon `next: 'ask'` : l'écran demande « Veux-tu que l'IA écrive le code ? ».
    // Seuls le propriétaire et les administrateurs implémentent (le code est écrit dans le dépôt). Une implémentation en cours ou terminée n'est pas relancée ;
    // après un échec, un nouveau clic sur « Accepter » la relance.
    let next = null, warn = null, fix = null;
    if (status === 'accepted' && ['owner', 'admin'].includes(p.access)) {
      const impl = (await implementationsOf(db, p.id, jobId)).get(n);
      if (!impl || !['queued', 'running', 'done'].includes(impl.status)) {
        const choice = (await getSetting(db, p.userId, 'ai_code_edit', '0')) === '1' ? 'yes' : await implChoiceOf(db, userId);
        if (choice === 'yes') {
          try {
            const r = await startImplementation(p, jobId, n, 'branch');
            next = r.ahead ? 'queued' : 'started';
            if (r.budgetBlocked) { warn = `En file, mais ${r.budgetBlocked}`; fix = { label: 'Ouvrir les Réglages', href: '/settings#budget' }; }
          } catch (e) { if (!(e instanceof HttpError)) throw e; warn = e.message; fix = e.data?.fix ?? null; }
        } else if (choice === 'ask') next = 'ask';
      }
    }
    json(ctx.res, { ok: true, html: await blockOf(ref), next, warn, fix });
  }, { limit: 'evo_decision' });

  // « Ne plus afficher ce message » retient le choix de CETTE personne (et le réglage des Réglages le change) : 'yes', 'no' ou 'ask'
  router.post('/api/evolution/implement-choice', async (ctx) => {
    const b = await readBody(ctx.req);
    if (!['ask', 'yes', 'no'].includes(b.choice)) throw new HttpError(400, 'Choix inconnu : oui, non ou demander', { expose: true });
    await setSetting(db, ctx.session.userId, 'evo_impl_choice', b.choice);
    json(ctx.res, { ok: true });
  }, { limit: 'evo_decision' });

  // Implémentation d'une idée ACCEPTÉE (« Oui » de la question posée à l'acceptation)
  router.post('/api/projects/:id/evolution/:job/:n/implement', async (ctx) => {
    const ref = await idea(ctx);
    const { p, jobId, n } = ref;
    needAccess(p.access, 'admin', "l'implémentation d'une idée (elle écrit dans le dépôt)");
    const b = await readBody(ctx.req);
    const target = b.target === 'default' ? 'default' : 'branch';
    if (target === 'default' && b.confirm !== true) throw new HttpError(400, 'Confirmation requise pour pousser sur la branche principale', { expose: true });
    const r = await startImplementation(p, jobId, n, target);
    json(ctx.res, { ok: true, id: r.id, queued: r.ahead > 0, budgetBlocked: r.budgetBlocked, html: await blockOf(ref) });
  }, { limit: 'evo_impl' });
}
