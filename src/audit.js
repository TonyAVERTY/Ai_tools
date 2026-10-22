// Journal d'audit : actions d'administration et décisions automatiques (pause d'envoi, comptes inactifs).
// Les adresses y sont masquées ; aucune route ne modifie ni n'efface une ligne (seule la purge ancienne en retire).
import { now } from './db.js';

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
