// Calendrier : page mensuelle (prochaines actions, posts LinkedIn programmés et publiés) et lien d'abonnement iCal.
import { HttpError, html, redirect, send, readBody } from './http.js';
import { now } from './db.js';
import { esc } from './http.js';
import { layout } from './views.js';
import { ic } from './icons.js';
import { icalBox } from './icalview.js';
import { accessibleProjects } from './mailroutes.js';
import { parisParts, parisTime } from './services/paris-time.js';
import { createFeed, deleteFeed, feedToken, feedUrl, userOfFeed, buildIcs, eventsFor } from './services/ical.js';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ts) => { const p = parisParts(new Date(ts * 1000)); return `${pad(p.hour)}:${pad(p.minute)}`; };

/** Événements du mois affiché, classés par jour (heure de Paris). */
export async function monthEvents(db, ids, year, month) {
  const start = Math.floor(parisTime(year, month, 1, 0).getTime() / 1000);
  const end = Math.floor((month === 12 ? parisTime(year + 1, 1, 1, 0) : parisTime(year, month + 1, 1, 0)).getTime() / 1000);
  const byDay = new Map();
  const add = (ts, ev) => { const d = parisParts(new Date(ts * 1000)).day; (byDay.get(d) || byDay.set(d, []).get(d)).push({ ...ev, at: ts }); };
  if (!ids.length) return byDay;
  const marks = ids.map(() => '?').join(',');
  for (const r of await db.prepare(`SELECT x.company, x.next_action, x.next_action_at, p.name project FROM prospects x JOIN projects p ON p.id = x.project_id
      WHERE x.project_id IN (${marks}) AND x.next_action_at >= ? AND x.next_action_at < ?`).all(...ids, start, end)) {
    add(Number(r.next_action_at), { kind: 'action', label: `${r.next_action} : ${r.company}`, project: r.project });
  }
  for (const r of await db.prepare(`SELECT l.body, l.status, l.scheduled_at, l.published_at, p.name project FROM linkedin_posts l JOIN projects p ON p.id = l.project_id
      WHERE l.project_id IN (${marks}) AND ((l.status = 'scheduled' AND l.scheduled_at >= ? AND l.scheduled_at < ?) OR (l.status = 'published' AND l.published_at >= ? AND l.published_at < ?))`).all(...ids, start, end, start, end)) {
    const published = r.status === 'published';
    add(Number(published ? r.published_at : r.scheduled_at), { kind: published ? 'published' : 'scheduled', label: String(r.body).replace(/\s+/g, ' ').slice(0, 90), project: r.project });
  }
  for (const list of byDay.values()) list.sort((a, b) => a.at - b.at);
  return byDay;
}

const KIND = { action: ['Action', 'ic-action'], scheduled: ['LinkedIn programmé', 'warn'], published: ['LinkedIn publié', 'ok'] };

export function calendarPage({ email, year, month, byDay, feed, today }) {
  const first = parisParts(parisTime(year, month, 1, 12));
  const lead = (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(first.weekday) + 7) % 7;
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prev = month === 1 ? [year - 1, 12] : [year, month - 1];
  const next = month === 12 ? [year + 1, 1] : [year, month + 1];
  const cells = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const isToday = (d) => today.year === year && today.month === month && today.day === d;
  const grid = cells.map((d) => (d === null ? '<div class="cal-cell off"></div>' : `<div class="cal-cell${isToday(d) ? ' today' : ''}">
      <span class="cal-d">${d}</span>
      ${(byDay.get(d) || []).map((e) => `<div class="cal-ev ${e.kind}" title="${esc(`${e.project} · ${e.label}`)}"><span class="cal-t">${esc(hhmm(e.at))}</span> ${esc(e.label)}</div>`).join('')}</div>`)).join('');
  const feedBox = icalBox(feed.url, '/calendar');
  return layout({
    title: 'Calendrier', email,
    body: `<section class="card">
  <div class="row-between"><h1>${ic('clock')}Calendrier</h1>
    <nav class="row" aria-label="Mois"><a class="btn small" href="/calendar?m=${prev[0]}-${pad(prev[1])}">← ${MONTHS[prev[1] - 1]}</a><strong>${MONTHS[month - 1]} ${year}</strong><a class="btn small" href="/calendar?m=${next[0]}-${pad(next[1])}">${MONTHS[next[1] - 1]} →</a></nav></div>
  <div class="cal"><div class="cal-head">${DAYS.map((d) => `<span>${d}</span>`).join('')}</div><div class="cal-grid">${grid}</div></div>
  <p class="muted small">Heures de Paris. Les posts LinkedIn se programment depuis le projet (section LinkedIn).</p>
</section>
<section class="card">
  <div class="card-h"><h2>Agenda externe</h2></div>
  ${feedBox}
</section>`,
  });
}

export function registerCalendarRoutes(router, app) {
  const { db, cfg } = app;

  router.get('/calendar', async ({ res, url, session }) => {
    const t = parisParts(new Date());
    const m = /^(\d{4})-(\d{2})$/.exec(url.searchParams.get('m') || '');
    const year = m && +m[1] >= 2020 && +m[1] <= 2100 && +m[2] >= 1 && +m[2] <= 12 ? +m[1] : t.year;
    const month = m && year === +m[1] && +m[2] >= 1 && +m[2] <= 12 ? +m[2] : t.month;
    const ids = (await accessibleProjects(db, session.userId)).map((p) => Number(p.id));
    const token = await feedToken(app, session.userId);
    html(res, calendarPage({ email: session.email, year, month, byDay: await monthEvents(db, ids, year, month), feed: { url: token ? feedUrl(cfg, token) : null }, today: t }));
  });

  // Retour sur la page d'où vient l'action (liste blanche : jamais une adresse arbitraire)
  const back = (b) => (b.back === '/account' ? '/account' : '/calendar');
  router.post('/calendar/feed', async ({ req, res, session }) => { const b = await readBody(req); await createFeed(app, session.userId); redirect(res, back(b)); }, { limit: 'link' });
  router.post('/calendar/feed/delete', async ({ req, res, session }) => { const b = await readBody(req); await deleteFeed(app, session.userId); redirect(res, back(b)); }, { limit: 'link' });

  // Abonnement des agendas : public (pas de cookie), le jeton du lien fait foi ; 404 identique pour tout lien inconnu
  router.get('/cal/:file', async ({ res, params }) => {
    const token = String(params.file).replace(/\.ics$/, '');
    const userId = await userOfFeed(db, token);
    if (!userId) throw new HttpError(404, 'Page introuvable');
    const host = new URL(cfg.appUrl).host;
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', 'inline; filename="aitools.ics"');
    send(res, 200, buildIcs(await eventsFor(app, userId, { host }), { name: 'AiTools', at: now() }), 'text/calendar; charset=utf-8');
  }, { public: true, limit: 'ical' });
}
