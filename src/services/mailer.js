import nodemailer from 'nodemailer';
import { randomBytes } from 'node:crypto';
import { prospectHtml } from './mailhtml.js';

export const EMAIL_RE = /^[^\s@<>()"',;:]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

// Limites dures, non modifiables depuis l'UI
export const HARD_LIMITS = { perBatch: 100, perDayProject: 200, perDayGlobal: 300 };

export function createTransport(smtp) {
  if (!smtp?.host || !smtp?.user || !smtp?.pass || !smtp?.fromEmail) throw new Error('SMTP incomplet');
  return nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port || 587),
    secure: Number(smtp.port) === 465,
    auth: { user: smtp.user, pass: smtp.pass },
    pool: false,
    // Hôte épinglé sur l'IP vérifiée (netguard.js) : le nom reste utilisé pour SNI et la vérification du certificat
    ...(smtp.servername ? { servername: smtp.servername, tls: { servername: smtp.servername } } : {}),
  });
}

export function fillTemplate(text, vars) {
  return String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
}

// Message-ID maîtrisé : c'est lui qui permet de rattacher une réponse au bon prospect
export function makeMessageId(fromEmail) {
  const domain = String(fromEmail || '').split('@')[1] || 'aitools.local';
  return `<${Date.now().toString(36)}.${randomBytes(9).toString('base64url')}@${domain}>`;
}

export function buildProspectMail({ template, prospect, smtp, unsubUrl, subject = template.subject, messageId, inReplyTo }) {
  const vars = {
    entreprise: prospect.company,
    ville: prospect.city || '',
    accroche: prospect.hook || '',
    expediteur: smtp.fromName || '',
  };
  const body = fillTemplate(template.body, vars).replace(/\n{3,}/g, '\n\n').trim();
  const notice = `Vous recevez ce message car l'adresse ${prospect.email} est publiée publiquement${prospect.source ? ` (${prospect.source})` : ''}.`;
  const footer = ['', '—', notice, `Pour ne plus être contacté : ${unsubUrl}`].join('\n');
  return {
    from: smtp.fromName ? `"${smtp.fromName.replace(/"/g, '')}" <${smtp.fromEmail}>` : smtp.fromEmail,
    to: prospect.email,
    subject: fillTemplate(subject, vars).trim(),
    text: body + '\n' + footer,
    html: prospectHtml({ body, notice, unsubUrl }),
    ...(messageId ? { messageId } : {}),
    ...(inReplyTo ? { inReplyTo, references: [inReplyTo] } : {}),
    headers: {
      'List-Unsubscribe': `<${unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

/**
 * Calcule combien de mails on peut réellement envoyer maintenant.
 * sentToday* = mails déjà partis sur les dernières 24 h.
 */
export function allowedToSend({ requested, available, projectCap, sentTodayProject, globalCap, sentTodayGlobal }) {
  const n = Math.floor(Number(requested));
  if (!Number.isFinite(n) || n < 1) throw new Error('Nombre de mails invalide');
  const pCap = Math.min(projectCap, HARD_LIMITS.perDayProject);
  const gCap = Math.min(globalCap, HARD_LIMITS.perDayGlobal);
  return Math.max(0, Math.min(n, HARD_LIMITS.perBatch, available, pCap - sentTodayProject, gCap - sentTodayGlobal));
}
