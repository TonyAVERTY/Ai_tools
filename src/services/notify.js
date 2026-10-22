// Notifications Discord via webhook (pas de bot, pas de process permanent : une requête HTTP).
import { getSetting } from '../db.js';
import { decrypt } from '../crypto.js';
import { parseEvolutions, EFFORTS } from './markdown.js';

// Uniquement de vraies URLs de webhook Discord : jamais d'envoi vers une adresse arbitraire
export const WEBHOOK_RE = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,25}\/[\w-]{20,120}$/;

export const EVENTS = {
  job_done: 'Recherche, analyse, envoi ou évolutions terminés',
  job_error: 'Job en erreur',
  reply: 'Réponse d\'un prospect',
  followup: 'Relances envoyées',
  thermal: 'Pause thermique du Pi',
  budget: 'Budget IA atteint',
  quota: 'Quota Claude proche de la limite, ou job reporté',
  weekly: 'Rapport hebdo',
};

const COLORS = { ok: 0x15803d, info: 0x2f5bea, warn: 0xb45309, error: 0xb91c1c };
const ICONS = { ok: '✅', info: '🔷', warn: '⚠️', error: '⛔' };
const FOOTERS = {
  job_done: 'Job terminé', job_error: 'Job en échec', reply: 'Réponse prospect', followup: 'Relances',
  thermal: 'Température', budget: 'Budget IA', quota: 'Quota Claude', weekly: 'Rapport hebdo', test: 'Test',
};

/** Barre de progression en caractères (Discord n'affiche pas d'images inline dans un embed sans hébergement). */
export function bar(done, total, width = 12) {
  const r = total ? Math.max(0, Math.min(1, done / total)) : 0;
  const full = Math.round(r * width);
  return `${'▰'.repeat(full)}${'▱'.repeat(width - full)} ${Math.round(r * 100)} %`;
}

export async function notifyConfig(app) {
  let url = null;
  try { url = decrypt(app.cfg.secretKey, await getSetting(app.db, 'discord_webhook_enc')); }
  catch { url = null; }
  const raw = await getSetting(app.db, 'discord_events');
  const events = raw ? JSON.parse(raw) : Object.keys(EVENTS);
  return { url, events };
}

/** Envoie une notif si le webhook est configuré et l'événement activé. Ne lève jamais d'erreur. */
export async function notify(app, event, { title, description = '', level = 'info', fields = [], footer }, { force = false } = {}) {
  const { url, events } = await notifyConfig(app);
  if (!url || (!force && !events.includes(event))) return false;
  const body = {
    username: 'AiTools',
    allowed_mentions: { parse: [] }, // un "@everyone" dans un nom d'entreprise ne pingera personne
    embeds: [{
      author: { name: `${ICONS[level] ?? ICONS.info}  AiTools`, ...(app.cfg.appUrl ? { url: app.cfg.appUrl } : {}) },
      title: String(title).slice(0, 256),
      description: String(description).slice(0, 4000),
      color: COLORS[level] ?? COLORS.info,
      fields: fields.slice(0, 25).map((f) => ({
        name: String(f.name).slice(0, 256), value: String(f.value ?? '-').slice(0, 1024) || '-', inline: f.inline ?? true,
      })),
      url: app.cfg.appUrl || undefined,
      footer: { text: String(footer || FOOTERS[event] || 'AiTools').slice(0, 200) },
      timestamp: new Date().toISOString(),
    }],
  };
  try {
    const r = await (app.fetch || fetch)(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return true;
  } catch (e) {
    console.warn('[discord]', e.message);
    return false;
  }
}

const duration = (s) => (s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);

// Fin de job → notif (seulement pour les jobs longs, ceux qu'on lance et qu'on oublie)
const DONE = {
  analyze: (r) => ({
    title: 'Fiche projet à jour', level: 'ok',
    description: 'Le code a été relu : la fiche et la cible proposée sont prêtes à valider dans le panel.',
    fields: r?.commit ? [{ name: 'Commit', value: `\`${String(r.commit).slice(0, 8)}\`` }] : [],
  }),
  prospect: (r) => ({
    title: 'Recherche de prospects terminée', level: 'ok',
    description: `${r?.found ?? 0} nouveau(x) prospect(s) sur ${r?.requested ?? '?'} demandés.\n${bar(r?.found ?? 0, r?.requested ?? 0)}`,
    fields: [
      { name: '🔎 Trouvés', value: `**${r?.found ?? 0}**` },
      { name: '🎯 Demandés', value: String(r?.requested ?? '?') },
    ],
  }),
  send: (r) => ({
    title: 'Envoi terminé', level: r?.failed ? 'warn' : 'ok',
    description: `${r?.sent ?? 0} mail(s) envoyé(s), ${r?.failed ?? 0} échec(s).\n${bar(r?.sent ?? 0, r?.total ?? 0)}`,
    fields: [
      { name: '✉️ Envoyés', value: `**${r?.sent ?? 0}**` },
      { name: '❌ Échecs', value: String(r?.failed ?? 0) },
    ],
  }),
  evolution: (r) => {
    const items = parseEvolutions(r?.markdown);
    return {
      title: 'Évolutions prêtes', level: 'ok',
      description: `Envoyées à ${r?.sentTo ?? 'ta boîte'}.${items.length ? `\n\n${items.slice(0, 10).map((e) => `**${e.n}.** ${e.title}${e.effort ? ` · \`${e.effort} ${EFFORTS[e.effort].toLowerCase()}\`` : ''}`).join('\n')}` : ''}`,
    };
  },
};
const LABEL = { analyze: 'Analyse', prospect: 'Recherche', template: 'Modèle de mail', followup_template: 'Modèle de relance', send: 'Envoi', followup: 'Relances', evolution: 'Évolutions' };

// Durée et coût réels, relus en base une fois le job clos (absents dans les tests unitaires)
async function jobMeta(app, job) {
  if (!job.id) return [];
  const row = await app.db.prepare('SELECT started_at, finished_at, cost_usd FROM jobs WHERE id = ?').get(job.id);
  const out = [];
  if (row?.started_at && row?.finished_at) out.push({ name: '⏱️ Durée', value: duration(row.finished_at - row.started_at) });
  if (row?.cost_usd) out.push({ name: '💳 Coût IA', value: `${row.cost_usd.toFixed(2)} $` });
  return out;
}

export async function notifyJob(app, job, { status, result, error }) {
  const project = job.project_id ? (await app.db.prepare('SELECT name FROM projects WHERE id = ?').get(job.project_id))?.name : null;
  const prefix = project ? `${project} · ` : '';
  const footer = project ? `${project} · ${LABEL[job.type] || job.type}` : undefined;
  if (status === 'error') {
    return notify(app, 'job_error', {
      title: `${prefix}${LABEL[job.type] || job.type} en échec`, level: 'error', footer,
      description: `\`\`\`\n${String(error || 'Erreur inconnue').slice(0, 900).replace(/```/g, "'''")}\n\`\`\``,
      fields: await jobMeta(app, job),
    });
  }
  if (status !== 'done') return false;
  if (job.type === 'followup') {
    if (!result?.sent) return false;
    return notify(app, 'followup', {
      title: `${prefix}Relances envoyées`, level: 'info', footer,
      description: `${result.sent} relance(s), ${result.failed} échec(s).\n${bar(result.sent, result.total || result.sent)}`,
    });
  }
  const make = DONE[job.type];
  if (!make) return false;
  const n = make(result);
  return notify(app, 'job_done', { ...n, title: `${prefix}${n.title}`, footer, fields: [...(n.fields || []), ...(await jobMeta(app, job))] });
}
