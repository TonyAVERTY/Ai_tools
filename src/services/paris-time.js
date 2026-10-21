// Heures "murales" de Paris, changements d'heure compris. Aucune dépendance.
const TZ = 'Europe/Paris';

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
});
const offsetFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' });

/** @returns {{year:number, month:number, day:number, hour:number, minute:number, weekday:string}} */
export function parisParts(date = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, weekday: p.weekday };
}

// Décalage de Paris par rapport à UTC à un instant donné, en minutes (+60 l'hiver, +120 l'été)
function offsetMinutes(date) {
  const name = offsetFmt.formatToParts(date).find((x) => x.type === 'timeZoneName')?.value || 'GMT';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
}

/** Heure murale à Paris → instant. */
export function parisTime(year, month, day, hour, minute = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let t = guess - offsetMinutes(new Date(guess)) * 60_000;
  t = guess - offsetMinutes(new Date(t)) * 60_000; // 2e passe : correct autour du changement d'heure
  return new Date(t);
}

/** Même heure murale, N jours plus tard. */
export function addParisDays(date, days) {
  const p = parisParts(date);
  const noon = parisTime(p.year, p.month, p.day, 12);
  const q = parisParts(new Date(noon.getTime() + days * 86_400_000));
  return { year: q.year, month: q.month, day: q.day };
}

// Créneau de nuit : le Pi est au frais et le quota Claude n'est pas utilisé par toi
export const NIGHT = { start: 1, end: 6 };

/** Prochain début de créneau de nuit (ou maintenant si on y est déjà). */
export function nextNightSlot(date = new Date()) {
  const p = parisParts(date);
  if (p.hour >= NIGHT.start && p.hour < NIGHT.end) return date;
  const d = p.hour < NIGHT.start ? p : addParisDays(date, 1);
  return parisTime(d.year, d.month, d.day, NIGHT.start);
}
