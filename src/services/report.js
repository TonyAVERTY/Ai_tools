// Rapport hebdo : lundi 8h (Paris), par mail + résumé Discord. Aucun token Claude.
import { now, getSetting, setSetting } from '../db.js';
import { abStats, globalSmtp } from '../projects.js';
import { createTransport } from './mailer.js';
import { notify } from './notify.js';
import { parisParts, parisTime } from './paris-time.js';

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : '-');
const usd = (n) => `${n.toFixed(2)} $`;
const day = (ts) => new Date(ts * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' });

export function weeklyStats(db, { at = now() } = {}) {
  const from = at - 7 * 86400;
  const one = (sql, ...a) => db.prepare(sql).get(...a).n;
  const projects = db.prepare('SELECT id, name FROM projects ORDER BY name COLLATE NOCASE').all().map((p) => {
    const sent = one("SELECT COUNT(*) n FROM mail_log WHERE project_id = ? AND kind = 'initial' AND error IS NULL AND sent_at > ?", p.id, from);
    const ab = abStats(db, p.id);
    return {
      name: p.name,
      found: one('SELECT COUNT(*) n FROM prospects WHERE project_id = ? AND created_at > ?', p.id, from),
      sent,
      followups: one("SELECT COUNT(*) n FROM mail_log WHERE project_id = ? AND kind = 'followup' AND error IS NULL AND sent_at > ?", p.id, from),
      replies: one('SELECT COUNT(*) n FROM prospects WHERE project_id = ? AND replied_at > ?', p.id, from),
      clients: one("SELECT COUNT(*) n FROM prospects WHERE project_id = ? AND status = 'client'", p.id),
      bounces: one(`SELECT COUNT(*) n FROM blacklist b JOIN prospects x ON x.email = b.email
        WHERE x.project_id = ? AND b.reason = 'bounce' AND b.created_at > ?`, p.id, from),
      cost: db.prepare('SELECT COALESCE(SUM(cost_usd), 0) c FROM jobs WHERE project_id = ? AND COALESCE(finished_at, created_at) > ?').get(p.id, from).c,
      bestSubject: ab.length > 1 && ab.every((v) => v.sent >= 10) ? [...ab].sort((a, b) => b.rate - a.rate)[0] : null,
    };
  });
  const cost = db.prepare('SELECT COALESCE(SUM(cost_usd), 0) c FROM jobs WHERE COALESCE(finished_at, created_at) > ?').get(from).c;
  const sum = (k) => projects.reduce((t, p) => t + p[k], 0);
  return { from, to: at, projects, totals: { found: sum('found'), sent: sum('sent'), followups: sum('followups'), replies: sum('replies'), cost } };
}

export function weeklyText(st) {
  const lines = [`AiTools · semaine du ${day(st.from)} au ${day(st.to)}`, ''];
  const t = st.totals;
  lines.push(`Total : ${t.found} prospect(s) trouvé(s), ${t.sent} mail(s) + ${t.followups} relance(s), ${t.replies} réponse(s) (${pct(t.replies, t.sent)}), IA ${usd(t.cost)}`, '');
  for (const p of st.projects) {
    const quiet = !p.found && !p.sent && !p.followups && !p.replies && !p.cost;
    if (quiet) { lines.push(`${p.name} : rien cette semaine`, ''); continue; }
    lines.push(p.name);
    lines.push(`  Prospects trouvés : ${p.found}`);
    lines.push(`  Mails envoyés     : ${p.sent} (+ ${p.followups} relance(s))`);
    lines.push(`  Réponses          : ${p.replies} (taux ${pct(p.replies, p.sent)})`);
    lines.push(`  Clients (total)   : ${p.clients}`);
    if (p.bounces) lines.push(`  Adresses invalides: ${p.bounces}`);
    if (p.bestSubject) lines.push(`  Test A/B          : l'objet ${p.bestSubject.variant} gagne (${pct(p.bestSubject.replied, p.bestSubject.sent)} de réponses)`);
    lines.push(`  Coût IA           : ${usd(p.cost)}`, '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

/** Envoie le rapport (mail si SMTP global + adresse, Discord si webhook). Retourne les canaux utilisés. */
export async function sendWeeklyReport(app, { at = now() } = {}) {
  const st = weeklyStats(app.db, { at });
  const text = weeklyText(st);
  const channels = [];
  const to = getSetting(app.db, 'notify_email');
  const smtp = globalSmtp(app);
  if (to && smtp) {
    const transport = (app.createTransport || createTransport)(smtp);
    try {
      await transport.sendMail({ from: smtp.fromEmail, to, subject: `[AiTools] Rapport du ${day(st.from)} au ${day(st.to)}`, text });
      channels.push('mail');
    } finally { transport.close(); }
  }
  const t = st.totals;
  const ok = await notify(app, 'weekly', {
    title: `Rapport hebdo · ${day(st.from)} → ${day(st.to)}`, level: 'info',
    description: st.projects.filter((p) => p.sent || p.found || p.replies)
      .map((p) => `**${p.name}** : ${p.found} trouvés · ${p.sent} envoyés · ${p.replies} réponses`).join('\n') || 'Rien cette semaine.',
    fields: [
      { name: 'Réponses', value: `${t.replies} (${pct(t.replies, t.sent)})` },
      { name: 'Relances', value: String(t.followups) },
      { name: 'Coût IA', value: usd(t.cost) },
    ],
  });
  if (ok) channels.push('discord');
  return { channels, text };
}

/** Appelé toutes les 15 min : envoie une fois par semaine, le lundi à partir de 8h (Paris). */
export async function maybeSendWeekly(app, { date = new Date() } = {}) {
  if (getSetting(app.db, 'weekly_report', '0') !== '1') return null;
  const p = parisParts(date);
  if (p.weekday !== 'Mon' || p.hour < 8) return null;
  const mondayAt8 = Math.floor(parisTime(p.year, p.month, p.day, 8).getTime() / 1000);
  if (Number(getSetting(app.db, 'weekly_report_last', '0')) >= mondayAt8) return null;
  const at = Math.floor(date.getTime() / 1000);
  const r = await sendWeeklyReport(app, { at });
  // Rien de configuré : on ne marque pas, il partira dès qu'un canal existera
  if (r.channels.length) setSetting(app.db, 'weekly_report_last', String(at));
  return r;
}
