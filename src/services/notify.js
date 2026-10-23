// Notifications Discord via webhook (pas de bot, pas de process permanent : une requête HTTP).
import { randomBytes } from 'node:crypto';
import { getSetting, setSetting } from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { HttpError } from '../http.js';
import { parseEvolutions, EFFORTS } from './markdown.js';

// Uniquement de vraies URLs de webhook Discord : jamais d'envoi vers une adresse arbitraire
export const WEBHOOK_RE = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,25}\/[\w-]{20,120}$/;

export const EVENTS = {
  job_done: 'Recherche, analyse, envoi ou évolutions terminés',
  job_error: 'Job en erreur',
  reply: 'Réponse d\'un prospect',
  followup: 'Relances envoyées',
  load: 'Serveur très chargé : tes jobs attendent',
  abuse: 'Envois mis en pause (trop de mails rejetés)',
  budget: 'Budget IA atteint',
  quota: 'Quota Claude proche de la limite, ou job reporté',
  weekly: 'Rapport hebdo',
};

const COLORS = { ok: 0x15803d, info: 0x2f5bea, warn: 0xb45309, error: 0xb91c1c };
const ICONS = { ok: '✅', info: '🔷', warn: '⚠️', error: '⛔' };
const FOOTERS = {
  job_done: 'Job terminé', job_error: 'Job en échec', reply: 'Réponse prospect', followup: 'Relances',
  load: 'Charge serveur', abuse: 'Envois en pause', budget: 'Budget IA', quota: 'Quota Claude', weekly: 'Rapport hebdo', test: 'Test',
};

/** Barre de progression en caractères (Discord n'affiche pas d'images inline dans un embed sans hébergement). */
export function bar(done, total, width = 12) {
  const r = total ? Math.max(0, Math.min(1, done / total)) : 0;
  const full = Math.round(r * width);
  return `${'▰'.repeat(full)}${'▱'.repeat(width - full)} ${Math.round(r * 100)} %`;
}

export const MAX_HOOKS = 5;
const ALL_EVENTS = Object.keys(EVENTS);
// « thermal » (ancienne pause du Raspberry) est devenu « load »
const cleanEvents = (list) => [...new Set((Array.isArray(list) ? list : []).map((e) => (e === 'thermal' ? 'load' : e)).filter((e) => EVENTS[e]))];
const parse = (raw) => { try { return JSON.parse(raw); } catch { return null; } };

/**
 * Les webhooks de l'utilisateur, chacun avec les événements qu'il reçoit (un salon pour les réponses, un autre pour les erreurs…).
 * Un compte qui n'a jamais enregistré la liste garde son ancien réglage unique (`discord_webhook_enc` + `discord_events`) comme premier webhook.
 * @returns {Promise<{id:string, url:string, events:string[]}[]>}
 */
export async function listHooks(app, userId) {
  const { db, cfg } = app;
  const open = (enc) => { try { return enc ? decrypt(cfg.secretKey, enc) : null; } catch { return null; } };
  const stored = parse(await getSetting(db, userId, 'discord_hooks_json'));
  if (Array.isArray(stored)) {
    return stored.map((h) => ({ id: String(h.id), url: open(h.urlEnc), events: cleanEvents(h.events) })).filter((h) => h.url);
  }
  const url = open(await getSetting(db, userId, 'discord_webhook_enc'));
  if (!url) return [];
  const raw = parse(await getSetting(db, userId, 'discord_events'));
  return [{ id: 'legacy', url, events: Array.isArray(raw) ? cleanEvents(raw) : ALL_EVENTS }];
}

export async function notifyConfig(app, userId) {
  const hooks = await listHooks(app, userId);
  return { hooks, url: hooks[0]?.url ?? null, events: hooks[0]?.events ?? ALL_EVENTS };
}

/** Ce que l'interface a le droit de voir : jamais l'adresse du webhook, seulement qu'il existe et ce qu'il reçoit. */
export const publicHooks = (hooks) => hooks.map((h) => ({ id: h.id, events: h.events }));

/**
 * Enregistre les webhooks à partir du formulaire des Réglages (champs discord_id_i, discord_url_i, discord_ev_i_<événement>,
 * discord_del_i). Une adresse laissée vide sur une ligne existante la conserve ; une ligne neuve sans adresse est ignorée.
 */
export async function saveDiscordHooks(app, userId, body) {
  const { db, cfg } = app;
  const stored = new Map();
  for (const h of parse(await getSetting(db, userId, 'discord_hooks_json')) || []) stored.set(String(h.id), h);
  const legacy = await getSetting(db, userId, 'discord_webhook_enc');
  if (!stored.size && legacy) stored.set('legacy', { id: 'legacy', urlEnc: legacy });
  const rows = [...new Set(Object.keys(body).map((k) => /^discord_url_(\d{1,2})$/.exec(k)?.[1]).filter(Boolean))].map(Number).sort((a, b) => a - b);
  const out = [];
  for (const i of rows) {
    if (body[`discord_del_${i}`]) continue;
    const typed = String(body[`discord_url_${i}`] ?? '').trim();
    const before = stored.get(String(body[`discord_id_${i}`] ?? ''));
    if (typed && !WEBHOOK_RE.test(typed)) throw new HttpError(400, 'URL de webhook Discord invalide (https://discord.com/api/webhooks/…)');
    const urlEnc = typed ? encrypt(cfg.secretKey, typed) : before?.urlEnc;
    if (!urlEnc) continue;
    out.push({ id: before?.id ?? randomBytes(4).toString('hex'), urlEnc, events: ALL_EVENTS.filter((k) => body[`discord_ev_${i}_${k}`] === 'on') });
  }
  if (out.length > MAX_HOOKS) throw new HttpError(400, `${MAX_HOOKS} webhooks Discord au plus`);
  await setSetting(db, userId, 'discord_hooks_json', JSON.stringify(out));
  // L'ancien réglage unique est dans la liste : on l'efface pour qu'il ne revienne pas après une suppression
  await setSetting(db, userId, 'discord_webhook_enc', null);
  await setSetting(db, userId, 'discord_events', null);
}

async function post(app, url, body) {
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

/**
 * Envoie une notif à chaque webhook qui reçoit cet événement. Ne lève jamais d'erreur.
 * `force` : même si l'événement n'est pas coché (test) ; `hookId` : un seul webhook.
 */
export async function notify(app, userId, event, { title, description = '', level = 'info', fields = [], footer }, { force = false, hookId = null } = {}) {
  const targets = (await listHooks(app, userId)).filter((h) => (!hookId || h.id === hookId) && (force || h.events.includes(event)));
  if (!targets.length) return false;
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
  const sent = await Promise.all(targets.map((h) => post(app, h.url, body)));
  return sent.some(Boolean);
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
  const row = await app.db.prepare('SELECT started_at, finished_at, cost_usd FROM jobs WHERE id = ? AND user_id = ?').get(job.id, job.user_id);
  const out = [];
  if (row?.started_at && row?.finished_at) out.push({ name: '⏱️ Durée', value: duration(row.finished_at - row.started_at) });
  if (row?.cost_usd) out.push({ name: '💳 Coût IA', value: `${row.cost_usd.toFixed(2)} $` });
  return out;
}

export async function notifyJob(app, job, { status, result, error }) {
  const project = job.project_id ? (await app.db.prepare('SELECT name FROM projects WHERE id = ? AND user_id = ?').get(job.project_id, job.user_id))?.name : null;
  const prefix = project ? `${project} · ` : '';
  const footer = project ? `${project} · ${LABEL[job.type] || job.type}` : undefined;
  if (status === 'error') {
    return notify(app, job.user_id, 'job_error', {
      title: `${prefix}${LABEL[job.type] || job.type} en échec`, level: 'error', footer,
      description: `\`\`\`\n${String(error || 'Erreur inconnue').slice(0, 900).replace(/```/g, "'''")}\n\`\`\``,
      fields: await jobMeta(app, job),
    });
  }
  if (status !== 'done') return false;
  if (job.type === 'followup') {
    if (!result?.sent) return false;
    return notify(app, job.user_id, 'followup', {
      title: `${prefix}Relances envoyées`, level: 'info', footer,
      description: `${result.sent} relance(s), ${result.failed} échec(s).\n${bar(result.sent, result.total || result.sent)}`,
    });
  }
  const make = DONE[job.type];
  if (!make) return false;
  const n = make(result);
  return notify(app, job.user_id, 'job_done', { ...n, title: `${prefix}${n.title}`, footer, fields: [...(n.fields || []), ...(await jobMeta(app, job))] });
}
