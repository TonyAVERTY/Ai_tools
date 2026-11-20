// Vues de l'authentification à deux facteurs : carte « Sécurité » du compte, page de saisie du code à la connexion, page des codes de secours.
import { esc } from './http.js';
import { ic } from './icons.js';
import { layout } from './views.js';
import { siteLayout } from './site/layout.js';
import { otpauthUrl } from './totp.js';

const group = (secret) => secret.match(/.{1,4}/g).join(' ');

/** Carte « Sécurité » de la page Mon compte : trois états (désactivée, en cours d'activation, activée). */
export function securityCard({ enabled, setup = null, email, recoveryLeft = 0 }) {
  const code = (name = 'code') => `<label class="field"><span class="lbl">Code à 6 chiffres</span><input name="${name}" inputmode="numeric" autocomplete="one-time-code" maxlength="20" required></label>`;
  let body;
  if (enabled) {
    body = `<p><span class="badge ok">Activée</span> Un code de ton application d'authentification est demandé à chaque connexion.</p>
  <p class="muted small">Codes de secours restants : <b>${recoveryLeft}</b> sur 10.</p>
  <form method="post" action="/account/2fa/recovery" class="cfg"><p class="muted small">Pour en obtenir 10 nouveaux (les anciens cessent de marcher), saisis un code de ton application.</p>${code()}
    <div class="row"><button class="btn">Régénérer les codes de secours</button></div></form>
  <form method="post" action="/account/2fa/disable" class="cfg" data-confirm="Désactiver l'A2F ? Ton compte ne sera plus protégé que par ton compte Google ou Apple."><p class="muted small">Pour la désactiver, saisis un code de ton application ou un code de secours.</p>${code()}
    <div class="row"><button class="btn danger">Désactiver l'A2F</button></div></form>`;
  } else if (setup) {
    body = `<p>1. Dans ton application d'authentification (Google Authenticator, Authy, 1Password, Bitwarden…), ajoute un compte avec cette clé :</p>
  <div class="cmd"><span class="lbl">Clé de configuration</span><div class="cmd-b"><pre><code>${esc(group(setup))}</code></pre><button type="button" class="btn small" data-copy-cmd aria-label="Copier : clé de configuration">${ic('copy')}Copier</button></div></div>
  <p class="muted small">Sur un téléphone, <a href="${esc(otpauthUrl(setup, email))}">ouvre directement l'application</a> pour l'ajouter sans rien taper. Type de clé : temporelle, 6 chiffres, 30 secondes.</p>
  <form method="post" action="/account/2fa/enable" class="cfg"><p>2. Saisis le code qu'elle affiche pour vérifier que tout est en place.</p>${code()}
    <div class="row"><button class="btn primary">${ic('shield')}Activer l'A2F</button></div></form>
  <form method="post" action="/account/2fa/cancel" class="cfg"><div class="row"><button class="btn">Annuler</button></div></form>`;
  } else {
    body = `<p class="muted">L'A2F ajoute un second contrôle à la connexion : en plus de ton compte Google ou Apple, il faut un code à 6 chiffres qui change toutes les 30 secondes.</p>
  <form method="post" action="/account/2fa/start" class="cfg"><div class="row"><button class="btn primary">${ic('shield')}Activer l'A2F</button></div></form>`;
  }
  return `<section class="card" id="securite" aria-labelledby="h-sec">
  <div class="card-h"><h2 id="h-sec">Sécurité : A2F</h2><p>Authentification à deux facteurs pour protéger ton compte.</p></div>
  ${body}
</section>`;
}

/** Saisie du code après le retour de Google ou d'Apple (session « en attente »). */
export function mfaLoginPage({ appUrl, error = null }) {
  return siteLayout({
    appUrl, path: '/login/2fa', noindex: true, title: 'Code de vérification · iaboss',
    description: 'Saisis le code de ton application d\'authentification pour finir ta connexion.',
    body: `<div class="stage-p"><div class="wrap"><section class="auth" aria-labelledby="m-h">
  <div><h1 id="m-h">Code de vérification</h1><p class="sub">Saisis le code à 6 chiffres de ton application d'authentification. Tu n'y as plus accès ? Utilise un code de secours.</p></div>
  ${error ? `<p class="msg msg-err" role="alert">${esc(error)}</p>` : ''}
  <form method="post" action="/login/2fa" class="cfg">
    <label class="field"><span class="lbl">Code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="20" required autofocus></label>
    <div class="row"><button class="btn primary">Valider</button></div>
  </form>
  <p class="fine"><a href="/login">Annuler et revenir à la connexion</a></p>
</section></div></div>`,
  });
}

/** Les codes de secours, montrés une seule fois (réponse directe du POST, jamais en adresse). */
export function recoveryCodesPage({ user, codes }) {
  return layout({ title: 'Codes de secours', email: user.email, body: `<div class="narrow"><h1 class="h1">${ic('shield')}Codes de secours</h1>
<section class="card" role="status"><div class="card-h"><h2>A2F activée : garde ces codes</h2><p>Chaque code ne sert qu'une fois, si tu perds ton application d'authentification. Ils ne seront plus jamais affichés : range-les dans un gestionnaire de mots de passe.</p></div>
  <div class="tokenbox"><code data-token>${codes.map(esc).join('\n')}</code><button type="button" class="btn small" data-copy-token>${ic('copy')}Copier</button></div>
  <div class="row"><a class="btn primary" href="/account#securite">J'ai conservé mes codes</a></div></section></div>` });
}
