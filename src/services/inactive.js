// Suppression des comptes inactifs (annoncée dans la politique de confidentialité), lancée par le planificateur.
//  - inactif = aucune connexion ni job depuis INACTIVE_ACCOUNT_MONTHS mois (24 par défaut) ;
//  - un mail d'avertissement part 30 jours avant, via le SMTP du serveur (SYSTEM_SMTP_*) ;
//  - un compte n'est supprimé que s'il a REÇU cet avertissement et qu'il est resté inactif les 30 jours suivants : sans SMTP du
//    serveur, l'avertissement est seulement journalisé et rien n'est supprimé automatiquement ;
//  - jamais un administrateur, jamais un compte suspendu (la suspension sert aussi à garder la trace d'un abus).
import { now, getSetting, setSetting } from '../db.js';
import { INACTIVITY } from '../limits.js';
import { logAudit } from '../audit.js';
import { deleteUser } from '../users.js';
import { createTransport } from './mailer.js';
import { inactivityMail } from './mailhtml.js';
import { pinSmtp } from '../netguard.js';
import { CONTACT_EMAIL } from '../site/layout.js';

const DAY = 86400;

/** Même instant, `n` mois plus tard (calendrier UTC). */
export function addMonths(ts, n) {
  const d = new Date(ts * 1000);
  d.setUTCMonth(d.getUTCMonth() + n);
  return Math.floor(d.getTime() / 1000);
}

/** Dernière activité : connexion, création du compte ou dernier job lancé. */
export async function lastActivity(db, user) {
  const job = await db.prepare('SELECT MAX(created_at) t FROM jobs WHERE user_id = ?').get(Number(user.id));
  return Math.max(Number(user.last_login_at) || 0, Number(user.created_at) || 0, Number(job?.t) || 0);
}

const dateFr = (ts) => new Date(ts * 1000).toLocaleDateString('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' });

export function warningMail(cfg, user, deleteAt) {
  const text = [
    'Bonjour,',
    '',
    `Ton compte AiTools (${user.email}) n'a pas servi depuis longtemps. Conformément à notre politique de confidentialité, il sera supprimé avec toutes ses données (projets, prospects, modèles, réglages) à partir du ${dateFr(deleteAt)}.`,
    '',
    `Pour le garder, il suffit de te connecter avant cette date : ${cfg.appUrl}/login`,
    `Pour récupérer tes prospects avant, exporte-les en CSV depuis le tableau de bord (${cfg.appUrl}/).`,
    '',
    `Une question ? ${CONTACT_EMAIL}`,
    '',
    "AiTools · message automatique, envoyé une seule fois.",
  ].join('\n');
  const html = inactivityMail({ email: user.email, deleteDate: dateFr(deleteAt), loginUrl: `${cfg.appUrl}/login`, appUrl: cfg.appUrl, contact: CONTACT_EMAIL });
  return { subject: 'Ton compte AiTools sera supprimé pour inactivité', text, html };
}

async function sendWarning(app, user, deleteAt) {
  const smtp = app.cfg.systemSmtp;
  if (!smtp) return { sent: false, reason: "SMTP du serveur non configuré (SYSTEM_SMTP_HOST)" };
  const mail = warningMail(app.cfg, user, deleteAt);
  const transport = (app.createTransport || createTransport)(await pinSmtp(app, null, smtp));
  try {
    await transport.sendMail({ from: smtp.fromEmail, to: user.email, subject: mail.subject, text: mail.text, html: mail.html });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: `envoi impossible (${String(e.message).slice(0, 120)})`, transient: true };
  } finally { transport.close?.(); }
}

/**
 * Un passage : avertit les comptes qui approchent de l'échéance, supprime ceux qui l'ont dépassée après avertissement.
 * `at` est injectable (horloge des tests). months = 0 désactive la suppression.
 * @returns {{warned: number, deleted: number, unsent: number}}
 */
export async function runInactiveCleanup(app, { at = now(), months = app.cfg.inactiveMonths ?? INACTIVITY.defaultMonths, log = console } = {}) {
  const out = { warned: 0, deleted: 0, unsent: 0 };
  if (!months || months < 1) return out;
  const { db } = app;
  const warnSec = INACTIVITY.warningDays * DAY;
  // Pré-filtre en base : seuls les comptes dont la dernière connexion approche de l'échéance sont examinés un par un
  const horizon = addMonths(at, -months) + warnSec;
  const rows = await db.prepare(`SELECT id, email, created_at, last_login_at FROM users
    WHERE is_admin = 0 AND plan <> 'admin' AND status = 'active' AND COALESCE(last_login_at, created_at) <= ?`).all(horizon);
  for (const user of rows) {
    const act = await lastActivity(db, user);
    const deadline = addMonths(act, months);
    if (at < deadline - warnSec) continue; // un job récent a repoussé l'échéance
    const warnedAt = Number(await getSetting(db, user.id, 'inactive_warned_at', '0')) || 0;
    const warned = warnedAt > act; // un avertissement antérieur à la dernière activité ne compte plus

    if (!warned) {
      const deleteAt = Math.max(deadline, at + warnSec);
      const r = await sendWarning(app, user, deleteAt);
      if (r.sent) {
        await setSetting(db, user.id, 'inactive_warned_at', String(at));
        await logAudit(db, { action: 'inactive_warning', target: user, detail: `avertissement envoyé, suppression possible dès le ${dateFr(deleteAt)}`, at });
        out.warned++;
      } else {
        out.unsent++;
        log.warn?.(`[inactifs] compte ${user.id} : avertissement non envoyé, ${r.reason}. Aucune suppression automatique.`);
        // Une seule trace au journal d'audit par période d'inactivité (pas à chaque passage du planificateur)
        const noted = Number(await getSetting(db, user.id, 'inactive_noted_at', '0')) || 0;
        if (!r.transient && noted <= act) {
          await setSetting(db, user.id, 'inactive_noted_at', String(at));
          await logAudit(db, { action: 'inactive_warning', target: user, detail: `avertissement NON envoyé : ${r.reason}. Compte inactif à traiter à la main.`, at });
        }
      }
      continue;
    }
    if (at >= deadline && at >= warnedAt + warnSec) {
      await logAudit(db, { action: 'inactive_delete', target: user, detail: `inactif depuis le ${dateFr(act)}, avertissement du ${dateFr(warnedAt)}`, at });
      app.worker?.abortUser(user.id);
      await deleteUser(app, user.id);
      out.deleted++;
    }
  }
  return out;
}
