import { projectChecklist } from './checklist.js';
import { now, getSetting, setSetting } from './db.js';
import { encrypt, decrypt, encryptJson, decryptJson, verifyUnsubToken } from './crypto.js';
import { html, json, redirect, readBody, HttpError } from './http.js';
import { startLogin, finishLogin, destroySession, getSession, checkOrigin } from './auth.js';
import { verifyCaptcha } from './captcha.js';
import { deleteUser, normalizeEmail, getUser } from './users.js';
import {
  assertCanRunAi, getLinkState, assertLoginConsent, linkLoginToken, validateSubscriptionToken, linkApiKey, linkSubscriptionToken, unlink, testLink, lastConsent,
  MODES,
  isPriced,
} from './claudelink.js';
import { loginPage } from './site/pages.js';
import { registerSiteRoutes } from './site/routes.js';
import { registerAdminRoutes } from './adminroutes.js';
import { loginsOf } from './claudelogin.js';
import { accessOn, memberTeamIds, needAccess } from './teams.js';
import { registerTeamRoutes } from './teamroutes.js';
import { registerMailRoutes } from './mailroutes.js';
import { registerApiV1 } from './apiv1.js';
import { registerDeveloperRoutes } from './developerroutes.js';
import { registerCalendarRoutes } from './calendar.js';
import { registerChatRoutes } from './chat.js';
import { registerEventRoutes } from './events.js';
import { feedToken, feedUrl } from './services/ical.js';
import { developerMode } from './apitokens.js';
import { registerLinkedinRoutes } from './linkedinroutes.js';
import { registerPromoRoutes, removeProjectVideos } from './promo.js';
import { registerPosteRoutes } from './posteroutes.js';
import { isRoleJob, roleTaskByJob } from './services/roles.js';
import { registerProspectRoutes } from './prospectroutes.js';
import { dashboardPage, settingsPage, unsubPage, accountPage, linkPage } from './views.js';
import { enqueue, latestJobs, cancelJob, usageSummary } from './services/jobs.js';
import { validateGitUrl, removeRepo } from './services/git.js';
import { fetchRecap, clearRecapCache, validateSelect } from './services/recap.js';
import { sendPause, pauseMessage as pauseMessageOf } from './services/abuse.js';
import { guardTarget, pinDb, pinGit } from './netguard.js';
import { checkGithubToken } from './githubcheck.js';
import { listGitServers, publicGitServers, allowedGitHosts, saveGitServers, saveGithubToken } from './gitservers.js';
import { allowedToSend, EMAIL_RE } from './services/mailer.js';
import { cpuTemp } from './services/thermal.js';
import { checkInbox } from './services/inbox.js';
import { followupPlan } from './services/followup.js';
import { warmupAdvice } from './services/warmup.js';
import { PROMPT_DEFS, parseCustomPrompts, promptsView, MAX_CUSTOM } from './services/prompts.js';
import { normalizeModel, PROMPT_SCOPES } from './services/models.js';
import { nextNightSlot } from './services/paris-time.js';
import { notify, notifyConfig, saveDiscordHooks, publicHooks, EVENTS, MAX_HOOKS } from './services/notify.js';
import { listChannels, saveChannels, publicChannels, notifyChannels, CHANNEL_TYPES } from './services/channels.js';
import { budgetState, AI_JOBS } from './services/budget.js';
import { currentClaudeQuota } from './services/usagelive.js';
import { sendWeeklyReport } from './services/report.js';
import { exportProspects, importProspects } from './services/csv.js';
import { quotaFor, planLimitError, withUserLock, assertRoom, usageView } from './services/plans.js';
import { history, saveSnapshot } from './services/metrics.js';
import { evolutionHtml } from './services/markdown.js';
import {
  listProspects, kanbanColumns, parseFilters, STATUSES as PROSPECT_STATUSES, prospectDetail, addNote, deleteNote, setNextAction,
} from './services/crm.js';
import {
  getProject, listProjects, createProject, saveSecretConfig, publicConfig,
  prospectStats, projectStats, sentSince, repoDir, getTemplate, saveTemplate, abStats,
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
  registerSiteRoutes(router, app);
  registerAdminRoutes(router, app);
  registerTeamRoutes(router, app);
  registerMailRoutes(router, app);
  registerLinkedinRoutes(router, app, { project, aiOpts });
  registerPromoRoutes(router, app, { project, aiOpts });
  registerPosteRoutes(router, app, { project, aiOpts });
  registerProspectRoutes(router, app, { project });
  registerApiV1(router, app, { aiOpts });
  registerDeveloperRoutes(router, app);
  registerCalendarRoutes(router, app);
  registerEventRoutes(router, app);
  registerChatRoutes(router, app);
  // Déjà connecté : la page de connexion n'a rien à offrir, on va au tableau de bord
  router.get('/login', async ({ req, res, url }) => {
    if (await getSession(db, req)) return redirect(res, '/');
    html(res, loginPage({ appUrl: cfg.appUrl, error: url.searchParams.get('e'), apple: !!cfg.apple, bye: url.searchParams.has('bye'), captcha: cfg.recaptcha ? { siteKey: cfg.recaptcha.siteKey } : null }));
  }, { public: true });
  // Erreur de connexion : message du serveur s'il est destiné à l'utilisateur, sinon générique (rien de technique à l'écran)
  const loginFailed = (res, e) => {
    if (!e.status || (e.status >= 500 && !e.expose)) console.error('[connexion]', e);
    redirect(res, `/login?e=${encodeURIComponent(e.status && (e.status < 500 || e.expose) ? e.message : 'Connexion impossible, réessaie dans un instant')}`);
  };
  // Démarrage : avec reCAPTCHA, seul un POST portant un jeton valide démarre le flux (le GET renvoie vers la page de connexion)
  const start = (name) => ({
    get: async ({ res }) => {
      if (cfg.recaptcha) return redirect(res, `/login?e=${encodeURIComponent('Passe par la vérification anti-robot de la page de connexion')}`);
      return startLogin(app, name, res);
    },
    post: async ({ req, res }) => {
      try {
        checkOrigin(req, cfg);
        await verifyCaptcha(app, (await readBody(req)).captcha);
      } catch (e) { return loginFailed(res, e); }
      return startLogin(app, name, res);
    },
  });
  router.get('/auth/google', start('google').get, { public: true, limit: 'auth_start' });
  router.post('/auth/google', start('google').post, { public: true, limit: 'auth_start' });
  router.get('/auth/google/callback', async ({ req, res, url }) => {
    try { await finishLogin(app, 'google', url.searchParams, req, res); }
    catch (e) { loginFailed(res, e); }
  }, { public: true, limit: 'auth_callback' });
  // Apple : le retour est un POST cross-site (response_mode=form_post), donc public et sans contrôle d'origine ;
  // la protection repose sur state + nonce + cookie de liaison (voir auth.js)
  router.get('/auth/apple', start('apple').get, { public: true, limit: 'auth_start' });
  router.post('/auth/apple', start('apple').post, { public: true, limit: 'auth_start' });
  router.post('/auth/apple/callback', async ({ req, res }) => {
    try { await finishLogin(app, 'apple', await readBody(req), req, res); }
    catch (e) { loginFailed(res, e); }
  }, { public: true, limit: 'auth_callback' });

  // Désinscription (RGPD). GET = page de confirmation (évite les désinscriptions par les scanners de liens),
  // POST = désinscription effective, compatible "one-click" (RFC 8058).
  router.get('/u/:email/:token', async ({ res, params }) => {
    const valid = verifyUnsubToken(cfg.secretKey, params.email, params.token);
    html(res, unsubPage({ email: params.email, valid, done: false }), valid ? 200 : 400);
  }, { public: true, limit: 'unsub' });
  router.post('/u/:email/:token', async ({ res, params }) => {
    const email = params.email.toLowerCase();
    const valid = verifyUnsubToken(cfg.secretKey, email, params.token);
    if (valid) {
      await db.prepare("INSERT OR IGNORE INTO blacklist(email, reason, created_at) VALUES(?, 'unsubscribe', ?)").run(email, now());
      await db.prepare("UPDATE prospects SET status = 'refused' WHERE email = ? AND status IN ('new','sent')").run(email);
    }
    html(res, unsubPage({ email, valid, done: valid }), valid ? 200 : 400);
  }, { public: true, limit: 'unsub' });

  // ---------- Privé ----------
  router.post('/logout', async ({ req, res }) => { await destroySession(db, req, res); redirect(res, '/login'); });

  router.get('/', async ({ res, session }) => {
    const userId = session.userId;
    const projects = [];
    for (const p of await listProjects(app, userId)) {
      const full = await getProject(app, p.id, { userId, secrets: true });
      projects.push({ project: p, smtp: publicConfig(full.smtp, 'pass'), dbCfg: publicConfig(full.dbCfg, 'password'), imap: publicConfig(full.imapCfg, 'pass') });
    }
    const stats = await projectStats(db, projects.map((x) => x.project.id));
    html(res, dashboardPage({
      email: session.email, projects, stats, gitHosts: (await listGitServers(db, userId)).map((x) => x.host), usage: await usageView(db, await getUser(db, userId)),
      pauseMessage: await sendPause(db, userId).then((p) => (p ? pauseMessageOf(p) : null)),
    }));
  });

  router.get('/settings', async ({ res, session, url }) => {
    const userId = session.userId;
    const discord = await notifyConfig(app, userId);
    const promptsRaw = await getSetting(db, userId, 'prompts_json', '');
    const analyze = normalizeModel(await getSetting(db, userId, 'analyze_model', 'haiku'));
    const models = { chat: normalizeModel(await getSetting(db, userId, 'chat_model', 'sonnet'), 'sonnet'), analyze, prospect: normalizeModel(await getSetting(db, userId, 'prospect_model', 'haiku')), write: normalizeModel(await getSetting(db, userId, 'write_model', ''), analyze) };
    const s = {
      priced: await isPriced(db, userId),
      notify_email: await getSetting(db, userId, 'notify_email', ''),
      git_servers: publicGitServers(await listGitServers(db, userId)),
      github_token_set: !!await getSetting(db, userId, 'github_token_enc'),
      global_daily_cap: await getSetting(db, userId, 'global_daily_cap', '100'),
      send_delay_min: await getSetting(db, userId, 'send_delay_min', '20'),
      send_delay_max: await getSetting(db, userId, 'send_delay_max', '60'),
      prospect_model: models.prospect,
      analyze_model: models.analyze,
      write_model: models.write,
      weekly_report: await getSetting(db, userId, 'weekly_report', '0') === '1',
      read_receipt: await getSetting(db, userId, 'read_receipt', '0') === '1',
      mail_footer: await getSetting(db, userId, 'mail_footer', '1') !== '0',
      budget_day_usd: await getSetting(db, userId, 'budget_day_usd', ''),
      budget_month_usd: await getSetting(db, userId, 'budget_month_usd', ''),
      priced: (await getLinkState(db, userId))?.mode === MODES.api_key, // plafonds en $ : seulement avec une clé API
      discord: { hooks: publicHooks(discord.hooks), all: EVENTS, max: MAX_HOOKS },
      channels: publicChannels(await listChannels(app, userId, Object.keys(EVENTS))), canEmail: !!cfg.systemSmtp,
      prompts: promptsView(parseCustomPrompts(promptsRaw), models),
      promptMax: MAX_CUSTOM,
    };
    html(res, settingsPage({ email: session.email, s, saved: url.searchParams.has('ok') }));
  });

  // Pied de page des mails de prospection (lien de désinscription + origine de l'adresse) : actif par défaut. Le retirer exige une
  // confirmation explicite ({ "confirmed": true }) : l'interface montre d'abord l'avertissement sur les risques. Le remettre est libre.
  router.post('/api/settings/mail-footer', async ({ req, res, session }) => {
    const b = await readBody(req);
    const enabled = b.enabled === true || b.enabled === 'true';
    if (!enabled && b.confirmed !== true) throw new HttpError(400, 'Retirer le pied de page demande une confirmation explicite (risques légaux et de réputation).', { expose: true, code: 'confirmation_required' });
    await setSetting(db, session.userId, 'mail_footer', enabled ? '1' : '0');
    json(res, { ok: true, enabled });
  }, { limit: 'prospect_write' });

  router.post('/settings', async ({ req, res, session }) => {
    const userId = session.userId;
    const set = (k, v) => setSetting(db, userId, k, v);
    const b = await readBody(req);
    if (b.notify_email && !EMAIL_RE.test(b.notify_email)) throw new HttpError(400, 'Email de réception invalide');
    await set('notify_email', (b.notify_email || '').trim());
    // Dépôts Git : le token GitHub, puis la liste des serveurs ajoutés (chacun avec son URL et son token)
    await saveGithubToken(app, userId, { typed: b.github_token, clear: b.github_token_clear });
    await saveGitServers(app, userId, b);
    const cap = int(b.global_daily_cap, 1, 300, 100);
    const dmin = int(b.send_delay_min, 5, 3600, 20);
    const dmax = Math.max(dmin, int(b.send_delay_max, 5, 3600, 60));
    await set('global_daily_cap', String(cap));
    await set('send_delay_min', String(dmin));
    await set('send_delay_max', String(dmax));
    // Modèles : uniquement ceux du catalogue (services/models.js) ; un champ absent ne change rien
    for (const k of ['prospect_model', 'analyze_model', 'write_model']) if (b[k] !== undefined) await set(k, normalizeModel(b[k]));
    const money = (v) => { const n = Number(String(v || '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? String(Math.round(n * 100) / 100) : ''; };
    await set('weekly_report', b.weekly_report === 'on' ? '1' : '0');
    // Les cases décochées ne sont pas envoyées : la présence du champ « délais » signale le formulaire complet
    if (b.send_delay_min !== undefined) await set('read_receipt', b.read_receipt === 'on' ? '1' : '0');
    // Champs absents du formulaire (compte en abonnement : pas de plafond en $) : les valeurs enregistrées ne bougent pas
    if (b.budget_day_usd !== undefined) await set('budget_day_usd', money(b.budget_day_usd));
    if (b.budget_month_usd !== undefined) await set('budget_month_usd', money(b.budget_month_usd));

    await saveDiscordHooks(app, userId, b);
    await saveChannels(app, userId, b, Object.keys(EVENTS));
    // Consignes des prompts, par gamme de modèle (« tous les modèles », Haiku, Sonnet, Opus, Fable). Un champ absent garde sa valeur ;
    // un champ vide, ou identique à ce que la gamme reçoit déjà, revient au défaut.
    const fieldName = (scope, key) => (scope === '*' ? `prompt_${key}` : `prompt_${scope}_${key}`);
    if (PROMPT_SCOPES.some((sc) => Object.keys(PROMPT_DEFS).some((k) => b[fieldName(sc, k)] !== undefined))) {
      const next = {};
      const current = parseCustomPrompts(await getSetting(db, userId, 'prompts_json', ''));
      for (const sc of PROMPT_SCOPES) {
        next[sc] = { ...current[sc] };
        for (const k of Object.keys(PROMPT_DEFS)) {
          const v = b[fieldName(sc, k)];
          if (v === undefined) continue;
          if (String(v).length > MAX_CUSTOM) throw new HttpError(400, `Une consigne dépasse ${MAX_CUSTOM} caractères`, { expose: true });
          next[sc][k] = String(v);
        }
      }
      const own = parseCustomPrompts(next);
      await set('prompts_json', Object.keys(own).length ? JSON.stringify(own) : '');
    }
    redirect(res, '/settings?ok');
  });

  // ---------- Liaison Claude ----------
  // Page d'onboarding (bloquante tant qu'aucune liaison valide n'existe). Les secrets arrivent par POST, ne sont jamais
  // relus ni réaffichés ; les erreurs ne contiennent que des messages fixes.
  router.get('/link', async ({ res, session, url }) => {
    html(res, linkPage({
      user: session.user, link: await getLinkState(db, session.userId), cliModeEnabled, error: url.searchParams.get('e'),
      start: url.searchParams.get('start') === 'claude',
    }));
  });

  const LINK_LIMIT = { limit: 'link' };

  // Test du token GitHub : celui tapé dans le champ (pas encore enregistré), sinon celui qui est enregistré
  router.post('/settings/github/test', async ({ req, res, session }) => {
    const userId = session.userId;
    const b = await readBody(req);
    let token = String(b.token ?? '').trim().slice(0, 600);
    if (!token) {
      try { token = decrypt(cfg.secretKey, await getSetting(db, userId, 'github_token_enc')) || ''; }
      catch { throw new HttpError(400, 'Le token enregistré est illisible : saisis-le de nouveau.'); }
    }
    if (!token) throw new HttpError(400, 'Aucun token à tester : colle-le dans le champ, ou enregistre-le d\'abord.');
    const mine = await db.prepare('SELECT name, git_url AS url FROM projects WHERE user_id = ? ORDER BY LOWER(name)').all(userId);
    json(res, await checkGithubToken(app, token, mine));
  }, LINK_LIMIT);
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
  router.post('/link/api-key', linkAction((b, s) => linkApiKey(app, s.userId, b.apiKey)), LINK_LIMIT);
  router.post('/link/subscription', linkAction((b, s) => linkSubscriptionToken(app, s.userId, { token: b.token, accept: b.accept })), LINK_LIMIT);
  // Connexion guidée avec Claude (src/claudelogin.js) : le serveur lance le CLI et renvoie le lien de connexion ;
  // l'utilisateur recopie ensuite le petit code affiché par Claude, et le serveur range le jeton qui en sort.
  router.post('/link/claude/login', async ({ req, res, session }) => {
    const b = await readBody(req);
    assertLoginConsent(cfg, b.accept);
    json(res, await loginsOf(app).start(session.userId));
  }, LINK_LIMIT);
  router.post('/link/claude/login/code', async ({ req, res, session }) => {
    const b = await readBody(req);
    const token = await loginsOf(app).finish(session.userId, b.id, b.code);
    // Vérifié avant d'être rangé : un jeton mal relu sur l'écran du CLI est refusé tout de suite, pas découvert plus tard
    await (app.validateToken || ((t) => validateSubscriptionToken(app, t)))(token);
    await linkLoginToken(app, session.userId, token);
    json(res, { ok: true });
  }, LINK_LIMIT);
  router.post('/link/claude/login/cancel', async ({ req, res, session }) => {
    loginsOf(app).cancel(session.userId, (await readBody(req)).id);
    json(res, { ok: true });
  }, LINK_LIMIT);
  router.post('/link/test', async ({ req, res, session }) => {
    const r = await testLink(app, session.userId);
    if (wantsJson(req)) return json(res, r);
    redirect(res, `/account?t=${r.ok ? 'ok' : 'ko'}&m=${encodeURIComponent(r.message)}`);
  }, LINK_LIMIT);
  router.post('/link/unlink', async ({ req, res, session }) => {
    const cancelled = await unlink(app, session.userId);
    if (wantsJson(req)) return json(res, { ok: true, cancelled });
    redirect(res, '/account?t=unlinked');
  }, LINK_LIMIT);

  // ---------- Mon compte ----------
  router.get('/account', async ({ res, session, url }) => {
    const t = url.searchParams.get('t');
    const link = await getLinkState(db, session.userId);
    // Le relevé des limites ne doit jamais empêcher d'afficher la page (Anthropic injoignable, réponse inattendue…)
    const quota = link && link.mode !== MODES.api_key ? await currentClaudeQuota(app, session.userId).catch(() => null) : null;
    const account = { link, quota };
    html(res, accountPage({
      user: session.user, error: url.searchParams.get('e'), link: account.link, quota: account.quota, developer: await developerMode(db, session.userId), appUrl: cfg.appUrl,
      ical: await (async () => { const t = await feedToken(app, session.userId); return t ? feedUrl(cfg, t) : null; })(),
      consent: await lastConsent(db, session.userId), cliModeEnabled, usage: await usageView(db, await getUser(db, session.userId)),
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
  }, { limit: 'account_delete' });

  // ---------- API JSON ----------
  router.post('/api/report/send', async ({ res, session }) => {
    const r = await sendWeeklyReport(app, session.userId);
    if (!r.channels.length) throw new HttpError(400, app.cfg.systemSmtp ? 'Configure ton email de réception, ou un webhook Discord' : "Le serveur n'a pas de SMTP (SYSTEM_SMTP_*) : configure un webhook Discord, ou demande à l'administrateur");
    json(res, { ok: true, channels: r.channels });
  }, { limit: 'mail_send' });

  router.post('/api/notify/test', async ({ req, res, session }) => {
    const b = await readBody(req);
    const { hooks } = await notifyConfig(app, session.userId);
    const test = { title: 'Notification de test', description: 'Les notifications AiTools arrivent bien ici.', level: 'ok' };
    // Un canal précis (Slack, Telegram, e-mail)
    if (b.channel) {
      if (!CHANNEL_TYPES[b.channel]) throw new HttpError(400, 'Canal inconnu');
      const done = await notifyChannels(app, session.userId, 'test', test, Object.keys(EVENTS), { force: true, only: String(b.channel) });
      if (!done.length) throw new HttpError(502, `${CHANNEL_TYPES[b.channel]} n'a pas accepté la notification (réglage à vérifier${b.channel === 'email' ? ', SMTP du serveur compris' : ''})`);
      return json(res, { ok: true });
    }
    if (!hooks.length && !Object.keys(await listChannels(app, session.userId, Object.keys(EVENTS))).length) throw new HttpError(400, 'Aucun canal de notification configuré');
    const hookId = b.hook ? String(b.hook) : null;
    if (hookId && !hooks.some((h) => h.id === hookId)) throw new HttpError(404, 'Webhook introuvable');
    const ok = await notify(app, session.userId, 'test', test, { force: true, hookId });
    if (!ok) throw new HttpError(502, 'Aucun canal n\'a accepté la notification (webhook supprimé ?)');
    json(res, { ok: true });
  }, { limit: 'mail_send' });

  // Barre du haut : uniquement les jobs, l'usage et les quotas de l'utilisateur courant (la température du serveur, réservée aux admins)
  router.get('/api/system', async ({ res, session }) => {
    const userId = session.userId;
    // Les jobs de l'utilisateur, plus ceux des projets que ses équipes partagent avec lui
    const teamIds = await memberTeamIds(db, userId);
    const mine = teamIds.length ? `(j.user_id = ? OR p.team_id IN (${teamIds.map(() => '?').join(',')}))` : 'j.user_id = ?';
    const mineArgs = [userId, ...teamIds];
    const queue = (await db.prepare(`SELECT COUNT(*) n FROM jobs j LEFT JOIN projects p ON p.id = j.project_id WHERE ${mine} AND (j.status = 'running'
      OR (j.status = 'queued' AND (j.run_after IS NULL OR j.run_after <= ?)))`).get(...mineArgs, now())).n;
    const scheduled = (await db.prepare(`SELECT COUNT(*) n FROM jobs j LEFT JOIN projects p ON p.id = j.project_id WHERE ${mine} AND j.status = 'queued' AND j.run_after > ?`).get(...mineArgs, now())).n;
    const link = await getLinkState(db, userId);
    // Le quota d'abonnement n'existe qu'en mode abonnement : relevé en direct chez Anthropic (il compte aussi ce que la personne
    // fait avec son Claude en dehors d'AiTools), à défaut la dernière mesure d'un job. Jamais de barre en mode clé API.
    const quota = link?.mode === MODES.api_key ? null : await currentClaudeQuota(app, userId);
    // Détail pour le menu « jobs » de la barre du haut : en cours d'abord, puis la file, puis les programmés
    const jobs = (await db.prepare(`SELECT j.id, j.type, j.status, j.progress_json, j.run_after, j.started_at, j.created_at, p.id pid, p.name project
      FROM jobs j LEFT JOIN projects p ON p.id = j.project_id
      WHERE ${mine} AND j.status IN ('queued','running')
      ORDER BY j.status = 'running' DESC, COALESCE(j.run_after, 0), j.id LIMIT 20`).all(...mineArgs)).map((r) => ({
      id: r.id, type: r.type, label: roleTaskByJob(r.type)?.label, status: r.status, projectId: r.pid, project: r.project,
      progress: r.progress_json ? JSON.parse(r.progress_json) : null,
      runAfter: r.run_after, startedAt: r.started_at, createdAt: r.created_at,
    }));
    json(res, {
      temp: session.user.isAdmin ? cpuTemp() : null, queue, scheduled, jobs, usage: await usageSummary(db, userId), budget: await budgetState(db, userId),
      claudeRateLimit: quota, linkMode: link?.mode ?? null,
    });
  });

  router.post('/api/projects', async ({ req, res, session }) => {
    const userId = session.userId;
    const b = await readBody(req);
    const name = String(b.name || '').trim().slice(0, 80);
    if (!name) throw new HttpError(400, 'Nom requis');
    // GitHub est accepté d'office ; les serveurs ajoutés dans les Réglages s'y ajoutent
    let gitUrl;
    try { gitUrl = validateGitUrl(String(b.gitUrl || '').trim(), await allowedGitHosts(db, userId)); }
    catch (e) { throw new HttpError(400, e.message); }
    await pinGit(app, userId, gitUrl); // hôte public et port autorisé, sinon refus immédiat
    // Un même dépôt peut être un projet pour deux comptes différents : l'unicité est par utilisateur
    const exists = () => db.prepare('SELECT 1 FROM projects WHERE user_id = ? AND git_url = ?').get(userId, gitUrl);
    if (await exists()) throw new HttpError(409, 'Ce dépôt est déjà un projet');
    let id;
    try { id = await createProject(app, { userId, name, gitUrl }); }
    catch (e) { if (await exists()) throw new HttpError(409, 'Ce dépôt est déjà un projet'); throw e; }
    // Plafond de jobs IA atteint : le projet est créé quand même (rien n'est perdu), seule l'analyse attend
    let notice = null;
    try { await enqueue(db, { userId, projectId: id, type: 'analyze' }, aiOpts); }
    catch (e) { if (e.code !== 'plan_limit') throw e; notice = e.message; }
    json(res, { id, ...(notice ? { notice } : {}) });
  }, { limit: 'project_create' });

  router.post('/api/projects/:id/delete', async (ctx) => {
    const p = await project(ctx, { need: 'owner' });
    await removeProjectVideos(app, p.id); // les fichiers d'abord : les lignes partent avec le projet
    await db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(p.id, p.userId);
    removeRepo(repoDir(cfg, p.userId, p.id));
    clearRecapCache(p.id);
    json(ctx.res, { ok: true });
  });

  // Mise en route : ce qui est configuré et ce qui reste à faire (aussi inclus dans /status pour le rafraîchissement)
  router.get('/api/projects/:id/checklist', async (ctx) => json(ctx.res, await projectChecklist(app, await project(ctx))));

  router.get('/api/projects/:id/status', async (ctx) => {
    const { res } = ctx;
    const p = await project(ctx);
    const userId = p.userId; // un membre agit comme le propriétaire : ses plafonds, ses réglages
    const jobs = await latestJobs(db, p.id);
    // Rendu côté serveur (échappé) : le front n'injecte jamais le Markdown brut de Claude
    if (jobs.evolution?.result?.markdown) jobs.evolution.result.html = evolutionHtml(jobs.evolution.result.markdown);
    if (jobs.audit?.result?.markdown) jobs.audit.result.html = evolutionHtml(jobs.audit.result.markdown);
    // Tâches des postes : le texte se lit à la demande (GET /api/projects/:id/poste/:task), pas à chaque rafraîchissement
    for (const [type, j] of Object.entries(jobs)) if (isRoleJob(type) && j.result) j.result = { size: String(j.result.markdown || '').length };
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
      warmup: await warmupAdvice(db, p.id, { sentToday: await sentSince(db, day, userId, p.id) }),
      followup: { enabled: p.followupEnabled, days: p.followupDays, ...(await followupPlan(db, p)) },
      targetValidated: p.targetValidated, hasProfile: !!p.profile, hasSmtp: p.hasSmtp, smtpSource: p.smtpSource, access: p.access,
      hasImap: p.hasImap, inbox: p.inbox, ab: await abStats(db, p.id), checklist: await projectChecklist(app, p),
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
    const { req, res } = ctx;
    const p = await project(ctx);
    // Pas de job IA sans liaison Claude valide : celle du PROPRIÉTAIRE du projet (un membre n'a pas besoin de la sienne ;
    // enqueue le revérifie)
    if (AI_JOBS.has(type)) await assertCanRunAi(db, p.userId, aiOpts);
    const b = req.headers['content-type']?.includes('json') ? await readBody(req) : {};
    await guard(p, b);
    // "Cette nuit" : démarrage au prochain créneau 1h-6h (Pi au frais, quota Claude libre)
    const runAfter = b.when === 'night' ? Math.floor(nextNightSlot().getTime() / 1000) : null;
    const r = await enqueue(db, { userId: p.userId, projectId: p.id, type, params: paramsOf(b), runAfter }, aiOpts);
    const budget = AI_JOBS.has(type) ? await budgetState(db, p.userId) : null;
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
  router.post('/api/projects/:id/prospect', jobRoute('prospect', (b) => ({ count: int(b.count, 1, 50, 10) }), async (p) => {
    await assertRoom(db, await getUser(db, p.userId), 'prospects');
    if (!p.targetValidated) throw new HttpError(400, 'Valide la cible avant de prospecter');
  }));
  // Audit du dépôt : réservé aux administrateurs du projet (il lit tout le code), jamais aux simples membres
  router.post('/api/projects/:id/code-review', jobRoute('audit', (b) => ({ level: ['rapide', 'normal', 'approfondi'].includes(b.level) ? b.level : 'rapide' }),
    (p) => needAccess(p.access, 'admin', "l'audit du code")));
  router.post('/api/projects/:id/evolution', jobRoute('evolution', (b) => ({
    count: int(b.count, 1, 20, 5),
    level: ['rapide', 'normal', 'approfondi'].includes(b.level) ? b.level : 'rapide',
  })));
  router.post('/api/projects/:id/send', jobRoute('send', (b) => ({ count: int(b.count, 1, 100, 10) }), async (p, b) => {
    if (!b.confirm) throw new HttpError(400, 'Confirmation requise');
    const running = await db.prepare("SELECT 1 FROM jobs WHERE project_id = ? AND type = 'prospect' AND status IN ('queued','running')").get(p.id);
    if (running) throw new HttpError(409, 'La recherche de prospects est encore en cours');
  }), { limit: 'mail_send' });

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
    const p = await project(ctx, { need: 'admin' });
    const b = await readBody(req);
    // Hôte vide = on efface le SMTP du projet (le plafond quotidien reste réglable) ; le projet ne peut plus envoyer tant qu'il n'en a pas
    if (!String(b.host || '').trim() || b.reset === true || b.reset === 'on') {
      await db.prepare('UPDATE projects SET smtp_enc = NULL WHERE id = ?').run(p.id);
      if (b.dailyCap !== undefined) await db.prepare('UPDATE projects SET daily_mail_cap = ? WHERE id = ?').run(int(b.dailyCap, 1, 200, 30), p.id);
      return json(res, { ok: true, reset: true });
    }
    if (b.fromEmail && !EMAIL_RE.test(b.fromEmail)) throw new HttpError(400, 'Email expéditeur invalide');
    if (String(b.host || '').trim()) await guardTarget(app, p.userId, 'smtp', String(b.host).trim(), int(b.port, 1, 65535, 587), { lenient: true });
    await saveSecretConfig(app, p.id, 'smtp_enc', {
      host: String(b.host || '').trim(), port: int(b.port, 1, 65535, 587), user: String(b.user || '').trim(),
      pass: b.pass || '', fromEmail: String(b.fromEmail || '').trim(), fromName: String(b.fromName || '').trim().slice(0, 80),
    }, 'pass');
    await db.prepare('UPDATE projects SET daily_mail_cap = ? WHERE id = ?').run(int(b.dailyCap, 1, 200, 30), p.id);
    json(res, { ok: true });
  });

  // Boîte de réception : on enregistre puis on teste tout de suite la connexion
  router.post('/api/projects/:id/imap', async (ctx) => {
    const { req, res } = ctx;
    const p = await project(ctx, { need: 'admin' });
    const b = await readBody(req);
    const host = String(b.host || '').trim();
    if (!host) {
      await db.prepare('UPDATE projects SET imap_enc = NULL, inbox_json = NULL WHERE id = ?').run(p.id);
      return json(res, { ok: true, disabled: true });
    }
    await guardTarget(app, p.userId, 'imap', host, int(b.port, 1, 65535, 993), { lenient: true });
    await saveSecretConfig(app, p.id, 'imap_enc', {
      host, port: int(b.port, 1, 65535, 993), user: String(b.user || '').trim(), pass: b.pass || '',
    }, 'pass');
    try { json(res, { ok: true, check: await checkInbox(app, p.userId, p.id) }); }
    catch (e) { json(res, { ok: false, error: e.message }); }
  }, { limit: 'conn_test' });

  router.post('/api/projects/:id/inbox/check', async (ctx) => {
    const { res } = ctx;
    const p = await project(ctx);
    try { json(res, { ok: true, check: await checkInbox(app, p.userId, p.id) }); }
    catch (e) { throw new HttpError(502, e.message); }
  }, { limit: 'conn_test' });

  router.post('/api/projects/:id/db', async (ctx) => {
    const { req, res } = ctx;
    const p = await project(ctx, { need: 'admin' });
    const b = await readBody(req);
    for (const k of ['sql_users', 'sql_clients', 'sql_revenue']) {
      try { validateSelect(b[k]); } catch (e) { throw new HttpError(400, `${k} : ${e.message}`); }
    }
    if (String(b.host || '').trim()) await guardTarget(app, p.userId, b.type === 'pg' ? 'pg' : 'mysql', String(b.host).trim(), b.port ? int(b.port, 1, 65535, 3306) : (b.type === 'pg' ? 5432 : 3306), { lenient: true });
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
    const p = await project(ctx, { secrets: true, need: 'admin' });
    const stats = await prospectStats(db, p.id);
    const cost = (await db.prepare('SELECT COALESCE(SUM(cost_usd),0) c FROM jobs WHERE project_id = ? AND user_id = ?').get(p.id, p.userId)).c;
    let business = null, error = null;
    try {
      business = await fetchRecap(p.id, await pinDb(app, p.userId, p.dbCfg), { force: url.searchParams.has('force') });
      await saveSnapshot(db, p.id, business); // la consultation alimente aussi la courbe du jour
    } catch (e) { error = e.message; }
    json(res, { business, error, stats, aiCostUsd: cost, priced: await isPriced(db, p.userId) });
  }, { limit: 'conn_test' });

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
  }, { limit: 'csv' });

  router.post('/api/projects/:id/prospects/import', async (ctx) => {
    const { req, res } = ctx;
    const p = await project(ctx);
    const b = await readBody(req, { max: 1024 * 1024 });
    try {
      json(res, await withUserLock(p.userId, async () => {
        const u = await getUser(db, p.userId);
        const q = await quotaFor(db, u, 'prospects');
        return importProspects(db, p.id, String(b.csv || ''), { limit: q.remaining, limitError: q.unlimited ? null : planLimitError(u, q, { wanted: q.remaining + 1, note: "Rien n'a été importé." }) });
      }));
    } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, e.message); }
  }, { limit: 'csv' });

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

  router.get('/api/projects/:id/kanban', async (ctx) => {
    const { res, url } = ctx;
    const p = await project(ctx);
    json(res, { columns: await kanbanColumns(db, p.id, parseFilters(url.searchParams)) });
  });

  const STATUSES = Object.keys(PROSPECT_STATUSES);
  // ---------- Fiche prospect ----------
  // Un prospect n'est accessible que par le propriétaire de son projet ; sinon 404, comme s'il n'existait pas
  const ownedProspect = async ({ params, session }) => {
    const row = await db.prepare(`SELECT x.id, x.email, p.id pid, p.user_id, p.team_id FROM prospects x JOIN projects p ON p.id = x.project_id
      WHERE x.id = ?`).get(Number(params.id));
    // Le propriétaire du projet ou un membre de l'équipe qui le partage ; sinon 404, comme s'il n'existait pas
    if (!row || !(await accessOn(db, { user_id: row.user_id, team_id: row.team_id }, session.userId))) throw new HttpError(404, 'Prospect introuvable');
    return { id: row.id, email: row.email, projectId: Number(row.pid), ownerId: Number(row.user_id) };
  };
  router.post('/api/prospects/:id/status', async (ctx) => {
    const { req, res } = ctx;
    const b = await readBody(req);
    if (!STATUSES.includes(b.status)) throw new HttpError(400, 'Statut invalide');
    const row = await ownedProspect(ctx);
    await db.prepare('UPDATE prospects SET status = ? WHERE id = ?').run(b.status, row.id);
    if (b.status === 'refused') {
      await db.prepare("INSERT OR IGNORE INTO blacklist(email, reason, created_at) VALUES(?, 'refused', ?)").run(row.email, now());
      // Le refus vaut pour tous les comptes : chez les autres, l'adresse n'est plus proposée ni contactée (sans dire qui ni pourquoi)
      await db.prepare("UPDATE prospects SET status = 'refused' WHERE email = ? AND status IN ('new','sent')").run(row.email);
    }
    json(res, { ok: true });
  });

  router.get('/api/prospects/:id', async (ctx) => {
    const row = await ownedProspect(ctx);
    const detail = await prospectDetail(db, row.id);
    // Régénération de l'accroche en cours ou terminée pour CE prospect
    const job = await db.prepare("SELECT status, error, result_json FROM jobs WHERE project_id = ? AND type = 'hook' AND params_json = ? ORDER BY id DESC LIMIT 1")
      .get(row.projectId, JSON.stringify({ prospectId: row.id }));
    json(ctx.res, { ...detail, hookJob: job ? { status: job.status, error: job.error } : null });
  });
  router.post('/api/prospects/:id/hook', async (ctx) => {
    const row = await ownedProspect(ctx);
    await assertCanRunAi(db, row.ownerId, aiOpts);
    const r = await enqueue(db, { userId: row.ownerId, projectId: row.projectId, type: 'hook', params: { prospectId: row.id } }, aiOpts);
    json(ctx.res, r);
  }, { limit: 'enrich' });
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
    const id = Number(params.id);
    const job = await db.prepare('SELECT j.user_id, p.team_id FROM jobs j LEFT JOIN projects p ON p.id = j.project_id WHERE j.id = ?').get(id);
    // Un job est à son propriétaire ; un membre peut annuler ceux des projets que son équipe partage
    const allowed = job && (Number(job.user_id) === Number(session.userId) || (await accessOn(db, { user_id: job.user_id, team_id: job.team_id }, session.userId)));
    if (!allowed) throw new HttpError(404, 'Job introuvable');
    await cancelJob(db, job.user_id, id);
    json(res, { ok: true });
  });
}
