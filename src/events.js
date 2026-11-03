// Événements de l'agenda : création à la main ou depuis une réponse de prospect, liens d'ajout (Google Agenda, fichier .ics), routes.
import { HttpError, json, redirect, readBody, send } from './http.js';
import { now } from './db.js';
import { accessibleProjects } from './mailroutes.js';
import { parisTime, parisParts } from './services/paris-time.js';
import { buildIcs } from './services/ical.js';
import { suggestEvent } from './services/dates.js';

const MAX_TITLE = 200;
export const DURATIONS = [15, 30, 45, 60, 90, 120];

const pad = (n) => String(n).padStart(2, '0');
/** « 2026-11-03T14:00 » (heure de Paris) → secondes Unix, ou null si illisible. */
export function parseParisLocal(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const dt = parisTime(y, mo, d, h, mi);
  const p = parisParts(dt);
  if (p.year !== y || p.month !== mo || p.day !== d) return null; // 31 novembre…
  return Math.floor(dt.getTime() / 1000);
}
/** Secondes Unix → « 2026-11-03T14:00 » en heure de Paris (valeur d'un champ datetime-local). */
export function toParisLocal(ts) {
  const p = parisParts(new Date(ts * 1000));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const stamp = (ts) => new Date(ts * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Liens pour ajouter l'événement à SON agenda : Google Agenda (lien direct) et fichier .ics (Apple, Outlook, Android). */
export function eventLinks(ev) {
  const g = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${stamp(ev.starts_at)}/${stamp(ev.starts_at + ev.minutes * 60)}`, ...(ev.notes ? { details: ev.notes } : {}) });
  return { google: `https://calendar.google.com/calendar/render?${g}`, ics: `/calendar/event/${ev.id}.ics` };
}

const shape = (e) => ({ id: Number(e.id), title: e.title, notes: e.notes || '', startsAt: Number(e.starts_at), minutes: Number(e.minutes), projectId: e.project_id == null ? null : Number(e.project_id), prospectId: e.prospect_id == null ? null : Number(e.prospect_id), replyId: e.reply_id == null ? null : Number(e.reply_id) });

function validate({ title, at, minutes }, { clock = now() } = {}) {
  const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  if (!t) throw new HttpError(400, "Donne un titre à l'événement", { expose: true });
  if (!Number.isFinite(at)) throw new HttpError(400, 'Date et heure invalides', { expose: true });
  if (at < clock - 86400 || at > clock + 3 * 365 * 86400) throw new HttpError(400, 'Choisis une date entre hier et dans trois ans', { expose: true });
  const m = Math.floor(Number(minutes));
  return { title: t, at, minutes: DURATIONS.includes(m) ? m : 30 };
}

export async function createEvent(db, userId, { title, at, minutes, notes = '', projectId = null, prospectId = null, replyId = null }) {
  const v = validate({ title, at, minutes });
  const r = await db.prepare('INSERT INTO calendar_events(user_id, project_id, prospect_id, reply_id, title, notes, starts_at, minutes, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(Number(userId), projectId, prospectId, replyId, v.title, String(notes || '').slice(0, 1000) || null, v.at, v.minutes, now());
  return Number(r.lastInsertRowid);
}

export async function listEvents(db, userId, { from, to, limit = 200 }) {
  return (await db.prepare('SELECT * FROM calendar_events WHERE user_id = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at LIMIT ?').all(Number(userId), from, to, limit)).map(shape);
}

/** Proposition pour une réponse : null si rien à proposer, sinon ce que l'interface préremplit. `event` : déjà ajouté ? */
export async function suggestionFor(db, userId, reply) {
  const existing = await db.prepare('SELECT * FROM calendar_events WHERE user_id = ? AND reply_id = ? ORDER BY id LIMIT 1').get(Number(userId), Number(reply.id));
  if (existing) return { suggestion: null, event: { ...shape(existing), links: eventLinks(existing) } };
  const s = suggestEvent({ subject: reply.subject, text: reply.text, intent: reply.intent, company: reply.company, from: reply.from, receivedAt: reply.receivedAt });
  if (!s) return { suggestion: null, event: null };
  return { suggestion: { title: s.title, whenLocal: toParisLocal(s.at), minutes: s.minutes, kind: s.kind, guessed: s.guessed, vague: s.vague, dateToChoose: s.dateToChoose, phrase: s.phrase }, event: null };
}

export function registerEventRoutes(router, app) {
  const { db } = app;
  const mine = async (userId) => (await accessibleProjects(db, userId)).map((p) => Number(p.id));

  // Ajouter à l'agenda depuis une réponse : l'utilisateur confirme (et corrige) le titre, la date et l'heure
  router.post('/api/replies/:id/event', async ({ req, res, params, session }) => {
    const ids = await mine(session.userId);
    const r = ids.length ? await db.prepare(`SELECT r.id, r.project_id, r.prospect_id FROM replies r WHERE r.id = ? AND r.project_id IN (${ids.map(() => '?').join(',')})`).get(Number(params.id), ...ids) : null;
    if (!r) throw new HttpError(404, 'Réponse introuvable');
    const b = await readBody(req);
    const dup = await db.prepare('SELECT * FROM calendar_events WHERE user_id = ? AND reply_id = ?').get(session.userId, r.id);
    if (dup) return json(res, { ok: true, existing: true, event: { ...shape(dup), links: eventLinks(dup) } });
    const at = parseParisLocal(b.when);
    const id = await createEvent(db, session.userId, { title: b.title, at, minutes: b.minutes, notes: b.notes, projectId: Number(r.project_id), prospectId: r.prospect_id == null ? null : Number(r.prospect_id), replyId: Number(r.id) });
    const ev = await db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id);
    json(res, { ok: true, existing: false, event: { ...shape(ev), links: eventLinks(ev) } }, 201);
  }, { limit: 'event' });

  // Formulaire de la page Calendrier
  router.post('/calendar/events', async ({ req, res, session }) => {
    const b = await readBody(req);
    let id;
    try {
      id = await createEvent(db, session.userId, { title: b.title, at: parseParisLocal(`${b.date}T${b.time}`), minutes: b.minutes, notes: b.notes });
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      return redirect(res, `/calendar?e=${encodeURIComponent(e.message)}`);
    }
    // `nouveau` : l'événement qu'on vient d'ajouter, surligné un instant dans « À venir » (la page ne montre que ceux du compte : un autre numéro ne surligne rien)
    redirect(res, `/calendar?m=${String(b.date).slice(0, 7)}&nouveau=${id}`);
  }, { limit: 'event' });

  router.post('/calendar/events/:id/delete', async ({ res, params, session }) => {
    await db.prepare('DELETE FROM calendar_events WHERE id = ? AND user_id = ?').run(Number(params.id), session.userId);
    redirect(res, '/calendar');
  }, { limit: 'event' });

  // Un événement, en fichier .ics (Apple Calendrier, Outlook, Android…)
  router.get('/calendar/event/:file', async ({ res, params, session }) => {
    const id = Number(String(params.file).replace(/\.ics$/, ''));
    const e = Number.isInteger(id) ? await db.prepare('SELECT * FROM calendar_events WHERE id = ? AND user_id = ?').get(id, session.userId) : null;
    if (!e) throw new HttpError(404, 'Événement introuvable');
    res.setHeader('Content-Disposition', 'attachment; filename="evenement.ics"');
    send(res, 200, buildIcs([{ uid: `event-${e.id}@${new URL(app.cfg.appUrl).host}`, at: Number(e.starts_at), minutes: Number(e.minutes), title: e.title, description: e.notes || '' }], { name: 'AiTools' }), 'text/calendar; charset=utf-8');
  });
}

