// Routes de l'équipe (pages HTML et formulaires). Toutes exigent d'être connecté ; la gestion est réservée au propriétaire.
import { HttpError, html, redirect, readBody } from './http.js';
import { getUser } from './users.js';
import { limitsFor } from './services/plans.js';
import {
  ownedTeam, memberships, createTeam, deleteTeam, teamDetails, createInvite, revokeInvite, inviteUrl, acceptInvite, inspectInvite,
  setMemberRole, removeMember, setProjectShared, sendInviteMail, ROLES,
} from './teams.js';
import { teamPage, joinPage } from './teamviews.js';

export function registerTeamRoutes(router, app) {
  const { db, cfg } = app;
  const LIMIT = { limit: 'link' };

  const render = async (session, extra = {}, status = 200) => {
    const user = await getUser(db, session.userId);
    const team = await ownedTeam(db, user.id);
    return {
      status,
      page: teamPage({
        user, owned: team ? await teamDetails(db, team) : null, memberOf: await memberships(db, user.id),
        canTeam: limitsFor(user).seats == null || limitsFor(user).seats >= 2, ...extra,
      }),
    };
  };
  const show = async (res, session, extra, status) => { const r = await render(session, extra); html(res, r.page, status ?? r.status); };
  // Erreur d'une action : on revient sur la page avec le message, jamais une page d'erreur brute
  const guarded = (fn) => async (ctx) => {
    try { await fn(ctx); } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      await show(ctx.res, ctx.session, { error: e.message }, e.status === 404 ? 404 : 400);
    }
  };
  const mustOwn = async (session) => {
    const team = await ownedTeam(db, session.userId);
    if (!team) throw new HttpError(404, "Tu n'as pas d'équipe", { expose: true });
    return team;
  };

  router.get('/team', async ({ res, session, url }) => {
    const notices = { created: 'Équipe créée.', joined: 'Tu as rejoint l\'équipe.', left: 'Tu as quitté l\'équipe.', deleted: 'Équipe supprimée.' };
    await show(res, session, { notice: notices[url.searchParams.get('t')] || null });
  });

  router.post('/team/create', guarded(async ({ req, res, session }) => {
    await createTeam(db, session.userId, (await readBody(req)).name);
    redirect(res, '/team?t=created');
  }), LIMIT);

  router.post('/team/invite', guarded(async ({ req, res, session }) => {
    const team = await mustOwn(session);
    const b = await readBody(req);
    const inv = await createInvite(db, team, { email: b.email, role: b.role, byUserId: session.userId });
    const owner = await getUser(db, session.userId);
    const mail = await sendInviteMail(app, team, owner, inv);
    await show(res, session, { invite: { email: inv.email, role: inv.role, url: inviteUrl(cfg, inv.token), mailed: mail.sent, mailReason: mail.reason } });
  }), LIMIT);

  router.post('/team/invite/:id/revoke', guarded(async ({ res, session, params }) => {
    await revokeInvite(db, await mustOwn(session), params.id);
    await show(res, session, { notice: 'Invitation annulée.' });
  }), LIMIT);

  router.post('/team/member/:uid/role', guarded(async ({ req, res, session, params }) => {
    const b = await readBody(req);
    if (!ROLES.includes(b.role)) throw new HttpError(400, 'Rôle inconnu', { expose: true });
    await setMemberRole(db, await mustOwn(session), params.uid, b.role);
    await show(res, session, { notice: 'Rôle modifié.' });
  }), LIMIT);

  router.post('/team/member/:uid/remove', guarded(async ({ res, session, params }) => {
    await removeMember(db, await mustOwn(session), params.uid);
    await show(res, session, { notice: 'Membre retiré : il n\'a plus accès à rien.' });
  }), LIMIT);

  router.post('/team/projects/:pid/share', guarded(async ({ req, res, session, params }) => {
    const b = await readBody(req);
    await setProjectShared(db, await mustOwn(session), params.pid, b.shared === '1' || b.shared === true);
    await show(res, session, { notice: b.shared === '1' || b.shared === true ? 'Projet partagé avec l\'équipe.' : 'Projet retiré du partage.' });
  }), LIMIT);

  router.post('/team/delete', guarded(async ({ res, session }) => {
    await deleteTeam(db, await mustOwn(session));
    redirect(res, '/team?t=deleted');
  }), LIMIT);

  router.post('/team/:tid/leave', guarded(async ({ res, session, params }) => {
    const mine = (await memberships(db, session.userId)).find((t) => t.id === Number(params.tid));
    if (!mine) throw new HttpError(404, 'Équipe introuvable', { expose: true });
    await removeMember(db, { id: mine.id }, session.userId);
    redirect(res, '/team?t=left');
  }), LIMIT);

  // Invitation : GET = page de confirmation (un scanner de liens n'accepte rien), POST = acceptation
  router.get('/team/join/:token', async ({ res, session, params }) => {
    const user = await getUser(db, session.userId);
    html(res, joinPage({ user, token: params.token, info: await inspectInvite(db, user, params.token) }));
  }, LIMIT);
  router.post('/team/join/:token', async ({ res, session, params }) => {
    const user = await getUser(db, session.userId);
    try { await acceptInvite(db, user, params.token); } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      return html(res, joinPage({ user, token: params.token, info: await inspectInvite(db, user, params.token), error: e.message }), e.status);
    }
    redirect(res, '/team?t=joined');
  }, LIMIT);
}
