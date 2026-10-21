import nodemailer from 'nodemailer';

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
  });
}

export function fillTemplate(text, vars) {
  return String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');
}

export function buildProspectMail({ template, prospect, smtp, unsubUrl }) {
  const vars = {
    entreprise: prospect.company,
    ville: prospect.city || '',
    accroche: prospect.hook || '',
    expediteur: smtp.fromName || '',
  };
  const body = fillTemplate(template.body, vars).replace(/\n{3,}/g, '\n\n').trim();
  const footer = [
    '',
    '—',
    `Vous recevez ce message car l'adresse ${prospect.email} est publiée publiquement${prospect.source ? ` (${prospect.source})` : ''}.`,
    `Pour ne plus être contacté : ${unsubUrl}`,
  ].join('\n');
  return {
    from: smtp.fromName ? `"${smtp.fromName.replace(/"/g, '')}" <${smtp.fromEmail}>` : smtp.fromEmail,
    to: prospect.email,
    subject: fillTemplate(template.subject, vars).trim(),
    text: body + '\n' + footer,
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
