// Vues de l'authentification à deux facteurs : carte « Sécurité » du compte, page de saisie du code à la connexion, page des codes de secours.
import { esc } from './http.js';
import { ic } from './icons.js';
import { banner } from './banner.js';
import { layout } from './views.js';
import { siteLayout } from './site/layout.js';
import { otpauthUrl } from './totp.js';
import { qrSvg } from './qr.js';

/** Carte « Sécurité » de la page Mon compte : trois états (désactivée, en cours d'activation, activée). */
export function securityCard({ enabled, setup = null, email, recoveryLeft = 0, devices = 0 }) {
  const code = (name = 'code') => `<label class="field"><span class="lbl">Code à 6 chiffres</span><input name="${name}" inputmode="numeric" autocomplete="one-time-code" maxlength="20" required></label>`;
  let body;
  if (enabled) {
    body = `<p><span class="badge ok">Activée</span> Un code de ton application d'authentification est demandé à chaque connexion.</p>
  <p class="muted small">Codes de secours restants : <b>${recoveryLeft}</b> sur 10.</p>
  <form method="post" action="/account/2fa/forget" class="cfg"><p class="muted small">Appareils de confiance (sans code pendant 30 jours) : <b>${devices}</b>.</p>${devices ? '<div class="row"><button class="btn">Oublier mes appareils de confiance</button></div>' : ''}</form>
  <form method="post" action="/account/2fa/recovery" class="cfg" data-one-code>
    <p class="muted small">Pour régénérer les codes de secours (les anciens cessent de marcher) ou pour désactiver l'A2F, saisis un code de ton application ou un code de secours, puis choisis l'action.</p>${code()}
    <div class="row"><button class="btn">Régénérer les codes de secours</button>
      <button class="btn danger" formaction="/account/2fa/disable" data-confirm="Désactiver l'A2F ? Ton compte ne sera plus protégé que par ton compte Google ou Apple." data-confirm-label="Désactiver l'A2F">Désactiver l'A2F</button></div>
  </form>`;
  } else if (setup) {
    body = `<p>1. Dans ton application d'authentification (Google Authenticator, Authy, 1Password, Bitwarden…), scanne ce QR code.</p>
  <div class="qr-box">${qrSvg(otpauthUrl(setup, email), 'QR code à scanner avec ton application d\'authentification')}
    <button type="button" class="btn" data-open-dialog="mfa-key">${ic('key')}Clé de configuration</button></div>
  <p class="muted small">Sur un téléphone, <a href="${esc(otpauthUrl(setup, email))}">ouvre directement l'application</a> pour l'ajouter sans scanner.</p>
  <form method="post" action="/account/2fa/enable" class="cfg"><p>2. Saisis le code qu'elle affiche pour vérifier que tout est en place.</p>${code()}
    <div class="row"><button class="btn primary">${ic('shield')}Activer l'A2F</button></div></form>
  <form method="post" action="/account/2fa/cancel" class="cfg"><div class="row"><button class="btn">Annuler</button></div></form>
  <dialog class="prospect-dialog modal" id="mfa-key" aria-labelledby="mfa-key-t"><div class="cfg">
    <h2 id="mfa-key-t">${ic('key')}Clé de configuration</h2>
    <p class="muted small">Si tu ne peux pas scanner le QR code, ajoute un compte dans ton application avec cette clé. Type de clé : temporelle, 6 chiffres, 30 secondes.</p>
    <div class="cmd"><span class="lbl">Clé</span><div class="cmd-b"><pre><code>${esc(setup)}</code></pre><button type="button" class="btn small" data-copy-cmd aria-label="Copier la clé de configuration">${ic('copy')}Copier</button></div></div>
    <div class="modal-f"><button type="button" class="btn primary" data-close-dialog>Fermer</button></div>
  </div></dialog>`;
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
  ${error ? banner('err', error) : ''}
  <form method="post" action="/login/2fa" class="auth-f">
    <label for="mfa-code">Code</label>
    <input id="mfa-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="20" required autofocus>
    <label class="chk"><input type="checkbox" name="trust" value="on"><span>Faire confiance à cet appareil pendant 30 jours</span></label>
    <button class="btn btn-primary btn-lg btn-block">Valider</button>
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
