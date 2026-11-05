// Agenda : un lien iCal secret (abonnement Google Agenda, Apple Calendrier, Outlook) qui affiche les prochaines actions des
// prospects et les posts LinkedIn programmés. Le lien est un secret (quiconque l'a lit l'agenda) : chiffré en base, régénérable.
import { randomBytes } from 'node:crypto';
import { now } from '../db.js';
import { encrypt, decrypt, hashSid } from '../crypto.js';
import { accessibleProjects } from '../mailroutes.js';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** (Re)crée le lien : l'ancien cesse aussitôt de fonctionner. @returns {Promise<string>} le jeton */
export async function createFeed(app, userId) {
  const token = randomBytes(32).toString('base64url');
  await app.db.prepare('DELETE FROM ical_feeds WHERE user_id = ?').run(Number(userId));
  await app.db.prepare('INSERT INTO ical_feeds(user_id, token_hash, token_enc, created_at) VALUES(?, ?, ?, ?)')
    .run(Number(userId), hashSid(token), encrypt(app.cfg.secretKey, token), now());
  return token;
}

export const deleteFeed = (app, userId) => app.db.prepare('DELETE FROM ical_feeds WHERE user_id = ?').run(Number(userId));

/** Jeton actuel du compte (pour réafficher le lien), ou null. */
export async function feedToken(app, userId) {
  const row = await app.db.prepare('SELECT token_enc FROM ical_feeds WHERE user_id = ?').get(Number(userId));
  try { return row ? decrypt(app.cfg.secretKey, row.token_enc) : null; } catch { return null; }
}

export const feedUrl = (cfg, token) => `${cfg.appUrl}/cal/${token}.ics`;

/** Compte propriétaire d'un jeton de lien (compte actif seulement), ou null. */
export async function userOfFeed(db, token) {
  if (!TOKEN_RE.test(String(token))) return null;
  const row = await db.prepare(`SELECT f.user_id FROM ical_feeds f JOIN users u ON u.id = f.user_id WHERE f.token_hash = ? AND u.status = 'active'`).get(hashSid(token));
  return row ? Number(row.user_id) : null;
}

// ---------- Fabrication du fichier .ics (RFC 5545) ----------

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
const stamp = (ts) => new Date(ts * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Lignes de 75 octets au plus, repliées avec CRLF + espace (sans couper un caractère UTF-8 en deux)
function fold(line) {
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** @param {{uid:string, at:number, minutes?:number, title:string, description?:string}[]} events */
export function buildIcs(events, { name = 'iaboss', at = now() } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//iaboss//Agenda//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`, 'X-WR-TIMEZONE:Europe/Paris', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp(at)}`, `DTSTART:${stamp(e.at)}`, `DTEND:${stamp(e.at + (e.minutes || 30) * 60)}`,
      `SUMMARY:${esc(e.title).slice(0, 200)}`, ...(e.description ? [`DESCRIPTION:${esc(e.description).slice(0, 1000)}`] : []), 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Les événements d'un compte : prochaines actions (30 jours en arrière, 1 an en avant) et posts LinkedIn programmés ou publiés récemment. */
export async function eventsFor(app, userId, { at = now(), host = 'aitools' } = {}) {
  const { db } = app;
  const events = [];
  const ids = (await accessibleProjects(db, userId)).map((p) => Number(p.id));
  const marks = ids.length ? ids.map(() => '?').join(',') : 'NULL'; // « IN (NULL) » : aucune ligne, les événements ajoutés à la main restent
  for (const r of await db.prepare(`SELECT x.id, x.company, x.next_action, x.next_action_at, p.name project FROM prospects x JOIN projects p ON p.id = x.project_id
      WHERE x.project_id IN (${marks}) AND x.next_action_at IS NOT NULL AND x.next_action_at BETWEEN ? AND ? ORDER BY x.next_action_at LIMIT 1000`).all(...ids, at - 30 * 86400, at + 365 * 86400)) {
    events.push({ uid: `action-${r.id}-${r.next_action_at}@${host}`, at: Number(r.next_action_at), minutes: 30, title: `${r.next_action} : ${r.company}`, description: `Projet ${r.project}` });
  }
  for (const r of await db.prepare(`SELECT l.id, l.body, l.scheduled_at, p.name project FROM linkedin_posts l JOIN projects p ON p.id = l.project_id
      WHERE l.project_id IN (${marks}) AND l.status = 'scheduled' AND l.scheduled_at IS NOT NULL ORDER BY l.scheduled_at LIMIT 500`).all(...ids)) {
    events.push({ uid: `linkedin-${r.id}-${r.scheduled_at}@${host}`, at: Number(r.scheduled_at), minutes: 15, title: `Post LinkedIn programmé : ${r.project}`, description: String(r.body).slice(0, 300) });
  }
  for (const r of await db.prepare('SELECT id, title, notes, starts_at, minutes FROM calendar_events WHERE user_id = ? AND starts_at BETWEEN ? AND ? ORDER BY starts_at LIMIT 1000').all(Number(userId), at - 30 * 86400, at + 365 * 86400)) {
    events.push({ uid: `event-${r.id}@${host}`, at: Number(r.starts_at), minutes: Number(r.minutes), title: r.title, description: r.notes || '' });
  }
  return events.sort((a, b) => a.at - b.at);
}
