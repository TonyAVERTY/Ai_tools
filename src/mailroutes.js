// Page « Mails » (envoyés, réponses classées par intention) et API des réponses (popup d'arrivée dans le panel).
import { HttpError, html, json } from './http.js';
import { now } from './db.js';
import { memberTeamIds } from './teams.js';
import { getProject } from './projects.js';
import { INTENTS, draftReply } from './services/replies.js';
import { mailsPage } from './mailviews.js';
import { suggestionFor } from './events.js';

const PAGE_SIZE = 50;
export const SENT_STATES = {
  sent: 'Envoyé', read: 'Lu (accusé)', replied: 'Répondu', bounced: 'Rejeté', refused: 'Refus', failed: 'Non envoyé',
};

// État d'un envoi, tel qu'on le lit dans l'historique : le journal d'envoi + le statut actuel du prospect
const STATE_SQL = {
  failed: 'm.error IS NOT NULL',
  replied: "m.error IS NULL AND x.status IN ('replied', 'client')",
  read: "m.error IS NULL AND m.read_at IS NOT NULL AND (x.status IS NULL OR x.status NOT IN ('replied', 'client', 'bounced', 'refused'))",
  bounced: "m.error IS NULL AND x.status = 'bounced'",
  refused: "m.error IS NULL AND x.status = 'refused'",
  sent: "m.error IS NULL AND m.read_at IS NULL AND (x.status IS NULL OR x.status NOT IN ('replied', 'client', 'bounced', 'refused'))",
};
export const stateOf = (row) => (row.error ? 'failed'
  : ['replied', 'client'].includes(row.status) ? 'replied' : row.status === 'bounced' ? 'bounced' : row.status === 'refused' ? 'refused' : row.read_at ? 'read' : 'sent');

/** Projets auxquels la personne a accès : les siens, puis ceux que son équipe partage. */
export async function accessibleProjects(db, userId) {
  const teams = await memberTeamIds(db, userId);
  return teams.length
    ? db.prepare(`SELECT id, name FROM projects WHERE user_id = ? OR team_id IN (${teams.map(() => '?').join(',')}) ORDER BY LOWER(name)`).all(Number(userId), ...teams)
    : db.prepare('SELECT id, name FROM projects WHERE user_id = ? ORDER BY LOWER(name)').all(Number(userId));
}

export function registerMailRoutes(router, app) {
  const { db } = app;
  const myProjects = (userId) => accessibleProjects(db, userId);
  const inList = (ids) => ids.map(() => '?').join(',');

  // Nom d'expéditeur du projet pour signer le brouillon (lisible seulement par le propriétaire et les administrateurs)
  const senders = new Map();
  const senderName = async (projectId, userId) => {
    const key = `${projectId}:${userId}`;
    if (!senders.has(key)) {
      senders.set(key, getProject(app, projectId, { userId, secrets: true }).then((p) => p.smtp?.fromName || '').catch(() => ''));
      setTimeout(() => senders.delete(key), 60_000).unref?.();
    }
    return senders.get(key);
  };

  const shapeReply = async (r, userId) => {
    const out = {
      id: Number(r.id), projectId: Number(r.project_id), project: r.project, from: r.from_email, company: r.company || null,
      subject: r.subject || '', text: r.body || '', intent: r.intent, intentLabel: INTENTS[r.intent] || INTENTS.other,
      draft: draftReply(r.intent, { company: r.company, senderName: await senderName(r.project_id, userId) }),
      receivedAt: Number(r.received_at), seen: !!r.seen_at,
    };
    // Date, appel ou rendez-vous évoqué : une proposition à ajouter à l'agenda (ou l'événement déjà ajouté)
    return { ...out, ...(await suggestionFor(db, userId, out)) };
  };
  const REPLY_SELECT = `SELECT r.*, p.name project, x.company FROM replies r JOIN projects p ON p.id = r.project_id
    LEFT JOIN prospects x ON x.id = r.prospect_id`;

  // Réponses : les nouvelles (popup) ou la liste complète
  router.get('/api/replies', async ({ res, url, session }) => {
    const ids = (await myProjects(session.userId)).map((p) => Number(p.id));
    if (!ids.length) return json(res, { unseen: 0, replies: [] });
    const unseen = Number((await db.prepare(`SELECT COUNT(*) n FROM replies WHERE seen_at IS NULL AND project_id IN (${inList(ids)})`).get(...ids)).n);
    const only = url.searchParams.get('unseen') === '1';
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit')) || 10));
    const rows = await db.prepare(`${REPLY_SELECT} WHERE r.project_id IN (${inList(ids)})${only ? ' AND r.seen_at IS NULL' : ''}
      ORDER BY r.received_at DESC, r.id DESC LIMIT ?`).all(...ids, limit);
    json(res, { unseen, replies: await Promise.all(rows.map((r) => shapeReply(r, session.userId))) });
  });

  router.post('/api/replies/:id/seen', async ({ res, params, session }) => {
    const ids = (await myProjects(session.userId)).map((p) => Number(p.id));
    const r = ids.length ? await db.prepare(`SELECT id FROM replies WHERE id = ? AND project_id IN (${inList(ids)})`).get(Number(params.id), ...ids) : null;
    if (!r) throw new HttpError(404, 'Réponse introuvable');
    await db.prepare('UPDATE replies SET seen_at = ? WHERE id = ? AND seen_at IS NULL').run(now(), r.id);
    json(res, { ok: true });
  });

  router.post('/api/replies/seen-all', async ({ res, session }) => {
    const ids = (await myProjects(session.userId)).map((p) => Number(p.id));
    if (ids.length) await db.prepare(`UPDATE replies SET seen_at = ? WHERE seen_at IS NULL AND project_id IN (${inList(ids)})`).run(now(), ...ids);
    json(res, { ok: true });
  });

  // Page « Mails »
  router.get('/mails', async ({ res, url, session }) => {
    const projects = await myProjects(session.userId);
    const ids = projects.map((p) => Number(p.id));
    const sp = url.searchParams;
    const view = sp.get('v') === 'replies' ? 'replies' : 'sent';
    const project = ids.includes(Number(sp.get('project'))) ? Number(sp.get('project')) : null;
    const scope = project ? [project] : ids;
    const page = Math.min(100_000, Math.max(1, Math.floor(Number(sp.get('page'))) || 1));
    const base = { projects, view, project, page, email: session.email };
    if (!scope.length) return html(res, mailsPage({ ...base, rows: [], counts: {}, total: 0, pages: 1, filter: '' }));

    if (view === 'replies') {
      const intent = Object.hasOwn(INTENTS, sp.get('filter')) ? sp.get('filter') : '';
      const counts = Object.fromEntries((await db.prepare(`SELECT intent, COUNT(*) n FROM replies WHERE project_id IN (${inList(scope)}) GROUP BY intent`).all(...scope))
        .map((r) => [r.intent, Number(r.n)]));
      const where = `r.project_id IN (${inList(scope)})${intent ? ' AND r.intent = ?' : ''}`;
      const args = intent ? [...scope, intent] : scope;
      const total = Number((await db.prepare(`SELECT COUNT(*) n FROM replies r WHERE ${where}`).get(...args)).n);
      const rows = await db.prepare(`${REPLY_SELECT} WHERE ${where} ORDER BY r.received_at DESC, r.id DESC LIMIT ? OFFSET ?`).all(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE);
      return html(res, mailsPage({ ...base, filter: intent, counts, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), rows: await Promise.all(rows.map((r) => shapeReply(r, session.userId))) }));
    }

    const state = Object.hasOwn(STATE_SQL, sp.get('filter')) ? sp.get('filter') : '';
    const from = `FROM mail_log m JOIN projects p ON p.id = m.project_id LEFT JOIN prospects x ON x.id = m.prospect_id WHERE m.project_id IN (${inList(scope)})`;
    const counts = {};
    for (const [k, cond] of Object.entries(STATE_SQL)) counts[k] = Number((await db.prepare(`SELECT COUNT(*) n ${from} AND ${cond}`).get(...scope)).n);
    const where = state ? ` AND ${STATE_SQL[state]}` : '';
    const total = Number((await db.prepare(`SELECT COUNT(*) n ${from}${where}`).get(...scope)).n);
    const rows = await db.prepare(`SELECT m.id, m.sent_at, m.email, m.subject, m.kind, m.error, m.read_at, p.name project, x.status, x.company
      ${from}${where} ORDER BY m.sent_at DESC, m.id DESC LIMIT ? OFFSET ?`).all(...scope, PAGE_SIZE, (page - 1) * PAGE_SIZE);
    html(res, mailsPage({ ...base, filter: state, counts, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), rows: rows.map((r) => ({ ...r, state: stateOf(r) })) }));
  });
}
