// API JSON publique (v1), réservée au mode développeur. Authentification : « Authorization: Bearer iaboss_… » (voir apitokens.js).
// Même contrôle d'accès que le panel : un jeton ne voit que les projets de son compte (et ceux que son équipe partage).
// Documentation : /docs/api (src/site/docs.js + src/apidocs.js) et la page /developer du panel.
import { json, readBody, HttpError } from './http.js';
import { now } from './db.js';
import { getUser } from './users.js';
import { getProject, prospectStats } from './projects.js';
import { accessOn, needAccess } from './teams.js';
import { needScope, SCOPES } from './apitokens.js';
import { accessibleProjects } from './mailroutes.js';
import { listProspects, parseFilters, prospectDetail, addNote, setNextAction, STATUSES } from './services/crm.js';
import { importProspects } from './services/csv.js';
import { quotaFor, planLimitError, withUserLock, assertRoom, limitsFor } from './services/plans.js';
import { INTENTS, draftReply } from './services/replies.js';
import { enqueue, latestJobs } from './services/jobs.js';
import { assertCanRunAi } from './claudelink.js';
import { AI_JOBS, budgetState } from './services/budget.js';
import { warmupAdvice } from './services/warmup.js';
import { sentSince } from './projects.js';

const int = (v, min, max, def) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def; };
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const MAX_ADD = 100;
const LEVELS = ['rapide', 'normal', 'approfondi'];

export const API_VERSION = 'v1';

/** Toutes les routes de l'API, une seule fois : la page /developer et la documentation /docs/api en dépendent (un test vérifie qu'aucune n'est oubliée). */
export const API_ENDPOINTS = [
  { method: 'GET', path: '/me', scope: null, summary: 'Compte du jeton : adresse, plan, droits.' },
  { method: 'GET', path: '/projects', scope: 'read', summary: 'Tes projets (et ceux que ton équipe partage) avec leurs compteurs de prospects.' },
  { method: 'GET', path: '/projects/:id', scope: 'read', summary: 'Un projet : fiche, cible, compteurs, envois du jour, conseil de montée en charge, dernières tâches.' },
  { method: 'GET', path: '/projects/:id/prospects', scope: 'read', summary: 'Prospects d\'un projet. Filtres : q, status, minScore, todo=1, sort (score, recent, contacted, company), page.' },
  { method: 'POST', path: '/projects/:id/prospects', scope: 'write', summary: 'Ajoute jusqu\'à 100 prospects : { "prospects": [ { "company", "email", "website", "city", "sector", "score", "source", "hook" } ] }. Doublons, adresses invalides et liste d\'opposition ignorés.' },
  { method: 'GET', path: '/prospects/:id', scope: 'read', summary: 'Un prospect : fiche, mails envoyés, notes.' },
  { method: 'POST', path: '/prospects/:id/status', scope: 'write', summary: 'Change le statut : { "status": "new | sent | replied | client | refused | bounced | invalid" }. « refused » vaut opposition.' },
  { method: 'POST', path: '/prospects/:id/notes', scope: 'write', summary: 'Ajoute une note : { "body": "…" }.' },
  { method: 'POST', path: '/prospects/:id/next', scope: 'write', summary: 'Prochaine action : { "action": "Rappeler", "day": "AAAA-MM-JJ" } (action vide : efface).' },
  { method: 'POST', path: '/prospects/:id/hook', scope: 'jobs', summary: 'Régénère l\'accroche du prospect à partir de son site (tâche asynchrone).' },
  { method: 'GET', path: '/replies', scope: 'read', summary: 'Réponses reçues, avec intention et réponse suggérée. Filtres : unseen=1, intent, limit, offset.' },
  { method: 'POST', path: '/replies/:id/seen', scope: 'write', summary: 'Marque une réponse comme lue.' },
  { method: 'GET', path: '/projects/:id/mails', scope: 'read', summary: 'Mails envoyés avec readAt (accusé de lecture reçu, si le destinataire en a envoyé un) ; limit, offset.' },
  { method: 'GET', path: '/jobs/:id', scope: 'read', summary: 'État et résultat d\'une tâche.' },
  { method: 'POST', path: '/projects/:id/jobs', scope: 'jobs', summary: 'Lance une tâche : { "type": "analyze | prospect | evolution | audit | send", … }. « send » exige { "confirm": true }.' },
];

export function registerApiV1(router, app, { aiOpts = {} } = {}) {
  const { db } = app;
  const get = (path, handler) => router.get(`/api/v1${path}`, handler, { api: true, limit: 'api_ip' });
  const post = (path, handler) => router.post(`/api/v1${path}`, handler, { api: true, limit: 'api_ip' });

  const project = (ctx, opts) => getProject(app, Number(ctx.params.id), { userId: ctx.api.userId, ...opts });
  const prospectRow = async (ctx) => {
    const row = await db.prepare('SELECT x.id, x.email, x.project_id, p.user_id, p.team_id FROM prospects x JOIN projects p ON p.id = x.project_id WHERE x.id = ?').get(Number(ctx.params.id));
    if (!row || !(await accessOn(db, { user_id: row.user_id, team_id: row.team_id }, ctx.api.userId))) throw new HttpError(404, 'Prospect introuvable', { expose: true, code: 'not_found' });
    return { id: Number(row.id), email: row.email, projectId: Number(row.project_id), ownerId: Number(row.user_id) };
  };
  const body = async (req) => { const b = await readBody(req); return b && typeof b === 'object' ? b : {}; };

  // ---------- Compte ----------
  get('/me', async (ctx) => {
    const u = await getUser(db, ctx.api.userId);
    json(ctx.res, { email: u.email, plan: u.plan, scopes: ctx.api.scopes, version: API_VERSION });
  });

  // ---------- Projets ----------
  get('/projects', async (ctx) => {
    needScope(ctx.api, 'read');
    const rows = await accessibleProjects(db, ctx.api.userId);
    const projects = [];
    for (const r of rows) {
      const p = await getProject(app, r.id, { userId: ctx.api.userId });
      projects.push({ id: p.id, name: p.name, access: p.access, gitUrl: p.gitUrl, analyzed: !!p.profile, targetValidated: p.targetValidated, hasSmtp: p.hasSmtp, stats: await prospectStats(db, p.id) });
    }
    json(ctx.res, { projects });
  });

  get('/projects/:id', async (ctx) => {
    needScope(ctx.api, 'read');
    const p = await project(ctx);
    const day = now() - 86400;
    json(ctx.res, {
      id: p.id, name: p.name, access: p.access, gitUrl: p.gitUrl, profile: p.profile, target: p.target, targetValidated: p.targetValidated,
      hasSmtp: p.hasSmtp, hasImap: p.hasImap, stats: await prospectStats(db, p.id),
      sendingToday: await sentSince(db, day, p.userId, p.id), warmup: await warmupAdvice(db, p.id, { sentToday: await sentSince(db, day, p.userId, p.id) }),
      jobs: await latestJobs(db, p.id),
    });
  });

  // ---------- Prospects ----------
  get('/projects/:id/prospects', async (ctx) => {
    needScope(ctx.api, 'read');
    const p = await project(ctx);
    json(ctx.res, await listProspects(db, p.id, parseFilters(ctx.url.searchParams)));
  });

  post('/projects/:id/prospects', async (ctx) => {
    needScope(ctx.api, 'write');
    const p = await project(ctx);
    const b = await body(ctx.req);
    const list = Array.isArray(b.prospects) ? b.prospects : null;
    if (!list || !list.length) throw new HttpError(400, 'Attendu : { "prospects": [ { "company", "email", … } ] }', { expose: true, code: 'invalid_request' });
    if (list.length > MAX_ADD) throw new HttpError(400, `${MAX_ADD} prospects au plus par appel`, { expose: true, code: 'too_many' });
    // Même chemin que l'import CSV : emails validés, doublons et liste d'opposition ignorés, plafond du plan appliqué, origine conservée
    const header = ['company', 'email', 'website', 'city', 'sector', 'score', 'source', 'hook'];
    const csv = [header.join(','), ...list.map((x) => header.map((k) => csvCell(typeof x === 'object' && x ? x[k] : '')).join(','))].join('\n');
    try {
      json(ctx.res, await withUserLock(p.userId, async () => {
        const u = await getUser(db, p.userId);
        const q = await quotaFor(db, u, 'prospects');
        return importProspects(db, p.id, csv, { limit: q.remaining, limitError: q.unlimited ? null : planLimitError(u, q, { wanted: q.remaining + 1, note: "Rien n'a été ajouté." }) });
      }), 201);
    } catch (e) { throw e instanceof HttpError ? e : new HttpError(400, e.message, { expose: true, code: 'invalid_request' }); }
  });

  get('/prospects/:id', async (ctx) => {
    needScope(ctx.api, 'read');
    const row = await prospectRow(ctx);
    json(ctx.res, await prospectDetail(db, row.id));
  });

  post('/prospects/:id/status', async (ctx) => {
    needScope(ctx.api, 'write');
    const row = await prospectRow(ctx);
    const b = await body(ctx.req);
    if (!Object.hasOwn(STATUSES, b.status)) throw new HttpError(400, `Statut invalide (${Object.keys(STATUSES).join(', ')})`, { expose: true, code: 'invalid_request' });
    await db.prepare('UPDATE prospects SET status = ? WHERE id = ?').run(b.status, row.id);
    if (b.status === 'refused') {
      // Comme dans le panel : un refus vaut opposition, pour tous les comptes
      await db.prepare("INSERT OR IGNORE INTO blacklist(email, reason, created_at) VALUES(?, 'refused', ?)").run(row.email, now());
      await db.prepare("UPDATE prospects SET status = 'refused' WHERE email = ? AND status IN ('new','sent')").run(row.email);
    }
    json(ctx.res, { ok: true, status: b.status });
  });

  post('/prospects/:id/notes', async (ctx) => {
    needScope(ctx.api, 'write');
    const row = await prospectRow(ctx);
    const id = await addNote(db, row.id, (await body(ctx.req)).body);
    if (!id) throw new HttpError(400, 'Note vide', { expose: true, code: 'invalid_request' });
    json(ctx.res, { ok: true, id }, 201);
  });

  post('/prospects/:id/next', async (ctx) => {
    needScope(ctx.api, 'write');
    const row = await prospectRow(ctx);
    const b = await body(ctx.req);
    try { json(ctx.res, { ok: true, at: await setNextAction(db, row.id, b.action, b.day) }); }
    catch (e) { throw new HttpError(400, e.message, { expose: true, code: 'invalid_request' }); }
  });

  // ---------- Réponses ----------
  get('/replies', async (ctx) => {
    needScope(ctx.api, 'read');
    const ids = (await accessibleProjects(db, ctx.api.userId)).map((p) => Number(p.id));
    if (!ids.length) return json(ctx.res, { unseen: 0, replies: [] });
    const q = ctx.url.searchParams;
    const intent = Object.hasOwn(INTENTS, q.get('intent')) ? q.get('intent') : null;
    const where = `r.project_id IN (${ids.map(() => '?').join(',')})${q.get('unseen') === '1' ? ' AND r.seen_at IS NULL' : ''}${intent ? ' AND r.intent = ?' : ''}`;
    const args = intent ? [...ids, intent] : ids;
    const unseen = Number((await db.prepare(`SELECT COUNT(*) n FROM replies WHERE seen_at IS NULL AND project_id IN (${ids.map(() => '?').join(',')})`).get(...ids)).n);
    const rows = await db.prepare(`SELECT r.*, p.name project, x.company FROM replies r JOIN projects p ON p.id = r.project_id LEFT JOIN prospects x ON x.id = r.prospect_id
      WHERE ${where} ORDER BY r.received_at DESC, r.id DESC LIMIT ? OFFSET ?`).all(...args, int(q.get('limit'), 1, 100, 25), int(q.get('offset'), 0, 100_000, 0));
    json(ctx.res, {
      unseen,
      replies: rows.map((r) => ({
        id: Number(r.id), projectId: Number(r.project_id), project: r.project, prospectId: r.prospect_id == null ? null : Number(r.prospect_id), company: r.company || null,
        from: r.from_email, subject: r.subject || '', text: r.body || '', intent: r.intent, receivedAt: Number(r.received_at), seen: !!r.seen_at,
        suggestedReply: draftReply(r.intent, { company: r.company }),
      })),
    });
  });

  post('/replies/:id/seen', async (ctx) => {
    needScope(ctx.api, 'write');
    const ids = (await accessibleProjects(db, ctx.api.userId)).map((p) => Number(p.id));
    const r = ids.length ? await db.prepare(`SELECT id FROM replies WHERE id = ? AND project_id IN (${ids.map(() => '?').join(',')})`).get(Number(ctx.params.id), ...ids) : null;
    if (!r) throw new HttpError(404, 'Réponse introuvable', { expose: true, code: 'not_found' });
    await db.prepare('UPDATE replies SET seen_at = ? WHERE id = ? AND seen_at IS NULL').run(now(), r.id);
    json(ctx.res, { ok: true });
  });

  // ---------- Mails envoyés ----------
  get('/projects/:id/mails', async (ctx) => {
    needScope(ctx.api, 'read');
    const p = await project(ctx);
    const q = ctx.url.searchParams;
    const rows = await db.prepare(`SELECT m.id, m.sent_at, m.email, m.subject, m.kind, m.error, m.read_at, x.status prospect_status
      FROM mail_log m LEFT JOIN prospects x ON x.id = m.prospect_id WHERE m.project_id = ? ORDER BY m.sent_at DESC, m.id DESC LIMIT ? OFFSET ?`)
      .all(p.id, int(q.get('limit'), 1, 200, 50), int(q.get('offset'), 0, 1_000_000, 0));
    json(ctx.res, { mails: rows.map((m) => ({ id: Number(m.id), sentAt: Number(m.sent_at), to: m.email, subject: m.subject, kind: m.kind, error: m.error, readAt: m.read_at ? Number(m.read_at) : null, prospectStatus: m.prospect_status })) });
  });

  // ---------- Tâches ----------
  get('/jobs/:id', async (ctx) => {
    needScope(ctx.api, 'read');
    const j = await db.prepare('SELECT j.*, p.user_id owner, p.team_id FROM jobs j LEFT JOIN projects p ON p.id = j.project_id WHERE j.id = ?').get(Number(ctx.params.id));
    const ok = j && (Number(j.user_id) === ctx.api.userId || (j.project_id && await accessOn(db, { user_id: j.owner, team_id: j.team_id }, ctx.api.userId)));
    if (!ok) throw new HttpError(404, 'Tâche introuvable', { expose: true, code: 'not_found' });
    const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
    json(ctx.res, { id: Number(j.id), type: j.type, status: j.status, progress: parse(j.progress_json), result: parse(j.result_json), error: j.error, createdAt: Number(j.created_at), finishedAt: j.finished_at ? Number(j.finished_at) : null });
  });

  // Lancer une tâche. Mêmes gardes que le panel ; l'envoi de mails exige en plus { "confirm": true }.
  const JOBS = {
    analyze: { params: () => ({}) },
    prospect: {
      params: (b) => ({ count: int(b.count, 1, 50, 10) }),
      guard: async (p) => { await assertRoom(db, await getUser(db, p.userId), 'prospects'); if (!p.targetValidated) throw new HttpError(400, 'Valide la cible avant de prospecter', { expose: true, code: 'target_not_validated' }); },
    },
    evolution: { params: (b) => ({ count: int(b.count, 1, 20, 5), level: LEVELS.includes(b.level) ? b.level : 'rapide' }) },
    audit: { params: (b) => ({ level: LEVELS.includes(b.level) ? b.level : 'rapide' }), guard: (p) => needAccess(p.access, 'admin', "l'audit du code") },
    send: {
      params: (b) => ({ count: int(b.count, 1, 100, 10) }),
      guard: async (p, b) => {
        if (b.confirm !== true) throw new HttpError(400, 'Envoi de mails : { "confirm": true } est obligatoire', { expose: true, code: 'confirmation_required' });
        const running = await db.prepare("SELECT 1 FROM jobs WHERE project_id = ? AND type = 'prospect' AND status IN ('queued','running')").get(p.id);
        if (running) throw new HttpError(409, 'La recherche de prospects est encore en cours', { expose: true, code: 'busy' });
      },
    },
  };
  post('/projects/:id/jobs', async (ctx) => {
    needScope(ctx.api, 'jobs');
    const p = await project(ctx);
    const b = await body(ctx.req);
    const def = Object.hasOwn(JOBS, b.type) ? JOBS[b.type] : null;
    if (!def) throw new HttpError(400, `Type de tâche inconnu (${Object.keys(JOBS).join(', ')})`, { expose: true, code: 'invalid_request' });
    if (AI_JOBS.has(b.type)) await assertCanRunAi(db, p.userId, aiOpts);
    await def.guard?.(p, b);
    const r = await enqueue(db, { userId: p.userId, projectId: p.id, type: b.type, params: def.params(b) }, aiOpts);
    const budget = AI_JOBS.has(b.type) ? await budgetState(db, p.userId) : null;
    json(ctx.res, { ...r, budgetBlocked: budget?.blocked ? budget.reason : null }, r.existing ? 200 : 202);
  });

  post('/prospects/:id/hook', async (ctx) => {
    needScope(ctx.api, 'jobs');
    const row = await prospectRow(ctx);
    await assertCanRunAi(db, row.ownerId, aiOpts);
    json(ctx.res, await enqueue(db, { userId: row.ownerId, projectId: row.projectId, type: 'hook', params: { prospectId: row.id } }, aiOpts), 202);
  });

  return { SCOPES, limitsFor };
}
