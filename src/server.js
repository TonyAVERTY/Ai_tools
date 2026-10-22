import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { Router, json, redirect, html, HttpError } from './http.js';
import { getSession, checkOrigin, purgeExpired } from './auth.js';
import { syncAdmins } from './users.js';
import { registerRoutes } from './routes.js';
import { Worker } from './services/jobs.js';
import { makeHandlers } from './handlers.js';
import { Scheduler } from './services/scheduler.js';
import { notify, notifyJob } from './services/notify.js';
import { budgetState, AI_JOBS, quotaState, isQuotaSensitive } from './services/budget.js';
import { layout } from './views.js';
import { homePage, notFoundPage } from './site/pages.js';
import { securityHeaders, robotsHeaderFor } from './site/seo.js';
import { hasUsableLink, isLinkExempt, LINK_REQUIRED_MESSAGE } from './claudelink.js';
import { sandboxStartupMessages } from './services/sandbox.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Fichiers statiques chargés une fois en mémoire (quelques Ko), avec ETag : un rechargement coûte un 304
function asset(file, type, maxAge) {
  const body = readFileSync(join(ROOT, 'public', file));
  const etag = '"' + createHash('sha1').update(body).digest('base64url').slice(0, 20) + '"';
  return { type, body, etag, cache: `public, max-age=${maxAge}` };
}
const STATIC = {
  '/static/app.css': asset('app.css', 'text/css; charset=utf-8', 3600),
  '/static/site.css': asset('site.css', 'text/css; charset=utf-8', 3600),
  '/static/app.js': asset('app.js', 'text/javascript; charset=utf-8', 3600),
  '/static/favicon.svg': asset('favicon.svg', 'image/svg+xml', 86400),
};

// `fetch`, `validateApiKey`, `validateToken`, `syncRepo` : points d'injection pour les tests (aucun appel réseau réel)
export async function createApp(cfg, { db, worker = true, createTransport, fetch, validateApiKey, validateToken, syncRepo } = {}) {
  db ??= await openDb(cfg.db, { adminEmails: cfg.adminEmails });
  await syncAdmins(db, cfg.adminEmails || []); // ADMIN_EMAILS fait foi pour le rôle admin
  const app = { db, cfg, createTransport, fetch, validateApiKey, validateToken, syncRepo };
  const secHeaders = securityHeaders(cfg.appUrl);
  const router = new Router();
  registerRoutes(router, app);

  const server = createServer(async (req, res) => {
    for (const [k, v] of Object.entries(secHeaders)) res.setHeader(k, v);
    const url = new URL(req.url, cfg.appUrl);
    // Pages d'application, API, connexion, 404 : jamais indexées (seul le site public l'est)
    const robots = robotsHeaderFor(url.pathname);
    if (robots) res.setHeader('X-Robots-Tag', robots);
    try {
      const isRead = req.method === 'GET' || req.method === 'HEAD';
      const st = isRead ? STATIC[url.pathname] : null;
      if (st) {
        const headers = { 'Content-Type': st.type, 'Cache-Control': st.cache, ETag: st.etag };
        if (req.headers['if-none-match'] === st.etag) { res.writeHead(304, headers); return res.end(); }
        res.writeHead(200, headers);
        return res.end(st.body);
      }
      // HEAD répond comme GET (Node n'envoie pas le corps)
      const route = router.match(req.method === 'HEAD' ? 'GET' : req.method, url.pathname);
      if (!route) {
        const wantsJson = url.pathname.startsWith('/api/') || req.headers.accept?.includes('json');
        if (wantsJson || !isRead) throw new HttpError(404, 'Page introuvable');
        return html(res, notFoundPage({ appUrl: cfg.appUrl }), 404);
      }
      const session = route.public ? null : await getSession(db, req);
      if (!route.public) {
        if (!session) {
          // Visiteur sur la racine : le site public. Connecté, la même adresse mène au tableau de bord.
          if (isRead && url.pathname === '/') {
            res.setHeader('Vary', 'Cookie');
            return html(res, homePage({ appUrl: cfg.appUrl, apple: !!cfg.apple }));
          }
          if (url.pathname.startsWith('/api/')) throw new HttpError(401, 'Non connecté');
          return redirect(res, '/login');
        }
        checkOrigin(req, cfg);
        // Onboarding bloquant : sans liaison Claude valide, seules la liaison, Mon compte et la déconnexion répondent
        if (!isLinkExempt(req.method, url.pathname) && !(await hasUsableLink(db, session.userId, { cliModeEnabled: cfg.cliModeEnabled !== false }))) {
          if (url.pathname.startsWith('/api/') || req.headers.accept?.includes('json')) {
            return json(res, { error: LINK_REQUIRED_MESSAGE, code: 'link_required' }, 403);
          }
          return redirect(res, '/link');
        }
      }
      await route.handler({ req, res, url, params: route.params, session, app });
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500 && !e.expose) console.error(`[${req.method} ${url.pathname}]`, e);
      if (res.headersSent) return res.end();
      const msg = status >= 500 && !e.expose ? 'Erreur interne' : e.message;
      if (url.pathname.startsWith('/api/') || req.headers.accept?.includes('json')) json(res, { error: msg }, status);
      else html(res, layout({ title: 'Erreur', body: `<section class="card"><h1>${status}</h1><p>${msg.replace(/</g, '&lt;')}</p><a href="/">Retour</a></section>` }), status);
    }
  });
  // Pi : on limite ce qui traîne en mémoire
  server.keepAliveTimeout = 5000;
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;

  let w = null;
  let scheduler = null;
  if (worker) {
    w = new Worker(db, makeHandlers(app), {
      thermalMax: cfg.thermalMax, cliModeEnabled: cfg.cliModeEnabled !== false,
      onFinish: (job, r) => notifyJob(app, job, r),
      budget: (userId) => budgetState(db, userId),
      isAiJob: (type) => AI_JOBS.has(type),
      onBudget: (reason, userId) => notify(app, userId, 'budget', {
        title: 'Budget IA atteint', level: 'warn',
        description: `${reason[0].toUpperCase()}${reason.slice(1)}. Les jobs IA attendent ; les envois et relances continuent.`,
      }),
      quota: (userId) => quotaState(db, userId),
      isQuotaSensitive,
      onQuotaHold: (reason, userId) => notify(app, userId, 'quota', {
        title: 'Job IA reporté (quota serré)', level: 'warn',
        description: `${reason[0].toUpperCase()}${reason.slice(1)}. Analyse et évolutions attendent ; prospection et envois continuent.`,
      }),
      onThermal: (t, userId) => notify(app, userId, 'thermal', {
        title: 'Pause thermique', level: 'warn',
        description: `CPU à ${t} °C : les jobs IA attendent que le Pi redescende sous ${cfg.thermalMax - 5} °C.`,
      }),
    });
    await w.start();
    app.worker = w;
    scheduler = new Scheduler(app);
    scheduler.start();
  }
  let purging = null;
  const purge = setInterval(() => {
    purging = purgeExpired(db).catch((e) => console.error('[purge]', e.message));
  }, 3600_000);
  purge.unref();

  // Arrêt propre : plus de requêtes, puis fin du job en cours et des tâches de fond, enfin fermeture de la base
  app.close = async () => {
    clearInterval(purge);
    await new Promise((r) => { server.close(r); server.closeIdleConnections?.(); });
    await w?.stop();
    await scheduler?.stop();
    await purging;
    await db.close();
  };
  app.server = server;
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  if (!cfg.adminEmails.length) console.warn('ADMIN_EMAILS est vide : aucun administrateur (personne ne pourra utiliser le mode « Claude du serveur »).');
  for (const m of sandboxStartupMessages(cfg.sandbox)) console.warn(m);
  const app = await createApp(cfg);
  app.server.listen(cfg.port, cfg.host, () => console.log(`AiTools sur http://${cfg.host}:${cfg.port} (${cfg.appUrl})`));
  const shutdown = () => app.close().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

