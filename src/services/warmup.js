// Montée en charge d'un nouvel expéditeur : un CONSEIL, jamais un blocage. Un domaine qui envoie 200 mails dès le premier jour
// abîme sa réputation ; l'utilisateur est prévenu, puis il décide (les plafonds durs de src/services/mailer.js restent seuls à bloquer).
import { now } from '../db.js';

export const WARMUP = { days: 7, perDay: 20 };

/**
 * @returns {Promise<{active: boolean, daysLeft: number, perDay: number, sentToday: number, over: boolean}>}
 * `over` : l'envoi du jour dépasse déjà la recommandation.
 */
export async function warmupAdvice(db, projectId, { at = now(), sentToday = 0 } = {}) {
  const first = (await db.prepare('SELECT MIN(sent_at) t FROM mail_log WHERE project_id = ? AND error IS NULL').get(projectId)).t;
  const age = first ? Math.floor((at - Number(first)) / 86400) : 0;
  const active = age < WARMUP.days;
  return { active, daysLeft: active ? WARMUP.days - age : 0, perDay: WARMUP.perDay, sentToday, over: active && sentToday > WARMUP.perDay };
}

/** Texte du conseil pour une demande d'envoi de `count` mails ; null si rien à dire. */
export function warmupNotice(advice, count) {
  if (!advice?.active || advice.sentToday + Number(count) <= advice.perDay) return null;
  return `Conseil : ${advice.perDay / 2} à ${advice.perDay} mails par jour pendant la première semaine protègent la réputation de ton adresse d'envoi (encore ${advice.daysLeft} jour${advice.daysLeft > 1 ? 's' : ''}). Tu peux quand même envoyer plus.`;
}
