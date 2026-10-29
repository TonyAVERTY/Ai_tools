// Handlers des jobs en arrière-plan.
import { now, getSetting, setSetting } from './db.js';
import { readdirSync, statSync } from 'node:fs';
import { runClaude, extractJson, rateLimitWindows } from './services/claude.js';
import { tidyTemplateText, acceptReview } from './services/mailcheck.js';
import { addUsage, jobContext } from './services/jobs.js';
import { syncRepo } from './services/git.js';
import { normalizeModel } from './services/models.js';
import { analyzePrompt, prospectPrompt, templatePrompt, reviewMailPrompt, followupTemplatePrompt, evolutionPrompt, linkedinPostPrompt, hookPrompt, auditPrompt, promoPrompt, rolePrompt, parseCustomPrompts, LEVELS } from './services/prompts.js';
import { VOICE_PROVIDERS, parseVoiceParams, extractVoiceScript, prepareVoice, cleanVoice, mixVoice, synthesize, langName } from './services/voiceover.js';
import { PROMO, FORMATS, SceneError, parsePromoParams, extractScene, promoSupported, renderPromo } from './services/promovideo.js';
import { reserveVideo, finishVideo, removeVideo, countVideos, getVoiceKey, getVoiceRegion } from './promo.js';
import { linkedinAccount, saveDraft, recentDrafts } from './linkedin.js';
import { followupCandidates, followupSubject, isBusinessHours } from './services/followup.js';
import { EMAIL_RE, createTransport, buildProspectMail, allowedToSend, makeMessageId } from './services/mailer.js';
import { unsubToken } from './crypto.js';
import { resolveCredentials, isAuthRefusal, markLinkInvalid } from './claudelink.js';
import { userRepoRoot, userChatRoot } from './users.js';
import { quotaAlerts } from './services/budget.js';
import { notify } from './services/notify.js';
import { quotaFor, recordUsage, planLimitMessage } from './services/plans.js';
import { getUser } from './users.js';
import { pinSmtp, pinGit } from './netguard.js';
import { sendPause, pauseMessage, evaluateSending } from './services/abuse.js';
import { verifyAddress, defaultMx } from './services/verify.js';
import { evolutionMail } from './services/mailhtml.js';
import { gitCredentialFor } from './gitservers.js';
import { ROLE_TASKS, roleById, MAX_NOTES } from './services/roles.js';
import { getProject, repoDir, sentSince, getTemplate, saveTemplate, pickVariant } from './projects.js';
import { getProfile, profileBlock } from './userprofile.js';
import { repoProfile, renderRepoProfile } from './services/repoprofile.js';
import { billingQuotesPrompt, billingRefinePrompt, billingDocsPrompt } from './services/prompts.js';
import { getBilling, listDocs, getDoc, replaceOptions, updateDocContent, replaceFinals } from './billingdata.js';
import { legalComplete, normalizeContent, DOC_KINDS, LAYOUTS } from './services/billing.js';

// Constats du dépôt cloné (profil établi par le code, mis en cache par commit) ; vide si le dossier est illisible : un job ne doit jamais échouer pour ça
function factsOf(dir) {
  try { return renderRepoProfile(repoProfile(dir)); } catch (e) { console.warn('[repoprofile]', e.message); return ''; }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Annulé')); }, { once: true });
});

// Les callbacks du flux Claude (onText, onTurn) sont synchrones : leurs écritures en base passent par une file
// ordonnée, attendue à la fin de la phase (flush). Une erreur d'écriture fait échouer le job au lieu de se perdre.
function makeSink() {
  let chain = Promise.resolve();
  return {
    push(fn) { chain = chain.then(fn); chain.catch(() => {}); },
    flush: () => chain,
  };
}

/**
 * Ce que Claude est en train de faire, en une phrase pour l'écran (null = rien à montrer). Jamais de contenu sensible :
 * une recherche web est affichée telle quelle (c'est le sujet du projet), une page lue seulement par son nom d'hôte.
 */
export function toolActivity(name, input = {}) {
  const clip = (t, n = 70) => { const v = String(t ?? '').replace(/\s+/g, ' ').trim(); return v.length > n ? `${v.slice(0, n - 1)}…` : v; };
  if (name === 'WebSearch' && input.query) return `Recherche web : « ${clip(input.query)} »`;
  if (name === 'WebFetch' && input.url) { try { return `Lecture du site ${new URL(input.url).hostname.replace(/^www\./, '')}`; } catch { return 'Lecture d\'une page web'; } }
  if (name === 'Read' && input.file_path) return `Lecture de ${clip(String(input.file_path).split('/').slice(-2).join('/'), 50)}`;
  if (name === 'Grep' || name === 'Glob') return 'Recherche dans le code';
  return null;
}

// Avancement d'une phase Claude : de `from` à `to` % au fil des messages, sur `maxTurns` au plus (estimation)
const turnPct = (from, to, n, maxTurns) => Math.round(from + (to - from) * Math.min(1, n / Math.max(1, maxTurns)));

/**
 * Un appel Claude d'un seul tour ne dit rien tant qu'il n'a pas fini : on fait avancer le pourcentage au fil du temps (jamais au-delà de `to`),
 * pour que l'utilisateur voie que ça tourne. Le vrai résultat ramène ensuite la tâche à 100 %.
 */
export async function creeping(ctx, message, from, fn, { to = 90, ms = 45_000 } = {}) {
  const t0 = Date.now();
  const tick = () => ctx.progress({ message, pct: Math.round(from + (to - from) * (1 - Math.exp(-(Date.now() - t0) / ms))) }).catch(() => {});
  const timer = setInterval(tick, 2000);
  try { return await fn(); } finally { clearInterval(timer); }
}

// Une page web peut tenter de faire enregistrer "javascript:…" : seules les URLs http(s) sont gardées
export function httpUrl(v) {
  const s = String(v ?? '').trim();
  if (!/^https?:\/\/[^\s<>"]+$/i.test(s)) return null;
  try { return new URL(s).protocol.startsWith('http') ? s.slice(0, 300) : null; } catch { return null; }
}

export function parseProspectLine(line) {
  const m = /^\s*PROSPECT\s+(\{.*\})\s*$/.exec(line);
  if (!m) return null;
  let p;
  try { p = JSON.parse(m[1]); } catch { return null; }
  const email = String(p.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || !p.company) return null;
  const str = (v, max = 300) => (v == null ? null : String(v).slice(0, max));
  const score = Math.max(1, Math.min(10, Math.round(Number(p.score) || 5)));
  return {
    company: str(p.company, 200), email, website: httpUrl(p.website), city: str(p.city, 100),
    sector: str(p.sector, 100), hook: str(p.hook, 400), source: httpUrl(p.source), score,
  };
}

/**
 * Ligne de diagnostic d'un appel à Claude qui a répondu en erreur (« Not logged in », quota…). Aucune valeur secrète :
 * seulement le mode, la présence et la forme du secret (longueur, caractères), le bac à sable et ce que contient le dossier de travail.
 */
export function claudeDiagnostic({ userId, cred, cfg, cwd, r }) {
  const secrets = Object.entries(cred.secretEnv || {}).map(([name, v]) => {
    const s = String(v ?? '');
    const clean = /^[\x21-\x7e]+$/.test(s); // un jeton ne contient ni espace ni caractère de contrôle
    return `${name}(len=${s.length},${clean ? 'propre' : 'CARACTERES_PARASITES'})`;
  });
  let ctx = 'aucun';
  if (cwd) {
    try { ctx = readdirSync(cwd).filter((f) => /^(\.claude|\.mcp\.json|CLAUDE\.md)$/.test(f)).join(',') || 'rien'; }
    catch { ctx = 'illisible'; }
  }
  const sb = cfg.sandbox || {};
  return `[claude] échec user=${Number(userId)} mode=${cred.mode} secret=${secrets.join(',') || 'AUCUN'} `
    + `bac_a_sable=${sb.enabled ? 'oui' : 'non'}${sb.production ? '(prod)' : ''} fichiers_claude_du_depot=${ctx} subtype=${r.subtype}`;
}

/**
 * Tout appel à Claude passe par ici. Le secret est relu pour le user_id du job (jamais un autre), l'exécution se fait
 * dans le bac à sable avec un environnement assaini, et le quota remonté par le CLI est enregistré pour CET utilisateur.
 */
export function makeClaude(app) {
  const { db, cfg } = app;
  return async (userId, o) => {
    const cred = await resolveCredentials(app, userId); // refuse sans liaison valide (dernier garde-fou)
    const jc = jobContext.getStore();
    if (jc && o.model) jc.model = o.model; // le job sait quel modèle sert vraiment
    // Profil de l'utilisateur (secteur, métier…) : une donnée de plus dans les consignes système, sauf pour le Support (qui répond d'après la documentation)
    const system = o.noProfile ? o.system : `${o.system ?? ''}${profileBlock(await getProfile(db, userId))}` || undefined;
    // Accès refusé par Claude (jeton expiré, clé révoquée) : la liaison devient invalide et l'interface demande de se reconnecter
    const refused = async () => { if (await markLinkInvalid(db, userId)) console.warn(`[claude] accès refusé : liaison de l'utilisateur ${Number(userId)} marquée invalide`); };
    let r;
    try {
      r = await runClaude({
        bin: cfg.claudeBin, ...o, system,
        sandbox: cfg.sandbox, secretEnv: cred.secretEnv,
        // Les clones lus sont ceux du propriétaire du projet (page IA : projet d'équipe joint, accès vérifié par l'appelant) ;
        // les pièces jointes lues en plus sont toujours dans le dossier de CET utilisateur.
        allowedRoot: o.allowedRoot ?? userRepoRoot(cfg, o.repoOwnerId ?? userId),
        extraRoot: userChatRoot(cfg, userId),
      });
    } catch (e) {
      if (isAuthRefusal(e.message)) await refused();
      throw e;
    }
    if (!r.ok) {
      console.warn(claudeDiagnostic({ userId, cred, cfg, cwd: o.cwd, r }));
      // Un message d'erreur d'authentification est court ; un long texte (analyse tronquée qui parle d'un « 401 » dans le code) n'en est pas un
      if (r.subtype !== 'error_max_turns' && String(r.text ?? '').length < 400 && isAuthRefusal(`${r.text} ${r.subtype}`)) await refused();
    }
    // État du quota d'abonnement (session 5h + semaine), affiché dans la carte « Consommation Claude ». Une clé API n'en a pas.
    const w = cred.mode === 'api_key' ? null : rateLimitWindows(r.rateLimit);
    if (w) {
      await setSetting(db, userId, 'claude_rate_limit_json', JSON.stringify({ at: now(), ...w }));
      for (const a of await quotaAlerts(db, userId, w)) {
        // notify ne lève jamais : un Discord indisponible ne fait pas échouer le job
        await notify(app, userId, 'quota', {
          title: `Quota Claude : ${a.level}+ % (${a.label})`,
          level: a.level >= 95 ? 'error' : 'warn',
          description: `${Math.round(a.utilization * 100)} % utilisé sur la ${a.label}.`,
        });
      }
    }
    return r;
  };
}

/** Clone ou met à jour le dépôt d'un projet avec le jeton git de SON propriétaire (jamais celui d'un autre). */
// Plusieurs jobs d'un même compte peuvent tourner en même temps (multi jobs) : deux synchronisations du même dépôt ne se chevauchent jamais.
const syncing = new Map(); // dossier du dépôt → fin de la synchronisation en cours

export function makeSync(app) {
  return async (userId, url, dir) => {
    const cred = await gitCredentialFor(app, userId, url); // le token de SON hôte seulement, jamais celui d'un autre
    const run = async () => (app.syncRepo || syncRepo)(url, dir, cred?.token ?? null, { pin: await pinGit(app, userId, url), scheme: cred?.scheme, user: cred?.user });
    const before = syncing.get(dir) || Promise.resolve();
    const mine = before.catch(() => {}).then(run);
    const tail = mine.catch(() => {});
    syncing.set(dir, tail);
    tail.then(() => { if (syncing.get(dir) === tail) syncing.delete(dir); });
    return mine;
  };
}

export function makeHandlers(app) {
  const { db, cfg } = app;
  const claude = makeClaude(app);
  // Dépôts Git (GitHub ou serveur perso) : l'hôte est revérifié à chaque synchronisation, git se connecte à l'adresse vérifiée
  const sync = makeSync(app);
  // Consignes modifiées par l'utilisateur (Réglages) : celles du compte qui lance le job
  const custom = async (userId) => parseCustomPrompts(await getSetting(db, userId, 'prompts_json'));
  // Modèles choisis dans les Réglages (liste de services/models.js ; toute autre valeur retombe sur Haiku)
  const modelOf = async (userId, key) => normalizeModel(await getSetting(db, userId, key, 'haiku'));
  // Rédaction (mails, relances, posts) : son propre réglage ; à défaut, le comportement d'avant (Haiku, et le modèle d'analyse pour LinkedIn)
  const writeModel = async (userId, legacy) => normalizeModel(await getSetting(db, userId, 'write_model', ''), legacy);
  const inHours = () => (app.isBusinessHours || isBusinessHours)();

  // Premier mail ou relance : mêmes plafonds, mêmes délais, même journal
  async function sendMails(ctx, kind) {
    // Une relance mise en file à 17h55 ne doit pas partir à 19h si le worker était occupé
    if (kind === 'followup' && !inHours()) return { sent: 0, failed: 0, total: 0, postponed: true };
    const userId = ctx.job.user_id;
    const pause = await sendPause(db, userId);
    if (pause) throw new Error(pauseMessage(pause)); // la désinscription et la liste d'opposition restent appliquées ci-dessous
    const project = await getProject(app, ctx.job.project_id, { userId, secrets: true });
    const template = await getTemplate(db, project.id, kind, { validatedOnly: true });
    if (!template) throw new Error(kind === 'followup' ? 'Modèle de relance non validé' : 'Modèle de mail non validé');
    if (!project.smtp) throw new Error("Aucun SMTP : configure-en un pour ce projet, ou dans les Réglages");

    const day = now() - 86400;
    const candidates = kind === 'followup'
      ? await followupCandidates(db, project)
      : await db.prepare(`SELECT * FROM prospects WHERE project_id = ? AND status = 'new'
          AND email NOT IN (SELECT email FROM blacklist) ORDER BY score DESC, id LIMIT 100`).all(project.id);
    // Plafond mensuel du plan : on n'envoie que ce qui reste (le reste attend, rien n'est perdu)
    const user = await getUser(db, userId);
    const mq = await quotaFor(db, user, 'mails');
    if (!mq.unlimited && mq.remaining <= 0) throw new Error(planLimitMessage(user, mq));
    const n0 = allowedToSend({
      requested: ctx.params.count,
      available: candidates.length,
      projectCap: project.dailyMailCap,
      sentTodayProject: await sentSince(db, day, userId, project.id),
      globalCap: Number(await getSetting(db, userId, 'global_daily_cap', '100')),
      sentTodayGlobal: await sentSince(db, day, userId),
    });
    const n = mq.unlimited ? n0 : Math.min(n0, mq.remaining);
    if (n === 0) throw new Error(kind === 'followup' ? 'Plafond quotidien atteint ou aucune relance due' : 'Plafond quotidien atteint ou aucun prospect à contacter');

    const transport = (app.createTransport || createTransport)(await pinSmtp(app, userId, project.smtp));
    await transport.verify();
    const minDelay = Number(await getSetting(db, userId, 'send_delay_min', '20')) * 1000;
    const maxDelay = Number(await getSetting(db, userId, 'send_delay_max', '60')) * 1000;
    const log = db.prepare(`INSERT INTO mail_log(project_id, prospect_id, email, sent_at, error, kind, variant, subject, message_id)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const markInitial = db.prepare('UPDATE prospects SET status = ?, sent_at = ?, variant = ? WHERE id = ?');
    const markFollowup = db.prepare('UPDATE prospects SET followup_at = ? WHERE id = ?');
    const markBounced = db.prepare("UPDATE prospects SET status = 'bounced' WHERE id = ?");
    const original = db.prepare("SELECT subject, message_id FROM mail_log WHERE prospect_id = ? AND kind = 'initial' AND error IS NULL ORDER BY id LIMIT 1");
    const current = db.prepare('SELECT status, followup_at FROM prospects WHERE id = ?');
    const markInvalid = db.prepare("UPDATE prospects SET status = 'invalid' WHERE id = ? AND status = 'new'");
    const mxCache = new Map();
    const readReceipt = (await getSetting(db, userId, 'read_receipt', '0')) === '1';
    const footer = (await getSetting(db, userId, 'mail_footer', '1')) !== '0'; // pied de page : actif sauf retrait explicite dans les Réglages
    let sent = 0, failed = 0, invalid = 0;
    await ctx.progress({ sent, failed, total: n, message: `0/${n} ${kind === 'followup' ? 'relances envoyées' : 'envoyés'}`, pct: 0 });

    // Les adresses refusées par la vérification ne comptent pas dans le lot : on continue dans la liste jusqu'à `n` envois tentés
    for (const p of candidates) {
      if (sent + failed >= n) break;
      if (await ctx.cancelled()) break;
      if (kind === 'followup' && !inHours()) break; // le reste repartira au prochain créneau
      // Re-vérifie juste avant l'envoi : désinscription, réponse arrivée pendant le batch…
      if (await db.prepare('SELECT 1 FROM blacklist WHERE email = ?').get(p.email)) continue;
      if (kind === 'followup') {
        const c = await current.get(p.id);
        if (c.status !== 'sent' || c.followup_at) continue;
      }
      if (kind === 'initial') {
        // Adresse mal formée, jetable ou sans serveur de réception : on ne l'essaie pas (un rejet abîme la réputation d'envoi)
        const v = await verifyAddress(p.email, { resolveMx: app.resolveMx || defaultMx, cache: mxCache });
        if (!v.ok) {
          await markInvalid.run(p.id);
          await log.run(project.id, p.id, p.email, now(), `Adresse non envoyée : ${v.reason}`, kind, null, null, null);
          invalid++;
          continue;
        }
      }
      const unsubUrl = `${cfg.appUrl}/u/${encodeURIComponent(p.email)}/${unsubToken(cfg.secretKey, p.email)}`;
      let variant = null, subject, inReplyTo;
      if (kind === 'initial') {
        variant = await pickVariant(db, project.id, template);
        subject = variant === 'B' ? template.subject_b : template.subject;
      } else {
        const orig = await original.get(p.id);
        subject = followupSubject(template, orig);
        inReplyTo = orig?.message_id;
      }
      const mail = buildProspectMail({
        template, prospect: p, smtp: project.smtp, site: project.siteUrl, unsubUrl, subject, inReplyTo,
        messageId: makeMessageId(project.smtp.fromEmail), readReceipt, footer, html: !!template.html,
      });
      try {
        await transport.sendMail(mail);
        await log.run(project.id, p.id, p.email, now(), null, kind, variant, mail.subject, mail.messageId);
        await recordUsage(db, userId, 'mail');
        if (kind === 'initial') await markInitial.run('sent', now(), variant, p.id);
        else await markFollowup.run(now(), p.id);
        sent++;
      } catch (e) {
        await log.run(project.id, p.id, p.email, now(), String(e.message).slice(0, 500), kind, variant, mail.subject, mail.messageId);
        if (/^5\d\d/.test(String(e.responseCode))) await markBounced.run(p.id);
        failed++;
      }
      const label = kind === 'followup' ? 'relances envoyées' : 'envoyés';
      await ctx.progress({ sent, failed, total: n, message: `${sent + failed}/${n} ${label}`, pct: Math.round(((sent + failed) / n) * 100) });
      if (sent + failed < n) await sleep(minDelay + Math.random() * (maxDelay - minDelay), ctx.signal).catch(() => {});
    }
    transport.close();
    await evaluateSending(app, userId); // trop de rejets : le compte passe en pause d'envoi
    return { sent, failed, total: n, ...(invalid ? { invalid } : {}) };
  }

  // Tâche d'un poste (Commerce, Communication, Finance…) : un livrable Markdown écrit à partir de la fiche du projet.
  // `repo` : lecture du dépôt (Read / Glob / Grep) ; `web` : recherche et lecture de pages ; sinon un seul tour, sans outil.
  const roleTask = (task) => async (ctx) => {
    const userId = ctx.job.user_id;
    const project = await getProject(app, ctx.job.project_id, { userId });
    if (!project.profile) throw new Error("Analyse le projet d'abord");
    const role = roleById(task.role);
    const notes = String(ctx.params.notes ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_NOTES);
    const model = await writeModel(userId, await modelOf(userId, 'analyze_model'));
    let dir = null;
    if (task.repo) {
      await ctx.progress({ message: 'Mise à jour du repo…', pct: 3 });
      dir = repoDir(cfg, userId, project.id);
      await sync(userId, project.gitUrl, dir);
    }
    await ctx.progress({ message: `${task.label} : Claude rédige…`, pct: 10 });
    const { prompt, system } = rolePrompt({ role, task, projectName: project.name, profile: project.profile, target: project.target || {}, notes, custom: await custom(userId), model, repoFacts: dir ? factsOf(dir) : '' });
    const maxTurns = task.repo ? 14 : task.web ? 10 : 1;
    const sink = makeSink();
    let turn = 0;
    const r = await claude(userId, {
      prompt, system, model, maxTurns, signal: ctx.signal,
      ...(dir ? { cwd: dir } : {}),
      tools: task.repo ? ['Read', 'Glob', 'Grep'] : task.web ? ['WebSearch', 'WebFetch'] : [],
      onTurn: (n) => { turn = n; sink.push(() => ctx.progress({ message: `${task.label} · étape ${n}…`, pct: turnPct(10, 95, n, maxTurns) })); },
      onTool: (name, input) => { const a = toolActivity(name, input); if (a) sink.push(() => ctx.progress({ message: `${task.label} : ${a}`, pct: turnPct(10, 95, turn, maxTurns) })); },
    });
    await sink.flush();
    addUsage(ctx, r);
    if (!r.text?.trim()) throw new Error(`Pas de résultat (${r.subtype})`);
    return { markdown: r.text.trim(), task: task.id, role: task.role, notes };
  };

  return {
    ...Object.fromEntries(ROLE_TASKS.map((t) => [t.job, roleTask(t)])),
    async analyze(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      await ctx.progress({ message: 'Récupération du repo…', pct: 3 });
      const dir = repoDir(cfg, userId, project.id);
      const commit = await sync(userId, project.gitUrl, dir);

      await ctx.progress({ message: 'Analyse du code par Claude…', pct: 10 });
      const model = await modelOf(userId, 'analyze_model');
      const { prompt, system } = analyzePrompt(project.name, await custom(userId), model, factsOf(dir));
      const sink = makeSink();
      let turn = 0;
      const r = await claude(userId, {
        prompt, system, cwd: dir, model, maxTurns: 20, tools: ['Read', 'Glob', 'Grep'], signal: ctx.signal,
        onTurn: (n) => { turn = n; sink.push(() => ctx.progress({ message: `Lecture du code par Claude (étape ${n})…`, pct: turnPct(10, 95, n, 20) })); },
        onTool: (name, input) => { const a = toolActivity(name, input); if (a) sink.push(() => ctx.progress({ message: a, pct: turnPct(10, 95, turn, 20) })); },
      });
      await sink.flush();
      addUsage(ctx, r);
      if (!r.ok) {
        // « success » + is_error : Claude a répondu par une erreur (quota, jeton, API). Son texte (déjà masqué) dit laquelle.
        const said = String(r.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
        throw new Error(`Analyse incomplète (${r.subtype})${said ? ` : ${said}` : ''}`);
      }
      const profile = extractJson(r.text);
      if (!profile.resume || !profile.cible) throw new Error('Fiche projet incomplète');
      const { cible, ...rest } = profile;
      await db.prepare('UPDATE projects SET profile_json = ?, profile_commit = ?, profile_at = ?, target_json = ?, target_validated = 0 WHERE id = ?')
        .run(JSON.stringify(rest), commit, now(), JSON.stringify(cible), project.id);
      return { commit };
    },

    async prospect(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      if (!project.profile || !project.targetValidated) throw new Error('Valide la cible du projet avant de prospecter');
      const count = Math.max(1, Math.min(50, Math.floor(Number(ctx.params.count) || 10)));

      // Domaines déjà connus de ce projet : Claude ne les recherche pas une 2e fois. La liste d'opposition,
      // commune à tous les comptes, n'entre pas dans le prompt (elle est appliquée à l'insertion, ci-dessous).
      const user = await getUser(db, userId);
      const pq = await quotaFor(db, user, 'prospects');
      let room = pq.unlimited ? Infinity : pq.remaining;
      let capped = false;
      const exclude = (await db.prepare(`
        SELECT DISTINCT substr(email, instr(email, '@') + 1) d FROM prospects WHERE project_id = ?
        LIMIT 300`).all(project.id)).map((r) => r.d);

      // Deux requêtes plutôt qu'un INSERT ... SELECT sans FROM (non portable) ; l'unicité (projet, email) reste garantie par la base
      const optedOut = db.prepare('SELECT 1 FROM blacklist WHERE email = ?');
      const insert = db.prepare(`INSERT OR IGNORE INTO prospects(project_id, company, email, website, city, sector, hook, source, score, created_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const sink = makeSink();
      let found = 0;
      let pending = '';
      let turns = 0;
      let message = 'Recherche en cours…';
      const recent = []; // derniers prospects ajoutés, montrés en direct dans la carte de la recherche
      const maxTurns = Math.min(80, count * 3 + 10);
      // Le plus avancé des deux : prospects trouvés, ou messages de Claude consommés
      const report = () => ctx.progress({
        found, target: count, message, recent,
        pct: Math.min(99, Math.max(Math.round((found / count) * 100), turnPct(0, 90, turns, maxTurns))),
      });
      const onText = (text) => {
        pending += text + '\n';
        const lines = pending.split('\n');
        pending = lines.pop();
        const parsed = lines.map(parseProspectLine).filter(Boolean);
        if (!parsed.length) return;
        sink.push(async () => {
          for (const p of parsed) {
            if (await optedOut.get(p.email)) continue;
            if (room <= 0) { capped = true; continue; }
            const res = await insert.run(project.id, p.company, p.email, p.website, p.city, p.sector, p.hook, p.source, p.score, now());
            if (res.changes) {
              room--;
              found++;
              message = `${found}/${count} — ${p.company}`;
              recent.push({ company: p.company, city: p.city || '' });
              if (recent.length > 5) recent.shift();
              await report();
            }
          }
        });
      };
      await report();
      const model = await modelOf(userId, 'prospect_model');
      const { prompt, system } = prospectPrompt({ profile: project.profile, target: project.target, count, exclude, custom: await custom(userId), model });
      const r = await claude(userId, {
        prompt, system, model, tools: ['WebSearch', 'WebFetch'],
        maxTurns, onText, signal: ctx.signal,
        onTurn: (n) => { turns = n; sink.push(report); },
        onTool: (name, input) => { const a = toolActivity(name, input); if (a) { message = a; sink.push(report); } },
      });
      onText('\n');
      await sink.flush();
      addUsage(ctx, r);
      return { found, requested: count, stoppedBy: r.subtype, ...(capped ? { capped: true } : {}) };
    },

    async template(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId, secrets: true });
      if (!project.profile) throw new Error('Analyse le projet d\'abord');
      await ctx.progress({ message: 'Rédaction du modèle par Claude…', pct: 40 });
      const model = await writeModel(userId, 'haiku');
      const { prompt, system } = templatePrompt({ profile: project.profile, target: project.target || {}, senderName: project.smtp?.fromName, site: project.siteUrl, custom: await custom(userId), model });
      const r = await creeping(ctx, 'Rédaction du modèle par Claude…', 40, () => claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal: ctx.signal }));
      addUsage(ctx, r);
      const t = extractJson(r.text);
      if (!t.subject || !t.body) throw new Error('Modèle de mail invalide');
      // Objet B (test A/B) : gardé seulement s'il est écrit, différent de l'objet A et d'une longueur d'objet
      const sb = String(t.subject_b ?? '').replace(/\s+/g, ' ').trim();
      const subjectB = sb && sb.length <= 120 && sb.toLowerCase() !== String(t.subject).trim().toLowerCase() ? sb : '';
      let mail = { subject: String(t.subject).trim(), subjectB, body: tidyTemplateText(t.body) };
      // Relecture par Claude (langue, ponctuation, signature) : facultative, retenue seulement si elle ne change ni variables ni adresses
      let corrections = [];
      let reviewed = false;
      await ctx.progress({ message: 'Relecture du mail par Claude…', pct: 80 });
      try {
        const rp = reviewMailPrompt(mail);
        const rr = await creeping(ctx, 'Relecture du mail par Claude…', 80, () => claude(userId, { prompt: rp.prompt, system: rp.system, model, maxTurns: 1, tools: [], signal: ctx.signal }), { to: 98, ms: 20_000 });
        addUsage(ctx, rr);
        const fixed = extractJson(rr.text);
        if (acceptReview(mail, fixed)) {
          mail = { subject: fixed.subject.trim(), subjectB: mail.subjectB ? String(fixed.subject_b).replace(/\s+/g, ' ').trim() : '', body: tidyTemplateText(fixed.body) };
          corrections = (Array.isArray(fixed.corrections) ? fixed.corrections : []).map((c) => String(c).trim().slice(0, 100)).filter(Boolean).slice(0, 6);
          reviewed = true;
        }
      } catch (e) {
        if (ctx.signal?.aborted || e.status === 403) throw e; // annulation, ou accès Claude perdu : on ne l'avale pas
      }
      await saveTemplate(db, project.id, 'initial', mail);
      return { ok: true, reviewed, corrections };
    },

    async followup_template(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId, secrets: true });
      if (!project.profile) throw new Error('Analyse le projet d\'abord');
      await ctx.progress({ message: 'Rédaction de la relance par Claude…', pct: 40 });
      const model = await writeModel(userId, 'haiku');
      const { prompt, system } = followupTemplatePrompt({ profile: project.profile, senderName: project.smtp?.fromName, custom: await custom(userId), model });
      const r = await creeping(ctx, 'Rédaction de la relance par Claude…', 40, () => claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal: ctx.signal }));
      addUsage(ctx, r);
      const t = extractJson(r.text);
      if (!t.body) throw new Error('Modèle de relance invalide');
      await saveTemplate(db, project.id, 'followup', { subject: '', body: t.body });
      return { ok: true };
    },

    // Facturation : trois exemples de devis. Claude écrit le texte et propose les lignes ; les mentions légales et les totaux viennent du code.
    async billing_quotes(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      const { legal } = await getBilling(db, project.id, userId);
      if (!legalComplete(legal)) throw new Error("Complète d'abord les informations légales du projet");
      if ((await listDocs(db, project.id, userId)).some((d) => d.kind === 'quote_option' && d.status === 'validated')) throw new Error('Un devis est déjà validé : recommence depuis le début pour en générer de nouveaux');
      await ctx.progress({ message: 'Claude rédige trois exemples de devis…', pct: 8 });
      const model = await writeModel(userId, 'sonnet');
      const { prompt, system } = billingQuotesPrompt({ projectName: project.name, profile: project.profile, legal, custom: await custom(userId), model });
      const r = await creeping(ctx, 'Claude rédige trois exemples de devis…', 8, () => claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal: ctx.signal }));
      addUsage(ctx, r);
      const raw = extractJson(r.text);
      const options = (Array.isArray(raw.options) ? raw.options : []).map((o) => normalizeContent(o, 'devis')).filter(Boolean).slice(0, 3);
      if (options.length < 3) throw new Error("Claude n'a pas produit trois devis exploitables : réessaie");
      options.forEach((o, i) => { o.layout = LAYOUTS[i][0]; }); // trois mises en page différentes, dans l'ordre
      await replaceOptions(db, project.id, userId, options);
      return { ok: true };
    },

    // Facturation : affiner un exemple de devis ou un document selon la demande de l'utilisateur
    async billing_refine(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      const doc = await getDoc(db, ctx.params.docId, userId);
      if (!doc || doc.projectId !== project.id) throw new Error('Document introuvable');
      const request = String(ctx.params.request ?? '').trim().slice(0, 800);
      if (request.length < 3) throw new Error('Décris ce que tu veux changer');
      const { legal } = await getBilling(db, project.id, userId);
      const kind = doc.kind === 'quote_option' ? 'devis' : doc.kind;
      await ctx.progress({ message: 'Claude affine le document selon ta demande…', pct: 8 });
      const model = await writeModel(userId, 'sonnet');
      const { prompt, system } = billingRefinePrompt({ projectName: project.name, profile: project.profile, legal, kind, content: doc.content, request, custom: await custom(userId), model });
      const r = await creeping(ctx, 'Claude affine le document selon ta demande…', 8, () => claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal: ctx.signal }));
      addUsage(ctx, r);
      const next = normalizeContent(extractJson(r.text), kind === 'acompte' ? 'acompte' : kind);
      if (!next) throw new Error("Claude n'a pas produit un document exploitable : réessaie");
      next.layout = doc.layout; // la mise en page choisie ne change pas en route
      if (kind === 'acompte' || kind === 'facture') next.lines = doc.content.lines; // les lignes et les prix viennent du devis validé
      await updateDocContent(db, doc.id, userId, next, request);
      // Un devis définitif modifié : l'acompte et la facture reprennent ses lignes, et sont à revalider si elles ont changé
      if (kind === 'devis' && doc.kind === 'devis') {
        for (const other of (await listDocs(db, project.id, userId)).filter((d) => d.kind === 'acompte' || d.kind === 'facture')) {
          if (JSON.stringify(other.content.lines) !== JSON.stringify(next.lines)) await updateDocContent(db, other.id, userId, { ...other.content, lines: next.lines }, other.refinement);
        }
      }
      return { ok: true };
    },

    // Facturation : à partir du devis validé, les quatre modèles de documents (devis, acompte, facture finale, avoir)
    async billing_docs(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      const quote = (await listDocs(db, project.id, userId)).find((d) => d.kind === 'quote_option' && d.status === 'validated');
      if (!quote) throw new Error("Valide d'abord un devis");
      const { legal } = await getBilling(db, project.id, userId);
      await ctx.progress({ message: 'Claude prépare le devis, l\'acompte, la facture finale et l\'avoir…', pct: 8 });
      const model = await writeModel(userId, 'sonnet');
      const { prompt, system } = billingDocsPrompt({ projectName: project.name, profile: project.profile, legal, quote: quote.content, custom: await custom(userId), model });
      const r = await creeping(ctx, 'Claude prépare le devis, l\'acompte, la facture finale et l\'avoir…', 8, () => claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal: ctx.signal }));
      addUsage(ctx, r);
      const raw = extractJson(r.text);
      const out = {};
      for (const { key } of DOC_KINDS) {
        // Les lignes viennent du devis validé (sauf l'avoir, qui peut ne reprendre qu'une partie) : Claude écrit les textes, pas les chiffres
        const withLines = { ...(raw?.[key] && typeof raw[key] === 'object' ? raw[key] : {}), lines: key === 'avoir' && Array.isArray(raw?.avoir?.lines) && raw.avoir.lines.length ? raw.avoir.lines : quote.content.lines };
        const c = normalizeContent(withLines, key);
        if (!c || !raw?.[key]) throw new Error(`Claude n'a pas produit le document « ${key} » : réessaie`);
        c.layout = quote.layout;
        if (key !== 'avoir') c.lines = quote.content.lines;
        out[key] = c;
      }
      out.facture.deposit_percent = out.acompte.deposit_percent;
      await replaceFinals(db, project.id, userId, out);
      return { ok: true };
    },

    // Brouillon de post LinkedIn : direction facultative ; sans elle Claude choisit l'angle. Rien n'est publié ici.
    async linkedin_post(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      if (!project.profile) throw new Error("Analyse le projet d'abord");
      const account = await linkedinAccount(db, project.id);
      if (!account) throw new Error("Connecte LinkedIn à ce projet d'abord");
      const direction = String(ctx.params.direction ?? '').trim().slice(0, 500);
      await ctx.progress({ message: direction ? 'Rédaction du post selon ta direction…' : 'Claude choisit un angle et rédige le post…', pct: 40 });
      const model = await writeModel(userId, await modelOf(userId, 'analyze_model'));
      const { prompt, system } = linkedinPostPrompt({
        profile: project.profile, target: project.target || {}, direction, previous: await recentDrafts(db, project.id), author: account.name, custom: await custom(userId), model,
      });
      const r = await creeping(ctx, direction ? 'Rédaction du post selon ta direction…' : 'Claude choisit un angle et rédige le post…', 40, () => claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal: ctx.signal }));
      addUsage(ctx, r);
      let body = '';
      try { body = String(extractJson(r.text).post ?? ''); } catch { body = ''; }
      body = body.replace(/\r\n/g, '\n').trim().slice(0, 3000);
      if (body.length < 50) throw new Error('Claude n\'a pas produit de post exploitable : réessaie');
      return { ok: true, postId: await saveDraft(db, project.id, { body, direction }) };
    },

    // Vidéo de promotion : Claude écrit une scène animée, Chromium la rend image par image, ffmpeg produit le MP4.
    // Une scène refusée au rendu (erreur de code, rien qui bouge…) est renvoyée une fois à Claude avec le message d'erreur.
    async promo_video(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      if (!project.profile) throw new Error("Analyse le projet d'abord");
      const sup = (app.promoSupported || promoSupported)(cfg);
      if (!sup.ok) throw new Error(sup.reason);
      const params = parsePromoParams(ctx.params);
      if (params.error) throw new Error(params.error);
      const vp = parseVoiceParams(ctx.params);
      if (vp.error) throw new Error(vp.error);
      const voice = vp.voice;
      if ((await countVideos(db, userId)) >= PROMO.maxVideos) throw new Error(`Tu as déjà ${PROMO.maxVideos} vidéos : supprime-en une avant d'en produire une autre.`);
      const fmt = FORMATS[params.format];
      const model = await writeModel(userId, await modelOf(userId, 'analyze_model'));
      const video = await reserveVideo(app, { userId, projectId: project.id, subject: params.subject, fps: params.fps, seconds: params.seconds, format: params.format, width: fmt.width, height: fmt.height });
      const sink = makeSink();
      try {
        let fix = null;
        for (let attempt = 1; ; attempt++) {
          await ctx.progress({ message: attempt === 1 ? (params.subject ? 'Claude conçoit la vidéo sur ton sujet…' : 'Claude conçoit la vidéo de présentation du projet…') : 'Claude corrige la scène…', pct: attempt === 1 ? 8 : 40 });
          const { prompt, system } = promoPrompt({
            projectName: project.name, profile: project.profile, target: project.target || {}, subject: params.subject, style: params.style, site: project.siteUrl,
            seconds: params.seconds, fps: params.fps, format: params.format, width: fmt.width, height: fmt.height, custom: await custom(userId), model, fix,
            voice: voice && { ...voice, langName: langName(voice.lang) },
          });
          const r = await creeping(ctx, attempt === 1 ? (params.subject ? 'Claude conçoit la vidéo sur ton sujet…' : 'Claude conçoit la vidéo de présentation du projet…') : 'Claude corrige la scène…', attempt === 1 ? 8 : 40, () => claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal: ctx.signal }), { to: 44 });
          addUsage(ctx, r);
          if (!r.ok) throw new Error(`La vidéo n'a pas pu être conçue (${r.subtype})${r.text ? ` : ${String(r.text).replace(/\s+/g, ' ').trim().slice(0, 200)}` : ''}`);
          let prepared = null;
          try {
            const html = extractScene(r.text);
            let notes = [];
            if (voice) {
              // La voix est préparée AVANT le rendu : un service de voix en panne ou un script trop long ne coûte pas les images
              await ctx.progress({ message: 'Voix : lecture des phrases…', pct: 44 });
              const key = VOICE_PROVIDERS[voice.provider].keyed ? await getVoiceKey(app, userId, voice.provider) : null;
              if (VOICE_PROVIDERS[voice.provider].keyed && !key) throw new Error(`Aucune clé API ${VOICE_PROVIDERS[voice.provider].label.split(' (')[0]} : ajoute-la dans l'onglet Promotion du projet`);
              const region = VOICE_PROVIDERS[voice.provider].region ? await getVoiceRegion(app, userId, voice.provider) : null;
              const synth = app.synthVoice || synthesize;
              prepared = await (app.prepareVoice || prepareVoice)({
                cfg, segments: extractVoiceScript(html, params.seconds), voice, seconds: params.seconds, synth: (o) => synth({ ...o, key, region }, { cfg }), signal: ctx.signal,
                onProgress: ({ done, total }) => sink.push(() => ctx.progress({ message: `Voix : phrase ${Math.min(done + 1, total)}/${total}`, pct: 44 })),
              });
              await sink.flush();
              if (prepared.overflow > 0.5) {
                const msg = `La voix dure ${prepared.overflow.toFixed(1)} s de plus que la vidéo (${params.seconds} s) : raccourcis les phrases ou avance leurs instants "t".`;
                if (attempt === 1) throw new SceneError(msg);
                notes.push(`Voix coupée en fin de vidéo : ${msg}`);
              }
            }
            const out = await (app.renderPromo || renderPromo)({
              cfg, html, fps: params.fps, seconds: params.seconds, width: fmt.width, height: fmt.height, out: video.path, signal: ctx.signal,
              // Première version : refusée si elle est vide, minuscule, figée ou sur fond blanc ; seconde : rendue quand même, avec les constats gardés
              quality: cfg.promoQuality === false ? 'off' : attempt === 1 ? 'strict' : 'warn',
              onProgress: ({ done, total }) => sink.push(() => ctx.progress({ message: `Rendu de la vidéo : image ${done}/${total}`, pct: 45 + Math.round((done / total) * 53) })),
            });
            await sink.flush();
            let bytes = out.bytes;
            if (prepared) {
              await ctx.progress({ message: 'Ajout de la voix à la vidéo…', pct: 99 });
              await (app.mixVoice || mixVoice)({ cfg, videoPath: video.path, placed: prepared.placed, seconds: params.seconds, signal: ctx.signal });
              bytes = statSync(video.path).size;
            }
            await finishVideo(db, video.id, bytes);
            notes = [...notes, ...(out.notes || [])];
            return { ok: true, videoId: video.id, frames: out.frames, attempts: attempt, ...(voice ? { voice: voice.voice } : {}), ...(notes.length ? { notes } : {}) };
          } catch (e) {
            await sink.flush().catch(() => {});
            if (!(e instanceof SceneError)) throw e;
            if (attempt >= 2) throw new Error(`La scène écrite par Claude ne passe pas au rendu : ${e.message}`);
            fix = e.message;
          } finally { cleanVoice(prepared); }
        }
      } catch (e) {
        await removeVideo(app, { id: video.id, user_id: userId });
        throw e;
      }
    },

    send: (ctx) => sendMails(ctx, 'initial'),
    followup: (ctx) => sendMails(ctx, 'followup'),

    async evolution(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId, secrets: true });
      const count = Math.max(1, Math.min(20, Math.floor(Number(ctx.params.count) || 5)));
      const level = LEVELS[ctx.params.level] ? ctx.params.level : 'normal';
      const to = await getSetting(db, userId, 'notify_email');
      const smtp = cfg.systemSmtp; // le résultat part de l'adresse d'AiTools (SMTP du serveur), pas de celle du projet
      if (!to) throw new Error('Adresse de réception non configurée (Réglages)');
      if (!smtp) throw new Error("Le serveur ne peut pas envoyer de mail (SMTP du serveur non configuré) : demande à l'administrateur");

      await ctx.progress({ message: 'Mise à jour du repo…', pct: 3 });
      const dir = repoDir(cfg, userId, project.id);
      await sync(userId, project.gitUrl, dir);

      await ctx.progress({ message: `Recherche de ${count} évolutions (${level})…`, pct: 10 });
      const { prompt, system } = evolutionPrompt({ projectName: project.name, profile: project.profile, count, level, custom: await custom(userId), repoFacts: factsOf(dir) });
      const { model, maxTurns } = LEVELS[level];
      const sink = makeSink();
      const r = await claude(userId, {
        prompt, system, cwd: dir, model, maxTurns, tools: ['Read', 'Glob', 'Grep'], signal: ctx.signal,
        onTurn: (n) => sink.push(() => ctx.progress({ message: `Recherche de ${count} évolutions (${level}) · étape ${n}…`, pct: turnPct(10, 90, n, maxTurns) })),
      });
      await sink.flush();
      addUsage(ctx, r);
      if (!r.text?.trim()) throw new Error(`Pas de résultat (${r.subtype})`);

      await ctx.progress({ message: 'Envoi par mail…', pct: 95 });
      const transport = (app.createTransport || createTransport)(await pinSmtp(app, null, smtp));
      await transport.sendMail({
        from: smtp.fromEmail, to,
        subject: `[AiTools] ${count} évolutions pour ${project.name}`,
        text: r.text,
        html: evolutionMail({ markdown: r.text, projectName: project.name, count, appUrl: cfg.appUrl }),
      });
      transport.close();
      return { markdown: r.text, sentTo: to };
    },

    // Audit du dépôt : rapport en lecture seule (Read / Glob / Grep), gardé dans le résultat du job
    async audit(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      const level = LEVELS[ctx.params.level] ? ctx.params.level : 'normal';
      await ctx.progress({ message: 'Mise à jour du repo…', pct: 3 });
      const dir = repoDir(cfg, userId, project.id);
      await sync(userId, project.gitUrl, dir);
      await ctx.progress({ message: `Audit du code (${level})…`, pct: 10 });
      const { prompt, system } = auditPrompt({ projectName: project.name, level, custom: await custom(userId), repoFacts: factsOf(dir) });
      const { model, maxTurns } = LEVELS[level];
      const sink = makeSink();
      const r = await claude(userId, {
        prompt, system, cwd: dir, model, maxTurns, tools: ['Read', 'Glob', 'Grep'], signal: ctx.signal,
        onTurn: (n) => sink.push(() => ctx.progress({ message: `Audit du code (${level}) · étape ${n}…`, pct: turnPct(10, 95, n, maxTurns) })),
      });
      await sink.flush();
      addUsage(ctx, r);
      if (!r.text?.trim()) throw new Error(`Pas de résultat (${r.subtype})`);
      return { markdown: r.text, level };
    },

    // Accroche d'un prospect : régénérée à partir de son site ; ville et secteur complétés s'ils manquaient
    async hook(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      const prospect = await db.prepare('SELECT * FROM prospects WHERE id = ? AND project_id = ?').get(Number(ctx.params.prospectId), project.id);
      if (!prospect) throw new Error('Prospect introuvable');
      await ctx.progress({ message: `Lecture du site de ${prospect.company}…`, pct: 20 });
      const model = await modelOf(userId, 'prospect_model');
      const { prompt, system } = hookPrompt({ profile: project.profile, prospect, custom: await custom(userId), model });
      // Sans site, Claude n'a rien à lire : pas d'outil web, l'accroche s'appuie sur la fiche du prospect
      const r = await claude(userId, {
        prompt, system, model,
        tools: prospect.website ? ['WebFetch'] : [], maxTurns: prospect.website ? 6 : 1, signal: ctx.signal,
      });
      addUsage(ctx, r);
      let out = {};
      try { out = extractJson(r.text); } catch { out = {}; }
      const hook = String(out.hook ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (hook.length < 15) throw new Error("Claude n'a pas produit d'accroche exploitable : réessaie");
      const city = String(out.city ?? '').trim().slice(0, 100);
      const sector = String(out.sector ?? '').trim().slice(0, 100);
      await db.prepare('UPDATE prospects SET hook = ?, city = COALESCE(NULLIF(city, \'\'), ?), sector = COALESCE(NULLIF(sector, \'\'), ?) WHERE id = ?')
        .run(hook, city || null, sector || null, prospect.id);
      return { prospectId: prospect.id, hook };
    },
  };
}
