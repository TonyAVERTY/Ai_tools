// Détection d'abus à l'envoi : un compte dont trop de mails sont rejetés (bounces) est mis en pause d'envoi, l'administrateur
// est prévenu (journal d'audit, journal du serveur, Discord s'il est configuré) et l'utilisateur voit un message clair.
// Le désabonnement et la liste d'opposition globale restent appliqués à chaque envoi, pause ou non (voir handlers.js).
// Seuils : src/limits.js (ABUSE).
import { now, getSetting, setSetting } from '../db.js';
import { ABUSE } from '../limits.js';
import { logAudit } from '../audit.js';
import { notify } from './notify.js';
import { CONTACT_EMAIL } from '../site/layout.js';

/**
 * Prospects contactés depuis `since` et, parmi eux, ceux dont le mail a été rejeté (adresse invalide). Un prospect compte une
 * fois, même relancé. Sont comptés les envois réussis et les rejets définitifs (5xx) ; une panne passagère de SMTP ne pèse pas.
 */
export async function bounceStats(db, userId, { since }) {
  const r = await db.prepare(`SELECT COUNT(DISTINCT m.prospect_id) sent,
      COUNT(DISTINCT CASE WHEN x.status = 'bounced' THEN m.prospect_id END) bounced
    FROM mail_log m JOIN projects p ON p.id = m.project_id JOIN prospects x ON x.id = m.prospect_id
    WHERE p.user_id = ? AND m.sent_at >= ? AND (m.error IS NULL OR x.status = 'bounced')`).get(Number(userId), since);
  const sent = Number(r.sent), bounced = Number(r.bounced);
  return { sent, bounced, rate: sent ? bounced / sent : 0 };
}

/** Pause d'envoi en cours ({ at, sent, bounced, rate }) ou null. */
export async function sendPause(db, userId) {
  const raw = await getSetting(db, userId, 'send_pause_json');
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** Message affiché à l'utilisateur : pourquoi, que vérifier, comment reprendre. */
export function pauseMessage(p) {
  const pct = Math.round((p.rate || 0) * 100);
  return `Tes envois sont en pause : ${p.bounced} adresse(s) sur ${p.sent} contactées ont été rejetées (${pct} %, seuil de ${Math.round(ABUSE.maxBounceRate * 100)} %). `
    + `Vérifie ta liste de prospects et la configuration de ton domaine d'envoi (SPF, DKIM), puis écris à ${CONTACT_EMAIL} pour reprendre. `
    + "Le lien de désinscription et la liste d'opposition restent appliqués.";
}

/**
 * Évalue la santé des envois d'un compte ; au-delà du seuil (et d'un minimum d'envois), met le compte en pause.
 * Appelée après chaque lot d'envois et chaque lecture de la boîte (c'est là qu'arrivent les rejets).
 * Après un rétablissement par l'administrateur, seuls les envois suivants sont comptés.
 * @returns {Promise<object|null>} la pause (existante ou nouvelle), ou null
 */
export async function evaluateSending(app, userId, { at = now() } = {}) {
  const { db } = app;
  const existing = await sendPause(db, userId);
  if (existing) return existing;
  const resumed = Number(await getSetting(db, userId, 'send_resumed_at', '0')) || 0;
  const since = Math.max(at - ABUSE.windowDays * 86400, resumed);
  const st = await bounceStats(db, userId, { since });
  if (st.sent < ABUSE.minSent || st.rate <= ABUSE.maxBounceRate) return null;

  const pause = { at, sent: st.sent, bounced: st.bounced, rate: Math.round(st.rate * 1000) / 1000 };
  await setSetting(db, userId, 'send_pause_json', JSON.stringify(pause));
  const user = await db.prepare('SELECT id, email FROM users WHERE id = ?').get(Number(userId));
  const detail = `${st.bounced} rejets sur ${st.sent} prospects contactés (${Math.round(st.rate * 100)} %)`;
  await logAudit(db, { action: 'abuse_pause', target: user, detail, at });
  console.warn(`[abus] envois du compte ${userId} mis en pause : ${detail}`);
  // L'administrateur est prévenu sur son Discord s'il en a un ; l'utilisateur sur le sien
  for (const a of await db.prepare("SELECT id FROM users WHERE is_admin = 1 AND status = 'active'").all()) {
    await notify(app, a.id, 'abuse', {
      title: 'Compte mis en pause d\'envoi', level: 'warn',
      description: `Compte n°${userId} : ${detail}. Rétablissement possible depuis /admin.`,
    }, { force: true });
  }
  await notify(app, userId, 'abuse', { title: 'Envois en pause', level: 'warn', description: pauseMessage(pause) });
  return pause;
}

/** Rétablit les envois (action de l'administrateur) : le décompte repart des envois suivants. */
export async function resumeSending(db, userId, { at = now() } = {}) {
  await setSetting(db, userId, 'send_pause_json', null);
  await setSetting(db, userId, 'send_resumed_at', String(at));
}
