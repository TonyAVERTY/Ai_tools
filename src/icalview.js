// Bloc « agenda externe » partagé par la page Calendrier et la page Mon compte (sans dépendance vers views.js : pas de cycle d'import).
import { esc } from './http.js';
import { ic } from './icons.js';

/** Le petit « i » : un tutoriel pour ajouter le lien sur iPhone, Android et ordinateur (sans JavaScript : un <details>). */
export function icalTip(url) {
  const webcal = url ? String(url).replace(/^https?:/, 'webcal:') : null;
  return `<details class="tip"><summary aria-label="Comment ajouter ce lien à mon agenda ?"><span class="tip-i" aria-hidden="true">i</span><span class="tip-t">Comment l'ajouter à mon agenda ?</span></summary>
    <div class="tip-body">
      <h4>iPhone (et iPad)</h4>
      ${webcal ? `<p><a class="btn small" href="${esc(webcal)}">${ic('link')}Ouvrir dans Calendrier</a> : depuis ton iPhone, un appui suffit, puis « S'abonner ».</p>` : ''}
      <ol><li>Copie le lien ci-dessus.</li>
        <li>Ouvre <b>Réglages</b> → <b>Calendrier</b> (iOS 17 et plus : <b>Apps</b> → <b>Calendrier</b>) → <b>Comptes</b> → <b>Ajouter un compte</b> → <b>Autre</b>.</li>
        <li>Touche <b>Ajouter un calendrier avec abonnement</b>, colle le lien, puis <b>Suivant</b> et <b>Enregistrer</b>.</li></ol>
      <h4>Android</h4>
      <p>L'application Google Agenda ne sait pas ajouter un lien directement : on l'ajoute <b>une fois depuis un ordinateur</b> (ou le navigateur du téléphone en « version pour ordinateur »), puis il apparaît dans l'appli.</p>
      <ol><li>Ouvre <b>calendar.google.com</b> avec ton compte Google.</li>
        <li>À gauche, <b>Autres agendas</b> → <b>+</b> → <b>À partir de l'URL</b>.</li>
        <li>Colle le lien, clique <b>Ajouter l'agenda</b>.</li>
        <li>Sur le téléphone, dans Google Agenda : menu ☰, vérifie que l'agenda « AiTools » est coché.</li></ol>
      <p class="muted small">Sans compte Google : l'application gratuite <b>ICSx⁵</b> (Play Store, F-Droid) ajoute un lien iCal directement.</p>
      <h4>Ordinateur</h4>
      <p><b>Outlook</b> : Ajouter un calendrier → S'abonner à partir du web. <b>Apple Calendrier (Mac)</b> : Fichier → Nouvel abonnement à un calendrier.</p>
      <p class="muted small">Les agendas se mettent à jour tout seuls, mais pas à la seconde : Google rafraîchit un agenda ajouté par lien toutes les 12 à 24 heures environ, Apple selon ton réglage. Le lien est secret : ne le partage pas ; si tu l'as diffusé, régénère-le.</p>
    </div></details>`;
}

/** Bloc « agenda externe » (page Calendrier et page Mon compte) : `back` = page où revenir après une action. */
export function icalBox(url, back) {
  const hidden = `<input type="hidden" name="back" value="${esc(back)}">`;
  return url ? `<div class="tokenbox"><code>${esc(url)}</code></div>
      ${icalTip(url)}
      <p class="muted small">Ajoute ce lien dans Google Agenda (Autres agendas → À partir de l'URL), Apple Calendrier (Fichier → Nouvel abonnement) ou Outlook. Il affiche tes prochaines actions et tes posts LinkedIn programmés. <b>Garde-le secret</b> : quiconque l'a peut lire ces rendez-vous.</p>
      <div class="row-actions"><form method="post" action="/calendar/feed">${hidden}<button class="btn small">${ic('repeat')}Régénérer le lien</button></form>
        <form method="post" action="/calendar/feed/delete">${hidden}<button class="btn small danger">${ic('trash')}Supprimer le lien</button></form></div>`
    : `<p class="muted">Affiche tes prochaines actions et tes posts LinkedIn programmés dans Google Agenda, Apple Calendrier ou Outlook, grâce à un lien d'abonnement secret.</p>
      ${icalTip(null)}
      <form method="post" action="/calendar/feed">${hidden}<button class="btn primary">${ic('link')}Créer mon lien d'agenda</button></form>`;
}
