// Back-office : liste des comptes, suspension, plan, suppression, journal d'audit. RIEN des données métier d'un compte
// (prospects, mails, notes, projets) n'est lu ici : uniquement l'identité du compte, sa liaison (mode, sans secret) et des compteurs.
import { now } from './db.js';
import { logAudit } from './audit.js';
import { sendPause, resumeSending } from './services/abuse.js';
import { HttpError } from './http.js';
import { destroyUserSessions } from './auth.js';
import { getUser, deleteUser, normalizeEmail } from './users.js';
import { ADMIN_PAGE_SIZE, PAID_PLANS } from './limits.js';
import { usageOf, limitsFor } from './services/plans.js';
import { modeLabelOf } from './claudelink.js';

const like = (q) => `%${String(q).replace(/[!%_]/g, '!$&')}%`;

export { maskEmail, ACTION_LABELS, logAudit, recentAudit, purgeAudit } from './audit.js';

/** Page de comptes : identité, liaison (mode seulement), usage du mois. Aucune donnée métier. */
export async function listAccounts(db, { page = 1, q = '', at = now() } = {}) {
  const where = q ? "WHERE email LIKE ? ESCAPE '!'" : '';
  const args = q ? [like(q)] : [];
  const total = Number((await db.prepare(`SELECT COUNT(*) n FROM users ${where}`).get(...args)).n);
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const p = Math.min(Math.max(1, Math.floor(Number(page)) || 1), pages);
  const rows = await db.prepare(`SELECT id, email, provider, status, is_admin, plan, created_at, last_login_at, claude_link_json
    FROM users ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, ADMIN_PAGE_SIZE, (p - 1) * ADMIN_PAGE_SIZE);
  const accounts = [];
  for (const r of rows) {
    let link = null;
    try { const j = r.claude_link_json ? JSON.parse(r.claude_link_json) : null; if (j?.mode) link = { mode: modeLabelOf(j), valid: !!j.valid }; } catch { link = null; }
    const user = await getUser(db, r.id);
    const usage = await usageOf(db, r.id, { at });
    accounts.push({
      id: Number(r.id), email: r.email, provider: r.provider, status: r.status, isAdmin: !!r.is_admin, plan: r.plan,
      createdAt: r.created_at, lastLoginAt: r.last_login_at, link,
      usage: { ...usage, limits: limitsFor(user) }, sendPause: await sendPause(db, r.id),
    });
  }
  return { accounts, total, page: p, pages };
}

// Un administrateur ne touche jamais à son propre compte ni à un autre compte administrateur (leur rôle vient de ADMIN_EMAILS)
function assertManageable(actor, target, verb) {
  if (!target) throw new HttpError(404, 'Compte introuvable');
  if (Number(target.id) === Number(actor.id)) throw new HttpError(400, `Tu ne peux pas ${verb} ton propre compte.`, { expose: true });
  if (target.isAdmin) throw new HttpError(400, `Ce compte est administrateur (ADMIN_EMAILS) : il ne se ${verb === 'suspendre' ? 'suspend' : 'modifie'} pas ici.`, { expose: true });
}

/**
 * Exécute une action d'administration, la journalise et renvoie un message pour l'écran.
 * @param {{db, worker?}} app
 * @param {{id: number, email: string}} actor administrateur connecté
 * @param {'suspend'|'reactivate'|'plan'|'delete'|'resume_send'} action
 */
export async function adminAction(app, actor, action, targetId, { plan, confirm } = {}) {
  const { db } = app;
  const target = await getUser(db, targetId);
  if (action === 'suspend') {
    assertManageable(actor, target, 'suspendre');
    await db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(target.id);
    await destroyUserSessions(db, target.id);
    app.worker?.abortUser(target.id); // le job en cours s'arrête ; les jobs en file sont refusés par le worker
    await logAudit(db, { admin: actor, action: 'suspend', target });
    return `Compte suspendu : ${target.email}`;
  }
  if (action === 'reactivate') {
    assertManageable(actor, target, 'réactiver');
    await db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(target.id);
    await logAudit(db, { admin: actor, action: 'reactivate', target });
    return `Compte réactivé : ${target.email}`;
  }
  if (action === 'plan') {
    assertManageable(actor, target, 'modifier');
    if (!PAID_PLANS.includes(plan)) throw new HttpError(400, 'Plan inconnu', { expose: true });
    await db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, target.id);
    await logAudit(db, { admin: actor, action: plan === 'pro' ? 'plan_pro' : 'plan_free', target });
    return `Plan ${plan === 'pro' ? 'pro' : 'gratuit'} attribué à ${target.email}`;
  }
  if (action === 'delete') {
    assertManageable(actor, target, 'supprimer');
    if (normalizeEmail(confirm) !== normalizeEmail(target.email)) throw new HttpError(400, "L'email saisi ne correspond pas à celui du compte", { expose: true });
    await logAudit(db, { admin: actor, action: 'delete', target }); // avant : la suite efface le compte
    app.worker?.abortUser(target.id);
    await deleteUser(app, target.id);
    return 'Compte supprimé avec toutes ses données.';
  }
  if (action === 'resume_send') {
    if (!target) throw new HttpError(404, 'Compte introuvable');
    await resumeSending(db, target.id);
    await logAudit(db, { admin: actor, action: 'resume_send', target });
    return `Envois rétablis pour ${target.email}`;
  }
  throw new HttpError(400, 'Action inconnue');
}
