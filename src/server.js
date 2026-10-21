import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { Router, json, redirect, html, HttpError } from './http.js';
import { getSession, checkOrigin, purgeExpired } from './auth.js';
import { registerRoutes } from './routes.js';
import { Worker } from './services/jobs.js';
import { makeHandlers } from './handlers.js';
import { layout } from './views.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Fichiers statiques chargés une fois en mémoire (2 fichiers, quelques Ko)
const STATIC = {
  '/static/app.css': ['text/css; charset=utf-8', readFileSync(join(ROOT, 'public/app.css'))],
  '/static/app.js': ['text/javascript; charset=utf-8', readFileSync(join(ROOT, 'public/app.js'))],
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; form-action 'self' https://accounts.google.com; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000',
};

export function createApp(cfg, { db = openDb(cfg.dataDir), worker = true, createTransport } = {}) {
  const app = { db, cfg, createTransport };
  const router = new Router();
  registerRoutes(router, app);

  const server = createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const url = new URL(req.url, cfg.appUrl);
    try {
      const st = STATIC[url.pathname];
      if (st && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': st[0], 'Cache-Control': 'public, max-age=3600' });
        return res.end(st[1]);
      }
      const route = router.match(req.method, url.pathname);
      if (!route) throw new HttpError(404, 'Page introuvable');
      const session = route.public ? null : getSession(db, req);
      if (!route.public) {
        if (!session) {
          if (url.pathname.startsWith('/api/')) throw new HttpError(401, 'Non connecté');
          return redirect(res, '/login');
        }
        checkOrigin(req, cfg);
      }
      await route.handler({ req, res, url, params: route.params, session, app });
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(`[${req.method} ${url.pathname}]`, e);
      if (res.headersSent) return res.end();
      const msg = status >= 500 ? 'Erreur interne' : e.message;
      if (url.pathname.startsWith('/api/') || req.headers.accept?.includes('json')) json(res, { error: msg }, status);
      else html(res, layout({ title: 'Erreur', body: `<section class="card"><h1>${status}</h1><p>${msg.replace(/</g, '&lt;')}</p><a href="/">Retour</a></section>` }), status);
    }
  });
  // Pi : on limite ce qui traîne en mémoire
  server.keepAliveTimeout = 5000;
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;

  let w = null;
  if (worker) {
    w = new Worker(db, makeHandlers(app), { thermalMax: cfg.thermalMax });
    w.start();
  }
  const purge = setInterval(() => purgeExpired(db), 3600_000);
  purge.unref();

  app.close = () => new Promise((r) => { w?.stop(); clearInterval(purge); server.close(() => { db.close(); r(); }); });
  app.server = server;
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  const app = createApp(cfg);
  app.server.listen(cfg.port, cfg.host, () => console.log(`AiTools sur http://${cfg.host}:${cfg.port} (${cfg.appUrl})`));
  const shutdown = () => app.close().then(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

