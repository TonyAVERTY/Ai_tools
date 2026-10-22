import { now, getSetting, setSetting } from './db.js';
import { encrypt, encryptJson, decryptJson, verifyUnsubToken } from './crypto.js';
import { html, json, redirect, readBody, HttpError } from './http.js';
import { startLogin, finishLogin, destroySession } from './auth.js';
import { deleteUser, normalizeEmail } from './users.js';
import {
  assertCanRunAi, getLinkState, linkApiKey, linkSubscriptionToken, linkServer, unlink, testLink, lastConsent,
  MODES,
} from './claudelink.js';
import { loginPage, dashboardPage, settingsPage, unsubPage, accountPage, linkPage } from './views.js';
import { enqueue, latestJobs, cancelJob, usageSummary } from './services/jobs.js';
import { validateGitUrl, removeRepo } from './services/git.js';
import { fetchRecap, clearRecapCache, validateSelect } from './services/recap.js';
import { allowedToSend, EMAIL_RE } from './services/mailer.js';
import { cpuTemp } from './services/thermal.js';
import { checkInbox } from './services/inbox.js';
import { followupPlan } from './services/followup.js';
import { nextNightSlot } from './services/paris-time.js';
import { notify, notifyConfig, EVENTS, WEBHOOK_RE } from './services/notify.js';
import { budgetState, AI_JOBS } from './services/budget.js';
import { sendWeeklyReport } from './services/report.js';
import { exportProspects, importProspects } from './services/csv.js';
import { history, saveSnapshot } from './services/metrics.js';
import { evolutionHtml } from './services/markdown.js';
import {
  listProspects, parseFilters, STATUSES as PROSPECT_STATUSES, prospectDetail, addNote, deleteNote, setNextAction,
} from './services/crm.js';
import {
  getProject, listProjects, createProject, saveSecretConfig, publicConfig, globalSmtp,
  prospectStats, sentSince, repoDir, getTemplate, saveTemplate, abStats,
} from './projects.js';

const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 20);
const int = (v, min, max, def) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def; };
const pid = (params) => Number(params.id);

export function registerRoutes(router, app) {
  const { db, cfg } = app;
  const cliModeEnabled = cfg.cliModeEnabled !== false;
  const aiOpts = { cliModeEnabled };

  // Toute ressource métier est lue AVEC l'utilisateur courant : celle d'un autre compte est « introuvable » (404)
  const project = (ctx, opts) => getProject(app, pid(ctx.params), { userId: ctx.session.userId, ...opts });

  // ---------- Public ----------
  router.get('/login', async ({ res, url }) => html(res, loginPage(url.searchParams.get('e'), { apple: !!cfg.apple, bye: url.searchParams.has('bye') })), { public: true });
  // Erreur de connexion : message du serveur s'il est destiné à l'utilisateur, sinon générique (rien de technique à l'écran)
  const loginFailed = (res, e) => {
    if (!e.status || e.status >= 500) console.error('[connexion]', e);
    redirect(res, `/login?e=${encodeURIComponent(e.status && e.status < 500 ? e.message : 'Connexion impossible, réessaie dans un instant')}`);
  };
  router.get('/auth/google', async ({ res }) => startLogin(app, 'google', res), { public: true });
  router.get('/auth/google/callback', async ({ req, res, url }) => {
    try { await finishLogin(app, 'google', url.searchParams, req, res); }
    catch (e) { loginFailed(res, e); }
  }, { public: true });
  // Apple : le retour est un POST cross-site (response_mode=form_post), donc public et sans contrôle d'origine ;
  // la protection repose sur state + nonce + cookie de liaison (voir auth.js)
  router.get('/auth/apple', async ({ res }) => startLogin(app, 'apple', res), { public: true });
  router.post('/auth/apple/callback', async ({ req, res }) => {
    try { await finishLogin(app, 'apple', await readBody(req), req, res); }
    catch (e) { loginFailed(res, e); }
  }, { public: true });

  // Désinscription (RGPD). GET = page de confirmation (évite les désinscriptions par les scanners de liens),
  // POST = désinscription effective, compatible "one-click" (RFC 8058).
  router.get('/u/:email/:token', async ({ res, params }) => {
    const valid = verifyUnsubToken(cfg.secretKey, params.email, params.token);
    html(res, unsubPage({ email: params.email, valid, done: false }), valid ? 200 : 400);
  }, { public: true });
  router.post('/u/:email/:token', async ({ res, params }) => {
    const email = params.email.toLowerCase();
    const valid = verifyUnsubToken(cfg.secretKey, email, params.token);
    if (valid) {
      await db.prepare("INSERT OR IGNORE INTO blacklist(email, reason, created_at) VALUES(?, 'unsubscribe', ?)").run(email, now());
      await db.prepare("UPDATE prospects SET status = 'refused' WHERE email = ? AND status IN ('new','sent')").run(email);
    }
    html(res, unsubPage({ email, valid, done: valid }), valid ? 200 : 400);
  }, { public: true });

  // ---------- Privé ----------
  router.post('/logout', async ({ req, res }) => { await destroySession(db, req, res); redirect(res, '/login'); });

  router.get('/', async ({ res, session }) => {
    const userId = session.userId;
    const projects = [];
    for (const p of await listProjects(app, userId)) {
      const full = await getProject(app, p.id, { userId, secrets: true });
      projects.push({ project: p, smtp: publicConfig(full.smtp, 'pass'), dbCfg: publicConfig(full.dbCfg, 'password'), imap: publicConfig(full.imapCfg, 'pass') });
    }
    html(res, dashboardPage({
      email: session.email, projects, forgejoHost: await getSetting(db, userId, 'forgejo_host'),
    }));
  });

  router.get('/settings', async ({ res, session, url }) => {
    const userId = session.userId;
    const discord = await notifyConfig(app, userId);
    const s = {
      notify_email: await getSetting(db, userId, 'notify_email', ''),
      forgejo_host: await getSetting(db, userId, 'forgejo_host', ''),
      forgejo_token_set: !!await getSetting(db, userId, 'forgejo_token_enc'),
      smtp: publicConfig(await globalSmtp(app, userId), 'pass'),
      global_daily_cap: await getSetting(db, userId, 'global_daily_cap', '100'),
      send_delay_min: await getSetting(db, userId, 'send_delay_min', '20'),
      send_delay_max: await getSetting(db, userId, 'send_delay_max', '60'),
      prospect_model: await getSetting(db, userId, 'prospect_model', 'haiku'),
      analyze_model: await getSetting(db, userId, 'analyze_model', 'haiku'),
      // La liste d'opposition est commune à tous les comptes : on n'en montre que ce qui touche SES prospects
      blacklist_count: (await db.prepare(`SELECT COUNT(DISTINCT x.email) n FROM prospects x JOIN projects p ON p.id = x.project_id
        WHERE p.user_id = ? AND x.email IN (SELECT email FROM blacklist)`).get(userId)).n,
      weekly_report: await getSetting(db, userId, 'weekly_report', '0') === '1',
      budget_day_usd: await getSetting(db, userId, 'budget_day_usd', ''),
      budget_month_usd: await getSetting(db, userId, 'budget_month_usd', ''),
      discord: { set: !!discord.url, events: discord.events, all: EVENTS },
    };
    html(res, settingsPage({ email: session.email, s, saved: url.searchParams.has('ok') }));
  });

  router.post('/settings', async ({ req, res, session }) => {
    const userId = session.userId;
    const set = (k, v) => setSetting(db, userId, k, v);
    const b = await readBody(req);
    if (b.notify_email && !EMAIL_RE.test(b.notify_email)) throw new HttpError(400, 'Email de réception invalide');
    await set('notify_email', (b.notify_email || '').trim());
    await set('forgejo_host', (b.forgejo_host || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
    if (b.forgejo_token) await set('forgejo_token_enc', encrypt(cfg.secretKey, b.forgejo_token.trim()));
    const cap = int(b.global_daily_cap, 1, 300, 100);
    const dmin = int(b.send_delay_min, 5, 3600, 20);
    const dmax = Math.max(dmin, int(b.send_delay_max, 5, 3600, 60));
    await set('global_daily_cap', String(cap));
    await set('send_delay_min', String(dmin));
    await set('send_delay_max', String(dmax));
    await set('prospect_model', b.prospect_model === 'sonnet' ? 'sonnet' : 'haiku');
    await set('analyze_model', b.analyze_model === 'sonnet' ? 'sonnet' : 'haiku');
    const money = (v) => { const n = Number(String(v || '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? String(Math.round(n * 100) / 100) : ''; };
    await set('weekly_report', b.weekly_report === 'on' ? '1' : '0');
    await set('budget_day_usd', money(b.budget_day_usd));
    await set('budget_month_usd', money(b.budget_month_usd));

    const hook = String(b.discord_webhook || '').trim();
    if (hook && !WEBHOOK_RE.test(hook)) throw new HttpError(400, 'URL de webhook Discord invalide (https://discord.com/api/webhooks/…)');
    if (hook) await set('discord_webhook_enc', encrypt(cfg.secretKey, hook));
    if (b.discord_remove === 'on') await set('discord_webhook_enc', null);
    await set('discord_events', JSON.stringify(Object.keys(EVENTS).filter((k) => b[`ev_${k}`] === 'on')));

    const prev = await globalSmtp(app, userId) || {};
    const smtp = { host: b.smtp_host, port: b.smtp_port, user: b.smtp_user, pass: b.smtp_pass || prev.pass, fromEmail: b.smtp_fromEmail };
    await set('smtp_enc', smtp.host ? encryptJson(cfg.secretKey, smtp) : null);
    redirect(res, '/settings?ok');
  });

  // ---------- Liaison Claude ----------
  // Page d'onboarding (bloquante tant qu'aucune liaison valide n'existe). Les secrets arrivent par POST, ne sont jamais
  // relus ni réaffichés ; les erreurs ne contiennent que des messages fixes.
  router.get('/link', async ({ res, session, url }) => {
    html(res, linkPage({
      user: session.user, link: await getLinkState(db, session.userId), cliModeEnabled, error: url.searchParams.get('e'),
    }));
  });

  const wantsJson = (req) => !!req.headers.accept?.includes('json');
  // Formulaire HTML : l'erreur revient sur la page de liaison ; appel JSON : code HTTP + { error }
  const linkAction = (fn, okTo = '/') => async ({ req, res, session }) => {
    const b = await readBody(req);
    try {
      const out = (await fn(b, session)) || {};
      if (wantsJson(req)) return json(res, { ok: true, ...out });
      redirect(res, okTo);
    } catch (e) {
      if (!(e instanceof HttpError) || wantsJson(req)) throw e;
      redirect(res, `/link?e=${encodeURIComponent(e.message)}`);
    }
  };
  router.post('/link/api-key', linkAction((b, s) => linkApiKey(app, s.userId, b.apiKey)));
  router.post('/link/subscription', linkAction((b, s) => linkSubscriptionToken(app, s.userId, { token: b.token, accept: b.accept })));
  router.post('/link/server', linkAction((b, s) => linkServer(app, s.userId)));
  router.post('/link/test', async ({ req, res, session }) => {
    const r = await testLink(app, session.userId);
    if (wantsJson(req)) return json(res, r);
    redirect(res, `/account?t=${r.ok ? 'ok' : 'ko'}&m=${encodeURIComponent(r.message)}`);
  });
  router.post('/link/unlink', async ({ req, res, session }) => {
    const cancelled = await unlink(app, session.userId);
    if (wantsJson(req)) return json(res, { ok: true, cancelled });
    redirect(res, '/account?t=unlinked');
  });

  // ---------- Mon compte ----------
  router.get('/account', async ({ res, session, url }) => {
    const t = url.searchParams.get('t');
    html(res, accountPage({
      user: session.user, error: url.searchParams.get('e'), link: await getLinkState(db, session.userId),
      consent: await lastConsent(db, session.userId), cliModeEnabled,
      notice: t === 'unlinked' ? { ok: true, text: 'Liaison supprimée : le secret a été effacé et tes jobs IA en attente ont été annulés.' }
        : t === 'ok' || t === 'ko' ? { ok: t === 'ok', text: String(url.searchParams.get('m') || '').slice(0, 300) } : null,
    }));
  });

  // Suppression du compte : confirmée en saisissant son email ; efface TOUTES les données de l'utilisateur
  router.post('/account/delete', async ({ req, res, session }) => {
    const b = await readBody(req);
    if (normalizeEmail(b.confirm) !== normalizeEmail(session.user.email)) {
      return redirect(res, `/account?e=${encodeURIComponent("L'email saisi ne correspond pas à celui du compte")}`);
    }
    app.worker?.abortUser(session.userId); // un job en cours pour ce compte s'arrête avant l'effacement
    await deleteUser(app, session.userId);
    await destroySession(db, req, res);
    redirect(res, '/login?bye=1');
  });

  // ---------- API JSON ----------
  router.post('/api/report/send', async ({ res, session }) => {
    const r = await sendWeeklyReport(app, session.userId);
    if (!r.channels.length) throw new HttpError(400, 'Configure le SMTP global + l\'email de réception, ou un webhook Discord');
    json(res, { ok: true, channels: r.channels });
  });

  router.post('/api/notify/test', async ({ res, session }) => {
    if (!(await notifyConfig(app, session.userId)).url) throw new HttpError(400, 'Aucun webhook Discord configuré');
    const ok = await notify(app, session.userId, 'test', { title: 'Notification de test', description: 'Les notifications AiTools arrivent bien ici.', level: 'ok' }, { force: true });
    if (!ok) throw new HttpError(502, 'Discord a refusé la notification (webhook supprimé ?)');
    json(res, { ok: true });
  });

  // Barre du haut : uniquement les jobs, l'usage et les quotas de l'utilisateur courant (la température du serveur, réservée aux admins)
  router.get('/api/system', async ({ res, session }) => {
    const userId = session.userId;
    const queue = (await db.prepare(`SELECT COUNT(*) n FROM jobs WHERE user_id = ? AND (status = 'running'
      OR (status = 'queued' AND (run_after IS NULL OR run_after <= ?)))`).get(userId, now())).n;
    const scheduled = (await db.prepare("SELECT COUNT(*) n FROM jobs WHERE user_id = ? AND status = 'queued' AND run_after > ?").get(userId, now())).n;
    const link = await getLinkState(db, userId);
    // Le quota d'abonnement n'existe qu'en mode abonnement ou serveur : jamais de barre en mode clé API
    const rlRaw = link?.mode === MODES.api_key ? null : await getSetting(db, userId, 'claude_rate_limit_json');
    // Détail pour le menu « jobs » de la barre du haut : en cours d'abord, puis la file, puis les programmés
    const jobs = (await db.prepare(`SELECT j.id, j.type, j.status, j.progress_json, j.run_after, j.started_at, j.created_at, p.id pid, p.name project
      FROM jobs j LEFT JOIN projects p ON p.id = j.project_id
      WHERE j.user_id = ? AND j.status IN ('queued','running')
      ORDER BY j.status = 'running' DESC, COALESCE(j.run_after, 0), j.id LIMIT 20`).all(userId)).map((r) => ({
      id: r.id, type: r.type, status: r.status, projectId: r.pid, project: r.project,
      progress: r.progress_json ? JSON.parse(r.progress_json) : null,
      runAfter: r.run_after, startedAt: r.started_at, createdAt: r.created_at,
    }));
    json(res, {
      temp: session.user.isAdmin ? cpuTemp() : null, queue, scheduled, jobs, usage: await usageSummary(db, userId), budget: await budgetState(db, userId), thermalMax: cfg.thermalMax,
      claudeRateLimit: rlRaw ? JSON.parse(rlRaw) : null, linkMode: link?.mode ?? null,
    });
  });

  router.post('/api/projects', async ({ req, res, session }) => {
    const userId = session.userId;
    const b = await readBody(req);
    const name = String(b.name || '').trim().slice(0, 80);
    if (!name) throw new HttpError(400, 'Nom requis');
    const host = await getSetting(db, userId, 'forgejo_host');
    if (!host) throw new HttpError(400, "Configure l'hôte Forgejo dans Réglages");
    let gitUrl;
    try { gitUrl = validateGitUrl(String(b.gitUrl || '').trim(), host); }
    catch (e) { throw new HttpError(400, e.message); }
    // Un même dépôt peut être un projet pour deux comptes différents : l'unicité est par utilisateur
    const exists = () => db.prepare('SELECT 1 FROM projects WHERE user_id = ? AND git_url = ?').get(userId, gitUrl);
    if (await exists()) throw new HttpError(409, 'Ce dépôt est déjà un projet');
    let id;
    try { id = await createProject(app, { userId, name, gitUrl }); }
    catch (e) { if (await exists()) throw new HttpError(409, 'Ce dépôt est déjà un projet'); throw e; }
    await enqueue(db, { userId, projectId: id, type: 'analyze' }, aiOpts);
    json(res, { id });
  });

  router.post('/api/projects/:id/delete', async (ctx) => {
    const p = await project(ctx);
    await db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(p.id, ctx.session.userId);
    removeRepo(repoDir(cfg, ctx.session.userId, p.id));
    clearRecapCache(p.id);
    json(ctx.res, { ok: true });
  });

  router.get('/api/projects/:id/status', async (ctx) => {
    const { res, session } = ctx;
    const userId = session.userId;
    const p = await project(ctx);
    const jobs = await latestJobs(db, p.id);
    // Rendu côté serveur (échappé) : le front n'injecte jamais le Markdown brut de Claude
    if (jobs.evolution?.result?.markdown) jobs.evolution.result.html = evolutionHtml(jobs.evolution.result.markdown);
    const tplOut = (row) => (row ? { subject: row.subject, subjectB: row.subject_b, body: row.body, status: row.status, updated_at: row.updated_at } : null);
    const templates = { initial: tplOut(await getTemplate(db, p.id, 'initial')), followup: tplOut(await getTemplate(db, p.id, 'followup')) };
    const stats = await prospectStats(db, p.id);
    const day = now() - 86400;
    const sendMax = allowedToSend({
      requested: 100, available: stats.new || 0,
      projectCap: p.dailyMailCap, sentTodayProject: await sentSince(db, day, userId, p.id),
      globalCap: Number(await getSetting(db, userId, 'global_daily_cap', '100')), sentTodayGlobal: await sentSince(db, day, userId),
    });
    json(res, {
      jobs, templates, stats, sendMax,
      followup: { enabled: p.followupEnabled, days: p.followupDays, ...(await followupPlan(db, p)) },
      targetValidated: p.targetValidated, hasProfile: !!p.profile, hasSmtp: p.hasSmtp,
      hasImap: p.hasImap, inbox: p.inbox, ab: await abStats(db, p.id),
    });
  });

  router.post('/api/projects/:id/target', async (ctx) => {
    const { req, res } = ctx;
    const p = await project(ctx);
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
    await db.prepare('UPDATE projects SET target_json = ?, target_validated = 1 WHERE id = ?').run(JSON.stringify(target), p.id);
    json(res, { ok: true });
  });

  const jobRoute = (type, paramsOf = () => ({}), guard = () => {}) => async (ctx) => {
    const { req, res, session } = ctx;
    // Refus côté serveur AVANT toute autre vérification : pas de job IA sans liaison Claude valide (enqueue le revérifie)
    if (AI_JOBS.has(type)) await assertCanRunAi(db, session.userId, aiOpts);
    const p = await project(ctx);
    const b = req.headers['content-type']?.includes('json') ? await readBody(req) : {};
    await guard(p, b);
    // "Cette nuit" : démarrage au prochain créneau 1h-6h (Pi au frais, quota Claude libre)
    const runAfter = b.when === 'night' ? Math.floor(nextNightSlot().getTime() / 1000) : null;
    const r = await enqueue(db, { userId: session.userId, projectId: p.id, type, params: paramsOf(b), runAfter }, aiOpts);
    const budget = AI_JOBS.has(type) ? await budgetState(db, session.userId) : null;
    json(res, { ...r, budgetBlocked: budget?.blocked ? budget.reason : null });
  };

  router.post('/api/projects/:id/analyze', jobRoute('analyze'));
  router.post('/api/projects/:id/template', jobRoute('template', () => ({}), (p) => {
    if (!p.profile) throw new HttpError(400, "Analyse le projet d'abord");
  }));
  router.post('/api/projects/:id/followup_template', jobRoute('followup_template', () => ({}), (p) => {
    if (!p.profile) throw new HttpError(400, "Analyse le projet d'abord");
  }));
  router.post('/api/projects/:id/followup', async (ctx) => {
    const { req, res } = ctx;
    const p = await project(ctx);
    const b = await readBody(req);
    const enabled = b.enabled === true || b.enabled === 'on';
    await db.prepare('UPDATE projects SET followup_enabled = ?, followup_days = ? WHERE id = ?').run(enabled ? 1 : 0, int(b.days, 2, 30, 7), p.id);
    json(res, { ok: true });
  });
  router.post('/api/projects/:id/prospect', jobRoute('prospect', (b) => ({ count: int(b.count, 1, 50, 10) }), (p) => {
    if (!p.targetValidated) throw new HttpError(400, 'Valide la cible avant de prospecter');
  }));
  router.post('/api/projects/:id/evolution', jobRoute('evolution', (b) => ({
    count: int(b.count, 1, 20, 5),
    level: ['rapide', 'normal', 'approfondi'].includes(b.level) ? b.level : 'rapide',
  })));
  router.post('/api/projects/:id/send', jobRoute('send', (b) => ({ count: int(b.count, 1, 100, 10) }), async (p, b) => {
    if (!b.confirm) throw new HttpError(400, 'Confirmation requise');
    const running = await db.prepare("SELECT 1 FROM jobs WHERE project_id = ? AND type = 'prospect' AND status IN ('queued','running')").get(p.id);
    if (running) throw new HttpError(409, 'La recherche de prospects est encore en cours');
  }));

  router.post('/api/projects/:id/template/save', async (ctx) => {
    const { req, res } = ctx;
    const p = await project(ctx);
    const b = await readBody(req);
    const subject = String(b.subject || '').trim().slice(0, 200);
    const body = String(b.body || '').trim().slice(0, 5000);
    const subjectB = String(b.subjectB || '').trim().slice(0, 200) || null;
    const kind = b.kind === 'followup' ? 'followup' : 'initial';
    // Relance : objet facultatif (vide = "Re: <objet du 1er mail>", même fil de discussion)
    if (!body || (kind === 'initial' && !subject)) throw new HttpError(400, kind === 'initial' ? 'Objet et corps requis' : 'Corps requis');
    const status = b.mode === 'validate' ? 'validated' : 'draft';
    await saveTemplate(db, p.id, kind, { subject, subjectB, body, status });
    json(res, { ok: true, status });
  });

  router.post('/api/projects/:id/smtp', async (ctx) => {
    const { req, res } = ctx;
    const p = await project(ctx);
    const b = await readBody(req);
    if (b.fromEmail && !EMAIL_RE.test(b.fromEmail)) throw new HttpError(400, 'Email expéditeur invalide');
    await saveSecretConfig(app, p.id, 'smtp_enc', {
      host: String(b.host || '').trim(), port: int(b.port, 1, 65535, 587), user: String(b.user || '').trim(),
      pass: b.pass || '', fromEmail: String(b.fromEmail || '').trim(), fromName: String(b.fromName || '').trim().slice(0, 80),
    }, 'pass');
    await db.prepare('UPDATE projects SET daily_mail_cap = ? WHERE id = ?').run(int(b.dailyCap, 1, 200, 30), p.id);
    json(res, { ok: true });
  });

  // Boîte de réception : on enregistre puis on teste tout de suite la connexion
  router.post('/api/projects/:id/imap', async (ctx) => {
    const { req, res, session } = ctx;
    const p = await project(ctx);
    const b = await readBody(req);
    const host = String(b.host || '').trim();
    if (!host) {
      await db.prepare('UPDATE projects SET imap_enc = NULL, inbox_json = NULL WHERE id = ?').run(p.id);
      return json(res, { ok: true, disabled: true });
    }
    await saveSecretConfig(app, p.id, 'imap_enc', {
      host, port: int(b.port, 1, 65535, 993), user: String(b.user || '').trim(), pass: b.pass || '',
    }, 'pass');
    try { json(res, { ok: true, check: await checkInbox(app, session.userId, p.id) }); }
    catch (e) { json(res, { ok: false, error: e.message }); }
  });

  router.post('/api/projects/:id/inbox/check', async (ctx) => {
    const { res, session } = ctx;
    const p = await project(ctx);
    try { json(res, { ok: true, check: await checkInbox(app, session.userId, p.id) }); }
    catch (e) { throw new HttpError(502, e.message); }
  });

  router.post('/api/projects/:id/db', async (ctx) => {
    const { req, res } = ctx;
    const p = await project(ctx);
    const b = await readBody(req);
    for (const k of ['sql_users', 'sql_clients', 'sql_revenue']) {
      try { validateSelect(b[k]); } catch (e) { throw new HttpError(400, `${k} : ${e.message}`); }
    }
    await saveSecretConfig(app, p.id, 'db_enc', {
      type: b.type === 'pg' ? 'pg' : 'mysql', host: String(b.host || '').trim(), port: b.port ? int(b.port, 1, 65535, null) : null,
      database: String(b.database || '').trim(), user: String(b.user || '').trim(), password: b.password || '',
      ssl: b.ssl === 'on' || b.ssl === true,
      sql_users: b.sql_users || '', sql_clients: b.sql_clients || '', sql_revenue: b.sql_revenue || '',
    }, 'password');
    clearRecapCache(p.id);
    json(res, { ok: true });
  });

  router.get('/api/projects/:id/recap', async (ctx) => {
    const { res, url } = ctx;
    const p = await project(ctx, { secrets: true });
    const stats = await prospectStats(db, p.id);
    const cost = (await db.prepare('SELECT COALESCE(SUM(cost_usd),0) c FROM jobs WHERE project_id = ? AND user_id = ?').get(p.id, ctx.session.userId)).c;
    let business = null, error = null;
    try {
      business = await fetchRecap(p.id, p.dbCfg, { force: url.searchParams.has('force') });
      await saveSnapshot(db, p.id, business); // la consultation alimente aussi la courbe du jour
    } catch (e) { error = e.message; }
    json(res, { business, error, stats, aiCostUsd: cost });
  });

  router.get('/api/projects/:id/prospects\\.csv', async (ctx) => {
    const { res, url } = ctx;
    const p = await project(ctx);
    const slug = p.name.normalize('NFD').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'projet';
    const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="prospects-${slug}-${date}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.end(await exportProspects(db, p.id, parseFilters(url.searchParams)));
  });

  router.post('/api/projects/:id/prospects/import', async (ctx) => {
    const { req, res } = ctx;
    const p = await project(ctx);
    const b = await readBody(req, { max: 1024 * 1024 });
    try { json(res, await importProspects(db, p.id, String(b.csv || ''))); }
    catch (e) { throw new HttpError(400, e.message); }
  });

  router.get('/api/projects/:id/history', async (ctx) => {
    const { res, url } = ctx;
    const p = await project(ctx);
    json(res, await history(db, p.id, { days: url.searchParams.get('days') === '90' ? 90 : 30 }));
  });

  router.get('/api/projects/:id/prospects', async (ctx) => {
    const { res, url } = ctx;
    const p = await project(ctx);
    json(res, await listProspects(db, p.id, parseFilters(url.searchParams)));
  });

  const STATUSES = Object.keys(PROSPECT_STATUSES);
  // ---------- Fiche prospect ----------
  // Un prospect n'est accessible que par le propriétaire de son projet ; sinon 404, comme s'il n'existait pas
  const ownedProspect = async ({ params, session }) => {
    const row = await db.prepare(`SELECT x.id, x.email FROM prospects x JOIN projects p ON p.id = x.project_id
      WHERE x.id = ? AND p.user_id = ?`).get(Number(params.id), session.userId);
    if (!row) throw new HttpError(404, 'Prospect introuvable');
    return row;
  };
  router.post('/api/prospects/:id/status', async (ctx) => {
    const { req, res } = ctx;
    const b = await readBody(req);
    if (!STATUSES.includes(b.status)) throw new HttpError(400, 'Statut invalide');
    const row = await ownedProspect(ctx);
    await db.prepare('UPDATE prospects SET status = ? WHERE id = ?').run(b.status, row.id);
    if (b.status === 'refused') {
      await db.prepare("INSERT OR IGNORE INTO blacklist(email, reason, created_at) VALUES(?, 'refused', ?)").run(row.email, now());
    }
    json(res, { ok: true });
  });

  router.get('/api/prospects/:id', async (ctx) => json(ctx.res, await prospectDetail(db, (await ownedProspect(ctx)).id)));
  router.post('/api/prospects/:id/notes', async (ctx) => {
    const id = (await ownedProspect(ctx)).id;
    const noteId = await addNote(db, id, (await readBody(ctx.req)).body);
    if (!noteId) throw new HttpError(400, 'Note vide');
    json(ctx.res, { ok: true, id: noteId });
  });
  router.post('/api/prospects/:id/notes/:nid/delete', async (ctx) => {
    if (!await deleteNote(db, (await ownedProspect(ctx)).id, Number(ctx.params.nid))) throw new HttpError(404, 'Note introuvable');
    json(ctx.res, { ok: true });
  });
  router.post('/api/prospects/:id/next', async (ctx) => {
    const id = (await ownedProspect(ctx)).id;
    const b = await readBody(ctx.req);
    try { json(ctx.res, { ok: true, at: await setNextAction(db, id, b.action, b.day) }); }
    catch (e) { throw new HttpError(400, e.message); }
  });

  router.post('/api/jobs/:id/cancel', async ({ res, params, session }) => {
    await cancelJob(db, session.userId, Number(params.id));
    json(res, { ok: true });
  });
}
