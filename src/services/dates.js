// Dates dans les réponses des prospects : « mardi à 14h », « le 5 novembre », « demain matin », « en janvier »…
// Le but est d'aider à agender un rendez-vous, pas de deviner : tout est proposé, rien n'est ajouté sans que l'utilisateur confirme
// (et puisse corriger la date et l'heure). Heures de Paris.
import { parisParts, parisTime } from './paris-time.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");
const MONTHS = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
const WEEKDAYS = { lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 7 };
const MONTH_RE = Object.keys(MONTHS).join('|');
const WD_RE = Object.keys(WEEKDAYS).join('|');
const ISO_WD = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

const day = (y, m, d) => Date.UTC(y, m - 1, d) / 86_400_000; // numéro de jour (calculs de calendrier sans fuseau)
const fromDay = (n) => { const x = new Date(n * 86_400_000); return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }; };
const validDate = (y, m, d) => { const x = new Date(Date.UTC(y, m - 1, d)); return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d; };

/** Prochain jour ouvré (lundi à vendredi) strictement après `base` (numéro de jour). */
function nextBusinessDay(baseDay) {
  let n = baseDay + 1;
  while ([6, 0].includes(new Date(n * 86_400_000).getUTCDay())) n++;
  return n;
}

// Heure explicite (« 14h », « 14h30 », « 14:30 », « 9 h ») ; sinon moment de la journée (deviné)
function findTime(t, from) {
  const rest = t.slice(Math.max(0, from));
  const m = /(?:\ba\s+|\bvers\s+|\bdes\s+)?\b([01]?\d|2[0-3])\s?(?:h|:)\s?([0-5]\d)?(?!\d)/.exec(rest) || /(?:\ba\s+|\bvers\s+)\b([01]?\d|2[0-3])\s?(?:h|:)\s?([0-5]\d)?/.exec(t);
  if (m) return { h: +m[1], min: m[2] ? +m[2] : 0, guessed: false };
  if (/\bmidi\b/.test(t)) return { h: 12, min: 0, guessed: true };
  if (/apres-?midi/.test(t)) return { h: 15, min: 0, guessed: true };
  if (/\bmatin\b/.test(t)) return { h: 10, min: 0, guessed: true };
  if (/\bsoir\b/.test(t)) return { h: 18, min: 0, guessed: true };
  return { h: 10, min: 0, guessed: true };
}

/**
 * Premier moment mentionné dans `text`, relativement au jour où la réponse a été reçue (`receivedAt`, secondes).
 * @returns {{at: number, guessed: boolean, vague: boolean, phrase: string} | null}
 *  `guessed` : l'heure n'est pas écrite (10 h par défaut) ; `vague` : seulement un mois ou « la semaine prochaine ».
 */
export function findMoment(text, receivedAt) {
  const t = norm(text);
  const b = parisParts(new Date(receivedAt * 1000));
  const base = day(b.year, b.month, b.day);
  const hits = []; // { index, day, vague, phrase }
  const push = (m, d, vague = false) => { if (m) hits.push({ index: m.index, end: m.index + m[0].length, day: d, vague, phrase: m[0].trim() }); };

  let m;
  // 05/11, 5-11-2026, 5.11
  const numRe = /\b(0?[1-9]|[12]\d|3[01])[\/.-](0?[1-9]|1[0-2])(?:[\/.-](\d{4}|\d{2}))?\b/g;
  while ((m = numRe.exec(t))) {
    const d = +m[1], mo = +m[2];
    let y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : b.year;
    if (!validDate(y, mo, d)) continue;
    if (!m[3] && day(y, mo, d) < base) y++;
    if (validDate(y, mo, d)) push(m, day(y, mo, d));
  }
  // « le 5 novembre », « 15 janvier 2027 », « 1er décembre »
  const dmRe = new RegExp(`\\b(0?[1-9]|[12]\\d|3[01])(?:er)?\\s+(${MONTH_RE})(?:\\s+(\\d{4}))?\\b`, 'g');
  while ((m = dmRe.exec(t))) {
    const d = +m[1], mo = MONTHS[m[2]];
    let y = m[3] ? +m[3] : b.year;
    if (!validDate(y, mo, d)) continue;
    if (!m[3] && day(y, mo, d) < base) y++;
    if (validDate(y, mo, d)) push(m, day(y, mo, d));
  }
  // « mardi », « jeudi prochain » : la prochaine occurrence, jamais le jour même de la réponse
  const wdRe = new RegExp(`\\b(${WD_RE})(?:\\s+prochain)?\\b`, 'g');
  while ((m = wdRe.exec(t))) {
    const target = WEEKDAYS[m[1]];
    const cur = ISO_WD[b.weekday];
    let delta = (target - cur + 7) % 7;
    if (delta === 0) delta = 7;
    push(m, base + delta);
    hits[hits.length - 1].weekday = true;
  }
  // « lundi 2 novembre » : la date écrite l'emporte sur le jour de la semaine qui la précède
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (h.weekday && hits.some((o) => !o.weekday && o.index >= h.end && o.index - h.end <= 2)) hits.splice(i, 1);
  }
  // relatifs
  if ((m = /\bapres-?demain\b/.exec(t))) push(m, base + 2);
  else if ((m = /\bdemain\b/.exec(t))) push(m, base + 1);
  if ((m = /\b(?:aujourd'?hui|ce jour)\b/.exec(t))) push(m, base);
  if ((m = /\bdans\s+(\d{1,2})\s+(jours?|semaines?)\b/.exec(t))) push(m, base + +m[1] * (m[2].startsWith('semaine') ? 7 : 1));
  // vagues : « la semaine prochaine » (lundi prochain), « en janvier », « début janvier »
  if ((m = /\b(?:la\s+)?semaine\s+prochaine\b/.exec(t))) push(m, base + (8 - ISO_WD[b.weekday]), true);
  const monthRe = new RegExp(`\\b(?:en|debut|fin|mi|courant)\\s+(${MONTH_RE})\\b`, 'g');
  while ((m = monthRe.exec(t))) {
    const mo = MONTHS[m[1]];
    let y = b.year;
    if (day(y, mo, 1) + 27 < base) y++;
    let d = 1;
    if (/^fin/.test(m[0])) d = 25; else if (/^mi/.test(m[0])) d = 15;
    if (/^en|^courant/.test(m[0]) && y === b.year && mo === b.month) d = base - day(y, mo, 1) + 1 + 7;
    if (validDate(y, mo, d)) push(m, nextBusinessDay(day(y, mo, d) - 1), true);
  }
  if (!hits.length) return null;
  hits.sort((x, y) => x.index - y.index);
  // Une date précise gagne sur une mention vague quand les deux sont là
  const precise = hits.filter((h) => !h.vague);
  const hit = (precise.length ? precise : hits)[0];
  const time = findTime(t, hit.end);
  const { y, m: mo, d } = fromDay(hit.day);
  return { at: Math.floor(parisTime(y, mo, d, time.h, time.min).getTime() / 1000), guessed: time.guessed, vague: hit.vague, phrase: hit.phrase };
}

const CALL = /\b(appel|appeler|appelez|appelle|telephon|tel\b|visio|zoom|teams|google meet|discuter|echanger|parler|call)/;
const VISIO = /\b(visio|zoom|teams|google meet|meet)\b/;
const MEET = /\b(rdv|rendez-?vous|rencontr|reunion|demo|demonstration|presentation|passer vous voir|passer nous voir|venir vous voir)/;

/**
 * Proposition d'événement pour une réponse, ou null. Jamais pour un refus. Sans date écrite, une réponse intéressée qui parle d'un appel ou
 * d'un rendez-vous donne une proposition « date à choisir » (prochain jour ouvré à 10 h).
 * @returns {{title: string, at: number, minutes: number, kind: string, guessed: boolean, vague: boolean, dateToChoose: boolean, phrase: string|null} | null}
 */
export function suggestEvent({ subject = '', text = '', intent = 'other', company = '', from = '', receivedAt }) {
  if (intent === 'refused') return null;
  const body = String(text || '').trim() || String(subject || ''); // l'objet « Re: … » reprend nos propres mots
  const t = norm(body);
  const moment = findMoment(body, receivedAt);
  const call = CALL.test(t), meet = MEET.test(t);
  if (!moment && !(intent === 'interested' && (call || meet))) return null;
  const who = String(company || '').trim() || String(from || '').split('@')[1] || 'le prospect';
  let kind = 'event', title = `Échange avec ${who}`, minutes = 30;
  if (VISIO.test(t)) { kind = 'visio'; title = `Visio avec ${who}`; minutes = 45; }
  else if (call && !meet) { kind = 'call'; title = `Appel avec ${who}`; }
  else if (meet) { kind = 'meeting'; title = `Rendez-vous avec ${who}`; minutes = 60; }
  else if (intent === 'later') { kind = 'reminder'; title = `Relancer ${who}`; minutes = 15; }
  if (moment) return { title, at: moment.at, minutes, kind, guessed: moment.guessed, vague: moment.vague, dateToChoose: false, phrase: moment.phrase };
  const b = parisParts(new Date(receivedAt * 1000));
  const { y, m, d } = fromDay(nextBusinessDay(day(b.year, b.month, b.day)));
  return { title, at: Math.floor(parisTime(y, m, d, 10, 0).getTime() / 1000), minutes, kind, guessed: true, vague: false, dateToChoose: true, phrase: null };
}
