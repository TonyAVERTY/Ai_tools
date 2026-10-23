// Page /admin : comptes (identité, liaison, usage du mois) et journal d'audit. Aucune donnée métier.
import { esc } from './http.js';
import { layout } from './views.js';

const fmt = (ts) => (ts ? new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }) : '—');
const PROVIDERS = { google: 'Google', apple: 'Apple' };
const PLANS = { free: 'gratuit', pro: 'pro', admin: 'administrateur' };

const cap = (used, limit) => (limit == null ? `${used}` : `${used}/${limit}`);
const usageCell = (u) => `<span title="Projets">P ${cap(u.projects, u.limits.projects)}</span> · <span title="Prospects">Pr ${cap(u.prospects, u.limits.prospects)}</span> · <span title="Mails ce mois-ci">M ${cap(u.mails, u.limits.mails)}</span> · <span title="Jobs IA ce mois-ci">IA ${cap(u.aiJobs, u.limits.aiJobs)}</span>`;

function actions(a, page, q, selfId) {
  if (a.id === selfId) return '<span class="muted small">Ton compte</span>';
  if (a.isAdmin) return '<span class="muted small">Administrateur (ADMIN_EMAILS)</span>';
  const back = `<input type="hidden" name="page" value="${page}"><input type="hidden" name="q" value="${esc(q)}">`;
  const f = (path, body) => `<form method="post" action="/admin/users/${a.id}/${path}" class="inline">${back}${body}</form>`;
  return `<div class="admin-actions">
    ${a.status === 'active' ? f('suspend', '<button class="btn small">Suspendre</button>') : f('reactivate', '<button class="btn small">Réactiver</button>')}
    ${f('plan', `<select name="plan" aria-label="Plan de ${esc(a.email)}"><option value="free"${a.plan === 'free' ? ' selected' : ''}>gratuit</option><option value="pro"${a.plan === 'pro' ? ' selected' : ''}>pro</option></select> <button class="btn small">Appliquer</button>`)}
    ${a.sendPause ? f('resume-send', '<button class="btn small">Rétablir les envois</button>') : ''}
    <details class="del"><summary class="btn small danger">Supprimer</summary>
      ${f('delete', `<label>Saisis l'email du compte pour confirmer<input name="confirm" type="email" required autocomplete="off" placeholder="${esc(a.email)}"></label><button class="btn small danger">Supprimer définitivement</button>`)}
    </details>
  </div>`;
}

export function adminPage({ user, list, audit, q = '', notice = null, error = null }) {
  const nav = (p) => `/admin?page=${p}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const rows = list.accounts.map((a) => `<tr>
    <td>${esc(a.email)}${a.isAdmin ? ' <span class="badge">admin</span>' : ''}</td>
    <td>${esc(PROVIDERS[a.provider] || '—')}</td>
    <td>${esc(PLANS[a.plan] || a.plan)}</td>
    <td>${a.status === 'active' ? '<span class="ok">actif</span>' : '<span class="error">suspendu</span>'}${a.sendPause ? '<br><span class="error small">envois en pause</span>' : ''}</td>
    <td>${fmt(a.createdAt)}</td>
    <td>${fmt(a.lastLoginAt)}</td>
    <td>${a.link ? `${esc(a.link.mode)}${a.link.valid ? '' : ' <span class="error small">invalide</span>'}` : '—'}</td>
    <td class="small">${usageCell(a.usage)}</td>
    <td>${actions(a, list.page, q, user.id)}</td>
  </tr>`).join('');
  const auditRows = audit.map((r) => `<tr><td>${fmt(r.at)}</td><td>${esc(r.admin)}</td><td>${esc(r.label)}</td><td>${esc(r.target || '—')}</td><td class="small">${esc(r.detail || '')}</td></tr>`).join('');
  return layout({
    title: 'Administration', email: user.email,
    body: `<div class="stack"><h1>Administration</h1>
<p class="muted small">Comptes et compteurs d'usage uniquement : aucun accès aux prospects, mails ni notes des utilisateurs.</p>
${notice ? `<p class="ok" role="status">${esc(notice)}</p>` : ''}
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<section class="card">
  <form method="get" action="/admin" class="inline"><label>Rechercher un email<input name="q" value="${esc(q)}" maxlength="100"></label> <button class="btn small">Chercher</button></form>
  <p class="muted small">${list.total} compte(s) · page ${list.page} / ${list.pages}</p>
  <div class="table-wrap"><table class="admin-table">
    <thead><tr><th>Email</th><th>Connexion</th><th>Plan</th><th>Statut</th><th>Créé</th><th>Dernière connexion</th><th>Liaison</th><th>Usage du mois</th><th>Actions</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="9">Aucun compte.</td></tr>'}</tbody>
  </table></div>
  <p class="admin-pager">${list.page > 1 ? `<a class="btn small" href="${nav(list.page - 1)}">Précédent</a>` : ''} ${list.page < list.pages ? `<a class="btn small" href="${nav(list.page + 1)}">Suivant</a>` : ''}</p>
  <p class="muted small">Usage : P projets, Pr prospects, M mails du mois, IA jobs IA du mois (utilisé/plafond).</p>
</section>
<section class="card">
  <h4>Journal d'audit</h4>
  <p class="muted small">Actions d'administration et décisions automatiques. Lecture seule ; les adresses sont masquées ; conservé 12 mois.</p>
  <div class="table-wrap"><table>
    <thead><tr><th>Date</th><th>Par</th><th>Action</th><th>Compte</th><th>Détail</th></tr></thead>
    <tbody>${auditRows || '<tr><td colspan="5">Rien pour le moment.</td></tr>'}</tbody>
  </table></div>
</section></div>`,
  });
}
