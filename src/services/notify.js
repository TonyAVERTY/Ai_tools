// Notifications Discord via webhook (pas de bot, pas de process permanent : une requête HTTP).
import { getSetting } from '../db.js';
import { decrypt } from '../crypto.js';

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

export function notifyConfig(app) {
  let url = null;
  try { url = decrypt(app.cfg.secretKey, getSetting(app.db, 'discord_webhook_enc')); }
  catch { url = null; }
  const raw = getSetting(app.db, 'discord_events');
  const events = raw ? JSON.parse(raw) : Object.keys(EVENTS);
  return { url, events };
}

/** Envoie une notif si le webhook est configuré et l'événement activé. Ne lève jamais d'erreur. */
export async function notify(app, event, { title, description = '', level = 'info', fields = [] }, { force = false } = {}) {
  const { url, events } = notifyConfig(app);
  if (!url || (!force && !events.includes(event))) return false;
  const body = {
    username: 'AiTools',
    allowed_mentions: { parse: [] }, // un "@everyone" dans un nom d'entreprise ne pingera personne
    embeds: [{
      title: String(title).slice(0, 256),
      description: String(description).slice(0, 4000),
      color: COLORS[level] ?? COLORS.info,
      fields: fields.slice(0, 10).map((f) => ({
        name: String(f.name).slice(0, 256), value: String(f.value ?? '-').slice(0, 1024) || '-', inline: f.inline ?? true,
      })),
      url: app.cfg.appUrl || undefined,
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

// Fin de job → notif (seulement pour les jobs longs, ceux qu'on lance et qu'on oublie)
const DONE = {
  analyze: () => ({ title: 'Fiche projet à jour', level: 'ok' }),
  prospect: (r) => ({ title: 'Recherche de prospects terminée', description: `${r?.found ?? 0} nouveau(x) prospect(s) sur ${r?.requested ?? '?'} demandés.`, level: 'ok' }),
  send: (r) => ({ title: 'Envoi terminé', description: `${r?.sent ?? 0} mail(s) envoyé(s), ${r?.failed ?? 0} échec(s).`, level: r?.failed ? 'warn' : 'ok' }),
  evolution: (r) => ({ title: 'Évolutions prêtes', description: `Envoyées à ${r?.sentTo ?? 'ta boîte'}.`, level: 'ok' }),
};
const LABEL = { analyze: 'Analyse', prospect: 'Recherche', template: 'Modèle de mail', followup_template: 'Modèle de relance', send: 'Envoi', followup: 'Relances', evolution: 'Évolutions' };

export function notifyJob(app, job, { status, result, error }) {
  const project = job.project_id ? app.db.prepare('SELECT name FROM projects WHERE id = ?').get(job.project_id)?.name : null;
  const prefix = project ? `${project} · ` : '';
  if (status === 'error') {
    return notify(app, 'job_error', { title: `${prefix}${LABEL[job.type] || job.type} en échec`, description: String(error || '').slice(0, 500), level: 'error' });
  }
  if (status !== 'done') return Promise.resolve(false);
  if (job.type === 'followup') {
    if (!result?.sent) return Promise.resolve(false);
    return notify(app, 'followup', { title: `${prefix}Relances envoyées`, description: `${result.sent} relance(s), ${result.failed} échec(s).`, level: 'info' });
  }
  const make = DONE[job.type];
  if (!make) return Promise.resolve(false);
  const n = make(result);
  return notify(app, 'job_done', { ...n, title: `${prefix}${n.title}` });
}
