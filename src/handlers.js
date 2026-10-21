// Handlers des jobs en arrière-plan.
import { now, getSetting } from './db.js';
import { runClaude, extractJson } from './services/claude.js';
import { addUsage } from './services/jobs.js';
import { syncRepo } from './services/git.js';
import { analyzePrompt, prospectPrompt, templatePrompt, evolutionPrompt, LEVELS } from './services/prompts.js';
import { EMAIL_RE, createTransport, buildProspectMail, allowedToSend } from './services/mailer.js';
import { unsubToken } from './crypto.js';
import { getProject, repoDir, forgejoToken, globalSmtp, sentSince } from './projects.js';

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Annulé')); }, { once: true });
});

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
    company: str(p.company, 200), email, website: str(p.website), city: str(p.city, 100),
    sector: str(p.sector, 100), hook: str(p.hook, 400), source: str(p.source), score,
  };
}

export function makeHandlers(app) {
  const { db, cfg } = app;
  const claude = (o) => runClaude({ bin: cfg.claudeBin, ...o });

  return {
    async analyze(ctx) {
      const project = getProject(app, ctx.job.project_id);
      ctx.progress({ message: 'Récupération du repo…' });
      const dir = repoDir(cfg, project.id);
      const commit = await syncRepo(project.gitUrl, dir, forgejoToken(app));

      ctx.progress({ message: 'Analyse du code par Claude…' });
      const { prompt, system } = analyzePrompt(project.name);
      const r = await claude({ prompt, system, cwd: dir, model: 'sonnet', maxTurns: 20, tools: ['Read', 'Glob', 'Grep'], signal: ctx.signal });
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
            ctx.progress({ found, target: count, message: `${found}/${count} — ${p.company}` });
          }
        }
      };
      ctx.progress({ found: 0, target: count, message: 'Recherche en cours…' });
      const { prompt, system } = prospectPrompt({ profile: project.profile, target: project.target, count, exclude });
      const model = getSetting(db, 'prospect_model', 'haiku');
      const r = await claude({
        prompt, system, model, tools: ['WebSearch', 'WebFetch'],
        maxTurns: Math.min(80, count * 3 + 10), onText, signal: ctx.signal,
      });
      onText('\n');
      addUsage(ctx, r);
      return { found, requested: count, stoppedBy: r.subtype };
    },

    async template(ctx) {
      const project = getProject(app, ctx.job.project_id, { secrets: true });
      if (!project.profile) throw new Error('Analyse le projet d\'abord');
      const { prompt, system } = templatePrompt({ profile: project.profile, target: project.target || {}, senderName: project.smtp?.fromName });
      const r = await claude({ prompt, system, model: 'haiku', maxTurns: 1, tools: [], signal: ctx.signal });
      addUsage(ctx, r);
      const t = extractJson(r.text);
      if (!t.subject || !t.body) throw new Error('Modèle de mail invalide');
      db.prepare(`INSERT INTO mail_templates(project_id, subject, body, status, updated_at) VALUES(?, ?, ?, 'draft', ?)
        ON CONFLICT(project_id) DO UPDATE SET subject = excluded.subject, body = excluded.body, status = 'draft', updated_at = excluded.updated_at`)
        .run(project.id, t.subject, t.body, now());
      return { ok: true };
    },

    async send(ctx) {
      const project = getProject(app, ctx.job.project_id, { secrets: true });
      const template = db.prepare("SELECT * FROM mail_templates WHERE project_id = ? AND status = 'validated'").get(project.id);
      if (!template) throw new Error('Modèle de mail non validé');
      if (!project.smtp) throw new Error('SMTP non configuré pour ce projet');

      const day = now() - 86400;
      const candidates = db.prepare(`SELECT * FROM prospects WHERE project_id = ? AND status = 'new'
        AND email NOT IN (SELECT email FROM blacklist) ORDER BY score DESC, id LIMIT 100`).all(project.id);
      const n = allowedToSend({
        requested: ctx.params.count,
        available: candidates.length,
        projectCap: project.dailyMailCap,
        sentTodayProject: sentSince(db, day, project.id),
        globalCap: Number(getSetting(db, 'global_daily_cap', '100')),
        sentTodayGlobal: sentSince(db, day),
      });
      if (n === 0) throw new Error('Plafond quotidien atteint ou aucun prospect à contacter');

      const transport = (app.createTransport || createTransport)(project.smtp);
      await transport.verify();
      const minDelay = Number(getSetting(db, 'send_delay_min', '20')) * 1000;
      const maxDelay = Number(getSetting(db, 'send_delay_max', '60')) * 1000;
      const log = db.prepare('INSERT INTO mail_log(project_id, prospect_id, email, sent_at, error) VALUES(?, ?, ?, ?, ?)');
      const mark = db.prepare("UPDATE prospects SET status = ?, sent_at = ? WHERE id = ?");
      let sent = 0, failed = 0;

      for (const p of candidates.slice(0, n)) {
        if (ctx.cancelled()) break;
        // Re-vérifie la blacklist juste avant l'envoi (désinscription pendant le batch)
        if (db.prepare('SELECT 1 FROM blacklist WHERE email = ?').get(p.email)) continue;
        const unsubUrl = `${cfg.appUrl}/u/${encodeURIComponent(p.email)}/${unsubToken(cfg.secretKey, p.email)}`;
        try {
          await transport.sendMail(buildProspectMail({ template, prospect: p, smtp: project.smtp, unsubUrl }));
          log.run(project.id, p.id, p.email, now(), null);
          mark.run('sent', now(), p.id);
          sent++;
        } catch (e) {
          log.run(project.id, p.id, p.email, now(), String(e.message).slice(0, 500));
          if (/^5\d\d/.test(String(e.responseCode))) mark.run('bounced', now(), p.id);
          failed++;
        }
        ctx.progress({ sent, failed, total: n, message: `${sent + failed}/${n} envoyés` });
        if (sent + failed < n) await sleep(minDelay + Math.random() * (maxDelay - minDelay), ctx.signal).catch(() => {});
      }
      transport.close();
      return { sent, failed, total: n };
    },

    async evolution(ctx) {
      const project = getProject(app, ctx.job.project_id, { secrets: true });
      const count = Math.max(1, Math.min(20, Math.floor(Number(ctx.params.count) || 5)));
      const level = LEVELS[ctx.params.level] ? ctx.params.level : 'normal';
      const to = getSetting(db, 'notify_email');
      const smtp = globalSmtp(app) || project.smtp;
      if (!to) throw new Error('Adresse de réception non configurée (Réglages)');
      if (!smtp) throw new Error('Aucun SMTP configuré (Réglages ou projet)');

      ctx.progress({ message: 'Mise à jour du repo…' });
      const dir = repoDir(cfg, project.id);
      await syncRepo(project.gitUrl, dir, forgejoToken(app));

      ctx.progress({ message: `Recherche de ${count} évolutions (${level})…` });
      const { prompt, system } = evolutionPrompt({ projectName: project.name, profile: project.profile, count, level });
      const { model, maxTurns } = LEVELS[level];
      const r = await claude({ prompt, system, cwd: dir, model, maxTurns, tools: ['Read', 'Glob', 'Grep'], signal: ctx.signal });
      addUsage(ctx, r);
      if (!r.text?.trim()) throw new Error(`Pas de résultat (${r.subtype})`);

      ctx.progress({ message: 'Envoi par mail…' });
      const transport = (app.createTransport || createTransport)(smtp);
      await transport.sendMail({
        from: smtp.fromEmail, to,
        subject: `[AiTools] ${count} évolutions pour ${project.name}`,
        text: r.text,
      });
      transport.close();
      return { markdown: r.text, sentTo: to };
    },
  };
}
