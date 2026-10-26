// Pages de l'équipe : gestion par le propriétaire, équipes dont on est membre, confirmation d'une invitation.
import { esc } from './http.js';
import { layout } from './views.js';
import { ic } from './icons.js';
import { ROLES, ROLE_LABELS } from './teams.js';

const fmt = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('fr-FR', { dateStyle: 'medium', timeZone: 'Europe/Paris' }) : '—');
const roleSelect = (value, name = 'role') => `<select name="${name}">${ROLES.map((r) => `<option value="${r}"${r === value ? ' selected' : ''}>${ROLE_LABELS[r]}</option>`).join('')}</select>`;

// Rôles et droits réels (voir src/teams.js, needAccess) : un tableau plutôt qu'une liste, pour comparer d'un coup d'œil
const RIGHTS = `<div class="table-wrap"><table class="rights" data-rt="skip">
  <caption class="sr-only">Ce que chaque rôle peut faire</caption>
  <thead><tr><th scope="col">Rôle</th><th scope="col">Ce qu'il peut faire</th></tr></thead>
  <tbody>
    <tr><th scope="row">Membre</th><td>Travaille sur les projets partagés : modèles, contacts, recherches, envois, notes.</td></tr>
    <tr><th scope="row">Administrateur</th><td>Comme un membre, et règle les projets : SMTP, boîte de réception, base du récap, LinkedIn.</td></tr>
    <tr><th scope="row">Propriétaire (toi)</th><td>Gère l'équipe, partage et supprime les projets.</td></tr>
  </tbody></table></div>
  <p class="muted small">L'équipe utilise ton offre : tes plafonds, ton SMTP et ton accès Claude servent à tous sur les projets partagés. Les membres n'ont pas besoin d'abonnement.</p>`;

function ownerSection(d) {
  const seats = d.seats;
  const seatText = seats.limit == null ? `${seats.used} place${seats.used > 1 ? 's' : ''} utilisée${seats.used > 1 ? 's' : ''}` : `${seats.used} / ${seats.limit} places utilisées`;
  const members = d.members.length ? `<div class="table-wrap"><table>
    <thead><tr><th>Membre</th><th>Rôle</th><th>Depuis</th><th></th></tr></thead><tbody>
    ${d.members.map((m) => `<tr><td>${esc(m.email)}</td>
      <td><form method="post" action="/team/member/${m.id}/role" class="inline-form">${roleSelect(m.role)} <button class="btn small">Changer</button></form></td>
      <td>${fmt(m.since)}</td>
      <td><form method="post" action="/team/member/${m.id}/remove"><button class="btn small danger">${ic('trash')}Retirer</button></form></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">Personne dans l\'équipe pour l\'instant.</p>';
  const invites = d.invites.length ? `<h3>Invitations en attente</h3><div class="table-wrap"><table>
    <thead><tr><th>Adresse</th><th>Rôle</th><th>Expire le</th><th></th></tr></thead><tbody>
    ${d.invites.map((i) => `<tr><td>${esc(i.email)}</td><td>${esc(ROLE_LABELS[i.role])}</td><td>${fmt(i.expiresAt)}</td>
      <td><form method="post" action="/team/invite/${i.id}/revoke"><button class="btn small">Annuler</button></form></td></tr>`).join('')}
    </tbody></table></div>` : '';
  return `<section class="card">
  <h2>Équipe « ${esc(d.team.name)} »</h2>
  <p class="muted">${esc(seatText)}. L'équipe utilise ton offre : tes plafonds, ton SMTP et ton accès Claude servent à tous sur les projets partagés.${seats.free === 0 ? ' <a href="/tarifs">Voir les offres avec plus de places</a>.' : ''}</p>
  ${RIGHTS}
  ${members}
  ${invites}
  <h3>Inviter quelqu'un</h3>
  <form method="post" action="/team/invite" class="cfg">
    <label>Adresse email<input name="email" type="email" required autocomplete="off"></label>
    <label>Rôle ${roleSelect('member')}</label>
    <button class="btn primary"${seats.free === 0 ? ' disabled' : ''}>Inviter</button>
  </form>
</section>
<section class="card">
  <h3>Projets partagés</h3>
  <p class="muted small">Seuls les projets marqués « partagé » sont visibles par l'équipe. Les autres restent à toi seul.</p>
  ${d.projects.length ? `<div class="table-wrap"><table><tbody>${d.projects.map((p) => `<tr><td>${esc(p.name)}</td>
    <td>${p.shared ? '<span class="badge ok">partagé</span>' : '<span class="badge">privé</span>'}</td>
    <td><form method="post" action="/team/projects/${p.id}/share"><input type="hidden" name="shared" value="${p.shared ? '0' : '1'}"><button class="btn small">${p.shared ? 'Ne plus partager' : 'Partager avec l\'équipe'}</button></form></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Tu n\'as pas encore de projet.</p>'}
</section>
<section class="card">
  <h3>Supprimer l'équipe</h3>
  <p class="muted small">Les membres perdent tout accès tout de suite. Tes projets restent à toi, intacts.</p>
  <form method="post" action="/team/delete"><button class="btn danger">${ic('trash')}Supprimer l'équipe</button></form>
</section>`;
}

function createSection(canTeam) {
  return canTeam
    ? `<section class="card team-new" aria-labelledby="h-tc">
  <div class="card-h"><h2 id="h-tc">Créer mon équipe</h2><p>Une équipe te permet de partager des projets avec des collègues, sans leur donner ton accès.</p></div>
  <form method="post" action="/team/create" class="cfg team-form"><label class="field"><span class="lbl">Nom de l'équipe</span><input name="name" required maxlength="80" autocomplete="off" placeholder="ex. Atelier Exemple"></label><button class="btn primary">Créer l'équipe</button></form>
  <div class="team-roles"><h3 class="sub-h">Rôles et droits</h3>${RIGHTS}</div>
</section>`
    : `<section class="card" aria-labelledby="h-tc"><h2 id="h-tc">Équipe</h2>
  <p class="muted">Ton offre actuelle ne comprend pas de place d'équipe. <a href="/tarifs">Voir les offres qui en proposent</a>.</p></section>`;
}

export function teamPage({ user, owned = null, memberOf = [], canTeam = false, error = null, notice = null }) {
  const member = memberOf.length ? `<section class="card"><h2>Équipes dont je suis membre</h2>
  <div class="table-wrap"><table><tbody>${memberOf.map((t) => `<tr><td><strong>${esc(t.name)}</strong><br><span class="muted small">de ${esc(t.ownerEmail)}</span></td>
    <td>${esc(ROLE_LABELS[t.role])}</td>
    <td><form method="post" action="/team/${t.id}/leave"><button class="btn small danger">Quitter</button></form></td></tr>`).join('')}</tbody></table></div>
  <p class="muted small">Les projets partagés apparaissent dans ton tableau de bord, avec le nom du propriétaire.</p></section>` : '';
  return layout({
    title: 'Équipe', email: user.email,
    body: `<div class="narrow"><h1>Équipe</h1>
${error ? `<p class="msg msg-err" role="alert">${esc(error)}</p>` : ''}${notice ? `<p class="msg msg-ok" role="status">${esc(notice)}</p>` : ''}
${owned ? ownerSection(owned) : createSection(canTeam)}
${member}</div>`,
  });
}

export function joinPage({ user, token, info, error = null }) {
  const body = !info.ok
    ? `<section class="card"><h2>Invitation</h2><p class="error">${esc(info.message)}</p><p><a class="btn" href="/">Retour au tableau de bord</a></p></section>`
    : `<section class="card"><h2>Rejoindre l'équipe « ${esc(info.team.name)} »</h2>
  <p>${esc(info.team.ownerEmail)} t'invite en tant que <strong>${esc(ROLE_LABELS[info.role].toLowerCase())}</strong>.</p>
  <p class="muted small">Tu verras les projets qu'il partage avec l'équipe et pourras y travailler avec son accès Claude, son SMTP et ses plafonds. Tu pourras quitter l'équipe à tout moment.</p>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <form method="post" action="/team/join/${esc(token)}" class="row-actions"><button class="btn primary">Rejoindre l'équipe</button> <a class="btn" href="/">Pas maintenant</a></form></section>`;
  return layout({ title: 'Invitation', email: user.email, body: `<div class="narrow"><h1>Invitation</h1>${body}</div>` });
}
