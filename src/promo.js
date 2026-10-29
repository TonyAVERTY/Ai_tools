// Onglet Promotion : vidéos de design motion d'un projet. Données (table promo_videos), fichiers MP4 dans le dossier de l'utilisateur
// propriétaire du projet, routes. Le rendu lui-même est dans services/promovideo.js, lancé par le job `promo_video`.
import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError, json, readBody } from './http.js';
import { now } from './db.js';
import { getProject } from './projects.js';
import { enqueue } from './services/jobs.js';
import { assertCanRunAi } from './claudelink.js';
import { budgetState } from './services/budget.js';
import { userPromoRoot } from './users.js';
import { PROMO, FORMATS, parsePromoParams, promoSupported } from './services/promovideo.js';
import { PROMO_STYLES } from './services/promokit.js';

const nameOf = (id) => `${Number(id)}.mp4`;
export const promoFile = (cfg, userId, id) => join(userPromoRoot(cfg, userId), nameOf(id));

const view = (r) => ({
  id: Number(r.id), subject: r.subject, fps: r.fps, seconds: r.seconds, format: r.format, width: r.width, height: r.height,
  size: Number(r.size), createdAt: Number(r.created_at),
});

export async function listVideos(db, projectId) {
  return (await db.prepare('SELECT * FROM promo_videos WHERE project_id = ? ORDER BY id DESC').all(projectId)).map(view);
}

export const countVideos = async (db, userId) => Number((await db.prepare('SELECT COUNT(*) n FROM promo_videos WHERE user_id = ?').get(userId)).n);

/** Réserve la ligne d'une vidéo à produire et renvoie son id et le chemin du fichier (le dossier est créé). */
export async function reserveVideo(app, { userId, projectId, subject, fps, seconds, format, width, height }) {
  const r = await app.db.prepare(`INSERT INTO promo_videos(user_id, project_id, subject, fps, seconds, format, width, height, size, file, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?)`).run(userId, projectId, subject, fps, seconds, format, width, height, now());
  const id = Number(r.lastInsertRowid);
  mkdirSync(userPromoRoot(app.cfg, userId), { recursive: true });
  return { id, path: promoFile(app.cfg, userId, id) };
}

export async function finishVideo(db, id, size) {
  await db.prepare('UPDATE promo_videos SET size = ?, file = ? WHERE id = ?').run(size, nameOf(id), id);
}

/** Retire une vidéo (ligne et fichier). */
export async function removeVideo(app, row) {
  rmSync(promoFile(app.cfg, row.user_id, row.id), { force: true });
  await app.db.prepare('DELETE FROM promo_videos WHERE id = ?').run(row.id);
}

/** Avant la suppression d'un projet : ses fichiers vidéo (les lignes partent avec lui). */
export async function removeProjectVideos(app, projectId) {
  for (const r of await app.db.prepare('SELECT id, user_id FROM promo_videos WHERE project_id = ?').all(projectId)) rmSync(promoFile(app.cfg, r.user_id, r.id), { force: true });
}

export function registerPromoRoutes(router, app, { project, aiOpts }) {
  const { db, cfg } = app;
  const LIMIT = { limit: 'promo' };

  // État de l'onglet : outils disponibles, limites, vidéos déjà produites
  router.get('/api/projects/:id/promo', async (ctx) => {
    const p = await project(ctx);
    const sup = (app.promoSupported || promoSupported)(cfg);
    json(ctx.res, {
      supported: sup.ok, reason: sup.ok ? null : sup.reason, hasProfile: !!p.profile, canDelete: p.access !== 'member',
      limits: { fps: PROMO.fps, seconds: PROMO.seconds, maxFrames: PROMO.maxFrames, maxSubject: PROMO.maxSubject, maxVideos: PROMO.maxVideos },
      formats: Object.entries(FORMATS).map(([id, f]) => ({ id, label: f.label })),
      styles: [{ id: 'auto', label: 'Automatique' }, ...Object.entries(PROMO_STYLES).map(([id, st]) => ({ id, label: st.label }))],
      videos: await listVideos(db, p.id),
    });
  });

  router.post('/api/projects/:id/promo/generate', async (ctx) => {
    const p = await project(ctx);
    const b = await readBody(ctx.req);
    const sup = (app.promoSupported || promoSupported)(cfg);
    if (!sup.ok) throw new HttpError(503, sup.reason, { expose: true });
    if (!p.profile) throw new HttpError(400, "Analyse le projet d'abord", { expose: true });
    const params = parsePromoParams(b);
    if (params.error) throw new HttpError(400, params.error, { expose: true });
    if ((await countVideos(db, p.userId)) >= PROMO.maxVideos) throw new HttpError(409, `Tu as déjà ${PROMO.maxVideos} vidéos : supprime-en une avant d'en produire une autre.`, { expose: true });
    await assertCanRunAi(db, p.userId, aiOpts);
    const r = await enqueue(db, { userId: p.userId, projectId: p.id, type: 'promo_video', params }, aiOpts);
    const budget = await budgetState(db, p.userId);
    json(ctx.res, { ...r, budgetBlocked: budget.blocked ? budget.reason : null });
  }, LIMIT);

  // Lecture (aperçu et téléchargement) : toute personne qui a accès au projet ; type figé, jamais interprété par le navigateur
  router.get('/api/promo/:vid/file', async ({ req, res, params, session, url }) => {
    const r = await db.prepare('SELECT * FROM promo_videos WHERE id = ?').get(Number(params.vid) || 0);
    if (!r || !r.file) throw new HttpError(404, 'Vidéo introuvable');
    await getProject(app, r.project_id, { userId: session.userId }); // 404 si le projet n'est pas le sien ni partagé avec lui
    const path = promoFile(cfg, r.user_id, r.id);
    if (!existsSync(path)) throw new HttpError(404, 'Vidéo introuvable');
    const total = statSync(path).size;
    const slug = String(r.subject || 'promotion').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'promotion';
    const head = {
      'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${slug}-${r.id}.mp4"`,
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    let start = 0;
    let end = total - 1;
    let status = 200;
    if (range && (range[1] || range[2])) {
      if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); } else { start = Math.max(0, total - Number(range[2])); }
      if (!(start <= end) || start >= total) { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); return res.end(); }
      status = 206;
      head['Content-Range'] = `bytes ${start}-${end}/${total}`;
    }
    head['Content-Length'] = String(end - start + 1);
    res.writeHead(status, head);
    if (req.method === 'HEAD') return res.end();
    createReadStream(path, { start, end }).pipe(res);
  });

  router.post('/api/projects/:id/promo/:vid/delete', async (ctx) => {
    const p = await project(ctx, { need: 'admin' });
    const r = await db.prepare('SELECT * FROM promo_videos WHERE id = ? AND project_id = ?').get(Number(ctx.params.vid) || 0, p.id);
    if (!r) throw new HttpError(404, 'Vidéo introuvable');
    await removeVideo(app, r);
    json(ctx.res, { ok: true });
  }, LIMIT);
}
