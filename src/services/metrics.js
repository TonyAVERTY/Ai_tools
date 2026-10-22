// Historique : photo quotidienne des KPI business (la BDD des projets ne les historise pas)
// + prospection recalculée depuis nos propres journaux (rien à stocker en plus).
import { now } from '../db.js';
import { getProject } from '../projects.js';
import { fetchRecap } from './recap.js';
import { pinDb } from '../netguard.js';
import { parisParts, parisTime, addParisDays } from './paris-time.js';

const pad = (n) => String(n).padStart(2, '0');
export const parisDay = (date = new Date()) => { const p = parisParts(date); return `${p.year}-${pad(p.month)}-${pad(p.day)}`; };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function saveSnapshot(db, projectId, business, { date = new Date() } = {}) {
  await db.prepare(`INSERT INTO metrics_daily(project_id, day, users, clients, revenue) VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(project_id, day) DO UPDATE SET users = excluded.users, clients = excluded.clients, revenue = excluded.revenue`)
    .run(projectId, parisDay(date), num(business.users), num(business.clients), num(business.revenue));
}

/** Une photo par projet et par jour, appelée par le planificateur (toutes les 15 min, ne fait rien si déjà prise). */
export async function snapshotAll(app, { date = new Date(), log = console } = {}) {
  const day = parisDay(date);
  const todo = await app.db.prepare(`SELECT p.id, p.user_id FROM projects p JOIN users u ON u.id = p.user_id
    WHERE p.db_enc IS NOT NULL AND u.status = 'active'
    AND p.id NOT IN (SELECT project_id FROM metrics_daily WHERE day = ?)`).all(day);
  let n = 0;
  for (const { id, user_id: userId } of todo) {
    try {
      const p = await getProject(app, id, { userId, secrets: true });
      await saveSnapshot(app.db, id, await (app.fetchRecap || fetchRecap)(id, await pinDb(app, userId, p.dbCfg), { force: true }), { date });
      n++;
    } catch (e) { log.error(`[métriques ${id}]`, e.message); }
  }
  return n;
}

// Lundi (heure de Paris) de la semaine qui contient cet instant
function weekStart(date) {
  const p = parisParts(date);
  const back = ({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 })[p.weekday];
  const d = addParisDays(date, -back);
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

/** Séries pour les graphiques : jours (KPI business) et semaines (envois / réponses). */
export async function history(db, projectId, { days = 30, at = now() } = {}) {
  const fromDay = parisDay(new Date((at - (days - 1) * 86400) * 1000));
  const daily = await db.prepare('SELECT day, users, clients, revenue FROM metrics_daily WHERE project_id = ? AND day >= ? ORDER BY day')
    .all(projectId, fromDay);

  const nWeeks = Math.ceil(days / 7);
  const weeks = [];
  let cursor = new Date(at * 1000);
  for (let i = 0; i < nWeeks; i++) {
    weeks.unshift({ start: weekStart(cursor), sent: 0, replies: 0 });
    cursor = new Date(cursor.getTime() - 7 * 86_400_000);
  }
  const first = weeks[0].start.split('-').map(Number);
  const since = Math.floor(parisTime(first[0], first[1], first[2], 0).getTime() / 1000);
  const bucket = (ts) => weeks.find((w) => w.start === weekStart(new Date(ts * 1000)));
  for (const r of await db.prepare("SELECT sent_at FROM mail_log WHERE project_id = ? AND kind = 'initial' AND error IS NULL AND sent_at >= ?").all(projectId, since)) {
    const w = bucket(r.sent_at); if (w) w.sent++;
  }
  for (const r of await db.prepare('SELECT replied_at FROM prospects WHERE project_id = ? AND replied_at >= ?').all(projectId, since)) {
    const w = bucket(r.replied_at); if (w) w.replies++;
  }
  return { daily, weeks };
}
