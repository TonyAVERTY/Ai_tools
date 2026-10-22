// Routes du back-office. Réservées aux administrateurs : le serveur répond 404 à tous les autres (visiteurs compris),
// comme si la page n'existait pas (voir server.js, option `admin`).
import { html, redirect, readBody, HttpError } from './http.js';
import { adminAction, listAccounts, recentAudit } from './admin.js';
import { adminPage } from './adminviews.js';

const DONE = {
  suspend: 'Compte suspendu : ses sessions sont fermées et ses jobs ne démarrent plus.',
  reactivate: 'Compte réactivé.',
  plan: 'Plan modifié.',
  delete: 'Compte supprimé avec toutes ses données.',
  resume_send: 'Envois rétablis.',
};

export function registerAdminRoutes(router, app) {
  const opts = { admin: true, limit: 'admin' };

  router.get('/admin', async ({ res, session, url }) => {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
    const done = url.searchParams.get('done');
    html(res, adminPage({
      user: session.user, q,
      list: await listAccounts(app.db, { page: url.searchParams.get('page'), q }),
      audit: await recentAudit(app.db),
      notice: DONE[done] || null, error: url.searchParams.get('e'),
    }));
  }, opts);

  const act = (action, route) => router.post(`/admin/users/:id/${route}`, async ({ req, res, session, params }) => {
    const b = await readBody(req);
    const back = `page=${encodeURIComponent(String(b.page || '1').slice(0, 6))}${b.q ? `&q=${encodeURIComponent(String(b.q).slice(0, 100))}` : ''}`;
    try {
      await adminAction(app, { id: session.userId, email: session.email }, action, Number(params.id), { plan: b.plan, confirm: b.confirm });
      redirect(res, `/admin?${back}&done=${action}`);
    } catch (e) {
      if (!(e instanceof HttpError) || e.status >= 500) throw e;
      redirect(res, `/admin?${back}&e=${encodeURIComponent(e.message)}`);
    }
  }, opts);

  act('suspend', 'suspend');
  act('reactivate', 'reactivate');
  act('plan', 'plan');
  act('delete', 'delete');
  act('resume_send', 'resume-send');
}
