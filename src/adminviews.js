// Page /admin : comptes (identité, liaison, usage de la semaine) et journal d'audit. Aucune donnée métier.
import { esc } from './http.js';
import { layout } from './views.js';
import { banner } from './banner.js';
import { localeOf } from './i18n/locale.js';

const fmt = (ts) => (ts ? new Date(ts * 1000).toLocaleString(localeOf(), { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }) : '—');
const PROVIDERS = { google: 'Google', apple: 'Apple' };
const PLANS = { free: 'gratuit', pro: 'pro', admin: 'administrateur' };

// Usage de la semaine : une colonne par plafond, « utilisé / plafond » (ou le seul nombre quand il n'y a pas de plafond), chiffres alignés à droite
const cap = (used, limit) => (limit == null ? `${used}` : `${used} / ${limit}`);
const USAGE_COLS = [['projects', 'Projets'], ['prospects', 'Prospects'], ['mails', 'Mails'], ['aiJobs', 'Tâches IA']];
const full = (u, k) => u.limits[k] != null && u[k] >= u.limits[k];
const usageCells = (u) => USAGE_COLS.map(([k, label]) => `<td class="num${full(u, k) ? ' error' : ''}" data-label="${label}">${cap(u[k], u.limits[k])}</td>`).join('');

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
      ${f('delete', `<label>Saisis l'email du compte pour confirmer<input maxlength="254" name="confirm" type="email" required autocomplete="off" placeholder="${esc(a.email)}"></label><button class="btn small danger">Supprimer définitivement</button>`)}
    </details>
  </div>`;
}

export function adminPage({ user, list, audit, q = '', notice = null, error = null }) {
  const nav = (p) => `/admin?page=${p}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const rows = list.accounts.map((a) => `<tr>
    <td>${esc(a.email)}${a.isAdmin ? ' <span class="badge">admin</span>' : ''}</td>
    <td>${esc(PROVIDERS[a.provider] || '—')}</td>
    <td>${esc(PLANS[a.plan] || a.plan)}</td>
    <td>${a.status === 'active' ? '<span class="badge ok">actif</span>' : '<span class="badge err">suspendu</span>'}${a.sendPause ? ' <span class="badge warn">envois en pause</span>' : ''}</td>
    <td>${fmt(a.createdAt)}<span class="td-s">dernière connexion : ${fmt(a.lastLoginAt)}</span></td>
    <td>${a.link ? `${esc(a.link.mode)}${a.link.valid ? '' : ' <span class="error small">invalide</span>'}` : '—'}</td>
    ${usageCells(a.usage)}
    <td>${actions(a, list.page, q, user.id)}</td>
  </tr>`).join('');
  const auditRows = audit.map((r) => `<tr><td>${fmt(r.at)}</td><td>${esc(r.admin)}</td><td>${esc(r.label)}</td><td>${esc(r.target || '—')}</td><td class="small">${esc(r.detail || '')}</td></tr>`).join('');
  return layout({
    title: 'Administration', email: user.email,
    body: `<div class="stack"><h1>Administration</h1>
<p><a class="btn small" href="/admin/stats">Statistiques globales</a></p>
<p class="muted">Comptes et compteurs d'usage uniquement : aucun accès aux prospects, mails ni notes des utilisateurs.</p>
${notice ? banner('ok', notice) : ''}
${error ? banner('err', error) : ''}
<section class="card">
  <form method="get" action="/admin" class="inline admin-search"><label class="field"><span class="lbl">Rechercher un email</span><input name="q" type="search" value="${esc(q)}" maxlength="100" placeholder="nom@exemple.fr"></label> <button class="btn small">Chercher</button></form>
  <p class="muted small">${list.total} compte${list.total > 1 ? 's' : ''}${list.pages > 1 ? `, page ${list.page} sur ${list.pages}` : ''}</p>
  <div class="table-wrap"><table class="admin-table">
    <thead><tr><th>Email</th><th>Connexion</th><th>Plan</th><th>Statut</th><th>Créé le</th><th>Liaison</th>${USAGE_COLS.map(([, l]) => `<th class="num" scope="col">${l}</th>`).join('')}<th>Actions</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="11">Aucun compte ne correspond.</td></tr>'}</tbody>
  </table></div>
  <p class="admin-pager">${list.page > 1 ? `<a class="btn small" href="${nav(list.page - 1)}">Précédent</a>` : ''} ${list.page < list.pages ? `<a class="btn small" href="${nav(list.page + 1)}">Suivant</a>` : ''}</p>
  <p class="muted small">Les quatre colonnes de droite comptent l'usage de la semaine en cours (du lundi à minuit, heure de Paris), sur le plafond de l'offre. Un nombre en rouge : plafond atteint.</p>
</section>
<section class="card">
  <h2>Journal d'audit</h2>
  <p class="muted small">Actions d'administration et décisions automatiques. Lecture seule ; les adresses sont masquées ; conservé 12 mois.</p>
  ${auditRows ? `<div class="table-wrap"><table>
    <thead><tr><th>Date</th><th>Par</th><th>Action</th><th>Compte</th><th>Détail</th></tr></thead>
    <tbody>${auditRows}</tbody>
  </table></div>` : '<p class="muted">Rien pour le moment : les actions d\'administration et les décisions automatiques apparaîtront ici.</p>'}
</section></div>`,
  });
}

const int = (n) => Number(n).toLocaleString(localeOf());
const usd = (n) => `${Number(n).toLocaleString(localeOf(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const secs = (n) => (n == null ? '—' : n < 90 ? `${Math.round(n)} s` : `${Math.floor(n / 60)} min ${String(Math.round(n % 60)).padStart(2, '0')} s`);
const pct = (n) => (n == null ? '—' : `${(n * 100).toLocaleString(localeOf(), { maximumFractionDigits: 1 })} %`);

/** Page /admin/stats : totaux de toute l'application, sans aucune donnée d'un compte en particulier. */
export function adminStatsPage({ user, stats, periods }) {
  const tile = (label, value, hint = '') => `<section class="card"><div class="card-h"><h2>${esc(label)}</h2></div><p class="stat-n">${value}</p>${hint ? `<p class="muted small">${hint}</p>` : ''}</section>`;
  const tabs = Object.entries(periods).map(([k, p]) => `<a href="/admin/stats?p=${k}"${k === stats.period ? ' aria-current="true"' : ''}>${esc(p.label)}</a>`).join('');
  const models = stats.models.length ? `<div class="table-wrap"><table><thead><tr><th>Modèle</th><th class="num">Requêtes</th><th class="num">Tokens entrants</th><th class="num">Tokens sortants</th><th class="num">Coût</th></tr></thead><tbody>
    ${stats.models.map((m) => `<tr><td>${esc(m.label)}</td><td class="num" data-label="Requêtes">${int(m.requests)}</td><td class="num" data-label="Tokens entrants">${int(m.tokensIn)}</td><td class="num" data-label="Tokens sortants">${int(m.tokensOut)}</td><td class="num" data-label="Coût">${usd(m.cost)}</td></tr>`).join('')}
  </tbody></table></div>` : '<p class="muted">Aucune requête IA sur la période.</p>';
  const errs = stats.errorsByType.length ? `<div class="table-wrap"><table><thead><tr><th>Type de tâche</th><th class="num">Erreurs</th></tr></thead><tbody>
    ${stats.errorsByType.map((e) => `<tr><td><code>${esc(e.type)}</code></td><td class="num" data-label="Erreurs">${int(e.n)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aucune tâche en erreur sur la période.</p>';
  const list = (rows, key, head) => (rows.length ? `<div class="table-wrap"><table><thead><tr><th>${head}</th><th class="num">Pages vues</th></tr></thead><tbody>${rows.map((r) => `<tr><td><code>${esc(r[key])}</code></td><td class="num" data-label="Pages vues">${int(r.n)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Rien sur la période.</p>');
  const audience = `${list(stats.audience.pages, 'path', 'Page')}<h3 class="h3">D'où viennent les visites</h3>${list(stats.audience.referrers, 'host', 'Site d\'origine')}`;
  const body = `<div class="pj-page"><div class="ph"><div class="t"><h1>Statistiques globales</h1><span class="muted small">Toute l'application, sur ${esc(periods[stats.period].label)} · <a href="/admin">Retour aux comptes</a></span></div></div>
<nav class="per" aria-label="Période">${tabs}</nav>
<div class="pj-cards">
${tile('Requêtes IA', int(stats.ai.requests), `${int(stats.ai.jobs)} tâches et ${int(stats.ai.chats)} réponses de la page IA`)}
${tile('Mails envoyés', int(stats.mails.sent), stats.mails.errors ? `${int(stats.mails.errors)} en échec` : 'aucun échec')}
${tile('Réponses reçues', int(stats.replies.total), `soit ${pct(stats.replies.rate)} des mails envoyés`)}
${tile('Temps de réponse IA', secs(stats.response.avg), `médiane ${secs(stats.response.p50)} · 95 % en moins de ${secs(stats.response.p95)} (${int(stats.response.count)} tâches terminées)`)}
${tile('Erreurs IA', int(stats.ai.errors), `sur ${int(stats.ai.jobs)} tâches`)}
${tile('Consommation IA', usd(stats.ai.cost), `${int(stats.ai.tokensIn + stats.ai.tokensOut)} tokens sur les tâches`)}
</div>
<section class="card"><div class="card-h"><h2>Consommation par modèle</h2><p>Les tâches d'avant la mise en place de ce suivi n'ont pas de modèle enregistré.</p></div>${models}</section>
<section class="card"><div class="card-h"><h2>Erreurs par type de tâche</h2></div>${errs}</section>
<section class="card"><div class="card-h"><h2>Fréquentation du site public</h2><p>Mesure sans cookie ni identifiant : ${int(stats.audience.total)} pages vues sur la période. Les visites avec « Ne pas me suivre » et les robots ne sont pas comptés.</p></div>${audience}</section></div>`;
  return layout({ title: 'Statistiques globales', email: user.email, body });
}
