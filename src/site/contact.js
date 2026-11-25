// Page « Contact » : un formulaire à la place d'une adresse e-mail affichée (voir src/services/contact.js).
import { siteLayout } from './layout.js';
import { esc } from '../http.js';
import { CONTACT_LEN, TOPICS } from '../services/contact.js';
import { LEN } from '../inputlimits.js';

export function contactFormPage({ appUrl, token, values = {}, error = '', sent = false }) {
  const v = { name: '', email: '', topic: 'question', message: '', ...values };
  const body = sent
    ? `<div class="wrap narrow-page"><h1 class="h1">Message envoyé</h1>
  <p class="lead">Merci, ton message est bien parti. Nous te répondons par e-mail, en général sous quelques jours.</p>
  <p><a class="btn btn-secondary" href="/accueil">Retour à l'accueil</a></p></div>`
    : `<div class="wrap narrow-page"><h1 class="h1">Contact</h1>
  <p class="lead">Une question, une demande sur tes données personnelles ou un contenu à signaler ? Écris-nous avec ce formulaire : nous te répondons par e-mail.</p>
  ${error ? `<p class="msg msg-err" role="alert">${esc(error)}</p>` : ''}
  <form method="post" action="/contact" class="ct-form" data-noajax>
    <input type="hidden" name="ts" value="${esc(token)}">
    <p class="hp" aria-hidden="true"><label>Ne pas remplir ce champ<input type="text" name="website" tabindex="-1" autocomplete="off"></label></p>
    <label class="ct-f"><span>Ton nom</span><input type="text" name="name" required maxlength="${CONTACT_LEN.name}" autocomplete="name" value="${esc(v.name)}"></label>
    <label class="ct-f"><span>Ton adresse e-mail <small>(pour te répondre, jamais affichée ni partagée)</small></span><input type="email" name="email" required maxlength="${LEN.email}" autocomplete="email" inputmode="email" value="${esc(v.email)}"></label>
    <label class="ct-f"><span>Sujet</span><select name="topic">${Object.entries(TOPICS).map(([k, label]) => `<option value="${k}"${k === v.topic ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
    <label class="ct-f"><span>Ton message</span><textarea name="message" required minlength="10" maxlength="${CONTACT_LEN.message}" rows="8">${esc(v.message)}</textarea></label>
    <p class="muted small">Ces informations servent uniquement à te répondre. Elles ne sont pas enregistrées sur le site : le message arrive dans la boîte de l'éditeur. Voir la <a href="/confidentialite">politique de confidentialité</a>.</p>
    <button class="btn btn-primary" type="submit">Envoyer le message</button>
  </form></div>`;
  return siteLayout({
    appUrl, path: '/contact', title: 'Contact · iaboss', description: 'Écrire à l\'équipe iaboss : question, données personnelles, signalement.',
    noindex: true, body,
  });
}
