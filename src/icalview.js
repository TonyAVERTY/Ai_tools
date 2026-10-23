// Bloc « agenda externe » partagé par la page Calendrier et la page Mon compte (sans dépendance vers views.js : pas de cycle d'import).
import { esc } from './http.js';
import { ic } from './icons.js';

/** Bloc « agenda externe » (page Calendrier et page Mon compte) : `back` = page où revenir après une action. */
export function icalBox(url, back) {
  const hidden = `<input type="hidden" name="back" value="${esc(back)}">`;
  return url ? `<div class="tokenbox"><code>${esc(url)}</code></div>
      <p class="muted small">Ajoute ce lien dans Google Agenda (Autres agendas → À partir de l'URL), Apple Calendrier (Fichier → Nouvel abonnement) ou Outlook. Il affiche tes prochaines actions et tes posts LinkedIn programmés. <b>Garde-le secret</b> : quiconque l'a peut lire ces rendez-vous.</p>
      <div class="row-actions"><form method="post" action="/calendar/feed">${hidden}<button class="btn small">${ic('repeat')}Régénérer le lien</button></form>
        <form method="post" action="/calendar/feed/delete">${hidden}<button class="btn small danger">${ic('trash')}Supprimer le lien</button></form></div>`
    : `<p class="muted">Affiche tes prochaines actions et tes posts LinkedIn programmés dans Google Agenda, Apple Calendrier ou Outlook, grâce à un lien d'abonnement secret.</p>
      <form method="post" action="/calendar/feed">${hidden}<button class="btn primary">${ic('link')}Créer mon lien d'agenda</button></form>`;
}
