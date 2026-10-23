import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { Router, json, redirect, html, esc, HttpError } from './http.js';
import { RateLimiter, clientIp } from './ratelimit.js';
import { getSession, checkOrigin, purgeExpired } from './auth.js';
import { authenticateApi } from './apitokens.js';
import { syncAdmins } from './users.js';
import { registerRoutes } from './routes.js';
import { Worker } from './services/jobs.js';
import { makeHandlers } from './handlers.js';
import { Scheduler } from './services/scheduler.js';
import { notify, notifyJob } from './services/notify.js';
import { budgetState, AI_JOBS, quotaState, isQuotaSensitive } from './services/budget.js';
import { layout } from './views.js';
import { homePage, notFoundPage } from './site/pages.js';
import { withViewer } from './site/layout.js';
import { reportError } from './services/errormail.js';
import { securityHeaders, robotsHeaderFor, cspFor } from './site/seo.js';
import { hasUsableLink, isLinkExempt, LINK_REQUIRED_MESSAGE } from './claudelink.js';
import { memberTeamIds, purgeInvites } from './teams.js';
import { sandboxStartupMessages } from './services/sandbox.js';
import { gitVersionNotes } from './services/git.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Fichiers statiques chargés une fois en mémoire (quelques Ko), avec ETag : un rechargement coûte un 304
function asset(file, type, maxAge) {
  const body = readFileSync(join(ROOT, 'public', file));
  const etag = '"' + createHash('sha1').update(body).digest('base64url').slice(0, 20) + '"';
  return { type, body, etag, cache: `public, max-age=${maxAge}` };
}
const IMG_TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const STATIC = {
  '/static/tokens.css': asset('tokens.css', 'text/css; charset=utf-8', 3600),
  '/static/app.css': asset('app.css', 'text/css; charset=utf-8', 3600),
  '/static/site.css': asset('site.css', 'text/css; charset=utf-8', 3600),
  '/static/responsive.css': asset('responsive.css', 'text/css; charset=utf-8', 3600),
  '/static/responsive.js': asset('responsive.js', 'text/javascript; charset=utf-8', 3600),
  '/static/app.js': asset('app.js', 'text/javascript; charset=utf-8', 3600),
  '/static/captcha.js': asset('captcha.js', 'text/javascript; charset=utf-8', 3600),
  '/static/chat.js': asset('chat.js', 'text/javascript; charset=utf-8', 3600),
  '/static/fx.js': asset('fx.js', 'text/javascript; charset=utf-8', 3600),
  // Les navigateurs réclament /favicon.ico d'office
  '/favicon.ico': asset('favicon.ico', 'image/x-icon', 86400),
  '/static/site.js': asset('site.js', 'text/javascript; charset=utf-8', 3600),
  ...Object.fromEntries(readdirSync(join(ROOT, 'public', 'img')).map((f) => [`/static/img/${f}`, asset(`img/${f}`, IMG_TYPES[extname(f)] || 'application/octet-stream', 86400)])),
};

// `fetch`, `validateApiKey`, `validateToken`, `syncRepo`, `limiter` : points d'injection pour les tests (aucun appel réseau réel)
export async function createApp(cfg, { db, worker = true, createTransport, fetch, validateApiKey, validateToken, syncRepo, limiter, resolveHost, resolveMx } = {}) {
  db ??= await openDb(cfg.db, { adminEmails: cfg.adminEmails });
  await syncAdmins(db, cfg.adminEmails || []); // ADMIN_EMAILS fait foi pour le rôle admin
  const app = { db, cfg, createTransport, fetch, validateApiKey, validateToken, syncRepo, resolveHost, resolveMx, limiter: limiter || new RateLimiter() };
  const secHeaders = securityHeaders(cfg.appUrl);
  const router = new Router();
  registerRoutes(router, app);

  const server = createServer(async (req, res) => {
    // Un défaut imprévu dans un gestionnaire ne doit jamais arrêter le serveur pour tous les utilisateurs
    try { await handle(req, res); } catch (e) {
      console.error('[http]', e);
      reportError(app, e, { method: req.method, path: req.url });
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Erreur interne');
    }
  });
  const handle = async (req, res) => {
    for (const [k, v] of Object.entries(secHeaders)) res.setHeader(k, v);
    // `//` ou une cible illisible font échouer new URL : sans ce garde-fou la promesse rejetée arrête tout le processus
    let url;
    try { url = new URL(req.url, cfg.appUrl); } catch { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' }); return res.end('Requête invalide'); }
    // Pages et API dépendent du compte connecté : jamais mises en cache (les fichiers statiques posent leur propre Cache-Control)
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', cspFor(url.pathname, !!cfg.recaptcha));
    // Pages d'application, API, connexion, 404 : jamais indexées (seul le site public l'est)
    const robots = robotsHeaderFor(url.pathname);
    if (robots) res.setHeader('X-Robots-Tag', robots);
    let session = null; // pour l'alerte d'erreur : le compte concerné, si la requête était connectée
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
        res.setHeader('Vary', 'Cookie');
        return html(res, withViewer(notFoundPage({ appUrl: cfg.appUrl }), !!(await getSession(db, req))), 404);
      }
      const ip = clientIp(req, cfg.trustProxy);
      // API (mode développeur) : jeton « Bearer », jamais de cookie ; pas de CSRF possible puisque rien n'est envoyé automatiquement
      if (route.api) {
        app.limiter.enforce(route.limit, { ip }); // par adresse, avant toute lecture en base
        const api = await authenticateApi(db, req);
        app.limiter.enforce('api', { ip, userId: api.userId });
        return await route.handler({ req, res, url, params: route.params, session: null, api, app });
      }
      if (route.public && route.limit) app.limiter.enforce(route.limit, { ip });
      session = route.public ? null : await getSession(db, req);
      // Back-office : 404 pour tout autre que les administrateurs (visiteurs compris), sans rien révéler
      if (route.admin && !session?.user.isAdmin) {
        if (url.pathname.startsWith('/api/') || !isRead || req.headers.accept?.includes('json')) throw new HttpError(404, 'Page introuvable');
        return html(res, notFoundPage({ appUrl: cfg.appUrl }), 404);
      }
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
        if (route.limit) app.limiter.enforce(route.limit, { ip, userId: session.userId });
        // Onboarding bloquant : sans liaison Claude valide, seules la liaison, Mon compte et la déconnexion répondent
        // Un membre d'une équipe travaille avec l'accès Claude du propriétaire des projets partagés : il n'en a pas besoin du sien
        if (!isLinkExempt(req.method, url.pathname) && !(await hasUsableLink(db, session.userId, { cliModeEnabled: cfg.cliModeEnabled !== false }))
          && !(await memberTeamIds(db, session.userId)).length) {
          if (url.pathname.startsWith('/api/') || req.headers.accept?.includes('json')) {
            return json(res, { error: LINK_REQUIRED_MESSAGE, code: 'link_required' }, 403);
          }
          return redirect(res, '/link');
        }
      }
      await route.handler({ req, res, url, params: route.params, session, app });
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500 && !e.expose) {
        console.error(`[${req.method} ${url.pathname}]`, e);
        reportError(app, e, { method: req.method, path: url.pathname, userId: session?.userId });
      }
      if (res.headersSent) return res.end();
      const msg = status >= 500 && !e.expose ? 'Erreur interne' : e.message;
      for (const [k, v] of Object.entries(e.headers || {})) res.setHeader(k, v);
      if (url.pathname.startsWith('/api/') || req.headers.accept?.includes('json')) json(res, { error: msg, ...(e.code ? { code: e.code } : {}), ...(e.data || {}) }, status);
      else html(res, layout({ title: 'Erreur', body: `<section class="card"><h1>${status}</h1><p>${esc(msg)}</p><a href="/">Retour</a></section>` }), status);
    }
  };
  // Pi : on limite ce qui traîne en mémoire
  server.keepAliveTimeout = 5000;
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;

  let w = null;
  let scheduler = null;
  if (worker) {
    w = new Worker(db, makeHandlers(app), {
      maxJobs: cfg.maxAiJobs ?? 4, loadMax: cfg.loadMax, cliModeEnabled: cfg.cliModeEnabled !== false,
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
      onLoad: (ratio, userId) => notify(app, userId, 'load', {
        title: 'Serveur très chargé', level: 'warn',
        description: `Charge du serveur à ${Math.round(ratio * 100)} % : tes jobs attendent un instant, ils repartent tout seuls.`,
      }),
    });
    await w.start();
    app.worker = w;
    scheduler = new Scheduler(app);
    scheduler.start();
  }
  let purging = null;
  const purge = setInterval(() => {
    app.limiter.sweep();
    purging = Promise.all([purgeExpired(db), purgeInvites(db)]).catch((e) => console.error('[purge]', e.message));
  }, 3600_000);
  purge.unref();

  // Arrêt propre : plus de requêtes, puis fin du job en cours et des tâches de fond, enfin fermeture de la base
  app.close = async () => {
    clearInterval(purge);
    app.claudeLogins?.closeAll();
    await new Promise((r) => { server.close(r); server.closeIdleConnections?.(); });
    await w?.stop();
    await scheduler?.stop();
    await purging;
    await db.close();
  };
  app.server = server;
  app.router = router;
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  if (!cfg.adminEmails.length) console.warn('ADMIN_EMAILS est vide : aucun administrateur (back-office inaccessible).');
  for (const m of sandboxStartupMessages(cfg.sandbox)) console.warn(m);
  try { for (const m of gitVersionNotes(execFileSync('git', ['--version'], { encoding: 'utf8', timeout: 5000 }))) console.warn(m); } catch { console.warn('git est introuvable ou ne répond pas : aucun dépôt ne pourra être cloné.'); }
  if (cfg.production && cfg.allowPrivateHosts) console.warn('ALLOW_PRIVATE_HOSTS est actif en production : seuls les administrateurs peuvent viser des hôtes privés.');
  if (cfg.production && !cfg.trustProxy) console.warn("TRUST_PROXY est désactivé : derrière Nginx, tous les visiteurs partagent la même adresse pour la limitation de débit. Pose TRUST_PROXY=true.");
  if (!cfg.recaptcha) console.warn(`reCAPTCHA désactivé (RECAPTCHA_SITE_KEY / RECAPTCHA_SECRET absentes)${cfg.sandbox.production ? " : à configurer avant l'ouverture au public" : ''}.`);
  const app = await createApp(cfg);
  app.server.listen(cfg.port, cfg.host, () => console.log(`AiTools sur http://${cfg.host}:${cfg.port} (${cfg.appUrl})`));
  const shutdown = () => app.close().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

