// Handlers des jobs en arrière-plan.
import { now, getSetting, setSetting } from './db.js';
import { runClaude, extractJson, rateLimitWindows } from './services/claude.js';
import { addUsage } from './services/jobs.js';
import { syncRepo } from './services/git.js';
import { analyzePrompt, prospectPrompt, templatePrompt, followupTemplatePrompt, evolutionPrompt, LEVELS } from './services/prompts.js';
import { followupCandidates, followupSubject, isBusinessHours } from './services/followup.js';
import { EMAIL_RE, createTransport, buildProspectMail, allowedToSend, makeMessageId } from './services/mailer.js';
import { unsubToken } from './crypto.js';
import { quotaAlerts } from './services/budget.js';
import { notify } from './services/notify.js';
import { evolutionMail } from './services/mailhtml.js';
import { getProject, repoDir, forgejoToken, globalSmtp, sentSince, getTemplate, saveTemplate, pickVariant } from './projects.js';

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Annulé')); }, { once: true });
});

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

export function makeHandlers(app) {
  const { db, cfg } = app;
  const claude = async (o) => {
    const r = await runClaude({ bin: cfg.claudeBin, ...o });
    // État du quota Pro (session 5h + semaine), affiché dans la barre système
    const w = rateLimitWindows(r.rateLimit);
    if (w) {
      setSetting(db, 'claude_rate_limit_json', JSON.stringify({ at: now(), ...w }));
      for (const a of quotaAlerts(db, w)) {
        notify(app, 'quota', {
          title: `Quota Claude : ${a.level}+ % (${a.label})`,
          level: a.level >= 95 ? 'error' : 'warn',
          description: `${Math.round(a.utilization * 100)} % utilisé sur la ${a.label}.`,
        });
      }
    }
    return r;
  };

  const inHours = () => (app.isBusinessHours || isBusinessHours)();

  // Premier mail ou relance : mêmes plafonds, mêmes délais, même journal
  async function sendMails(ctx, kind) {
    // Une relance mise en file à 17h55 ne doit pas partir à 19h si le worker était occupé
    if (kind === 'followup' && !inHours()) return { sent: 0, failed: 0, total: 0, postponed: true };
    const project = getProject(app, ctx.job.project_id, { secrets: true });
    const template = getTemplate(db, project.id, kind, { validatedOnly: true });
    if (!template) throw new Error(kind === 'followup' ? 'Modèle de relance non validé' : 'Modèle de mail non validé');
    if (!project.smtp) throw new Error('SMTP non configuré pour ce projet');

    const day = now() - 86400;
    const candidates = kind === 'followup'
      ? followupCandidates(db, project)
      : db.prepare(`SELECT * FROM prospects WHERE project_id = ? AND status = 'new'
          AND email NOT IN (SELECT email FROM blacklist) ORDER BY score DESC, id LIMIT 100`).all(project.id);
    const n = allowedToSend({
      requested: ctx.params.count,
      available: candidates.length,
      projectCap: project.dailyMailCap,
      sentTodayProject: sentSince(db, day, project.id),
      globalCap: Number(getSetting(db, 'global_daily_cap', '100')),
      sentTodayGlobal: sentSince(db, day),
    });
    if (n === 0) throw new Error(kind === 'followup' ? 'Plafond quotidien atteint ou aucune relance due' : 'Plafond quotidien atteint ou aucun prospect à contacter');

    const transport = (app.createTransport || createTransport)(project.smtp);
    await transport.verify();
    const minDelay = Number(getSetting(db, 'send_delay_min', '20')) * 1000;
    const maxDelay = Number(getSetting(db, 'send_delay_max', '60')) * 1000;
    const log = db.prepare(`INSERT INTO mail_log(project_id, prospect_id, email, sent_at, error, kind, variant, subject, message_id)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const markInitial = db.prepare('UPDATE prospects SET status = ?, sent_at = ?, variant = ? WHERE id = ?');
    const markFollowup = db.prepare('UPDATE prospects SET followup_at = ? WHERE id = ?');
    const markBounced = db.prepare("UPDATE prospects SET status = 'bounced' WHERE id = ?");
    const original = db.prepare("SELECT subject, message_id FROM mail_log WHERE prospect_id = ? AND kind = 'initial' AND error IS NULL ORDER BY id LIMIT 1");
    const current = db.prepare('SELECT status, followup_at FROM prospects WHERE id = ?');
    let sent = 0, failed = 0;
    ctx.progress({ sent, failed, total: n, message: `0/${n} ${kind === 'followup' ? 'relances envoyées' : 'envoyés'}`, pct: 0 });

    for (const p of candidates.slice(0, n)) {
      if (ctx.cancelled()) break;
      if (kind === 'followup' && !inHours()) break; // le reste repartira au prochain créneau
      // Re-vérifie juste avant l'envoi : désinscription, réponse arrivée pendant le batch…
      if (db.prepare('SELECT 1 FROM blacklist WHERE email = ?').get(p.email)) continue;
      if (kind === 'followup') {
        const c = current.get(p.id);
        if (c.status !== 'sent' || c.followup_at) continue;
      }
      const unsubUrl = `${cfg.appUrl}/u/${encodeURIComponent(p.email)}/${unsubToken(cfg.secretKey, p.email)}`;
      let variant = null, subject, inReplyTo;
      if (kind === 'initial') {
        variant = pickVariant(db, project.id, template);
        subject = variant === 'B' ? template.subject_b : template.subject;
      } else {
        const orig = original.get(p.id);
        subject = followupSubject(template, orig);
        inReplyTo = orig?.message_id;
      }
      const mail = buildProspectMail({
        template, prospect: p, smtp: project.smtp, unsubUrl, subject, inReplyTo,
        messageId: makeMessageId(project.smtp.fromEmail),
      });
      try {
        await transport.sendMail(mail);
        log.run(project.id, p.id, p.email, now(), null, kind, variant, mail.subject, mail.messageId);
        if (kind === 'initial') markInitial.run('sent', now(), variant, p.id);
        else markFollowup.run(now(), p.id);
        sent++;
      } catch (e) {
        log.run(project.id, p.id, p.email, now(), String(e.message).slice(0, 500), kind, variant, mail.subject, mail.messageId);
        if (/^5\d\d/.test(String(e.responseCode))) markBounced.run(p.id);
        failed++;
      }
      const label = kind === 'followup' ? 'relances envoyées' : 'envoyés';
      ctx.progress({ sent, failed, total: n, message: `${sent + failed}/${n} ${label}`, pct: Math.round(((sent + failed) / n) * 100) });
      if (sent + failed < n) await sleep(minDelay + Math.random() * (maxDelay - minDelay), ctx.signal).catch(() => {});
    }
    transport.close();
    return { sent, failed, total: n };
  }

  return {
    async analyze(ctx) {
      const project = getProject(app, ctx.job.project_id);
      ctx.progress({ message: 'Récupération du repo…', pct: 3 });
      const dir = repoDir(cfg, project.id);
      const commit = await syncRepo(project.gitUrl, dir, forgejoToken(app));

      ctx.progress({ message: 'Analyse du code par Claude…', pct: 10 });
      const { prompt, system } = analyzePrompt(project.name);
      const model = getSetting(db, 'analyze_model', 'haiku');
      const r = await claude({
        prompt, system, cwd: dir, model, maxTurns: 20, tools: ['Read', 'Glob', 'Grep'], signal: ctx.signal,
        onTurn: (n) => ctx.progress({ message: `Lecture du code par Claude (étape ${n})…`, pct: turnPct(10, 95, n, 20) }),
      });
      addUsage(ctx, r);
      if (!r.ok) throw new Error(`Analyse incomplète (${r.subtype})`);
      const profile = extractJson(r.text);
      if (!profile.resume || !profile.cible) throw new Error('Fiche projet incomplète');
      const { cible, ...rest } = profile;
      db.prepare('UPDATE projects SET profile_json = ?, profile_commit = ?, profile_at = ?, target_json = ?, target_validated = 0 WHERE id = ?')
        .run(JSON.stringify(rest), commit, now(), JSON.stringify(cible), project.id);
      return { commit };
    },

    async prospect(ctx) {
      const project = getProject(app, ctx.job.project_id);
      if (!project.profile || !project.targetValidated) throw new Error('Valide la cible du projet avant de prospecter');
      const count = Math.max(1, Math.min(50, Math.floor(Number(ctx.params.count) || 10)));

      // Domaines déjà connus (tous projets) : Claude ne les recherche pas une 2e fois
      const exclude = db.prepare(`
        SELECT DISTINCT substr(email, instr(email, '@') + 1) d FROM prospects WHERE project_id = ?
        UNION SELECT substr(email, instr(email, '@') + 1) FROM blacklist
        LIMIT 300`).all(project.id).map((r) => r.d);

      const insert = db.prepare(`INSERT OR IGNORE INTO prospects(project_id, company, email, website, city, sector, hook, source, score, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM blacklist WHERE email = ?)`);
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
        for (const line of lines) {
          const p = parseProspectLine(line);
          if (!p) continue;
          const res = insert.run(project.id, p.company, p.email, p.website, p.city, p.sector, p.hook, p.source, p.score, now(), p.email);
          if (res.changes) {
            found++;
            message = `${found}/${count} — ${p.company}`;
            report();
          }
        }
      };
      report();
      const { prompt, system } = prospectPrompt({ profile: project.profile, target: project.target, count, exclude });
      const model = getSetting(db, 'prospect_model', 'haiku');
      const r = await claude({
        prompt, system, model, tools: ['WebSearch', 'WebFetch'],
        maxTurns, onText, signal: ctx.signal,
        onTurn: (n) => { turns = n; report(); },
      });
      onText('\n');
      addUsage(ctx, r);
      return { found, requested: count, stoppedBy: r.subtype };
    },

    async template(ctx) {
      const project = getProject(app, ctx.job.project_id, { secrets: true });
      if (!project.profile) throw new Error('Analyse le projet d\'abord');
      ctx.progress({ message: 'Rédaction du modèle par Claude…', pct: 40 });
      const { prompt, system } = templatePrompt({ profile: project.profile, target: project.target || {}, senderName: project.smtp?.fromName });
      const r = await claude({ prompt, system, model: 'haiku', maxTurns: 1, tools: [], signal: ctx.signal });
      addUsage(ctx, r);
      const t = extractJson(r.text);
      if (!t.subject || !t.body) throw new Error('Modèle de mail invalide');
      saveTemplate(db, project.id, 'initial', { subject: t.subject, body: t.body });
      return { ok: true };
    },

    async followup_template(ctx) {
      const project = getProject(app, ctx.job.project_id, { secrets: true });
      if (!project.profile) throw new Error('Analyse le projet d\'abord');
      ctx.progress({ message: 'Rédaction de la relance par Claude…', pct: 40 });
      const { prompt, system } = followupTemplatePrompt({ profile: project.profile, senderName: project.smtp?.fromName });
      const r = await claude({ prompt, system, model: 'haiku', maxTurns: 1, tools: [], signal: ctx.signal });
      addUsage(ctx, r);
      const t = extractJson(r.text);
      if (!t.body) throw new Error('Modèle de relance invalide');
      saveTemplate(db, project.id, 'followup', { subject: '', body: t.body });
      return { ok: true };
    },

    send: (ctx) => sendMails(ctx, 'initial'),
    followup: (ctx) => sendMails(ctx, 'followup'),

    async evolution(ctx) {
      const project = getProject(app, ctx.job.project_id, { secrets: true });
      const count = Math.max(1, Math.min(20, Math.floor(Number(ctx.params.count) || 5)));
      const level = LEVELS[ctx.params.level] ? ctx.params.level : 'normal';
      const to = getSetting(db, 'notify_email');
      const smtp = globalSmtp(app) || project.smtp;
      if (!to) throw new Error('Adresse de réception non configurée (Réglages)');
      if (!smtp) throw new Error('Aucun SMTP configuré (Réglages ou projet)');

      ctx.progress({ message: 'Mise à jour du repo…', pct: 3 });
      const dir = repoDir(cfg, project.id);
      await syncRepo(project.gitUrl, dir, forgejoToken(app));

      ctx.progress({ message: `Recherche de ${count} évolutions (${level})…`, pct: 10 });
      const { prompt, system } = evolutionPrompt({ projectName: project.name, profile: project.profile, count, level });
      const { model, maxTurns } = LEVELS[level];
      const r = await claude({
        prompt, system, cwd: dir, model, maxTurns, tools: ['Read', 'Glob', 'Grep'], signal: ctx.signal,
        onTurn: (n) => ctx.progress({ message: `Recherche de ${count} évolutions (${level}) · étape ${n}…`, pct: turnPct(10, 90, n, maxTurns) }),
      });
      addUsage(ctx, r);
      if (!r.text?.trim()) throw new Error(`Pas de résultat (${r.subtype})`);

      ctx.progress({ message: 'Envoi par mail…', pct: 95 });
      const transport = (app.createTransport || createTransport)(smtp);
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
