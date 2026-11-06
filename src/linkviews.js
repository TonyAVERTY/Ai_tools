// Page « Relier mon IA » : onboarding bloquant. L'utilisateur choisit son IA (Claude, ChatGPT ou Gemini) sur trois cartes avec leur logo ; un clic
// ouvre les options de connexion de cette IA. Les formulaires sont des POST classiques ; les fenêtres d'avertissement (<dialog>) et la connexion
// guidée sont gérées par public/app.js (Claude) et public/app-link.js (cartes, ChatGPT).
import { esc } from './http.js';
import { ic } from './icons.js';
import { banner } from './banner.js';
import { layout, pctBlock } from './views.js';
import { CONSENT_TEXT, CONSENT_CHECKBOX, CONSENT_VERSION, OPENAI_CONSENT_TEXT, OPENAI_CONSENT_VERSION, GOOGLE_CONSENT_TEXT } from './claudelink.js';

/** Les trois IA proposées, dans l'ordre d'affichage. `how(cli)` : ce que la carte dit en une ligne (l'abonnement n'est cité que s'il est proposé). */
export const AI_CARDS = [
  { id: 'claude', name: 'Claude', company: 'Anthropic', how: (cli) => (cli ? 'Clé API ou abonnement' : 'Clé API') },
  { id: 'openai', name: 'ChatGPT', company: 'OpenAI', how: (cli) => (cli ? 'Clé API ou compte ChatGPT' : 'Clé API') },
  { id: 'gemini', name: 'Gemini', company: 'Google', how: (cli, google) => (google ? 'Clé API ou compte Google' : 'Clé API Google AI Studio') },
];

const notice = (texts) => `<div class="notice">${texts.map((t) => `<p>${esc(t)}</p>`).join('')}</div>`;
const consentBox = () => `<label class="check opt"><input type="checkbox" name="accept" data-consent required><span class="box">${ic('check')}</span><span>${esc(CONSENT_CHECKBOX)}</span></label>`;

/** Formulaire de clé API (même forme pour les trois IA). */
function keyPanel({ id, title, body, placeholder, provider, badge = 'Recommandée' }) {
  return `<section class="panel link-main" aria-labelledby="${id}">
  <div class="panel-h"><h2 id="${id}">${title}</h2>${badge ? `<span class="badge ok">${ic('check')}${badge}</span>` : ''}</div>
  ${body}
  <form method="post" action="/link/api-key" class="cfg link-key">
    <input type="hidden" name="provider" value="${provider}">
    <label class="field"><span class="lbl">Clé API</span><input name="apiKey" type="password" autocomplete="new-password" spellcheck="false" required placeholder="${placeholder}"></label>
    <button class="btn primary">Vérifier et relier</button>
  </form>
</section>`;
}

function claudePanel(cliModeEnabled) {
  const key = keyPanel({
    id: 'h-key', title: 'Clé API Anthropic', provider: 'claude', placeholder: 'sk-ant-…',
    body: '<p>Crée une clé sur console.anthropic.com puis colle-la ici. Elle est vérifiée sans consommer de tokens, chiffrée, et ne sera plus jamais affichée (seuls ses 4 derniers caractères le seront). Tu paies à l\'usage, directement chez Anthropic.</p>',
  });
  // Alternatives par abonnement : un bloc, avec le risque annoncé dans son titre ; deux lignes (connexion guidée, jeton collé)
  const alts = cliModeEnabled ? `
<section class="alts" aria-labelledby="h-alt">
  <div class="alts-h"><h2 id="h-alt">Avec ton abonnement Claude (Pro, Max)</h2><span class="badge warn">${ic('alert')}Risque pour ton compte</span></div>
  <p class="hint">Utilise ton abonnement au lieu d'une clé API. Cette option comporte un risque pour ton compte Claude : une fenêtre d'avertissement s'affiche avant de continuer.</p>
  <div class="alt">
    <div class="alt-t"><h3>Se connecter avec Claude</h3><p>Connexion guidée : tu te connectes à Claude, puis tu recopies le code qu'il affiche.</p></div>
    <button type="button" class="btn" data-open-dialog="consent-dialog">Se connecter avec Claude</button>
  </div>
  <div class="alt">
    <div class="alt-t"><h3>Jeton collé à la main</h3><p>Colle un jeton d'abonnement Claude. Pour les cas où la connexion directe ne passe pas.</p></div>
    <details class="manual"><summary class="btn">Coller un jeton</summary>
      <form method="post" action="/link/subscription" class="cfg" data-consent-form>
        ${notice(CONSENT_TEXT)}
        ${consentBox()}
        <p class="hint">Sur ta propre machine, lance la commande <code>claude setup-token</code>, connecte-toi à ton compte Claude quand le navigateur s'ouvre, puis copie le jeton affiché et colle-le ci-dessous. Le jeton est chiffré, utilisé uniquement pour tes jobs, et n'est jamais réaffiché.</p>
        <label class="field"><span class="lbl">Jeton d'abonnement</span><input name="token" type="password" autocomplete="new-password" spellcheck="false" required></label>
        <p class="hint">La vérification lance un appel minimal du CLI : quelques tokens sont décomptés de ton abonnement.</p>
        <button class="btn primary" data-consent-submit disabled>Relier avec mon jeton</button>
      </form>
    </details>
  </div>
</section>` : '';
  return key + alts;
}

function openaiPanel(cliModeEnabled) {
  const key = keyPanel({
    id: 'h-key-openai', title: 'Clé API OpenAI', provider: 'openai', placeholder: 'sk-…',
    body: '<p>Crée une clé sur platform.openai.com/api-keys puis colle-la ici. Elle est vérifiée sans consommer de tokens, chiffrée, et ne sera plus jamais affichée (seuls ses 4 derniers caractères le seront). Tu paies à l\'usage, directement chez OpenAI.</p>',
  });
  const alts = cliModeEnabled ? `
<section class="alts" aria-labelledby="h-alt-openai">
  <div class="alts-h"><h2 id="h-alt-openai">Avec ton compte ChatGPT (Plus, Pro, Business)</h2><span class="badge warn">${ic('alert')}Risque pour ton compte</span></div>
  <p class="hint">Utilise ton abonnement ChatGPT au lieu d'une clé API. Cette option comporte un risque pour ton compte : une fenêtre d'avertissement s'affiche avant de continuer. Tes tâches passent l'une après l'autre.</p>
  <div class="alt">
    <div class="alt-t"><h3>Se connecter avec ChatGPT</h3><p>Connexion guidée : un lien et un code s'affichent, tu valides sur chatgpt.com, c'est tout.</p></div>
    <button type="button" class="btn" data-open-dialog="chatgpt-dialog">Se connecter avec ChatGPT</button>
  </div>
  <div class="alt">
    <div class="alt-t"><h3>Fichier de connexion collé</h3><p>Colle le fichier de connexion de Codex. Pour les cas où la connexion directe ne passe pas.</p></div>
    <details class="manual"><summary class="btn">Coller le fichier</summary>
      <form method="post" action="/link/chatgpt/auth" class="cfg" data-consent-form>
        ${notice(OPENAI_CONSENT_TEXT)}
        ${consentBox()}
        <p class="hint">Sur ta propre machine, lance <code>codex login</code> et connecte-toi à ton compte ChatGPT, puis colle ci-dessous le contenu complet du fichier <code>~/.codex/auth.json</code>. Il est chiffré, utilisé uniquement pour tes jobs, et n'est jamais réaffiché.</p>
        <label class="field"><span class="lbl">Contenu du fichier de connexion</span><textarea name="authJson" rows="5" autocomplete="off" spellcheck="false" required></textarea></label>
        <p class="hint">La vérification lance un appel minimal du CLI : quelques tokens sont décomptés de ton abonnement.</p>
        <button class="btn primary" data-consent-submit disabled>Relier avec mon fichier</button>
      </form>
    </details>
  </div>
</section>` : '';
  return key + alts;
}

function geminiPanel(googleEnabled = false, keyEnabled = true) {
  const key = !keyEnabled ? '' : keyPanel({
    id: 'h-key-gemini', title: 'Clé API Google AI Studio', provider: 'gemini', placeholder: 'AIza…', badge: '',
    body: `<p>Crée une clé sur aistudio.google.com puis colle-la ici. Elle est vérifiée sans consommer de tokens, chiffrée, et ne sera plus jamais affichée (seuls ses 4 derniers caractères le seront).</p>
  <p class="hint">${googleEnabled ? 'Tu peux aussi utiliser ton abonnement Google AI, plus bas sur cette page.' : 'Gemini se connecte uniquement avec une clé API : Google ne permet plus de se connecter avec un compte pour ce type d\'usage.'}</p>
  <div class="notice warn" role="note">
    <p><strong>Une clé gratuite suffit pour essayer</strong> (modèles Flash, avec des limites quotidiennes fixées par Google).</p>
    <p><strong>Avec une clé gratuite, Google peut utiliser les données envoyées pour améliorer ses produits, et des personnes peuvent les relire.</strong> N'y mets pas de données de prospects. Pour un vrai usage, active la facturation sur ton projet Google : tes données ne sont alors plus utilisées pour améliorer ses produits.</p>
  </div>`,
  });
  // Abonnement Google AI (Plus, Pro, Ultra) par Antigravity CLI : proposé seulement si l'administrateur l'a activé (GOOGLE_ACCOUNT_ENABLED)
  const alts = googleEnabled ? `
<section class="alts" aria-labelledby="h-alt-gemini">
  <div class="alts-h"><h2 id="h-alt-gemini">Avec ton abonnement Google AI (Plus, Pro, Ultra)</h2><span class="badge warn">${ic('alert')}Risque pour ton compte</span></div>
  <p class="hint">Utilise ton abonnement Google AI au lieu d'une clé API. Google n'a pas dit clairement si c'est permis depuis une application comme iaboss : une fenêtre d'avertissement s'affiche avant de continuer. Tes tâches passent l'une après l'autre.</p>
  <div class="alt">
    <div class="alt-t"><h3>Se connecter avec Google</h3><p>Connexion guidée : un lien s'affiche, tu te connectes à Google, tu copies le code affiché et tu le colles ici. Tu as 60 secondes pour le coller.</p></div>
    <button type="button" class="btn" data-open-dialog="google-dialog">Se connecter avec Google</button>
  </div>
  <div class="alt">
    <div class="alt-t"><h3>Fichier de connexion collé</h3><p>Pour les cas où la connexion directe ne passe pas : tu t'es connecté à Antigravity CLI sur une machine Linux ou WSL, et tu colles le fichier de connexion.</p></div>
    <details class="manual"><summary class="btn">Coller le fichier</summary>
      <form method="post" action="/link/google/auth" class="cfg" data-consent-form>
        ${notice(GOOGLE_CONSENT_TEXT)}
        ${consentBox()}
        <p class="hint">Sur ta machine, lance <code>agy</code> et connecte-toi avec Google, puis colle ci-dessous le contenu complet du fichier <code>~/.gemini/antigravity-cli/antigravity-oauth-token</code>. Il est chiffré, utilisé uniquement pour tes tâches, et ne sera plus jamais affiché. Sous Windows et sur Mac, la connexion est rangée ailleurs : utilise la connexion guidée.</p>
        <label class="field"><span class="lbl">Contenu du fichier de connexion</span><textarea name="authFile" rows="5" autocomplete="off" spellcheck="false" required></textarea></label>
        <p class="hint">La vérification lance un appel minimal du CLI : quelques milliers de tokens sont décomptés de ton abonnement.</p>
        <button class="btn primary" data-consent-submit disabled>Relier avec mon fichier</button>
      </form>
    </details>
  </div>
</section>` : '';
  return key + alts;
}

/** Fenêtre de la connexion guidée Google : avertissement, puis lien et code à recopier dans les 60 secondes que laisse le CLI. */
function googleDialog() {
  return `<dialog class="prospect-dialog modal" id="google-dialog" aria-labelledby="google-title">
  <div class="cfg">
    <h2 id="google-title">${ic('alert')}Avant de continuer</h2>
    <form class="cfg" data-google-login data-consent-form>
      ${notice(GOOGLE_CONSENT_TEXT)}
      ${consentBox()}
      <p class="hint">Un lien va s'afficher. Tu te connectes à Google avec le compte qui porte ton abonnement, tu copies le code que Google affiche, et tu le colles ici. Tu as 60 secondes pour le coller : prépare-toi avant de cliquer.</p>
      <div class="modal-f"><button type="button" class="btn" data-close-dialog>Annuler</button><button class="btn primary" data-consent-submit disabled><span data-label>Continuer</span></button></div>
      <p class="hint" role="status" data-google-status></p>
      ${pctBlock('Préparation du lien de connexion')}
      <p class="msg msg-err" role="alert" data-google-error hidden></p>
    </form>
    <form class="cfg" data-google-step2 hidden>
      <p><strong>1.</strong> Ouvre Google et connecte-toi :</p>
      <p><a class="btn primary" data-google-link href="#" target="_blank" rel="noopener noreferrer">Ouvrir Google</a></p>
      <p><strong>2.</strong> Copie le code que Google affiche, puis colle-le ici :</p>
      <label class="field"><span class="lbl">Code de Google</span><input name="code" autocomplete="off" spellcheck="false" required></label>
      <p class="hint" role="timer" data-google-timer></p>
      <div class="modal-f"><button type="button" class="btn" data-close-dialog>Annuler</button><button type="button" class="btn" data-google-again hidden>Nouveau lien</button><button class="btn primary" data-google-send><span data-label>Valider le code</span></button></div>
      <p class="msg msg-err" role="alert" data-google-error2 hidden></p>
    </form>
  </div>
</dialog>`;
}

/** Fenêtre de la connexion guidée ChatGPT : avertissement, puis lien et code à saisir sur chatgpt.com pendant que le serveur attend la validation. */
function chatgptDialog() {
  return `<dialog class="prospect-dialog modal" id="chatgpt-dialog" aria-labelledby="chatgpt-title">
  <div class="cfg">
    <h2 id="chatgpt-title">${ic('alert')}Avant de continuer</h2>
    <form class="cfg" data-chatgpt-login data-consent-form>
      ${notice(OPENAI_CONSENT_TEXT)}
      ${consentBox()}
      <p class="hint">Un lien et un code vont s'afficher. Tu valides la connexion sur chatgpt.com, puis iaboss récupère ta connexion tout seul. Dans les paramètres de sécurité de ton compte ChatGPT, la connexion par code d'appareil doit être activée. Texte d'avertissement version ${esc(OPENAI_CONSENT_VERSION)}.</p>
      <div class="modal-f"><button type="button" class="btn" data-close-dialog>Annuler</button><button class="btn primary" data-consent-submit disabled><span data-label>Continuer</span></button></div>
      <p class="hint" role="status" data-chatgpt-status></p>
      ${pctBlock('Préparation du lien de connexion')}
      <p class="msg msg-err" role="alert" data-chatgpt-error hidden></p>
    </form>
    <div class="cfg" data-chatgpt-step2 hidden>
      <p><strong>1.</strong> Ouvre ChatGPT et connecte-toi :</p>
      <p><a class="btn primary" data-chatgpt-link href="#" target="_blank" rel="noopener noreferrer">Ouvrir ChatGPT</a></p>
      <p><strong>2.</strong> Saisis ce code sur la page :</p>
      <p class="devcode" data-chatgpt-code aria-live="polite"></p>
      <p class="hint" role="status" data-chatgpt-wait>J'attends ta validation… cette fenêtre se ferme toute seule.</p>
      <div class="modal-f"><button type="button" class="btn" data-close-dialog>Annuler</button></div>
    </div>
  </div>
</dialog>`;
}

/** Fenêtre de la connexion guidée Claude (public/app.js). */
function claudeDialog(start) {
  return `<dialog class="prospect-dialog modal" id="consent-dialog" aria-labelledby="consent-title"${start ? ' data-autoopen' : ''}>
  <div class="cfg">
    <h2 id="consent-title">${ic('alert')}Avant de continuer</h2>
    <form class="cfg" data-claude-login data-consent-form>
      ${notice(CONSENT_TEXT)}
      ${consentBox()}
      <p class="hint">Un lien de connexion va s'afficher. Tu te connectes à Claude, puis tu recopies ici le petit code qu'il te montre : iaboss récupère le jeton tout seul. Texte d'avertissement version ${esc(CONSENT_VERSION)}.</p>
      <div class="modal-f"><button type="button" class="btn" data-close-dialog>Annuler</button><button class="btn primary" data-consent-submit disabled><span data-label>Continuer</span></button></div>
      <p class="hint" role="status" data-claude-status></p>
      ${pctBlock('Préparation du lien de connexion')}
      <p class="msg msg-err" role="alert" data-claude-error hidden></p>
    </form>
    <div class="cfg" data-claude-step2 hidden>
      <p data-claude-hint-popup hidden><strong>1.</strong> Connecte-toi à Claude dans la petite fenêtre qui vient de s'ouvrir.</p>
      <div data-claude-hint-link><p><strong>1.</strong> Ouvre Claude et connecte-toi :</p>
      <p><a class="btn primary" data-claude-link href="#" target="_blank" rel="noopener noreferrer">Ouvrir Claude</a></p></div>
      <p><strong>2.</strong> Copie le code que Claude affiche, puis reviens ici : il est reconnu tout seul (sinon, colle-le dans le champ).</p>
      <form class="cfg" data-claude-code>
        <label class="field"><span class="lbl">Code affiché par Claude</span><input name="code" autocomplete="off" spellcheck="false" required></label>
        <button class="btn primary"><span data-label>Terminer la connexion</span></button>
        ${pctBlock('Récupération de ton jeton')}
      </form>
      <p class="msg msg-err" role="alert" data-claude-error2 hidden></p>
    </div>
  </div>
</dialog>`;
}

/**
 * @param {object} o
 * @param {object|null} o.link       liaison actuelle (getLinkState)
 * @param {boolean} o.cliModeEnabled modes « abonnement » proposés
 * @param {Record<string,boolean>} [o.available]  IA utilisables sur ce serveur (providers/availability.js)
 * @param {string|null} [o.selected] IA dont les options sont ouvertes (?ia=) ; sinon celle qui est reliée ; sinon aucune
 */
export function linkPage({ user, link, cliModeEnabled, googleEnabled = false, error, start = false, available = { claude: true, openai: true, gemini: true }, selected = null }) {
  const current = link?.provider ?? null;
  const known = AI_CARDS.map((c) => c.id);
  const open = known.includes(selected) && available[selected] !== false ? selected : (start ? 'claude' : current);
  const intro = link
    ? `<p class="lead">Ton IA actuelle : <strong>${esc(link.providerLabel)}</strong> · ${esc(link.label)}${link.valid ? '' : ' (à revalider)'}. Relier une autre IA, ou un autre accès, remplace le précédent : son secret est effacé. Si tu changes d'IA, tes choix de modèle repartent du modèle par défaut de la nouvelle IA ; tes consignes personnalisées sont gardées.</p>`
    : '<p class="lead">Choisis l\'IA qui travaille pour toi, puis comment t\'y connecter. Les analyses, recherches et rédactions s\'exécutent avec <em>ton</em> accès, jamais celui d\'un autre utilisateur.</p>';
  const cards = AI_CARDS.map((c) => {
    const off = available[c.id] === false;
    const on = c.id === open;
    const badge = current === c.id ? `<span class="badge ok">${ic('check')}Connectée</span>` : '';
    if (off) return `<div class="ai-card" aria-disabled="true">${ic(c.id)}<b>${c.name}</b><small>${c.company}</small><span class="ai-how">Pas encore disponible sur ce serveur</span></div>`;
    return `<a class="ai-card${on ? ' on' : ''}" href="/link?ia=${c.id}" data-ai-card="${c.id}" aria-pressed="${on}" aria-controls="ai-panel-${c.id}">${ic(c.id)}<b>${c.name}</b><small>${c.company}</small><span class="ai-how">${c.how(cliModeEnabled, cliModeEnabled && googleEnabled)}</span>${badge}</a>`;
  }).join('');
  const panels = {
    claude: claudePanel(cliModeEnabled), openai: openaiPanel(cliModeEnabled), gemini: geminiPanel(cliModeEnabled && googleEnabled, available.geminiKey !== false),
  };
  const sections = AI_CARDS.filter((c) => available[c.id] !== false).map((c) => `<div class="ai-panel" id="ai-panel-${c.id}" data-ai-panel="${c.id}" role="region" aria-label="Se connecter avec ${c.name}"${c.id === open ? '' : ' hidden'}>${panels[c.id]}</div>`).join('\n');
  return layout({
    title: 'Relier mon IA', email: user.email, scripts: ['/static/app-link.js'],
    body: `<div class="narrow"${!link || !link.valid ? ' data-nolink' : ''}>
<h1 class="h1">Relier mon IA</h1>
${intro}
${error ? banner('err', error) : ''}
<div class="ai-cards" role="group" aria-label="Choisis ton IA">${cards}</div>
${open ? '' : '<p class="hint ai-pick">Clique sur une IA pour voir comment t\'y connecter.</p>'}
${sections}
${cliModeEnabled ? claudeDialog(start) : ''}
${cliModeEnabled && available.openai !== false ? chatgptDialog() : ''}
${cliModeEnabled && googleEnabled && available.gemini !== false ? googleDialog() : ''}
</div>`,
  });
}
