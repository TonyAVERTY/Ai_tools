// Mode développeur : activation (compte), page Développeur, création et suppression des jetons d'API.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, html, redirect, readBody, send } from './http.js';
import { getUser } from './users.js';
import { developerMode, setDeveloperMode, createApiToken, listApiTokens, revokeApiToken, MAX_TOKENS, SCOPES } from './apitokens.js';
import { developerPage } from './developerviews.js';
import { requireFeature } from './services/plans.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

export function registerDeveloperRoutes(router, app) {
  const { db, cfg } = app;
  // Le serveur MCP à télécharger : servi par le panel pour ceux qui ont activé le mode développeur (404 pour les autres).
  // La documentation (API, MCP) est publique : voir /docs.
  const files = { mcp: read('mcp/iaboss-mcp.js') };
  const gated = (fn) => async (ctx) => {
    if (!(await developerMode(db, ctx.session.userId))) throw new HttpError(404, 'Page introuvable');
    return fn(ctx);
  };
  router.get('/developer/mcp.js', gated(({ res }) => {
    res.setHeader('Content-Disposition', 'attachment; filename="iaboss-mcp.js"');
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
    const on = b.enabled === 'on' || b.enabled === true;
    if (on) await requireFeature(db, session.userId, 'api');
    await setDeveloperMode(db, session.userId, on);
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
