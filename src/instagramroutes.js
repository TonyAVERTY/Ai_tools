// Routes Instagram : connexion OAuth d'un compte professionnel à un projet, publication et programmation d'un brouillon de la section Communication,
// et l'adresse publique (secrète, éphémère) d'où Instagram récupère l'image à publier.
// Droits : un membre génère et modifie les brouillons ; relier, déconnecter, publier et programmer demandent d'être administrateur du projet.
import { HttpError, json, redirect, readBody } from './http.js';
import { getProject } from './projects.js';
import { instagramAvailable, instagramAccount, disconnectInstagram, startInstagram, finishInstagram, publishInstagram, scheduleInstagram, unscheduleInstagram, getMedia, NOT_CONFIGURED } from './instagram.js';

export function registerInstagramRoutes(router, app, { project }) {
  const { db, cfg } = app;
  const LIMIT = { limit: 'link' };
  const backTo = (res, id, q) => redirect(res, `${id ? `/p/${id}/communication` : '/projets'}?${new URLSearchParams(q)}`);

  router.get('/instagram/connect', async ({ res, session, url }) => {
    const id = Number(url.searchParams.get('project'));
    try {
      const p = await getProject(app, id, { userId: session.userId, need: 'admin' });
      await startInstagram(app, session.userId, p.id, res);
    } catch (e) { if (!(e instanceof HttpError)) throw e; backTo(res, id, { ig: 'error', m: e.message }); }
  }, LIMIT);

  router.get('/instagram/callback', async ({ req, res, session, url }) => {
    let id = 0;
    try {
      id = await finishInstagram(app, session.userId, url.searchParams, req, res, async (pid) => { id = pid; await getProject(app, pid, { userId: session.userId, need: 'admin' }); });
      backTo(res, id, { ig: 'ok' });
    } catch (e) { if (!(e instanceof HttpError)) throw e; backTo(res, id, { ig: 'error', m: e.message }); }
  }, LIMIT);

  // L'image à publier, récupérée par Instagram : sans session, mais l'adresse contient un jeton aléatoire de 192 bits qui n'existe que pendant la publication
  router.get('/ig-media/:token', async (ctx) => {
    const jpg = getMedia(String(ctx.params.token).replace(/\.jpg$/, ''));
    if (!jpg) throw new HttpError(404, 'Introuvable');
    ctx.res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': jpg.length });
    ctx.res.end(jpg);
  }, { public: true, limit: 'link' });

  const confirmed = (b, what) => { if (b.confirm !== true && b.confirm !== 'on') throw new HttpError(400, `Confirmation requise : ${what}`, { expose: true }); };
  const live = () => { if (!instagramAvailable(cfg)) throw new HttpError(503, NOT_CONFIGURED, { expose: true }); };

  router.post('/api/projects/:id/instagram/publish', async (ctx) => {
    live();
    const p = await project(ctx, { need: 'admin' });
    const b = await readBody(ctx.req);
    confirmed(b, 'le post sera public sur Instagram');
    json(ctx.res, { ok: true, ...(await publishInstagram(app, p.id, b.draftId, { as: b.as })) });
  }, LIMIT);

  router.post('/api/projects/:id/instagram/schedule', async (ctx) => {
    live();
    const p = await project(ctx, { need: 'admin' });
    const b = await readBody(ctx.req);
    confirmed(b, 'le post sera publié automatiquement et sera public sur Instagram');
    json(ctx.res, { ok: true, at: await scheduleInstagram(app, p.id, b.draftId, { at: b.at, as: b.as }) });
  }, LIMIT);

  router.post('/api/projects/:id/instagram/unschedule', async (ctx) => {
    const p = await project(ctx, { need: 'admin' });
    const b = await readBody(ctx.req);
    await unscheduleInstagram(db, p.id, b.draftId);
    json(ctx.res, { ok: true });
  }, LIMIT);

  router.post('/api/projects/:id/instagram/disconnect', async (ctx) => {
    const p = await project(ctx, { need: 'admin' });
    await disconnectInstagram(db, p.id);
    json(ctx.res, { ok: true, account: await instagramAccount(db, p.id) });
  }, LIMIT);
}
