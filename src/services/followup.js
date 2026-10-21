// Relance automatique : qui relancer, quand, et ce qui bloque.
import { now } from '../db.js';
import { getTemplate } from '../projects.js';

const INBOX_MAX_AGE = 2 * 3600; // la boîte doit avoir été lue il y a moins de 2 h

// Lundi-vendredi, 9h-18h heure de Paris : une relance à 3h du matin sent le robot
export function isBusinessHours(date = new Date(), timeZone = 'Europe/Paris') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: 'numeric', hour12: false })
      .formatToParts(date).map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour) % 24;
  return !['Sat', 'Sun'].includes(parts.weekday) && hour >= 9 && hour < 18;
}

const CANDIDATES_SQL = `FROM prospects WHERE project_id = ? AND status = 'sent' AND followup_at IS NULL
  AND sent_at <= ? AND email NOT IN (SELECT email FROM blacklist)`;

export function followupCandidates(db, project, { at = now(), limit = 100 } = {}) {
  const cutoff = at - project.followupDays * 86400;
  return db.prepare(`SELECT * ${CANDIDATES_SQL} ORDER BY sent_at, id LIMIT ?`).all(project.id, cutoff, limit);
}

/** @returns {{due: number, blockers: string[], inHours: boolean, ready: boolean}} */
export function followupPlan(db, project, { at = now(), date = new Date(at * 1000) } = {}) {
  const blockers = [];
  if (!project.followupEnabled) blockers.push('relance désactivée');
  if (!getTemplate(db, project.id, 'followup', { validatedOnly: true })) blockers.push('modèle de relance à valider');
  if (!project.hasSmtp) blockers.push('SMTP à configurer');
  // Sans lecture de la boîte, on relancerait des gens qui ont déjà répondu
  const inbox = project.inbox || {};
  if (!project.hasImap) blockers.push('boîte IMAP à connecter');
  else if (inbox.lastError || !inbox.lastOk || at - inbox.lastOk > INBOX_MAX_AGE) blockers.push('boîte non vérifiée récemment');

  const cutoff = at - project.followupDays * 86400;
  const due = db.prepare(`SELECT COUNT(*) n ${CANDIDATES_SQL}`).get(project.id, cutoff).n;
  const inHours = isBusinessHours(date);
  return { due, blockers, inHours, ready: !blockers.length && inHours && due > 0 };
}

// Objet de la relance : vide = "Re: <objet du premier mail>" pour rester dans le même fil
export function followupSubject(template, original) {
  if (template.subject) return template.subject;
  const s = original?.subject || 'notre échange';
  return /^re\s*:/i.test(s) ? s : `Re: ${s}`;
}
