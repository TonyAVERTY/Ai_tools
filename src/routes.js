import { now, getSetting, setSetting } from './db.js';
import { encrypt, encryptJson, decryptJson, verifyUnsubToken } from './crypto.js';
import { html, json, redirect, readBody, HttpError } from './http.js';
import { startGoogleLogin, finishGoogleLogin, destroySession } from './auth.js';
import { loginPage, dashboardPage, settingsPage, unsubPage } from './views.js';
import { enqueue, latestJobs, cancelJob, usageSummary } from './services/jobs.js';
import { validateGitUrl, removeRepo } from './services/git.js';
import { fetchRecap, clearRecapCache, validateSelect } from './services/recap.js';
import { allowedToSend, EMAIL_RE } from './services/mailer.js';
import { cpuTemp } from './services/thermal.js';
import {
  getProject, listProjects, createProject, saveSecretConfig, publicConfig, globalSmtp,
  prospectStats, sentSince, repoDir,
} from './projects.js';

const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 20);
const int = (v, min, max, def) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def; };
const pid = (params) => Number(params.id);

export function registerRoutes(router, app) {
  const { db, cfg } = app;

  // ---------- Public ----------
  router.get('/login', ({ res, url }) => html(res, loginPage(url.searchParams.get('e'))), { public: true });
  router.get('/auth/google', ({ res }) => startGoogleLogin(db, cfg, res), { public: true });
  router.get('/auth/google/callback', async ({ res, url }) => {
    try { await finishGoogleLogin(db, cfg, url, res); }
    catch (e) { redirect(res, `/login?e=${encodeURIComponent(e.message)}`); }
  }, { public: true });

  // Désinscription (RGPD). GET = page de confirmation (évite les désinscriptions par les scanners de liens),
  // POST = désinscription effective, compatible "one-click" (RFC 8058).
  router.get('/u/:email/:token', ({ res, params }) => {
    const valid = verifyUnsubToken(cfg.secretKey, params.email, params.token);
    html(res, unsubPage({ email: params.email, valid, done: false }), valid ? 200 : 400);
  }, { public: true });
  router.post('/u/:email/:token', ({ res, params }) => {
    const email = params.email.toLowerCase();
    const valid = verifyUnsubToken(cfg.secretKey, email, params.token);
    if (valid) {
      db.prepare("INSERT OR IGNORE INTO blacklist(email, reason, created_at) VALUES(?, 'unsubscribe', ?)").run(email, now());
      db.prepare("UPDATE prospects SET status = 'refused' WHERE email = ? AND status IN ('new','sent')").run(email);
    }
    html(res, unsubPage({ email, valid, done: valid }), valid ? 200 : 400);
  }, { public: true });

  // ---------- Privé ----------
  router.post('/logout', ({ req, res }) => { destroySession(db, req, res); redirect(res, '/login'); });

  router.get('/', ({ res, session }) => {
    const projects = listProjects(app).map((p) => {
      const full = getProject(app, p.id, { secrets: true });
      return { project: p, smtp: publicConfig(full.smtp, 'pass'), dbCfg: publicConfig(full.dbCfg, 'password') };
    });
    html(res, dashboardPage({ email: session.email, projects, forgejoHost: getSetting(db, 'forgejo_host') }));
  });

  router.get('/settings', ({ res, session, url }) => {
    const s = {
      notify_email: getSetting(db, 'notify_email', ''),
      forgejo_host: getSetting(db, 'forgejo_host', ''),
      forgejo_token_set: !!getSetting(db, 'forgejo_token_enc'),
      smtp: publicConfig(globalSmtp(app), 'pass'),
      global_daily_cap: getSetting(db, 'global_daily_cap', '100'),
      send_delay_min: getSetting(db, 'send_delay_min', '20'),
      send_delay_max: getSetting(db, 'send_delay_max', '60'),
      prospect_model: getSetting(db, 'prospect_model', 'haiku'),
      blacklist_count: db.prepare('SELECT COUNT(*) n FROM blacklist').get().n,
    };
    html(res, settingsPage({ email: session.email, s, saved: url.searchParams.has('ok') }));
  });

  router.post('/settings', async ({ req, res }) => {
    const b = await readBody(req);
    if (b.notify_email && !EMAIL_RE.test(b.notify_email)) throw new HttpError(400, 'Email de réception invalide');
    setSetting(db, 'notify_email', (b.notify_email || '').trim());
    setSetting(db, 'forgejo_host', (b.forgejo_host || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
    if (b.forgejo_token) setSetting(db, 'forgejo_token_enc', encrypt(cfg.secretKey, b.forgejo_token.trim()));
    const cap = int(b.global_daily_cap, 1, 300, 100);
    const dmin = int(b.send_delay_min, 5, 3600, 20);
    const dmax = Math.max(dmin, int(b.send_delay_max, 5, 3600, 60));
    setSetting(db, 'global_daily_cap', String(cap));
    setSetting(db, 'send_delay_min', String(dmin));
    setSetting(db, 'send_delay_max', String(dmax));
    setSetting(db, 'prospect_model', b.prospect_model === 'sonnet' ? 'sonnet' : 'haiku');

    const prev = globalSmtp(app) || {};
    const smtp = { host: b.smtp_host, port: b.smtp_port, user: b.smtp_user, pass: b.smtp_pass || prev.pass, fromEmail: b.smtp_fromEmail };
    setSetting(db, 'smtp_enc', smtp.host ? encryptJson(cfg.secretKey, smtp) : null);
    redirect(res, '/settings?ok');
  });

  // ---------- API JSON ----------
  router.get('/api/system', ({ res }) => {
    const queue = db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')").get().n;
    json(res, { temp: cpuTemp(), queue, usage: usageSummary(db), thermalMax: cfg.thermalMax });
  });

  router.post('/api/projects', async ({ req, res }) => {
    const b = await readBody(req);
    const name = String(b.name || '').trim().slice(0, 80);
    if (!name) throw new HttpError(400, 'Nom requis');
    const host = getSetting(db, 'forgejo_host');
    if (!host) throw new HttpError(400, "Configure l'hôte Forgejo dans Réglages");
    let gitUrl;
    try { gitUrl = validateGitUrl(String(b.gitUrl || '').trim(), host); }
    catch (e) { throw new HttpError(400, e.message); }
    if (db.prepare('SELECT 1 FROM projects WHERE git_url = ?').get(gitUrl)) throw new HttpError(409, 'Ce dépôt est déjà un projet');
    const id = createProject(app, { name, gitUrl });
    enqueue(db, { projectId: id, type: 'analyze' });
    json(res, { id });
  });

  router.post('/api/projects/:id/delete', ({ res, params }) => {
    const p = getProject(app, pid(params));
    db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
    removeRepo(repoDir(cfg, p.id));
    clearRecapCache(p.id);
    json(res, { ok: true });
  });

  router.get('/api/projects/:id/status', ({ res, params }) => {
    const p = getProject(app, pid(params));
    const jobs = latestJobs(db, p.id);
    const tpl = db.prepare('SELECT subject, body, status, updated_at FROM mail_templates WHERE project_id = ?').get(p.id) || null;
    const stats = prospectStats(db, p.id);
    const day = now() - 86400;
    const sendMax = allowedToSend({
      requested: 100, available: stats.new || 0,
      projectCap: p.dailyMailCap, sentTodayProject: sentSince(db, day, p.id),
      globalCap: Number(getSetting(db, 'global_daily_cap', '100')), sentTodayGlobal: sentSince(db, day),
    });
    json(res, {
      jobs, template: tpl, stats, sendMax,
      targetValidated: p.targetValidated, hasProfile: !!p.profile, hasSmtp: p.hasSmtp,
    });
  });

  router.post('/api/projects/:id/target', async ({ req, res, params }) => {
    const p = getProject(app, pid(params));
    const b = await readBody(req);
    const target = {
      description: String(b.description || '').slice(0, 300),
      zone: String(b.zone || '').slice(0, 100),
      taille: String(b.taille || '').slice(0, 100),
      decideur: String(b.decideur || '').slice(0, 100),
      secteurs: lines(b.secteurs),
      requetes: lines(b.requetes),
    };
    if (!target.description || !target.secteurs.length) throw new HttpError(400, 'Description et au moins un secteur requis');
    db.prepare('UPDATE projects SET target_json = ?, target_validated = 1 WHERE id = ?').run(JSON.stringify(target), p.id);
    json(res, { ok: true });
  });

  const jobRoute = (type, paramsOf = () => ({}), guard = () => {}) => async ({ req, res, params }) => {
    const p = getProject(app, pid(params));
    const b = req.headers['content-type']?.includes('json') ? await readBody(req) : {};
    guard(p, b);
    const r = enqueue(db, { projectId: p.id, type, params: paramsOf(b) });
    json(res, r);
  };

  router.post('/api/projects/:id/analyze', jobRoute('analyze'));
  router.post('/api/projects/:id/template', jobRoute('template', () => ({}), (p) => {
    if (!p.profile) throw new HttpError(400, "Analyse le projet d'abord");
  }));
  router.post('/api/projects/:id/prospect', jobRoute('prospect', (b) => ({ count: int(b.count, 1, 50, 10) }), (p) => {
    if (!p.targetValidated) throw new HttpError(400, 'Valide la cible avant de prospecter');
  }));
  router.post('/api/projects/:id/evolution', jobRoute('evolution', (b) => ({
    count: int(b.count, 1, 20, 5),
    level: ['rapide', 'normal', 'approfondi'].includes(b.level) ? b.level : 'normal',
  })));
  router.post('/api/projects/:id/send', jobRoute('send', (b) => ({ count: int(b.count, 1, 100, 10) }), (p, b) => {
    if (!b.confirm) throw new HttpError(400, 'Confirmation requise');
    const running = db.prepare("SELECT 1 FROM jobs WHERE project_id = ? AND type = 'prospect' AND status IN ('queued','running')").get(p.id);
    if (running) throw new HttpError(409, 'La recherche de prospects est encore en cours');
  }));

  router.post('/api/projects/:id/template/save', async ({ req, res, params }) => {
    const p = getProject(app, pid(params));
    const b = await readBody(req);
    const subject = String(b.subject || '').trim().slice(0, 200);
    const body = String(b.body || '').trim().slice(0, 5000);
    if (!subject || !body) throw new HttpError(400, 'Objet et corps requis');
    const status = b.mode === 'validate' ? 'validated' : 'draft';
    db.prepare(`INSERT INTO mail_templates(project_id, subject, body, status, updated_at) VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET subject = excluded.subject, body = excluded.body, status = excluded.status, updated_at = excluded.updated_at`)
      .run(p.id, subject, body, status, now());
    json(res, { ok: true, status });
  });

  router.post('/api/projects/:id/smtp', async ({ req, res, params }) => {
    const p = getProject(app, pid(params));
    const b = await readBody(req);
    if (b.fromEmail && !EMAIL_RE.test(b.fromEmail)) throw new HttpError(400, 'Email expéditeur invalide');
    saveSecretConfig(app, p.id, 'smtp_enc', {
      host: String(b.host || '').trim(), port: int(b.port, 1, 65535, 587), user: String(b.user || '').trim(),
      pass: b.pass || '', fromEmail: String(b.fromEmail || '').trim(), fromName: String(b.fromName || '').trim().slice(0, 80),
    }, 'pass');
    db.prepare('UPDATE projects SET daily_mail_cap = ? WHERE id = ?').run(int(b.dailyCap, 1, 200, 30), p.id);
    json(res, { ok: true });
  });

  router.post('/api/projects/:id/db', async ({ req, res, params }) => {
    const p = getProject(app, pid(params));
    const b = await readBody(req);
    for (const k of ['sql_users', 'sql_clients', 'sql_revenue']) {
      try { validateSelect(b[k]); } catch (e) { throw new HttpError(400, `${k} : ${e.message}`); }
    }
    saveSecretConfig(app, p.id, 'db_enc', {
      type: b.type === 'pg' ? 'pg' : 'mysql', host: String(b.host || '').trim(), port: b.port ? int(b.port, 1, 65535, null) : null,
      database: String(b.database || '').trim(), user: String(b.user || '').trim(), password: b.password || '',
      ssl: b.ssl === 'on' || b.ssl === true,
      sql_users: b.sql_users || '', sql_clients: b.sql_clients || '', sql_revenue: b.sql_revenue || '',
    }, 'password');
    clearRecapCache(p.id);
    json(res, { ok: true });
  });

  router.get('/api/projects/:id/recap', async ({ res, params, url }) => {
    const p = getProject(app, pid(params), { secrets: true });
    const stats = prospectStats(db, p.id);
    const cost = db.prepare('SELECT COALESCE(SUM(cost_usd),0) c FROM jobs WHERE project_id = ?').get(p.id).c;
    let business = null, error = null;
    try { business = await fetchRecap(p.id, p.dbCfg, { force: url.searchParams.has('force') }); }
    catch (e) { error = e.message; }
    json(res, { business, error, stats, aiCostUsd: cost });
  });

  router.get('/api/projects/:id/prospects', ({ res, params }) => {
    const p = getProject(app, pid(params));
    const rows = db.prepare(`SELECT id, company, email, website, city, sector, score, status, sent_at FROM prospects
      WHERE project_id = ? ORDER BY CASE status WHEN 'new' THEN 0 ELSE 1 END, score DESC, id DESC LIMIT 500`).all(p.id);
    json(res, rows);
  });

  const STATUSES = ['new', 'sent', 'replied', 'client', 'refused', 'bounced'];
  router.post('/api/prospects/:id/status', async ({ req, res, params }) => {
    const b = await readBody(req);
    if (!STATUSES.includes(b.status)) throw new HttpError(400, 'Statut invalide');
    const r = db.prepare('UPDATE prospects SET status = ? WHERE id = ?').run(b.status, Number(params.id));
    if (!r.changes) throw new HttpError(404, 'Prospect introuvable');
    if (b.status === 'refused') {
      const { email } = db.prepare('SELECT email FROM prospects WHERE id = ?').get(Number(params.id));
      db.prepare("INSERT OR IGNORE INTO blacklist(email, reason, created_at) VALUES(?, 'refused', ?)").run(email, now());
    }
    json(res, { ok: true });
  });

  router.post('/api/jobs/:id/cancel', ({ res, params }) => { cancelJob(db, Number(params.id)); json(res, { ok: true }); });
}
