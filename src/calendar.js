// Calendrier : page mensuelle (prochaines actions, posts LinkedIn programmés et publiés) et lien d'abonnement iCal.
import { HttpError, html, redirect, send, readBody } from './http.js';
import { now } from './db.js';
import { esc } from './http.js';
import { layout } from './views.js';
import { ic } from './icons.js';
import { icalBox } from './icalview.js';
import { accessibleProjects } from './mailroutes.js';
import { parisParts, parisTime } from './services/paris-time.js';
import { eventLinks, DURATIONS } from './events.js';
import { createFeed, deleteFeed, feedToken, feedUrl, userOfFeed, buildIcs, eventsFor } from './services/ical.js';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ts) => { const p = parisParts(new Date(ts * 1000)); return `${pad(p.hour)}:${pad(p.minute)}`; };

/** Événements du mois affiché, classés par jour (heure de Paris). */
export async function monthEvents(db, ids, year, month, userId = null) {
  const start = Math.floor(parisTime(year, month, 1, 0).getTime() / 1000);
  const end = Math.floor((month === 12 ? parisTime(year + 1, 1, 1, 0) : parisTime(year, month + 1, 1, 0)).getTime() / 1000);
  const byDay = new Map();
  const add = (ts, ev) => { const d = parisParts(new Date(ts * 1000)).day; (byDay.get(d) || byDay.set(d, []).get(d)).push({ ...ev, at: ts }); };
  if (userId != null) {
    for (const r of await db.prepare('SELECT id, title, notes, minutes, starts_at FROM calendar_events WHERE user_id = ? AND starts_at >= ? AND starts_at < ?').all(Number(userId), start, end)) add(Number(r.starts_at), { kind: 'event', label: r.title, project: 'Événement', event: { id: Number(r.id), title: r.title, notes: r.notes, minutes: r.minutes, starts_at: Number(r.starts_at) } });
  }
  if (!ids.length) { for (const list of byDay.values()) list.sort((a, b) => a.at - b.at); return byDay; }
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
const KIND_LABEL = { event: 'Événement', action: 'Action', scheduled: 'LinkedIn programmé', published: 'LinkedIn publié' };

/**
 * « À venir » : ce qui est réellement prévu à partir de maintenant (une heure de marge), tous types confondus, dans l'ordre.
 * Même source que la grille (monthEvents) sur le mois en cours et le suivant : aucun événement n'est inventé, la liste peut être vide.
 */
export async function agendaUpcoming(db, ids, userId, { at = now(), limit = 8 } = {}) {
  const t = parisParts(new Date(at * 1000));
  const [ny, nm] = t.month === 12 ? [t.year + 1, 1] : [t.year, t.month + 1];
  const out = [];
  for (const [y, m] of [[t.year, t.month], [ny, nm]]) for (const list of (await monthEvents(db, ids, y, m, userId)).values()) out.push(...list);
  return out.filter((e) => e.at >= at - 3600).sort((a, b) => a.at - b.at).slice(0, limit);
}
const dayHead = (ts) => new Date(ts * 1000).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });

export function calendarPage({ email, year, month, byDay, feed, today, agenda = [], error = null }) {
  const first = parisParts(parisTime(year, month, 1, 12));
  const lead = (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(first.weekday) + 7) % 7;
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prev = month === 1 ? [year - 1, 12] : [year, month - 1];
  const next = month === 12 ? [year + 1, 1] : [year, month + 1];
  const cells = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const isToday = (d) => today.year === year && today.month === month && today.day === d;
  const isPast = (d) => year < today.year || (year === today.year && (month < today.month || (month === today.month && d < today.day)));
  const grid = cells.map((d, i) => (d === null ? '<div class="cal-cell off"></div>' : `<div class="cal-cell${isToday(d) ? ' today' : isPast(d) ? ' past' : ''}${(byDay.get(d) || []).length ? ' has' : ''}"${isToday(d) ? ' aria-current="date"' : ''}>
      <span class="cal-d">${d}<span class="cal-wd"> ${DAYS[i % 7]} ${MONTHS[month - 1]}</span>${isToday(d) ? '<span class="sr-only"> (aujourd\'hui)</span>' : ''}</span>
      ${(byDay.get(d) || []).map((e) => `<div class="cal-ev ${e.kind}" title="${esc(`${e.project} · ${e.label}`)}"><span class="cal-t">${esc(hhmm(e.at))}</span> ${esc(e.label)}</div>`).join('')}</div>`)).join('');

  // « À venir » : regroupé par jour ; un événement ajouté à la main garde ses actions (agenda externe, suppression)
  let lastDay = '';
  const agendaItems = agenda.map((e) => {
    const head = dayHead(e.at);
    const h = head === lastDay ? '' : `<li class="ag-day" aria-hidden="true">${esc(head)}</li>`;
    lastDay = head;
    const acts = e.event ? (() => {
      const l = eventLinks(e.event);
      return `<div class="ag-act"><a href="${esc(l.google)}" target="_blank" rel="noopener noreferrer">Google Agenda</a><a href="${esc(l.ics)}">Fichier .ics</a>
        <form method="post" action="/calendar/events/${e.event.id}/delete"><button class="ag-del" aria-label="Supprimer ${esc(e.label)}" title="Supprimer">${ic('trash', 'ic-s')}</button></form></div>`;
    })() : '';
    return `${h}<li class="ag-i"><time datetime="${new Date(e.at * 1000).toISOString()}">${esc(hhmm(e.at))}</time><div><b>${esc(e.label)}</b><span class="td-s">${esc(KIND_LABEL[e.kind] || '')}${e.kind === 'event' ? '' : ` · ${esc(e.project)}`}</span>${e.event?.notes ? `<span class="td-s">${esc(e.event.notes)}</span>` : ''}${acts}</div></li>`;
  }).join('');
  const feedBox = icalBox(feed.url, '/calendar');
  return layout({
    title: 'Calendrier', email,
    body: `<div class="cal-page">
<div class="cal-layout">
<section class="card cal-main" aria-labelledby="h-cal">
  <div class="row-between"><h1 id="h-cal">Calendrier</h1>
    <nav class="row" aria-label="Mois"><a class="btn small" href="/calendar?m=${prev[0]}-${pad(prev[1])}">← ${MONTHS[prev[1] - 1]}</a><strong>${MONTHS[month - 1]} ${year}</strong><a class="btn small" href="/calendar?m=${next[0]}-${pad(next[1])}">${MONTHS[next[1] - 1]} →</a></nav></div>
  <div class="cal"><div class="cal-head">${DAYS.map((d) => `<span>${d}</span>`).join('')}</div><div class="cal-grid">${grid}</div></div>
  <p class="muted small">Heures de Paris. Les posts LinkedIn se programment depuis le projet (section LinkedIn).</p>
</section>
<aside class="cal-side">
<section class="card" aria-labelledby="h-agenda">
  <div class="card-h"><h2 id="h-agenda">À venir</h2></div>
  ${agenda.length ? `<ul class="agenda">${agendaItems}</ul>` : '<p class="muted">Rien de prévu pour l\'instant. Les rendez-vous, les prochaines actions sur tes prospects et les posts LinkedIn programmés apparaissent ici.</p>'}
</section>
<section class="card" id="evenements" aria-labelledby="h-ev">
  <div class="card-h"><h2 id="h-ev">Ajouter un événement</h2><p>Un rendez-vous, un appel ou un rappel. Quand un prospect te répond avec une date, AiTools te propose de l'ajouter d'un clic (popup et page Mails).</p></div>
  ${error ? `<p class="msg msg-err" role="alert">${esc(error)}</p>` : ''}
  <form method="post" action="/calendar/events" class="cfg evform">
    <label class="field"><span class="lbl">Titre</span><input name="title" maxlength="200" required placeholder="ex. Appel avec Boulangerie Dupont"></label>
    <div class="grid2">
      <label class="field"><span class="lbl">Date</span><input type="date" name="date" required value="${esc(`${today.year}-${pad(today.month)}-${pad(today.day)}`)}"></label>
      <label class="field"><span class="lbl">Heure (Paris)</span><input type="time" name="time" required value="10:00"></label>
    </div>
    <label class="field"><span class="lbl">Durée</span><span class="sel"><select name="minutes">${DURATIONS.map((m) => `<option value="${m}"${m === 30 ? ' selected' : ''}>${m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? ` ${m % 60}` : ''}`}</option>`).join('')}</select>${ic('down')}</span></label>
    <label class="field"><span class="lbl">Notes (facultatif)</span><textarea name="notes" rows="2" maxlength="1000"></textarea></label>
    <div class="row"><button class="btn primary">${ic('plus')}Ajouter à mon calendrier</button></div>
  </form>
</section>
<section class="card" aria-labelledby="h-ext">
  <div class="card-h"><h2 id="h-ext">Agenda externe</h2></div>
  ${feedBox}
</section>
</aside>
</div>
</div>`,
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
    const agenda = await agendaUpcoming(db, ids, session.userId);
    html(res, calendarPage({ email: session.email, year, month, byDay: await monthEvents(db, ids, year, month, session.userId), feed: { url: token ? feedUrl(cfg, token) : null }, today: t, agenda, error: url.searchParams.get('e') }));
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
