// Routes Communication : posts Instagram (légende, hashtags, image dessinée d'après le design du projet) et newsletters.
// Un membre de l'équipe génère, relit et modifie ; rien n'est publié ni envoyé par iaboss (on copie ou on télécharge).
import { HttpError, json, readBody, esc } from './http.js';
import { enqueue } from './services/jobs.js';
import { assertCanRunAi } from './claudelink.js';
import { budgetState } from './services/budget.js';
import { renderMarkdown } from './services/markdown.js';
import { stillSupported } from './services/stillimage.js';
import { KINDS, INSTAGRAM_FORMATS, LIMITS, listDrafts, getDraft, getImage, editDraft, removeDraft } from './contentdrafts.js';

const JOB = { instagram: 'instagram_post', newsletter: 'newsletter' };
const slug = (s) => String(s || 'projet').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'projet';

/** La newsletter en HTML d'e-mail autonome (styles en ligne, sans script) : à coller dans ton outil d'envoi ou à ouvrir dans un navigateur. */
export function newsletterHtml(draft, projectName) {
  const styles = {
    h1: 'font-size:24px;margin:0 0 12px;color:#14202a', h2: 'font-size:19px;margin:24px 0 8px;color:#14202a', h3: 'font-size:16px;margin:18px 0 6px;color:#14202a',
    p: 'margin:0 0 14px', ul: 'margin:0 0 14px;padding-left:22px', ol: 'margin:0 0 14px;padding-left:22px', li: 'margin:0 0 6px', a: 'color:#0f5c6c',
    strong: 'font-weight:700', blockquote: 'margin:0 0 14px;padding-left:12px;border-left:3px solid #ccc;color:#555',
  };
  const preview = draft.extra.preview ? `<div style="display:none;max-height:0;overflow:hidden">${esc(draft.extra.preview)}</div>` : '';
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(draft.title)}</title></head>
<body style="margin:0;background:#f4f4f1;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#222">
${preview}<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px"><tr><td style="padding:28px 32px">
<p style="margin:0 0 18px;font-size:13px;color:#777">${esc(projectName)}</p>
${renderMarkdown(draft.body, { styles })}
</td></tr></table></td></tr></table></body></html>
`;
}

export function registerContentRoutes(router, app, { project, aiOpts }) {
  const { db, cfg } = app;
  const kindOf = (ctx) => {
    const k = ctx.params.kind;
    if (!KINDS.includes(k)) throw new HttpError(404, 'Page introuvable');
    return k;
  };
  const pngHeaders = (name, download) => ({
    'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
  });

  // État affiché dans la section : brouillons (sans l'image, servie à part), formats et limites
  router.get('/api/projects/:id/content/:kind', async (ctx) => {
    const kind = kindOf(ctx);
    const p = await project(ctx);
    const sup = kind === 'instagram' ? (app.stillSupported || stillSupported)(cfg) : { ok: true };
    json(ctx.res, {
      kind, hasProfile: !!p.profile, supported: sup.ok, unsupportedReason: sup.ok ? null : sup.reason,
      formats: kind === 'instagram' ? Object.entries(INSTAGRAM_FORMATS).map(([key, f]) => ({ key, label: f.label, width: f.width, height: f.height })) : null,
      limits: { caption: LIMITS.caption, alt: LIMITS.alt, subject: LIMITS.subject, preview: LIMITS.preview, newsletter: LIMITS.newsletter, direction: LIMITS.direction, hashtags: LIMITS.hashtags },
      drafts: await listDrafts(db, p.id, kind),
    });
  });

  router.post('/api/projects/:id/content/:kind/generate', async (ctx) => {
    const kind = kindOf(ctx);
    const p = await project(ctx);
    const b = await readBody(ctx.req);
    if (!p.profile) throw new HttpError(400, "Analyse le projet d'abord", { expose: true });
    if (kind === 'instagram') {
      const sup = (app.stillSupported || stillSupported)(cfg);
      if (!sup.ok) throw new HttpError(503, sup.reason, { expose: true });
    }
    await assertCanRunAi(db, p.userId, aiOpts);
    const direction = String(b.direction ?? '').trim().slice(0, LIMITS.direction);
    const params = kind === 'instagram' ? { direction, format: INSTAGRAM_FORMATS[b.format] ? b.format : 'carre' } : { direction };
    const r = await enqueue(db, { userId: p.userId, projectId: p.id, type: JOB[kind], params }, aiOpts);
    const budget = await budgetState(db, p.userId);
    json(ctx.res, { ...r, budgetBlocked: budget.blocked ? budget.reason : null });
  });

  router.post('/api/projects/:id/content/:kind/edit', async (ctx) => {
    const kind = kindOf(ctx);
    const p = await project(ctx);
    const b = await readBody(ctx.req);
    await editDraft(db, p.id, kind, b.draftId, { title: b.title, body: b.body, hashtags: b.hashtags, alt: b.alt, preview: b.preview });
    json(ctx.res, { ok: true });
  });

  router.post('/api/projects/:id/content/:kind/delete', async (ctx) => {
    const kind = kindOf(ctx);
    const p = await project(ctx);
    const b = await readBody(ctx.req);
    await removeDraft(db, p.id, kind, b.draftId);
    json(ctx.res, { ok: true });
  });

  // L'image d'un post Instagram : affichée dans la page, ou téléchargée (?telecharger=1)
  router.get('/api/projects/:id/content/instagram/:draftId/image', async (ctx) => {
    const p = await project(ctx);
    const png = await getImage(db, p.id, ctx.params.draftId);
    if (!png) throw new HttpError(404, 'Image introuvable');
    const d = await getDraft(db, p.id, 'instagram', ctx.params.draftId);
    ctx.res.writeHead(200, { ...pngHeaders(`instagram-${slug(p.name)}-${d?.id || 0}.png`, ctx.url.searchParams.get('telecharger') === '1'), 'Content-Length': png.length });
    ctx.res.end(png);
  });

  // La newsletter en HTML d'e-mail, téléchargée
  router.get('/api/projects/:id/content/newsletter/:draftId/html', async (ctx) => {
    const p = await project(ctx);
    const d = await getDraft(db, p.id, 'newsletter', ctx.params.draftId);
    if (!d) throw new HttpError(404, 'Brouillon introuvable');
    const body = Buffer.from(newsletterHtml(d, p.name), 'utf8');
    ctx.res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="newsletter-${slug(p.name)}-${d.id}.html"`, 'Content-Length': body.length,
    });
    ctx.res.end(body);
  });
}
