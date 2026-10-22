// Back-office : liste des comptes, suspension, plan, suppression, journal d'audit. RIEN des données métier d'un compte
// (prospects, mails, notes, projets) n'est lu ici : uniquement l'identité du compte, sa liaison (mode, sans secret) et des compteurs.
import { now } from './db.js';
import { HttpError } from './http.js';
import { destroyUserSessions } from './auth.js';
import { getUser, deleteUser, normalizeEmail } from './users.js';
import { ADMIN_PAGE_SIZE, PAID_PLANS } from './limits.js';
import { usageOf, limitsFor } from './services/plans.js';
import { MODE_LABELS } from './claudelink.js';

/** « jean.dupont@exemple.fr » → « j***@exemple.fr » : l'identification suffit, l'adresse complète n'est pas gardée dans le journal. */
export function maskEmail(email) {
  const [local = '', domain = ''] = String(email || '').split('@');
  return `${local.slice(0, 1)}***${domain ? `@${domain}` : ''}`;
}

const ACTIONS = {
  suspend: 'Compte suspendu', reactivate: 'Compte réactivé', plan_free: 'Plan gratuit attribué', plan_pro: 'Plan pro attribué',
  delete: 'Compte supprimé', resume_send: 'Envois rétablis', abuse_pause: 'Envois mis en pause (rejets)',
  inactive_warning: 'Avertissement d\'inactivité', inactive_delete: 'Compte inactif supprimé',
};
export const ACTION_LABELS = ACTIONS;

/** Ajoute une ligne au journal. `admin` = { id, email } de l'administrateur, ou null pour une décision du système. */
export async function logAudit(db, { admin = null, action, target = null, detail = null, at = now() }) {
  if (!ACTIONS[action]) throw new Error(`Action d'audit inconnue : ${action}`);
  await db.prepare('INSERT INTO admin_audit(admin_id, admin_label, action, target_id, target_label, detail, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
    .run(admin?.id ?? null, admin ? admin.email : 'système', action, target?.id ?? null, target ? maskEmail(target.email) : null, detail ? String(detail).slice(0, 500) : null, at);
}

export async function recentAudit(db, limit = 50) {
  return (await db.prepare('SELECT * FROM admin_audit ORDER BY id DESC LIMIT ?').all(limit)).map((r) => ({
    id: r.id, at: r.created_at, admin: r.admin_label, action: r.action, label: ACTIONS[r.action] || r.action,
    target: r.target_label, targetId: r.target_id, detail: r.detail,
  }));
}

/** Nettoyage du journal ancien (planificateur). */
export async function purgeAudit(db, months, at = now()) {
  const d = new Date(at * 1000); d.setUTCMonth(d.getUTCMonth() - months);
  await db.prepare('DELETE FROM admin_audit WHERE created_at < ?').run(Math.floor(d.getTime() / 1000));
}

const like = (q) => `%${String(q).replace(/[!%_]/g, '!$&')}%`;

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
    try { const j = r.claude_link_json ? JSON.parse(r.claude_link_json) : null; if (j?.mode) link = { mode: MODE_LABELS[j.mode] || j.mode, valid: !!j.valid }; } catch { link = null; }
    const user = await getUser(db, r.id);
    const usage = await usageOf(db, r.id, { at });
    accounts.push({
      id: Number(r.id), email: r.email, provider: r.provider, status: r.status, isAdmin: !!r.is_admin, plan: r.plan,
      createdAt: r.created_at, lastLoginAt: r.last_login_at, link,
      usage: { ...usage, limits: limitsFor(user) },
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
 * @param {'suspend'|'reactivate'|'plan'|'delete'} action
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
  throw new HttpError(400, 'Action inconnue');
}
