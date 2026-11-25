// Formulaire de contact du site public : l'adresse de l'éditeur n'est écrite nulle part dans les pages (les robots qui collectent les adresses
// n'en trouvent aucune). Le message part par le SMTP du serveur ; rien n'est gardé dans la base. Garde-fous : origine vérifiée, limite par adresse IP
// (src/limits.js), plafond global par jour, champ piège (un robot le remplit), délai minimal entre l'affichage et l'envoi, valeurs bornées,
// aucune donnée du visiteur dans l'objet ni dans les en-têtes du mail (sauf « répondre à », une seule adresse validée).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createTransport, EMAIL_RE } from './mailer.js';
import { pinSmtp } from '../netguard.js';
import { CONTACT_EMAIL } from '../site/layout.js';

export const CONTACT_LEN = { name: 100, message: 3000 };
export const TOPICS = {
  question: 'Une question',
  rights: 'Mes données personnelles (accès, effacement, opposition)',
  report: 'Signaler un contenu illicite ou un mail reçu à tort',
  plan: 'Être prévenu de l\'ouverture d\'une offre',
  other: 'Autre',
};
const MIN_AGE_MS = 3000;           // un humain ne remplit pas le formulaire en moins de 3 secondes
const MAX_AGE_MS = 2 * 3600_000;   // le formulaire affiché depuis plus de 2 heures est périmé
const DAY_CAP = 100;               // messages par jour pour tout le site

const sign = (key, ts) => createHmac('sha256', key).update(`contact:${ts}`).digest('base64url').slice(0, 24);

/** Jeton caché du formulaire : l'heure d'affichage, signée. */
export const formToken = (key, now = Date.now()) => `${now}.${sign(key, now)}`;

/** @returns {'ok'|'trop-tot'|'perime'|'invalide'} */
export function checkToken(key, token, now = Date.now()) {
  const m = /^(\d{10,14})\.([\w-]{24})$/.exec(String(token || ''));
  if (!m) return 'invalide';
  const good = Buffer.from(sign(key, m[1])); const got = Buffer.from(m[2]);
  if (good.length !== got.length || !timingSafeEqual(good, got)) return 'invalide';
  const age = now - Number(m[1]);
  if (age < MIN_AGE_MS) return 'trop-tot';
  if (age > MAX_AGE_MS) return 'perime';
  return 'ok';
}

/** Valide les champs : { ok, values, error }. Jamais de troncature silencieuse. */
export function readContact(b) {
  const v = {
    name: String(b.name ?? '').replace(/\s+/g, ' ').trim(),
    email: String(b.email ?? '').trim(),
    topic: Object.hasOwn(TOPICS, b.topic) ? b.topic : 'question',
    message: String(b.message ?? '').replace(/\r\n?/g, '\n').trim(),
  };
  if (!v.name) return { ok: false, values: v, error: 'Dis-nous ton nom.' };
  if (v.name.length > CONTACT_LEN.name) return { ok: false, values: v, error: `Ton nom est trop long (${CONTACT_LEN.name} caractères au plus).` };
  if (!EMAIL_RE.test(v.email) || v.email.length > 254) return { ok: false, values: v, error: 'Cette adresse e-mail ne semble pas valide : nous en avons besoin pour te répondre.' };
  if (v.message.length < 10) return { ok: false, values: v, error: 'Ton message est trop court : explique-nous ta demande en quelques phrases.' };
  if (v.message.length > CONTACT_LEN.message) return { ok: false, values: v, error: `Ton message est trop long (${CONTACT_LEN.message} caractères au plus).` };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v.name + v.message)) return { ok: false, values: v, error: 'Ton message contient des caractères non autorisés.' };
  return { ok: true, values: v, error: '' };
}

const clean = (s) => String(s).replace(/[\r\n]+/g, ' ');

/** Envoie le message à l'éditeur. @returns {Promise<{sent:boolean, reason?:string}>} ne lève jamais. */
export async function sendContact(app, values, { ipHint = '' } = {}) {
  try {
    const smtp = app.cfg.systemSmtp;
    if (!smtp) return { sent: false, reason: 'smtp-absent' };
    const st = (app.contactState ??= { day: '', count: 0 });
    const today = new Date().toISOString().slice(0, 10);
    if (st.day !== today) { st.day = today; st.count = 0; }
    if (st.count >= DAY_CAP) return { sent: false, reason: 'plafond-du-jour' };
    st.count++;
    const to = app.cfg.contactTo || CONTACT_EMAIL;
    const text = [`Sujet : ${TOPICS[values.topic]}`, `Nom : ${clean(values.name)}`, `Adresse pour répondre : ${clean(values.email)}`, ipHint ? `Réseau : ${ipHint}` : '', '', values.message].filter((l, i) => l !== '' || i > 3).join('\n');
    const transport = (app.createTransport || createTransport)(await pinSmtp(app, null, smtp));
    try {
      await transport.sendMail({ from: smtp.fromEmail, to, replyTo: values.email, subject: `[IaBoss] Formulaire de contact : ${TOPICS[values.topic]}`, text });
    } finally { transport.close?.(); }
    return { sent: true };
  } catch (err) {
    console.error('[contact] envoi impossible :', err.message);
    return { sent: false, reason: 'envoi-impossible' };
  }
}
