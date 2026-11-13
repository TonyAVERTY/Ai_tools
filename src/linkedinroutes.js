// Routes LinkedIn : connexion OAuth d'un compte à un projet, brouillons écrits par Claude, publication.
// Droits : un membre génère et modifie les brouillons ; connecter, déconnecter et publier demandent d'être administrateur du projet
// (la publication part sur le profil du compte relié).
import { requireFeature } from './services/plans.js';
import { HttpError, json, redirect, readBody } from './http.js';
import { getProject } from './projects.js';
import { enqueue } from './services/jobs.js';
import { assertCanRunAi } from './claudelink.js';
import { budgetState } from './services/budget.js';
import {
  linkedinAvailable, linkedinAccount, disconnectLinkedin, startLinkedin, finishLinkedin, listPosts, editDraft, publishPost, NOT_CONFIGURED, MAX_POST,
  listLinkedinPages, setLinkedinTarget, schedulePost, unschedulePost,
} from './linkedin.js';

export function registerLinkedinRoutes(router, app, { project, aiOpts }) {
  const { db, cfg } = app;
  const LIMIT = { limit: 'link' };
  const back = (res, q) => redirect(res, `/?${new URLSearchParams(q)}`);

  router.get('/linkedin/connect', async ({ res, session, url }) => {
    try {
      const p = await getProject(app, Number(url.searchParams.get('project')), { userId: session.userId, need: 'admin' });
      await startLinkedin(app, session.userId, p.id, res);
    } catch (e) { if (!(e instanceof HttpError)) throw e; back(res, { li: 'error', m: e.message }); }
  }, LIMIT);

  router.get('/linkedin/callback', async ({ req, res, session, url }) => {
    try {
      const id = await finishLinkedin(app, session.userId, url.searchParams, req, res,
        (pid) => getProject(app, pid, { userId: session.userId, need: 'admin' }));
      back(res, { li: 'ok', p: id });
    } catch (e) { if (!(e instanceof HttpError)) throw e; back(res, { li: 'error', m: e.message }); }
  }, LIMIT);

  // État affiché dans la section LinkedIn du projet
  router.get('/api/projects/:id/linkedin', async (ctx) => {
    const p = await project(ctx);
    json(ctx.res, {
      configured: linkedinAvailable(cfg), canManage: p.access !== 'member', hasProfile: !!p.profile,
      // Publier sur une page : activé quand l'application LinkedIn a les droits « page » (LINKEDIN_SCOPES)
      pagesEnabled: cfg.linkedin?.pages === true,
      account: await linkedinAccount(db, p.id), posts: await listPosts(db, p.id), maxLength: MAX_POST,
    });
  });

  // Les pages que le compte relié administre, et celle où partent les posts. Lecture réservée aux administrateurs du projet.
  router.get('/api/projects/:id/linkedin/pages', async (ctx) => {
    const p = await project(ctx, { need: 'admin' });
    if (cfg.linkedin?.pages !== true) throw new HttpError(400, "Publier sur une page n'est pas activé sur ce service : l'application LinkedIn doit avoir l'accès « Community Management API » (LINKEDIN_SCOPES).", { expose: true });
    const pages = await listLinkedinPages(app, p.id, { refresh: ctx.url?.searchParams?.get('refresh') === '1' });
    json(ctx.res, { pages, target: (await linkedinAccount(db, p.id))?.target ?? null });
  }, LIMIT);

  router.post('/api/projects/:id/linkedin/target', async (ctx) => {
    const p = await project(ctx, { need: 'admin' });
    const b = await readBody(ctx.req);
    const page = await setLinkedinTarget(app, p.id, b.urn);
    json(ctx.res, { ok: true, target: page });
  }, LIMIT);

  router.post('/api/projects/:id/linkedin/generate', async (ctx) => {
    const p = await project(ctx);
    await requireFeature(db, p.userId, 'content');
    const b = await readBody(ctx.req);
    if (!linkedinAvailable(cfg)) throw new HttpError(503, NOT_CONFIGURED, { expose: true });
    const acc = await linkedinAccount(db, p.id);
    if (!acc) throw new HttpError(400, "Connecte d'abord un compte LinkedIn à ce projet");
    if (acc.expired) throw new HttpError(400, 'La connexion LinkedIn a expiré : reconnecte le compte');
    if (!p.profile) throw new HttpError(400, "Analyse le projet d'abord");
    await assertCanRunAi(db, p.userId, aiOpts);
    // Direction facultative : vide, c'est Claude qui choisit le sujet
    const direction = String(b.direction ?? '').trim().slice(0, 500);
    const r = await enqueue(db, { userId: p.userId, projectId: p.id, type: 'linkedin_post', params: { direction } }, aiOpts);
    const budget = await budgetState(db, p.userId);
    json(ctx.res, { ...r, budgetBlocked: budget.blocked ? budget.reason : null });
  });

  router.post('/api/projects/:id/linkedin/post', async (ctx) => {
    const p = await project(ctx);
    const b = await readBody(ctx.req);
    await editDraft(db, p.id, b.postId, b.body);
    json(ctx.res, { ok: true });
  });

  router.post('/api/projects/:id/linkedin/publish', async (ctx) => {
    const p = await project(ctx, { need: 'admin' });
    const b = await readBody(ctx.req);
    if (b.confirm !== true && b.confirm !== 'on') throw new HttpError(400, 'Confirmation requise : le post sera public sur LinkedIn', { expose: true });
    if (b.body !== undefined) await editDraft(db, p.id, b.postId, b.body); // le texte affiché est celui qui part
    json(ctx.res, { ok: true, ...(await publishPost(app, p.id, b.postId)) });
  }, LIMIT);

  // Programmer la publication : le post part tout seul à l'heure choisie (réservé aux administrateurs, comme « Publier »)
  router.post('/api/projects/:id/linkedin/schedule', async (ctx) => {
    const p = await project(ctx, { need: 'admin' });
    const b = await readBody(ctx.req);
    if (b.confirm !== true && b.confirm !== 'on') throw new HttpError(400, 'Confirmation requise : le post sera publié automatiquement et sera public sur LinkedIn', { expose: true });
    if (!(await linkedinAccount(db, p.id))) throw new HttpError(400, "Connecte LinkedIn à ce projet d'abord", { expose: true });
    if (b.body !== undefined) await editDraft(db, p.id, b.postId, b.body); // le texte affiché est celui qui partira
    json(ctx.res, { ok: true, at: await schedulePost(db, p.id, b.postId, b.at) });
  }, LIMIT);

  router.post('/api/projects/:id/linkedin/unschedule', async (ctx) => {
    const p = await project(ctx, { need: 'admin' });
    const b = await readBody(ctx.req);
    await unschedulePost(db, p.id, b.postId);
    json(ctx.res, { ok: true });
  }, LIMIT);

  router.post('/api/projects/:id/linkedin/disconnect', async (ctx) => {
    const p = await project(ctx, { need: 'admin' });
    await disconnectLinkedin(db, p.id);
    json(ctx.res, { ok: true });
  }, LIMIT);
}
