// Handlers des jobs en arrière-plan.
import { now, getSetting, setSetting } from './db.js';
import { readdirSync } from 'node:fs';
import { runClaude, extractJson, rateLimitWindows } from './services/claude.js';
import { addUsage } from './services/jobs.js';
import { syncRepo } from './services/git.js';
import { analyzePrompt, prospectPrompt, templatePrompt, followupTemplatePrompt, evolutionPrompt, linkedinPostPrompt, LEVELS } from './services/prompts.js';
import { linkedinAccount, saveDraft, recentDrafts } from './linkedin.js';
import { followupCandidates, followupSubject, isBusinessHours } from './services/followup.js';
import { EMAIL_RE, createTransport, buildProspectMail, allowedToSend, makeMessageId } from './services/mailer.js';
import { unsubToken } from './crypto.js';
import { resolveCredentials } from './claudelink.js';
import { userRepoRoot } from './users.js';
import { quotaAlerts } from './services/budget.js';
import { notify } from './services/notify.js';
import { quotaFor, recordUsage, planLimitMessage } from './services/plans.js';
import { getUser } from './users.js';
import { pinSmtp, pinGit } from './netguard.js';
import { sendPause, pauseMessage, evaluateSending } from './services/abuse.js';
import { evolutionMail } from './services/mailhtml.js';
import { getProject, repoDir, forgejoToken, globalSmtp, sentSince, getTemplate, saveTemplate, pickVariant } from './projects.js';

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

// Avancement d'une phase Claude : de `from` à `to` % au fil des messages, sur `maxTurns` au plus (estimation)
const turnPct = (from, to, n, maxTurns) => Math.round(from + (to - from) * Math.min(1, n / Math.max(1, maxTurns)));

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
    const r = await runClaude({
      bin: cfg.claudeBin, ...o,
      sandbox: cfg.sandbox, secretEnv: cred.secretEnv,
      allowedRoot: userRepoRoot(cfg, userId),
    });
    if (!r.ok) console.warn(claudeDiagnostic({ userId, cred, cfg, cwd: o.cwd, r }));
    // État du quota d'abonnement (session 5h + semaine), affiché dans la barre système. Une clé API n'en a pas.
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

export function makeHandlers(app) {
  const { db, cfg } = app;
  const claude = makeClaude(app);
  // Forgejo : l'hôte est revérifié à chaque synchronisation, git se connecte à l'adresse vérifiée
  const sync = async (userId, url, dir, token) => (app.syncRepo || syncRepo)(url, dir, token, { pin: await pinGit(app, userId, url) });
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
    let sent = 0, failed = 0;
    await ctx.progress({ sent, failed, total: n, message: `0/${n} ${kind === 'followup' ? 'relances envoyées' : 'envoyés'}`, pct: 0 });

    for (const p of candidates.slice(0, n)) {
      if (await ctx.cancelled()) break;
      if (kind === 'followup' && !inHours()) break; // le reste repartira au prochain créneau
      // Re-vérifie juste avant l'envoi : désinscription, réponse arrivée pendant le batch…
      if (await db.prepare('SELECT 1 FROM blacklist WHERE email = ?').get(p.email)) continue;
      if (kind === 'followup') {
        const c = await current.get(p.id);
        if (c.status !== 'sent' || c.followup_at) continue;
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
        template, prospect: p, smtp: project.smtp, unsubUrl, subject, inReplyTo,
        messageId: makeMessageId(project.smtp.fromEmail),
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
    return { sent, failed, total: n };
  }

  return {
    async analyze(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      await ctx.progress({ message: 'Récupération du repo…', pct: 3 });
      const dir = repoDir(cfg, userId, project.id);
      const commit = await sync(userId, project.gitUrl, dir, await forgejoToken(app, userId));

      await ctx.progress({ message: 'Analyse du code par Claude…', pct: 10 });
      const { prompt, system } = analyzePrompt(project.name);
      const model = await getSetting(db, userId, 'analyze_model', 'haiku');
      const sink = makeSink();
      const r = await claude(userId, {
        prompt, system, cwd: dir, model, maxTurns: 20, tools: ['Read', 'Glob', 'Grep'], signal: ctx.signal,
        onTurn: (n) => sink.push(() => ctx.progress({ message: `Lecture du code par Claude (étape ${n})…`, pct: turnPct(10, 95, n, 20) })),
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
      const maxTurns = Math.min(80, count * 3 + 10);
      // Le plus avancé des deux : prospects trouvés, ou messages de Claude consommés
      const report = () => ctx.progress({
        found, target: count, message,
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
              await report();
            }
          }
        });
      };
      await report();
      const { prompt, system } = prospectPrompt({ profile: project.profile, target: project.target, count, exclude });
      const model = await getSetting(db, userId, 'prospect_model', 'haiku');
      const r = await claude(userId, {
        prompt, system, model, tools: ['WebSearch', 'WebFetch'],
        maxTurns, onText, signal: ctx.signal,
        onTurn: (n) => { turns = n; sink.push(report); },
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
      const { prompt, system } = templatePrompt({ profile: project.profile, target: project.target || {}, senderName: project.smtp?.fromName });
      const r = await claude(userId, { prompt, system, model: 'haiku', maxTurns: 1, tools: [], signal: ctx.signal });
      addUsage(ctx, r);
      const t = extractJson(r.text);
      if (!t.subject || !t.body) throw new Error('Modèle de mail invalide');
      await saveTemplate(db, project.id, 'initial', { subject: t.subject, body: t.body });
      return { ok: true };
    },

    async followup_template(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId, secrets: true });
      if (!project.profile) throw new Error('Analyse le projet d\'abord');
      await ctx.progress({ message: 'Rédaction de la relance par Claude…', pct: 40 });
      const { prompt, system } = followupTemplatePrompt({ profile: project.profile, senderName: project.smtp?.fromName });
      const r = await claude(userId, { prompt, system, model: 'haiku', maxTurns: 1, tools: [], signal: ctx.signal });
      addUsage(ctx, r);
      const t = extractJson(r.text);
      if (!t.body) throw new Error('Modèle de relance invalide');
      await saveTemplate(db, project.id, 'followup', { subject: '', body: t.body });
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
      const { prompt, system } = linkedinPostPrompt({
        profile: project.profile, target: project.target || {}, direction, previous: await recentDrafts(db, project.id), author: account.name,
      });
      const model = await getSetting(db, userId, 'analyze_model', 'haiku');
      const r = await claude(userId, { prompt, system, model: ['haiku', 'sonnet'].includes(model) ? model : 'haiku', maxTurns: 1, tools: [], signal: ctx.signal });
      addUsage(ctx, r);
      let body = '';
      try { body = String(extractJson(r.text).post ?? ''); } catch { body = ''; }
      body = body.replace(/\r\n/g, '\n').trim().slice(0, 3000);
      if (body.length < 50) throw new Error('Claude n\'a pas produit de post exploitable : réessaie');
      return { ok: true, postId: await saveDraft(db, project.id, { body, direction }) };
    },

    send: (ctx) => sendMails(ctx, 'initial'),
    followup: (ctx) => sendMails(ctx, 'followup'),

    async evolution(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId, secrets: true });
      const count = Math.max(1, Math.min(20, Math.floor(Number(ctx.params.count) || 5)));
      const level = LEVELS[ctx.params.level] ? ctx.params.level : 'normal';
      const to = await getSetting(db, userId, 'notify_email');
      const smtp = (await globalSmtp(app, userId)) || project.smtp;
      if (!to) throw new Error('Adresse de réception non configurée (Réglages)');
      if (!smtp) throw new Error('Aucun SMTP configuré (Réglages ou projet)');

      await ctx.progress({ message: 'Mise à jour du repo…', pct: 3 });
      const dir = repoDir(cfg, userId, project.id);
      await sync(userId, project.gitUrl, dir, await forgejoToken(app, userId));

      await ctx.progress({ message: `Recherche de ${count} évolutions (${level})…`, pct: 10 });
      const { prompt, system } = evolutionPrompt({ projectName: project.name, profile: project.profile, count, level });
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
      const transport = (app.createTransport || createTransport)(await pinSmtp(app, userId, smtp));
      await transport.sendMail({
        from: smtp.fromEmail, to,
        subject: `[AiTools] ${count} évolutions pour ${project.name}`,
        text: r.text,
        html: evolutionMail({ markdown: r.text, projectName: project.name, count, appUrl: cfg.appUrl }),
      });
      transport.close();
      return { markdown: r.text, sentTo: to };
    },
  };
}
