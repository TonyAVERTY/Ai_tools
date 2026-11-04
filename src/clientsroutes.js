// Page Clients : les projets du compte sous forme de déroulants (clients et prospects, recherche), la fiche d'un client (informations modifiables, documents générés,
// échanges), la fiche d'un prospect (échanges, passage en client), l'ajout manuel et l'export CSV. Seuls les projets DONT LE COMPTE EST PROPRIÉTAIRE sont concernés.
import { HttpError, html, redirect, readBody } from './http.js';
import { getProject } from './projects.js';
import {
  ClientError, getClient, createClient, updateClient, removeClient, convertProspect, listProjectClients, listProjectProspects, clientsOverview, clientDocuments, clientTotals,
  clientExchanges, prospectSheet, addProspectNote, clientsCsv,
} from './clientsdata.js';
import { clientsPage, clientSheetPage, prospectSheetPage, clientListsHtml } from './clientsviews.js';
import { fmtEur, slug, todayIso } from './services/accounting.js';

const refuse = (status, msg) => new HttpError(status, msg, { expose: true });
const LIMIT = { limit: 'compta' };
const PAGE = 30;
const cap = (v) => Math.max(PAGE, Math.min(600, Math.floor(Number(v)) || PAGE));

export function registerClientsRoutes(router, app) {
  const { db } = app;

  /** Un projet dont le compte est propriétaire ; sinon 404 comme s'il n'existait pas. */
  const mine = async (userId, id) => {
    const p = await getProject(app, Number(id), { userId });
    if (p.access !== 'owner') throw new HttpError(404, 'Projet introuvable', { expose: true });
    return p;
  };
  const projectOf = (userId, client) => mine(userId, client.projectId);
  const clientOr404 = async (ctx) => {
    const c = await getClient(db, ctx.session.userId, ctx.params.id);
    if (!c) throw new HttpError(404, 'Client introuvable', { expose: true });
    return c;
  };
  const prospectProject = async (ctx) => {
    const row = await db.prepare('SELECT x.id, x.project_id FROM prospects x JOIN projects p ON p.id = x.project_id WHERE x.id = ? AND p.user_id = ?').get(Number(ctx.params.id), ctx.session.userId);
    if (!row) throw new HttpError(404, 'Prospect introuvable', { expose: true });
    return mine(ctx.session.userId, row.project_id);
  };
  const failTo = (res, to, e) => {
    if (!(e instanceof ClientError)) throw e;
    redirect(res, `${to}${to.includes('?') ? '&' : '?'}e=${encodeURIComponent(e.message)}`);
  };

  // ---------- Liste des projets ----------
  router.get('/clients', async ({ res, url, session }) => {
    const userId = session.userId;
    const projects = await db.prepare('SELECT id, name FROM projects WHERE user_id = ? ORDER BY LOWER(name), id').all(userId);
    const overview = await clientsOverview(db, userId, projects.map((p) => Number(p.id)));
    const rows = projects.map((p) => ({ id: Number(p.id), name: p.name, counts: overview.get(Number(p.id)) }));
    const asked = Number(url.searchParams.get('projet'));
    const openId = rows.find((r) => r.id === asked)?.id ?? (rows.length === 1 ? rows[0].id : null);
    html(res, clientsPage({ email: session.email, rows, openId, flash: { ok: url.searchParams.get('ok'), error: url.searchParams.get('e') } }));
  });

  // Clients et prospects d'un projet (fragment HTML chargé quand on déroule le projet, et à chaque frappe dans la recherche)
  router.get('/clients/projet/:id/liste', async ({ res, params, url, session }) => {
    const p = await mine(session.userId, params.id);
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 100);
    const limit = cap(url.searchParams.get('limit'));
    const [clients, prospects] = await Promise.all([listProjectClients(db, session.userId, p.id, { q, limit }), listProjectProspects(db, p.id, { q, limit })]);
    html(res, clientListsHtml({ projectId: p.id, q, limit, clients, prospects }));
  });

  router.post('/clients/projet/:id/ajouter', async (ctx) => {
    const p = await mine(ctx.session.userId, ctx.params.id);
    const b = await readBody(ctx.req);
    try {
      const id = await createClient(db, ctx.session.userId, p.id, b);
      redirect(ctx.res, `/clients/c/${id}?ok=cree`);
    } catch (e) { failTo(ctx.res, `/clients?projet=${p.id}`, e); }
  }, LIMIT);

  router.get('/clients/projet/:id/export.csv', async ({ res, params, session }) => {
    const p = await mine(session.userId, params.id);
    const { rows } = await listProjectClients(db, session.userId, p.id, { limit: 100000 });
    const data = Buffer.from(clientsCsv(rows, (c) => fmtEur(c).replace(/[  ]/g, ' ')), 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="clients-${slug(p.name)}-${todayIso()}.csv"`,
    });
    res.end(data);
  }, LIMIT);

  // ---------- Fiche client ----------
  router.get('/clients/c/:id', async (ctx) => {
    const { res, url, session } = ctx;
    const c = await clientOr404(ctx);
    const p = await projectOf(session.userId, c);
    const documents = await clientDocuments(db, session.userId, c);
    html(res, clientSheetPage({
      email: session.email, project: { id: p.id, name: p.name, gitUrl: p.gitUrl }, client: c, documents, totals: clientTotals(documents), exchanges: await clientExchanges(db, c),
      flash: { ok: url.searchParams.get('ok'), error: url.searchParams.get('e') },
    }));
  });

  router.post('/clients/c/:id', async (ctx) => {
    const c = await clientOr404(ctx);
    const b = await readBody(ctx.req);
    try {
      await updateClient(db, ctx.session.userId, c.id, b);
      redirect(ctx.res, `/clients/c/${c.id}?ok=maj`);
    } catch (e) { failTo(ctx.res, `/clients/c/${c.id}`, e); }
  }, LIMIT);

  router.post('/clients/c/:id/supprimer', async (ctx) => {
    const c = await clientOr404(ctx);
    await removeClient(db, ctx.session.userId, c.id);
    redirect(ctx.res, `/clients?projet=${c.projectId}&ok=retire`);
  }, LIMIT);

  // ---------- Fiche prospect ----------
  router.get('/clients/p/:id', async (ctx) => {
    const { res, url, session } = ctx;
    const p = await prospectProject(ctx);
    const sheet = await prospectSheet(db, p.id, ctx.params.id);
    html(res, prospectSheetPage({ email: session.email, project: { id: p.id, name: p.name }, sheet, flash: { ok: url.searchParams.get('ok'), error: url.searchParams.get('e') } }));
  });

  router.post('/clients/p/:id/client', async (ctx) => {
    const p = await prospectProject(ctx);
    const id = await convertProspect(db, ctx.session.userId, p.id, ctx.params.id);
    if (!id) throw refuse(404, 'Prospect introuvable');
    redirect(ctx.res, `/clients/c/${id}?ok=converti`);
  }, LIMIT);

  router.post('/clients/p/:id/note', async (ctx) => {
    const p = await prospectProject(ctx);
    const b = await readBody(ctx.req);
    if (!(await addProspectNote(db, p.id, ctx.params.id, b.body))) return redirect(ctx.res, `/clients/p/${ctx.params.id}?e=${encodeURIComponent('La note est vide.')}#echanges`);
    redirect(ctx.res, `/clients/p/${ctx.params.id}?ok=note#echanges`);
  }, LIMIT);
}
