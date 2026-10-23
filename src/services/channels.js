// Autres canaux de notification, en plus de Discord : Slack (webhook entrant), Telegram (bot) et e-mail.
// Un canal de chaque type au plus. Aucune adresse arbitraire n'est jamais appelée : Slack et Telegram ont des hôtes fixes, validés
// par motif ; l'e-mail part du SMTP du serveur (SYSTEM_SMTP_*), jamais de celui d'un projet. Les secrets sont chiffrés et jamais réaffichés.
import { getSetting, setSetting } from '../db.js';
import { encryptJson, decryptJson } from '../crypto.js';
import { HttpError, esc } from '../http.js';
import { EMAIL_RE, createTransport } from './mailer.js';
import { pinSmtp } from '../netguard.js';

export const SLACK_RE = /^https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{6,}\/B[A-Z0-9]{6,}\/[A-Za-z0-9]{16,}$/;
export const TELEGRAM_TOKEN_RE = /^\d{5,12}:[A-Za-z0-9_-]{30,50}$/;
export const TELEGRAM_CHAT_RE = /^(-?\d{3,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;

export const CHANNEL_TYPES = { slack: 'Slack', telegram: 'Telegram', email: 'E-mail' };
const MAIL_PER_HOUR = 20; // un canal e-mail ne doit jamais devenir un robinet : au-delà, les notifications du reste de l'heure sont ignorées

const parse = (raw) => { try { return JSON.parse(raw); } catch { return null; } };

/** Canaux enregistrés, secrets déchiffrés : { slack?: {url, events}, telegram?: {token, chat, events}, email?: {to, events} }. */
export async function listChannels(app, userId, allEvents) {
  const stored = parse(await getSetting(app.db, userId, 'notify_channels_json')) || {};
  const out = {};
  for (const type of Object.keys(CHANNEL_TYPES)) {
    const c = stored[type];
    if (!c) continue;
    let secret = null;
    try { secret = c.secretEnc ? decryptJson(app.cfg.secretKey, c.secretEnc) : null; } catch { secret = null; }
    const events = (Array.isArray(c.events) ? c.events : []).filter((e) => allEvents.includes(e));
    if (type === 'slack' && secret?.url) out.slack = { url: secret.url, events };
    if (type === 'telegram' && secret?.token && c.chat) out.telegram = { token: secret.token, chat: c.chat, events };
    if (type === 'email' && c.to) out.email = { to: c.to, events };
  }
  return out;
}

/** Ce que l'interface peut voir : qu'un canal existe, son destinataire quand il n'est pas secret, ce qu'il reçoit. Jamais une URL ni un jeton. */
export const publicChannels = (channels) => Object.fromEntries(Object.entries(channels).map(([type, c]) => [type, {
  events: c.events, ...(type === 'telegram' ? { chat: c.chat } : {}), ...(type === 'email' ? { to: c.to } : {}),
}]));

/** Enregistre depuis le formulaire des Réglages (champs slack_*, telegram_*, email_*). Un secret laissé vide est conservé. */
export async function saveChannels(app, userId, body, allEvents) {
  const { db, cfg } = app;
  // Rien dans le formulaire (autre page, ancien client) : on ne touche à rien
  if (!Object.keys(CHANNEL_TYPES).some((t) => Object.keys(body).some((k) => k.startsWith(`${t}_`)))) return;
  const stored = parse(await getSetting(db, userId, 'notify_channels_json')) || {};
  const events = (t) => allEvents.filter((k) => body[`${t}_ev_${k}`] === 'on');
  const typed = (k) => String(body[k] ?? '').trim();
  const out = {};

  if (!body.slack_del && (typed('slack_url') || stored.slack)) {
    if (typed('slack_url') && !SLACK_RE.test(typed('slack_url'))) throw new HttpError(400, 'URL de webhook Slack invalide (https://hooks.slack.com/services/…)', { expose: true });
    out.slack = { secretEnc: typed('slack_url') ? encryptJson(cfg.secretKey, { url: typed('slack_url') }) : stored.slack.secretEnc, events: events('slack') };
  }
  if (!body.telegram_del && (typed('telegram_chat') || typed('telegram_token') || stored.telegram)) {
    const chat = typed('telegram_chat') || stored.telegram?.chat || '';
    if (!TELEGRAM_CHAT_RE.test(chat)) throw new HttpError(400, 'Identifiant de conversation Telegram invalide (nombre, ou @canal)', { expose: true });
    if (typed('telegram_token') && !TELEGRAM_TOKEN_RE.test(typed('telegram_token'))) throw new HttpError(400, 'Jeton de bot Telegram invalide (donné par @BotFather)', { expose: true });
    const secretEnc = typed('telegram_token') ? encryptJson(cfg.secretKey, { token: typed('telegram_token') }) : stored.telegram?.secretEnc;
    if (!secretEnc) throw new HttpError(400, 'Jeton du bot Telegram requis', { expose: true });
    out.telegram = { secretEnc, chat, events: events('telegram') };
  }
  if (!body.email_del && (typed('email_to') || stored.email)) {
    const to = typed('email_to') || stored.email?.to || '';
    if (!EMAIL_RE.test(to)) throw new HttpError(400, 'Adresse e-mail de notification invalide', { expose: true });
    out.email = { to, events: events('email') };
  }
  await setSetting(db, userId, 'notify_channels_json', JSON.stringify(out));
}

// ---------- Envoi ----------

const slackText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ICONS = { ok: '✅', info: 'ℹ️', warn: '⚠️', error: '⛔' };

/** Texte brut commun : titre, description, champs. */
function plain({ title, description = '', level = 'info', fields = [] }) {
  const lines = [`${ICONS[level] ?? ICONS.info} ${title}`];
  if (description) lines.push('', String(description).replace(/```/g, ''));
  const f = fields.filter((x) => x?.name).map((x) => `${x.name} : ${x.value ?? '-'}`);
  if (f.length) lines.push('', ...f);
  return lines.join('\n').slice(0, 3500);
}

async function postJson(app, url, body) {
  const r = await (app.fetch || fetch)(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

const sent = new Map(); // userId -> { at, n } : plafond horaire de l'e-mail
function mailAllowed(userId, at = Date.now()) {
  const e = sent.get(userId);
  if (!e || at - e.at > 3600_000) { sent.set(userId, { at, n: 1 }); return true; }
  return ++e.n <= MAIL_PER_HOUR;
}

/**
 * Envoie la notification à chaque canal qui reçoit l'événement (`force` : même non coché, pour un test ; `only` : un seul type).
 * Ne lève jamais : un canal en panne ne gêne ni les autres ni le job. @returns {Promise<string[]>} types livrés
 */
export async function notifyChannels(app, userId, event, message, allEvents, { force = false, only = null } = {}) {
  const channels = await listChannels(app, userId, allEvents);
  const delivered = [];
  await Promise.all(Object.entries(channels).filter(([type, c]) => (!only || type === only) && (force || c.events.includes(event))).map(async ([type, c]) => {
    try {
      const text = plain(message);
      if (type === 'slack') await postJson(app, c.url, { text: slackText(text) });
      else if (type === 'telegram') await postJson(app, `https://api.telegram.org/bot${c.token}/sendMessage`, { chat_id: c.chat, text, disable_web_page_preview: true });
      else if (type === 'email') {
        const smtp = app.cfg.systemSmtp;
        if (!smtp) throw new Error('SMTP du serveur non configuré');
        if (!force && !mailAllowed(userId)) throw new Error('plafond horaire atteint');
        const transport = (app.createTransport || createTransport)(await pinSmtp(app, null, smtp));
        try {
          await transport.sendMail({ from: smtp.fromEmail, to: c.to, subject: `[AiTools] ${String(message.title).replace(/[\r\n]+/g, ' ').slice(0, 150)}`, text, html: `<pre style="font-family:inherit;white-space:pre-wrap">${esc(text)}</pre>` });
        } finally { transport.close?.(); }
      }
      delivered.push(type);
    } catch (e) {
      console.warn(`[notify:${type}]`, String(e.message).replace(/bot\d+:[\w-]+/g, 'bot***'));
    }
  }));
  return delivered;
}
