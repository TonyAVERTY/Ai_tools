// Mode développeur : activation (compte), page Développeur, création et suppression des jetons d'API.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, html, redirect, readBody, send } from './http.js';
import { DEV_DOCS } from './devlinks.js';
import { getUser } from './users.js';
import { developerMode, setDeveloperMode, createApiToken, listApiTokens, revokeApiToken, MAX_TOKENS, SCOPES } from './apitokens.js';
import { developerPage } from './developerviews.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

export function registerDeveloperRoutes(router, app) {
  const { db, cfg } = app;
  // Documentation et serveur MCP : servis par le panel pour ceux qui ont activé le mode développeur (404 pour les autres)
  const files = { docs: Object.fromEntries(Object.entries(DEV_DOCS).map(([k, f]) => [k, read(`docs/${f}`)])), mcp: read('mcp/aitools-mcp.js') };
  const gated = (fn) => async (ctx) => {
    if (!(await developerMode(db, ctx.session.userId))) throw new HttpError(404, 'Page introuvable');
    return fn(ctx);
  };
  router.get('/developer/docs/:name', gated(({ res, params }) => {
    if (!Object.hasOwn(files.docs, params.name)) throw new HttpError(404, 'Page introuvable');
    send(res, 200, files.docs[params.name], 'text/markdown; charset=utf-8');
  }));
  router.get('/developer/mcp.js', gated(({ res }) => {
    res.setHeader('Content-Disposition', 'attachment; filename="aitools-mcp.js"');
    send(res, 200, files.mcp, 'text/javascript; charset=utf-8');
  }));

  const show = async (res, session, extra = {}, status = 200) => {
    html(res, developerPage({
      user: await getUser(db, session.userId), enabled: await developerMode(db, session.userId), tokens: await listApiTokens(db, session.userId),
      appUrl: cfg.appUrl, max: MAX_TOKENS, ...extra,
    }), status);
  };

  router.get('/developer', async ({ res, session }) => show(res, session));

  router.post('/account/developer', async ({ req, res, session }) => {
    const b = await readBody(req);
    await setDeveloperMode(db, session.userId, b.enabled === 'on' || b.enabled === true);
    redirect(res, '/developer');
  }, { limit: 'link' });

  router.post('/developer/tokens', async ({ req, res, session }) => {
    const b = await readBody(req);
    try {
      const t = await createApiToken(db, session.userId, { name: b.name, scopes: Object.keys(SCOPES).filter((k) => b[`scope_${k}`] === 'on') });
      // Réponse directe (pas de redirection) : le jeton n'existe en clair que dans cette page, jamais dans une URL ni un cookie
      await show(res, session, { newToken: t.token });
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      await show(res, session, { error: e.message }, e.status);
    }
  }, { limit: 'link' });

  router.post('/developer/tokens/:id/revoke', async ({ res, session, params }) => {
    await revokeApiToken(db, session.userId, params.id);
    redirect(res, '/developer');
  }, { limit: 'link' });
}
