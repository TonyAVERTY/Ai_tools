import { RECOMMENDED, OTHERS, modelLabel } from './services/models.js';
import { esc } from './http.js';
import { STATUSES } from './services/crm.js';
import { icalBox } from './icalview.js';
import { devLinks } from './devlinks.js';
import { assetUrl, brandMark, iconLinks } from './assets.js';
import { SPRITE, ic } from './icons.js';
import { GIT_SERVER_TYPES, MAX_GIT_SERVERS } from './gitservers.js';
import { ROLES, MAX_NOTES, rolesOfSection } from './services/roles.js';
import { tourJson } from './tour.js';
import { describeKpi } from './services/dbschema.js';
import { MODE_LABELS, CONSENT_TEXT, CONSENT_CHECKBOX, CONSENT_VERSION } from './claudelink.js';

const fmtDate = (ts) => (ts ? new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }) : '—');

// Icônes de la section : noms du sprite (src/icons.js), une seule fois par page
const SECTION_ICONS = { target: 'target', search: 'search', spark: 'spark', chart: 'chart', mail: 'mail', linkedin: 'pen', send: 'send', repeat: 'repeat', users: 'users', gear: 'gear', git: 'git', computer: 'computer', film: 'film' };

/** Section dépliable. `title` peut contenir du HTML de confiance (badges), jamais de donnée utilisateur brute. */
function acc(key, icon, title, sub, body, { open = false, cls = '' } = {}) {
  const roles = rolesOfSection(key); // postes auxquels la section se rattache : le filtre par poste du projet la garde ou la cache
  return `<details class="acc anim ${cls}" data-acc="${key}"${roles.length ? ` data-roles="${roles.join(' ')}"` : ''}${open ? ' open' : ''}>
  <summary><span class="acc-ico">${ic(SECTION_ICONS[icon])}</span><span class="acc-txt"><span class="acc-title">${title}</span>${sub ? `<span class="acc-sub">${sub}</span>` : ''}</span><span class="chev" aria-hidden="true"></span></summary>
  <div class="acc-body">${body}</div>
</details>`;
}

/** Entrées de la barre du haut : chacune doit avoir son étape dans la visite guidée (test/tour.test.js). */
export const NAV = [['/', 'folder', 'Projets'], ['/mails', 'mail', 'Mails'], ['/calendar', 'clock', 'Calendrier'], ['/compta', 'wallet', 'Comptabilité'], ['/facturation', 'receipt', 'Facturation'], ['/clients', 'user', 'Clients'], ['/team', 'users', 'Équipe']];

/** Libellé court d'un onglet sur écran étroit (< 450 px) : « Comptabilité » ne tient pas dans sa case. Le nom complet reste dans le HTML pour les lecteurs d'écran. */
const NAV_SHORT = { '/compta': 'Compta' };
const pillLabel = (href, label) => (NAV_SHORT[href] ? `<span class="pill-l">${label}</span><span class="pill-s" aria-hidden="true">${NAV_SHORT[href]}</span>` : label);

export function layout({ title, body, email, scripts = [] }) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<title>${esc(title)} · AiTools</title>
${iconLinks()}
<link rel="stylesheet" href="${assetUrl('/static/tokens.css')}">
<link rel="stylesheet" href="${assetUrl('/static/app.css')}">
<link rel="stylesheet" href="${assetUrl('/static/responsive.css')}">
<script src="${assetUrl('/static/tour.js')}" defer></script>
<script src="${assetUrl('/static/app.js')}" defer></script>
<script src="${assetUrl('/static/app-recap.js')}" defer></script>
<script src="${assetUrl('/static/app-promo.js')}" defer></script>
<script src="${assetUrl('/static/app-linkedin.js')}" defer></script>
<script src="${assetUrl('/static/app-prospects.js')}" defer></script>
<script src="${assetUrl('/static/app-replies.js')}" defer></script>
<script src="${assetUrl('/static/app-bdd.js')}" defer></script>
<script src="${assetUrl('/static/responsive.js')}" defer></script>
<script src="${assetUrl('/static/fx.js')}" defer></script>
<script src="${assetUrl('/static/ajax.js')}" defer></script>
${scripts.map((src) => `<script src="${assetUrl(src)}" defer></script>`).join('\n')}
</head>
<body class="app">
${SPRITE}
<a class="skip" href="#contenu">Aller au contenu</a>
${email ? `<header class="top">
  <div class="top-in">
    <a class="lockup" href="/" aria-label="AiTools, projets">${brandMark()}<span class="wordmark">AiTools</span></a>
    <nav class="pills" aria-label="Navigation de l'application">
      ${NAV.map(([href, icon, label]) => `<a class="pill" href="${href}">${ic(icon)}${pillLabel(href, label)}</a>`).join('\n      ')}
    </nav>
    <div class="top-r">
      <div class="jobs" id="jobs" hidden>
        <button type="button" class="jobs-btn" aria-expanded="false" aria-controls="jobs-pop"><span class="spin-inline"></span><span data-jobs-count></span><span class="chev" aria-hidden="true"></span></button>
        <div class="jobs-pop" id="jobs-pop" role="region" aria-label="Jobs en cours" hidden>
          <div class="jobs-head"><strong>Activité</strong><span class="muted small" data-jobs-sub></span></div>
          <div data-jobs-list></div>
        </div>
      </div>
      <a class="ia-link site-link" href="/accueil" data-noajax aria-label="Accès au site internet" title="Accès au site internet">${ic('globe')}<span>Site internet</span></a>
      <details class="ia-menu">
        <summary class="ia-link" aria-label="Assistant : discuter avec Claude ou demander de l'aide sur AiTools">${ic('spark')}<span>Assistant</span></summary>
        <div class="user-pop ia-pop">
          <a href="/chat">${ic('spark')}<span class="pop-t">Claude<small>Discute avec ton Claude</small></span></a>
          <a href="/support">${ic('help')}<span class="pop-t">Support<small>Une question sur AiTools ?</small></span></a>
        </div>
      </details>
      <details class="user">
        <summary aria-label="Menu du compte : ${esc(email)}"><span class="avatar" aria-hidden="true">${esc(String(email).trim().charAt(0).toUpperCase())}</span></summary>
        <div class="user-pop">
          <p class="user-mail">${esc(email)}</p>
          <a href="/account">${ic('user')}Mon compte</a>
          <a href="/settings">${ic('gear')}Réglages</a>
          <a href="/?tour=1">${ic('help')}Visite guidée</a>
          <form method="post" action="/logout"><button>${ic('out')}Déconnexion</button></form>
        </div>
      </details>
    </div>
  </div>
</header>` : ''}
<main id="contenu" tabindex="-1"><div class="page">${body}</div></main>
</body>
</html>`;
}

// Rangée de quatre indicateurs en haut de la page Projets : mêmes chiffres que les plafonds du plan (usageView), rien d'inventé.
// Un indicateur passe en « attention » à 80 % du plafond et en « atteint » à 100 %.
const KPI_SUB = { projects: '', prospects: '', mails: 'ce mois-ci', aiJobs: 'ce mois-ci' };
const KPI_LABEL = { projects: 'Projets', prospects: 'Prospects', mails: 'Mails envoyés', aiJobs: 'Tâches IA' };
const KPI_ICON = { projects: 'folder', prospects: 'users', mails: 'send', aiJobs: 'spark' };
export function usageKpis(u) {
  if (!u) return '';
  const cell = (i) => {
    const level = i.full ? ' full' : i.limit != null && i.used / i.limit >= 0.8 ? ' warn' : '';
    const sub = [KPI_SUB[i.kind], i.limit == null ? '' : `sur ${i.limit.toLocaleString('fr-FR')}`].filter(Boolean).join(' · ');
    return `<div class="ukpi-c${level}"><dt>${ic(KPI_ICON[i.kind] || 'chart', 'ic-s')}${esc(KPI_LABEL[i.kind] || i.label)}</dt><dd><b>${i.used.toLocaleString('fr-FR')}</b><span>${esc(sub)}${i.full ? ' · plafond atteint' : ''}</span></dd></div>`;
  };
  const full = u.items.filter((i) => i.full);
  return `<section class="ukpis" aria-labelledby="h-kpis">
  <h2 class="sr-only" id="h-kpis">Utilisation du plan ${esc(u.planLabel)}</h2>
  <dl class="ukpi-r">${u.items.map(cell).join('')}</dl>
  ${full.length ? `<p class="cap" role="alert">${ic('alert')}<span>Plafond atteint : ${full.map((i) => esc(i.label.toLowerCase())).join(', ')}. Rien n'est perdu. <a href="/tarifs">Voir les tarifs</a></span></p>`
    : `<p class="ukpi-n">Plan ${esc(u.planLabel)}. Les plafonds mensuels repartent de zéro le 1er (heure de Paris).${u.plan === 'free' ? ' <a href="/tarifs">Voir les tarifs</a>' : ''}</p>`}
</section>`;
}

// Consommation de Claude (quota de l'abonnement ou budget d'une clé API) : rempli par public/app.js à partir de /api/system, masqué tant qu'il est vide
export function claudePanel() {
  return `<section class="panel claude-card" aria-labelledby="h-claude-use" data-claude-card hidden>
  <div class="panel-h"><h2 id="h-claude-use">Consommation Claude</h2></div>
  <ul class="usage-list usage-claude" data-usage-claude aria-label="Consommation de Claude"></ul>
</section>`;
}

// Usage du mois : une barre par plafond du plan (largeurs par classes w-N, la CSP interdit le style en ligne)
export function usagePanel(u) {
  if (!u) return '';
  const rows = u.items.map((i) => `<li class="g"><div class="g-h"><span>${esc(i.label)}</span><span class="g-v">${i.used}${i.limit == null ? '' : ` / ${i.limit}`}</span></div>${i.limit == null ? '' : `<div class="bar usage${i.full ? ' full' : ''}" role="progressbar" aria-label="${esc(i.label)}" aria-valuemin="0" aria-valuemax="${i.limit}" aria-valuenow="${i.used}"><span class="w-${Math.round(i.pct / 5) * 5}"></span></div>`}</li>`).join('');
  const full = u.items.filter((i) => i.full);
  return `<section class="panel usage-card" aria-labelledby="h-usage">
  <div class="panel-h"><h2 id="h-usage">Usage du mois</h2><span class="badge">plan ${esc(u.planLabel)}</span></div>
  <ul class="usage-list">${rows}</ul>
  <div data-claude-card hidden><ul class="usage-list usage-claude" data-usage-claude aria-label="Usage de Claude"></ul></div>
  ${full.length ? `<p class="cap" role="alert">${ic('alert')}<span>Plafond atteint : ${full.map((i) => esc(i.label.toLowerCase())).join(', ')}. Rien n'est perdu. <a href="/tarifs">Voir les tarifs</a></span></p>` : u.plan === 'free' ? '<p class="foot-n">Les plafonds se renouvellent le 1er du mois (heure de Paris). <a href="/tarifs">Voir les tarifs</a></p>' : ''}
</section>`;
}

const PROVIDER_NAMES = { google: 'Google', apple: 'Apple' };

// Section « Liaison Claude » de Mon compte : état, test, changement de mode, déliaison. Jamais le secret, ni même un masque
// plus long que les 4 derniers caractères de la clé API.
const QUOTA_WHY = {
  denied: "Anthropic refuse le relevé en direct avec ce jeton (relie-toi avec « Se connecter avec Claude »).",
  rate: 'Anthropic limite les relevés : nouvel essai dans une minute.',
  network: 'Anthropic ne répond pas.',
  unavailable: 'Le relevé en direct est indisponible chez Anthropic.',
  format: 'Réponse inattendue du relevé en direct.',
};
const fmtReset = (ts) => new Date(ts * 1000).toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

// Limites d'utilisation du compte Claude : session glissante de 5 h et semaine de 7 j (abonnement seulement ; une clé API n'a pas ces limites).
function claudeLimits(quota, mode) {
  const head = '<h3 class="sub-h">Limites d\'utilisation</h3>';
  if (mode === 'api_key') return `${head}<p class="hint">Avec une clé API, Anthropic facture ce que tu consommes, à l'usage.</p>`;
  const row = (label, w) => {
    if (!w) return '';
    if (w.expired) return `<li class="g"><div class="g-h"><span>${label}</span><span class="g-v muted">remise à zéro</span></div></li>`;
    const pct = Math.round(w.utilization * 100);
    const cls = w.utilization >= 1 ? ' full' : w.utilization >= 0.8 ? ' warn' : '';
    return `<li class="g"><div class="g-h"><span>${label}</span><span class="g-v">${pct} %</span></div>
      <div class="bar usage${cls}" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span class="w-${Math.round(Math.min(100, pct) / 5) * 5}"></span></div>
      ${w.resetsAt ? `<p class="hint">Remise à zéro ${esc(fmtReset(w.resetsAt))}</p>` : ''}</li>`;
  };
  const rows = quota ? row('Session de 5 h', quota.fiveHour) + row('Semaine de 7 jours', quota.sevenDay) : '';
  if (!rows) return `${head}<p class="hint">${quota?.error ? esc(QUOTA_WHY[quota.error] || 'Relevé indisponible.') : 'Pas encore mesuré.'}</p>`;
  const live = quota.source === 'live' && !quota.error;
  return `${head}<ul class="usage-list">${rows}</ul>
  <p class="hint">${live ? 'Relevé en direct chez Anthropic : il compte tout ton usage de Claude, y compris hors AiTools.' : `Dernière mesure faite pendant un job AiTools${quota.error ? ` (${esc((QUOTA_WHY[quota.error] || 'relevé en direct indisponible').replace(/\.$/, ''))})` : ''}.`}</p>`;
}

function linkSection(link, consent, quota = null) {
  if (!link) {
    return `<section class="card">
  <div class="card-h"><h2>Liaison Claude</h2></div>
  <p class="card-d">Relie un accès Claude pour utiliser l'application : tant qu'il manque, cette page de liaison reste affichée.</p>
  <div class="row"><a class="btn primary" href="/link">Relier Claude</a></div>
</section>`;
  }
  return `<section class="card">
  <div class="card-h"><h2>Liaison Claude</h2>${link.valid ? `<span class="badge ok">${ic('check')}${esc(link.label)}</span>` : `<span class="badge err">${ic('alert')}À revalider</span>`}</div>
  <p class="card-d">Ton accès à Claude est facturé à part, par Anthropic.</p>
  <dl class="account">
    <dt>Mode</dt><dd>${esc(link.label)}</dd>
    <dt>État</dt><dd>${link.valid ? '<span class="ok">Valide</span>' : '<span class="error">À revalider (déconnecte puis relie Claude)</span>'}</dd>
    ${link.last4 ? `<dt>Clé API</dt><dd>sk-ant-…${esc(link.last4)}</dd>` : ''}
    <dt>Reliée le</dt><dd>${fmtDate(link.linkedAt)}</dd>
    ${link.consentAt ? `<dt>Risque accepté</dt><dd>${fmtDate(link.consentAt)} (texte ${esc(link.consentVersion)})</dd>` : ''}
  </dl>
  ${claudeLimits(quota, link.mode)}
  <div class="row-actions">
    <form method="post" action="/link/unlink"><button class="btn danger">Déconnecter</button></form>
  </div>
  <p class="hint">Déconnecter efface le secret chiffré et annule tes jobs IA en attente ou en cours.${consent && !link.consentAt ? ` Dernier consentement au mode abonnement : ${fmtDate(consent.at)}.` : ''}</p>
</section>`;
}

// Barre de chargement avec pourcentage ESTIMÉ (public/app.js, track) : montée vers 95 % selon la durée habituelle, 100 % à la réponse
const pctBlock = (label) => `<div class="dl-pct" data-pct hidden><div class="bar" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="w-0" data-pct-bar></span></div><p class="dl-pct-t"><span>${esc(label)} · estimation</span><b data-pct-text>0 %</b></p></div>`;

export function accountPage({ user, error, link = null, consent = null, notice = null, usage = null, developer = false, ical = null, appUrl = '', quota = null, profileSet = false }) {
  return layout({
    title: 'Mon compte', email: user.email,
    body: `<div class="narrow">
<h1 class="h1">Mon compte</h1>
<section class="card">
  <div class="card-h"><h2>Connexion</h2></div>
  <div class="ident"><span class="avatar" aria-hidden="true">${esc(String(user.email).trim().charAt(0).toUpperCase())}</span>
    <span class="sp"><b>${esc(user.email)}</b><span class="hint">Connecté avec ${esc(PROVIDER_NAMES[user.provider] || '—')}, sans mot de passe</span></span></div>
  ${user.isAdmin ? '<div class="row"><a class="btn small" href="/admin">Administration</a></div>' : ''}
</section>
${notice ? `<p class="${notice.ok ? 'msg msg-ok' : 'msg msg-err'}" role="status">${esc(notice.text)}</p>` : ''}
${usagePanel(usage)}
${linkSection(link, consent, quota)}
<section class="card">
  <div class="card-h"><h2>Mon profil</h2><span class="badge ${profileSet ? 'ok' : ''}">${profileSet ? `${ic('check')}Renseigné` : 'Non renseigné'}</span><p>Ta fonction, ton niveau technique, le niveau de détail et le tutoiement que tu préfères : Claude s'en sert pour te répondre. Valable pour tous tes projets, rien n'est partagé avec un autre compte.</p></div>
  <div class="row"><a class="btn small" href="/welcome?edit=1">${ic('user')}${profileSet ? 'Modifier mon profil' : 'Renseigner mon profil'}</a></div>
</section>
<section class="card">
  <div class="card-h"><h2>Agenda</h2><a class="btn small" href="/calendar">${ic('clock')}Voir le calendrier</a></div>
  ${icalBox(ical, '/account')}
</section>
<section class="card">
  <div class="card-h"><h2>Mode développeur</h2><p>L'API d'AiTools et le serveur MCP (relier Claude à ton panel) ne sont disponibles que si tu actives ce mode.</p></div>
  <div class="row"><span class="badge ${developer ? 'ok' : ''}">${developer ? 'Activé' : 'Désactivé'}</span><a class="btn small" href="/developer">${ic('key')}${developer ? 'Jetons et documentation' : 'Activer'}</a></div>
  ${developer ? devLinks(appUrl) : `<p class="muted small">Une fois le mode activé, les adresses de l'API et du serveur MCP, leurs documentations et tes jetons s'affichent ici et sur la page Développeur.</p>`}
</section>
<section class="card danger">
  <div class="card-h"><h2>Zone de danger</h2></div>
  <p class="card-d">Supprimer ton compte efface définitivement ton compte et toutes tes données : projets, prospects, notes, modèles de mail, journaux d'envoi, lignes de comptabilité et leurs justificatifs, jobs, réglages et clones du code. Les adresses qui ont demandé à ne plus être contactées restent dans la liste d'opposition commune. Cette action est irréversible.</p>
  ${error ? `<p class="msg msg-err" role="alert">${esc(error)}</p>` : ''}
  <form method="post" action="/account/delete" class="cfg">
    <label class="field"><span class="lbl">Pour confirmer, saisis ton email (${esc(user.email)})</span><input name="confirm" type="email" required autocomplete="off"></label>
    <div class="row"><button class="btn danger-fill">${ic('trash')}Supprimer mon compte et mes données</button></div>
  </form>
</section>
</div>`,
  });
}

/**
 * Page « Relier Claude » : onboarding bloquant. Les trois modes sont des formulaires HTML classiques (POST) ;
 * la fenêtre d'avertissement du mode abonnement est un <dialog> ouvert par public/app.js.
 */
export function linkPage({ user, link, cliModeEnabled, error, start = false }) {
  const intro = link
    ? `<p class="lead">Accès actuel : <strong>${esc(link.label)}</strong>${link.valid ? '' : ' (à revalider)'}. Relier un autre accès remplace le précédent, dont le secret est effacé.</p>`
    : '<p class="lead">Choisis comment AiTools accède à ton Claude. Les analyses, recherches et rédactions s\'exécutent avec <em>ton</em> accès, jamais celui d\'un autre utilisateur.</p>';
  const box = `<label class="check opt"><input type="checkbox" name="accept" data-consent required><span class="box">${ic('check')}</span><span>${esc(CONSENT_CHECKBOX)}</span></label>`;
  const notice = `<div class="notice">${CONSENT_TEXT.map((t) => `<p>${esc(t)}</p>`).join('')}</div>`;
  // Connexion guidée (public/app.js) : le bouton demande le lien au serveur, avec un petit chargement, puis l'étape 2
  // attend le code que Claude affiche ; le serveur récupère le jeton tout seul.
  // Alternatives par abonnement : un bloc, avec le risque annoncé dans son titre ; deux lignes (connexion guidée, jeton collé)
  const cards = cliModeEnabled ? `
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
        ${notice}
        ${box}
        <p class="hint">Sur ta propre machine, lance la commande <code>claude setup-token</code>, connecte-toi à ton compte Claude quand le navigateur s'ouvre, puis copie le jeton affiché et colle-le ci-dessous. Le jeton est chiffré, utilisé uniquement pour tes jobs, et n'est jamais réaffiché.</p>
        <label class="field"><span class="lbl">Jeton d'abonnement</span><input name="token" type="password" autocomplete="new-password" spellcheck="false" required></label>
        <p class="hint">La vérification lance un appel minimal du CLI : quelques tokens sont décomptés de ton abonnement.</p>
        <button class="btn primary" data-consent-submit disabled>Relier avec mon jeton</button>
      </form>
    </details>
  </div>
</section>` : '';
  const dialog = cliModeEnabled ? `<dialog class="prospect-dialog modal" id="consent-dialog" aria-labelledby="consent-title"${start ? ' data-autoopen' : ''}>
  <div class="cfg">
    <h2 id="consent-title">${ic('alert')}Avant de continuer</h2>
    <form class="cfg" data-claude-login data-consent-form>
      ${notice}
      ${box}
      <p class="hint">Un lien de connexion va s'afficher. Tu te connectes à Claude, puis tu recopies ici le petit code qu'il te montre : AiTools récupère le jeton tout seul. Texte d'avertissement version ${esc(CONSENT_VERSION)}.</p>
      <div class="modal-f"><button type="button" class="btn" data-close-dialog>Annuler</button><button class="btn primary" data-consent-submit disabled><span class="spin-inline" hidden></span><span data-label>Continuer</span></button></div>
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
        <button class="btn primary"><span class="spin-inline" hidden></span><span data-label>Terminer la connexion</span></button>
        ${pctBlock('Récupération de ton jeton')}
      </form>
      <p class="msg msg-err" role="alert" data-claude-error2 hidden></p>
    </div>
  </div>
</dialog>` : '';
  return layout({
    title: 'Relier Claude', email: user.email,
    body: `<div class="narrow"${!link || !link.valid ? ' data-nolink' : ''}>
<h1 class="h1">Relier Claude</h1>
${intro}
${error ? `<p class="msg msg-err" role="alert">${esc(error)}</p>` : ''}
<section class="panel link-main" aria-labelledby="h-key">
  <div class="panel-h"><h2 id="h-key">Clé API Anthropic</h2><span class="badge ok">${ic('check')}Recommandée</span></div>
  <p>Crée une clé sur console.anthropic.com puis colle-la ici. Elle est vérifiée sans consommer de tokens, chiffrée, et ne sera plus jamais affichée (seuls ses 4 derniers caractères le seront). Tu paies à l'usage, directement chez Anthropic.</p>
  <form method="post" action="/link/api-key" class="cfg link-key">
    <label class="field"><span class="lbl">Clé API</span><input name="apiKey" type="password" autocomplete="new-password" spellcheck="false" required placeholder="sk-ant-…"></label>
    <button class="btn primary">Vérifier et relier</button>
  </form>
</section>
${cards}
${dialog}
</div>`,
  });
}

function targetForm(p) {
  const t = p.target || {};
  const list = (a) => esc((a || []).join('\n'));
  return `<form class="target cfg" data-action="target" data-id="${p.id}">
  <label>Description<input name="description" value="${esc(t.description)}"></label>
  <div class="grid3">
    <label>Zone<input name="zone" value="${esc(t.zone)}"></label>
    <label>Taille<input name="taille" value="${esc(t.taille)}"></label>
    <label>Décideur<input name="decideur" value="${esc(t.decideur)}"></label>
  </div>
  <div class="grid2">
    <label>Secteurs (1 par ligne)<textarea name="secteurs" rows="4">${list(t.secteurs)}</textarea></label>
    <label>Requêtes de recherche (1 par ligne)<textarea name="requetes" rows="4">${list(t.requetes)}</textarea></label>
  </div>
  <div class="row"><button class="btn${p.targetValidated ? '' : ' primary'}">${p.targetValidated ? 'Mettre à jour' : `${ic('check')}Valider la cible`}</button></div>
</form>`;
}

/** Choix des tables du Récapitulatif : l'état enregistré. Après « Se connecter et analyser », public/app-bdd.js remplit les listes avec les vraies tables. */
function bddTables(dbCfg) {
  const k = dbCfg.kpi || {};
  const rules = describeKpi(k);
  const legacy = !Object.keys(k).length && (dbCfg.sql_users || dbCfg.sql_clients || dbCfg.sql_revenue);
  const sel = (name, label, table) => `<div class="bdd-row"><label>${label}<select name="${name}" data-bdd-sel="${name}"><option value="">Ne pas suivre</option>${table ? `<option value="${esc(table)}" selected>${esc(table)}</option>` : ''}</select></label>
    <small class="muted" data-bdd-rule="${name.replace('_table', '')}">${esc(rules[name.replace('_table', '')] || '')}</small></div>`;
  const r = k.revenue;
  return `<div class="bdd" data-bdd>
  ${legacy ? '<p class="notice">Ce projet utilise des requêtes personnalisées enregistrées avant. Elles continuent de fonctionner ; choisis tes tables ci-dessous pour les remplacer.</p>' : ''}
  ${sel('users_table', 'Table des utilisateurs', k.users?.table)}
  ${sel('clients_table', 'Table des clients payants', k.clients?.table)}
  ${sel('revenue_table', 'Table des paiements', r?.table)}
  <div class="grid2 bdd-rev" data-bdd-rev${r ? '' : ' hidden'}>
    <label>Colonne du montant<select name="revenue_column" data-bdd-sel="revenue_column">${r ? `<option value="${esc(r.amountColumn)}" selected>${esc(r.amountColumn)}</option>` : ''}</select></label>
    <label>Montants en<select name="revenue_unit" data-bdd-sel="revenue_unit"><option value="euros" ${r && !r.cents ? 'selected' : ''}>euros</option><option value="cents" ${r?.cents ? 'selected' : ''}>centimes</option></select></label>
  </div>
  <p class="small" data-bdd-state role="status"></p>
  <p class="small bdd-preview" data-bdd-preview role="status"></p>
</div>`;
}

function configForms(p, smtp, dbCfg, imap) {
  const source = { project: 'Ce projet envoie depuis son adresse (SMTP ci-dessous).', null: "Aucun SMTP : renseigne celui de l'adresse d'envoi de ce projet, sinon rien ne peut partir." }[p.smtpSource ?? 'null'];
  return `<form data-action="smtp" data-id="${p.id}" class="cfg">
  <h4>SMTP d'envoi de ce projet (adresse du projet)</h4>
  <p class="muted small" data-smtp-source>${source} Les mails de prospection et les relances de ce projet partent de cette adresse (une boîte par projet). Les mails d'AiTools (rapport, évolutions, invitations) partent, eux, du serveur.</p>
  <div class="grid3">
    <label>Hôte<input name="host" value="${esc(smtp.host)}" placeholder="smtp.exemple.fr"></label>
    <label>Port<input name="port" type="number" value="${esc(smtp.port || 587)}"></label>
    <label>Utilisateur<input name="user" value="${esc(smtp.user)}" autocomplete="off"></label>
    <label>Mot de passe<input name="pass" type="password" placeholder="${smtp.passSet ? '•••••• (inchangé)' : ''}" autocomplete="new-password"></label>
    <label>Email expéditeur<input name="fromEmail" type="email" value="${esc(smtp.fromEmail)}"></label>
    <label>Nom expéditeur<input name="fromName" value="${esc(smtp.fromName)}"></label>
  </div>
  <label>Plafond mails / 24 h (max 200)<input name="dailyCap" type="number" min="1" max="200" value="${p.dailyMailCap}"></label>
  <button class="btn">Enregistrer SMTP</button>
</form>
<form data-action="imap" data-id="${p.id}" class="cfg">
  <h4>Boîte de réception (IMAP)</h4>
  <p class="muted small">Sert à détecter les réponses et les adresses invalides. Utilisateur vide = mêmes identifiants que le SMTP. Hôte vide = désactivé.</p>
  <div class="grid3">
    <label>Hôte IMAP<input name="host" value="${esc(imap.host)}" placeholder="imap.mondomaine.fr"></label>
    <label>Port<input name="port" type="number" value="${esc(imap.port || 993)}"></label>
    <label>Utilisateur<input name="user" value="${esc(imap.user)}" placeholder="identique au SMTP" autocomplete="off"></label>
    <label>Mot de passe<input name="pass" type="password" placeholder="${imap.passSet ? '•••••• (inchangé)' : 'identique au SMTP'}" autocomplete="new-password"></label>
  </div>
  <button class="btn">Enregistrer et tester</button>
</form>
<form data-action="db" data-id="${p.id}" class="cfg">
  <h4>Base de données (récapitulatif)</h4>
  <p class="muted small">Utilise un compte en lecture seule. AiTools lit la structure de ta base, te propose les bonnes tables et affiche un aperçu des chiffres : tu n'écris aucune requête.</p>
  <div class="grid3">
    <label>Type<select name="type"><option value="mysql" ${dbCfg.type !== 'pg' ? 'selected' : ''}>MySQL / MariaDB</option><option value="pg" ${dbCfg.type === 'pg' ? 'selected' : ''}>PostgreSQL</option></select></label>
    <label>Hôte<input name="host" value="${esc(dbCfg.host)}"></label>
    <label>Port<input name="port" type="number" value="${esc(dbCfg.port)}"></label>
    <label>Base<input name="database" value="${esc(dbCfg.database)}"></label>
    <label>Utilisateur<input name="user" value="${esc(dbCfg.user)}" autocomplete="off"></label>
    <label>Mot de passe<input name="password" type="password" placeholder="${dbCfg.passwordSet ? '•••••• (inchangé)' : ''}" autocomplete="new-password"></label>
  </div>
  <label class="check"><input type="checkbox" name="ssl" ${dbCfg.ssl ? 'checked' : ''}> SSL</label>
  ${bddTables(dbCfg)}
  <div class="row"><button type="button" class="btn" data-bdd-analyze>Se connecter et analyser</button><button class="btn">Enregistrer BDD</button></div>
</form>
${p.access === 'owner' ? `<form data-action="delete" data-id="${p.id}" data-confirm="Supprimer ${esc(p.name)} et tous ses prospects ?" class="cfg">
  <button class="btn danger">${ic('trash')}Supprimer le projet</button>
</form>` : ''}`;
}

function templateForm(p, kind) {
  const initial = kind === 'initial';
  const job = initial ? 'template' : 'followup_template';
  return `<form data-action="template" data-kind="${kind}" data-id="${p.id}" class="tpl">
      <div class="row"><h4>${initial ? 'Modèle de mail' : 'Modèle de relance'} <span data-tpl-state></span></h4>
        <button type="button" class="btn small" data-run="${job}" data-id="${p.id}">Générer avec l'IA</button></div>
      <p class="muted small">Variables : {{entreprise}} {{ville}}${initial ? ' {{accroche}}' : ''} {{expediteur}} {{site}}. Le lien de désinscription est ajouté automatiquement.</p>
      <label>Objet${initial ? '' : ' <span class="muted small">(vide = « Re: » + objet du premier mail, dans le même fil)</span>'}<input name="subject"></label>
      ${initial ? '<label>Objet B <span class="muted small">(optionnel : test A/B, les envois alternent entre les deux objets)</span><input name="subjectB"></label>' : ''}
      <label>Corps<textarea name="body" rows="${initial ? 9 : 5}"></textarea></label>
      <label class="opt"><input type="checkbox" name="html"><span class="box">${ic('check')}</span><span>Envoyer en mail HTML<small class="muted"> Sans cette case, le mail part en texte simple, comme un mail écrit à la main.</small></span></label>
      <div class="row">
        <button type="button" class="btn" data-tpl-preview>${ic('eye')}Aperçu</button>
        <button class="btn" name="mode" value="save">Enregistrer</button>
        <button class="btn primary" name="mode" value="validate">Valider le modèle</button>
      </div>
    </form>
    <div class="job" data-job="${job}"></div>`;
}

/** Filtre par poste, dans l'en-tête de la page Projets : il s'applique à tous les projets. */
const ROLE_SELECT = `<label class="rolesel"><span class="lbl">Poste</span><span class="sel"><select data-role-select aria-label="Filtrer les projets par poste">
    <option value="">Tous les postes</option>
    ${ROLES.map((r) => `<option value="${r.id}">${esc(r.label)}</option>`).join('\n    ')}
  </select>${ic('down')}</span></label>`;

/** Section « Postes et tâches IA » : chaque poste avec ses tâches. Les tâches qui lisent le dépôt sont réservées aux administrateurs. */
function postesBody(p) {
  const member = p.access === 'member';
  return `<p class="muted small">Chaque tâche fait écrire à Claude un livrable à partir de la fiche du projet : le livrable reste dans AiTools, à toi de l'utiliser. Les précisions sont facultatives. Les chiffres, prix et références que la fiche ne donne pas restent « à compléter ».</p>
  <div class="roles">${ROLES.map((r) => `
    <details class="role" data-role="${r.id}">
      <summary><b>${esc(r.label)}</b><span class="muted small">${esc(r.summary)}</span></summary>
      <ul class="tasks">${r.tasks.map((t) => `
        <li class="task" data-task="${t.id}">
          <div class="task-h"><b>${esc(t.label)}</b>${t.web ? '<span class="badge">cherche sur le web</span>' : ''}${t.repo ? '<span class="badge">lit le dépôt</span>' : ''}</div>
          <p class="muted small">${esc(t.brief)}</p>
          ${t.repo && member ? '<p class="muted small">Réservé aux administrateurs du projet.</p>' : `<form data-action="poste" data-id="${p.id}" data-task="${t.id}" class="inline">
            <label>Précisions <span class="muted small">(facultatif)</span><input name="notes" maxlength="${MAX_NOTES}" autocomplete="off"></label>
            <button class="btn primary">${ic('spark')}Lancer la tâche</button>
          </form>`}
          <div class="job" data-job="poste_${t.id}" data-label="${esc(t.label)}"></div>
        </li>`).join('')}
      </ul>
    </details>`).join('')}
  </div>`;
}

const shortDay = (ts) => new Date(ts * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
/** Chiffres réels d'un projet dans sa ligne repliée (voir projectStats) : seuls les compteurs non nuls s'ajoutent à « prospects ». */
function projectFacts(st) {
  if (!st) return '';
  if (!st.prospects) return '<span class="pfacts"><span class="muted">aucun prospect</span></span>';
  const parts = [`<span><b>${st.prospects.toLocaleString('fr-FR')}</b> prospect${st.prospects > 1 ? 's' : ''}</span>`];
  if (st.toContact) parts.push(`<span><b>${st.toContact.toLocaleString('fr-FR')}</b> à contacter</span>`);
  if (st.replies) parts.push(`<span class="ok"><b>${st.replies.toLocaleString('fr-FR')}</b> réponse${st.replies > 1 ? 's' : ''}</span>`);
  if (st.lastSentAt) parts.push(`<span>dernier envoi le ${esc(shortDay(st.lastSentAt))}</span>`);
  return `<span class="pfacts">${parts.join('')}</span>`;
}

function projectItem(p, smtp, dbCfg, imap, { open = false, stats = null } = {}) {
  const profile = p.profile;
  // « En-tête » (dépôt, site, fiche, sortie de l'analyse) : en haut et ouvert tant que le projet n'est pas analysé, puis replié en bas, juste avant « Configuration ».
  const headerAcc = acc('header', 'git', 'En-tête', 'Dépôt Git et fiche projet', `
  <div class="field"><span class="lbl">Dépôt Git</span><div class="ro">${ic('lock', 'ic-s')}<span>${esc(p.gitUrl)}</span><span class="badge">lecture seule</span></div></div>
  <p class="muted small" data-todo-restore hidden><button type="button" class="link" data-todo-restore-btn>Afficher la mise en route</button> (la liste « config » que tu as retirée de ce projet)</p>
  ${p.access !== 'member' ? `<form data-action="site" data-id="${p.id}" class="site-form">
    <label class="field"><span class="lbl">Site du produit</span><input name="site_url" maxlength="300" inputmode="url" autocomplete="off" placeholder="https://monproduit.fr" value="${esc(p.siteUrl || '')}"></label>
    <p class="muted small">Cette adresse est ajoutée dans les mails de prospection à la place de <code>{{site}}</code>. Laisse vide pour ne pas en mettre.</p>
    <div class="row"><button class="btn small">Enregistrer le site</button></div>
  </form>` : ''}
  ${profile ? `<section class="profile fiche">
    <div class="fiche-h"><b>Fiche projet</b></div>
    <p>${esc(profile.resume)}</p><p class="meta"><span>Analysé le ${fmtDate(p.profileAt)}</span><span>Commit <code>${esc((p.profileCommit || '').slice(0, 8))}</code></span><span>${esc(profile.stack || '')}</span></p>
  </section>` : ''}
  <div class="job" data-job="analyze"></div>`, { open: !profile });
  return `<details class="project anim" data-id="${p.id}"${open ? ' open' : ''}>
<summary><span class="pname">${esc(p.name)}</span>${p.access !== 'owner' ? `<span class="badge" title="Projet partagé par ${esc(p.ownerEmail || '')}">équipe de ${esc(p.ownerEmail || '')}</span>` : p.teamId ? '<span class="badge ok">partagé</span>' : ''}<span class="pcfg badge" data-cfg title="Afficher la liste de mise en route" hidden></span><button type="button" class="btn small secondary prean" data-run="analyze" data-id="${p.id}"${profile ? ' data-reanalyze' : ''} title="${profile ? "Relancer l'analyse du dépôt" : "Lancer l'analyse du dépôt"}" aria-label="${profile ? 'Réanalyser' : 'Analyser'} le projet">${ic(profile ? 'repeat' : 'spark')}<span>${profile ? 'Réanalyser' : 'Analyser'}</span></button><span class="pstate" data-state></span>${projectFacts(stats)}</summary>
<div class="pbody"><div class="pcard">
  ${profile ? '' : headerAcc}

  ${profile ? acc('target', 'target',
    `Cible${p.targetValidated ? '' : ' <span class="badge warn">à valider</span>'}`, // une cible validée est signalée par la coche verte de la section
    esc((p.target?.description || '').slice(0, 120)), targetForm(p), { open: !p.targetValidated, cls: 'target-acc' }) : ''}

  <div class="accs">
  ${acc('prospect', 'search', 'Prospecter', 'Recherche, modèle de mail, envoi, relances et CRM', `
    ${acc('search', 'search', 'Recherche de prospects', 'Claude cherche des entreprises qui collent à la cible', `
    <form data-action="prospect" data-id="${p.id}" class="inline">
      <label>Prospects à chercher<input name="count" type="number" min="1" max="50" value="10"></label>
      <label>Quand<select name="when"><option value="now">Maintenant</option><option value="night">Cette nuit (1h-6h)</option></select></label>
      <button class="btn primary">Lancer la recherche</button>
    </form>
    <div class="job" data-job="prospect"></div>`, { open: true, cls: 'sub' })}

    ${acc('template', 'mail', 'Modèle de mail', 'Objet, test A/B et corps du premier mail', templateForm(p, 'initial'), { cls: 'sub' })}

    ${acc('send', 'send', 'Envoi', 'Envoi par lots, boîte de réception et test A/B', `
    <form data-action="send" data-id="${p.id}" class="inline send">
      <label>Mails à envoyer<input name="count" type="number" min="1" value="10"></label>
      <button class="btn primary" disabled>Envoyer</button>
      <span class="muted small" data-send-info></span>
    </form>
    <div class="job" data-job="send"></div>
    <p class="inbox small" data-inbox></p>`, { cls: 'sub' })}

    ${acc('followup', 'repeat', 'Relance automatique', 'Une relance dans le même fil après quelques jours', `
    <section class="followup">
      <form data-action="followup" data-id="${p.id}" class="inline">
        <label class="check"><input type="checkbox" name="enabled" ${p.followupEnabled ? 'checked' : ''}> Relancer une fois les prospects sans réponse</label>
        <label>Après (jours)<input name="days" type="number" min="2" max="30" value="${p.followupDays}"></label>
        <button class="btn">Enregistrer</button>
      </form>
      <p class="muted small" data-followup-info></p>
      ${templateForm(p, 'followup')}
      <div class="job" data-job="followup"></div>
    </section>`, { cls: 'sub' })}

    ${acc('prospects', 'users', 'Prospects <span data-count></span>', 'Recherche, filtres, fiches, import et export CSV', `
      <div class="viewtoggle" role="group" aria-label="Affichage des prospects">
        <button type="button" class="btn small on" data-view-mode="list" aria-pressed="true">Liste</button>
        <button type="button" class="btn small" data-view-mode="board" aria-pressed="false">Kanban</button>
      </div>
      <form class="pfilters" data-filters>
        <input type="search" name="q" placeholder="Rechercher : entreprise, email, ville, secteur" aria-label="Rechercher">
        <select name="status" aria-label="Statut"><option value="">Tous les statuts</option>${Object.entries(STATUSES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <select name="minScore" aria-label="Score minimum"><option value="0">Tous les scores</option><option value="5">Score ≥ 5</option><option value="7">Score ≥ 7</option><option value="9">Score ≥ 9</option></select>
        <label class="opt"><input type="checkbox" name="todo" value="1"><span class="box">${ic('check')}</span><span>Actions à faire</span></label>
        <select name="sort" aria-label="Tri"><option value="score">Tri : score</option><option value="recent">Plus récents</option><option value="contacted">Dernier contact</option><option value="company">Entreprise A → Z</option></select>
      </form>
      <div class="row csv">
        <button type="button" class="btn small primary" data-pform-toggle aria-expanded="false">${ic('plus')}Ajouter un prospect</button>
        <a class="btn small" data-export href="/api/projects/${p.id}/prospects.csv" download>Exporter (CSV)</a>
        <label class="btn small file">Importer un CSV<input type="file" accept=".csv,text/csv" data-import="${p.id}" hidden></label>
        <span class="muted small">Colonnes reconnues : entreprise, email, site, ville, secteur, score, source, accroche.</span>
      </div>
      <form class="pform panel" data-pform data-id="${p.id}" hidden>
        <div class="panel-h"><h4>Ajouter un prospect</h4></div>
        <p class="muted small">Pour un contact que tu as déjà : le prospect est ajouté avec le statut « À contacter ». Il est écarté s'il existe déjà dans ce projet ou s'il ne doit pas être contacté.</p>
        <div class="grid2">
          <label class="field"><span class="lbl">Email</span><input name="email" type="email" required maxlength="200" autocomplete="off" placeholder="contact@entreprise.fr"></label>
          <label class="field"><span class="lbl">Entreprise</span><input name="company" maxlength="200" placeholder="Laisse vide : le domaine de l'adresse"></label>
          <label class="field"><span class="lbl">Site</span><input name="website" maxlength="300" placeholder="https://entreprise.fr"></label>
          <label class="field"><span class="lbl">Ville</span><input name="city" maxlength="100"></label>
          <label class="field"><span class="lbl">Secteur</span><input name="sector" maxlength="100"></label>
          <label class="field"><span class="lbl">Score (1 à 10)</span><input name="score" type="number" min="1" max="10" inputmode="numeric"></label>
        </div>
        <label class="field"><span class="lbl">Accroche <span class="muted small">(la phrase qui ouvre le mail, facultatif)</span></span><input name="hook" maxlength="400"></label>
        <label class="field"><span class="lbl">Origine de l'adresse <span class="muted small">(facultatif : où tu l'as trouvée)</span></span><input name="source" maxlength="300" placeholder="Laisse vide : « Ajout manuel du … »"></label>
        <div class="row"><button class="btn primary">Ajouter le prospect</button><button type="button" class="btn" data-pform-cancel>Annuler</button></div>
      </form>
      <div data-import-report></div>
      <div data-prospects></div>
      <div class="pager" data-pager></div>`, { cls: 'sub prospects' })}
  `, { cls: 'main', open: !!profile && !!p.targetValidated })}

  ${acc('evolution', 'spark', 'Évolution', 'Idées de fonctionnalités tirées du code, envoyées par mail', `
    <form data-action="evolution" data-id="${p.id}" class="inline">
      <label>Nombre d'évolutions<input name="count" type="number" min="1" max="20" value="5"></label>
      <label>Raisonnement<select name="level">
        <option value="rapide" selected>Rapide (Haiku, économe)</option>
        <option value="normal">Normal (Sonnet, plus cher)</option>
        <option value="approfondi">Approfondi (Opus, coûteux)</option>
      </select></label>
      <label>Quand<select name="when"><option value="now">Maintenant</option><option value="night">Cette nuit (1h-6h)</option></select></label>
      <button class="btn primary">Chercher et envoyer par mail</button>
    </form>
    <div class="job" data-job="evolution"></div>`, { cls: 'main' })}

  ${p.access !== 'member' ? acc('audit', 'computer', 'Audit du projet', 'Rapport qualité et sécurité du code, en lecture seule', `
    <form data-action="audit" data-id="${p.id}" class="inline">
      <label>Raisonnement<select name="level">
        <option value="rapide" selected>Rapide (Haiku, économe)</option>
        <option value="normal">Normal (Sonnet, plus cher)</option>
        <option value="approfondi">Approfondi (Opus, coûteux)</option>
      </select></label>
      <label>Quand<select name="when"><option value="now">Maintenant</option><option value="night">Cette nuit (1h-6h)</option></select></label>
      <button class="btn primary">${ic('shield')}Lancer l'audit</button>
    </form>
    <p class="muted small">Claude lit le dépôt (sans rien modifier) et signale les défauts de code, de sécurité, de tests et de dépendances, avec le fichier concerné.</p>
    <div class="job" data-job="audit"></div>`, { cls: 'main' }) : ''}

  ${acc('linkedin', 'linkedin', 'LinkedIn', 'Relie un compte, Claude écrit des posts, tu relis et publies', `
    <div class="linkedin" data-linkedin><p class="muted">Chargement…</p></div>
    <div class="job" data-job="linkedin_post"></div>`, { cls: 'main' })}

  ${acc('promo', 'film', 'Promotion', 'Claude conçoit une vidéo de design motion pour présenter ton projet', `
    <div class="promo" data-promo><p class="muted">Chargement…</p></div>
    <div class="job" data-job="promo_video"></div>`, { cls: 'main' })}

  ${p.access !== 'member' ? acc('recap', 'chart', 'Récapitulatif', 'Chiffres business, prospection et courbes', `
    <div class="recap" data-recap><p class="muted">Chargement…</p></div>`, { cls: 'main' }) : ''}

  ${acc('postes', 'users', 'Postes et tâches IA', 'Les postes d\'une entreprise, chacun avec ses tâches faites par l\'IA', postesBody(p), { cls: 'main' })}
  </div>

  ${profile ? headerAcc : ''}

  ${p.access !== 'member' ? acc('config', 'gear', 'Configuration du projet', 'SMTP, boîte IMAP, base de données', configForms(p, smtp, dbCfg, imap), { cls: 'config' }) : ''}
</div></div>
</details>`;
}

export function dashboardPage({ email, projects, stats = new Map(), gitHosts = [], usage = null, pauseMessage = null, tour = null }) {
  return layout({
    title: 'Projets', email,
    body: `<div class="dash">
<div class="hd dash-hd"><h1 id="h-projets">Projets</h1><div class="hd-tools">${projects.length ? ROLE_SELECT : ''}<button type="button" class="btn primary" data-new-toggle aria-expanded="false" aria-controls="new-project">${ic('plus')}Nouveau projet</button></div></div>
${usageKpis(usage)}
<section class="col-p" aria-label="Liste des projets">
  ${pauseMessage ? `<p class="ban ban-err" role="alert">${ic('alert')}<span class="ban-t"><b>${esc(pauseMessage)}</b></span></p>` : ''}
  <form data-action="create" class="panel cfg" id="new-project" aria-labelledby="h-new" hidden>
    <div class="panel-h"><h2 id="h-new">Nouveau projet</h2></div>
    <div class="form">
      <label class="field"><span class="lbl">Nom</span><input name="name" required maxlength="80" placeholder="Ex. Atelier Exemple"></label>
      <label class="field"><span class="lbl">Dépôt Git</span><input name="gitUrl" required placeholder="https://github.com/utilisateur/projet.git">
        <span class="hint">${gitHosts.length ? `GitHub et ${gitHosts.map(esc).join(', ')} sont acceptés.` : 'GitHub est accepté.'} Dépôt privé ou autre serveur Git : ajoute un token dans <a href="/settings">Réglages</a>. Le lien ne pourra plus être modifié. Le projet est cloné et analysé une fois (Sonnet).</span></label>
    </div>
    <div class="form-b"><button class="btn primary">Créer et analyser</button><button type="button" class="btn" data-new-toggle>Annuler</button></div>
  </form>
  <dialog class="prospect-dialog" id="prospect-dialog" aria-label="Fiche prospect"><div data-dialog-body></div></dialog>
  <div class="projects">
  ${projects.length ? projects.map((x) => projectItem(x.project, x.smtp, x.dbCfg, x.imap, { open: projects.length === 1, stats: stats.get(Number(x.project.id)) })).join('\n') : `<div class="empty">
    <span class="empty-i">${ic('folder')}</span>
    <h3>Aucun projet pour l'instant</h3>
    <p>Crée ton premier projet : donne-lui un nom et l'adresse de son dépôt Git, Claude s'occupe de l'analyser.</p>
  </div>`}
  </div>
</section>
<aside class="col-s">${claudePanel()}</aside>
</div>
${projects.length ? '<aside class="todo" id="todo" aria-label="Mise en route du projet" hidden></aside>' : ''}
${tour ? `<script type="application/json" id="tour-data" data-mode="${esc(tour)}">${tourJson()}</script>` : ''}`,
  });
}

/** Une ligne « serveur Git » : URL et token. `i` : numéro de la ligne (champs git_*_i) ; `fresh` : ligne qui vient d'être ajoutée (gabarit). */
function gitRow(i, srv, { fresh = false } = {}) {
  const hint = GIT_SERVER_TYPES[srv.type]?.hint ?? '';
  return `<div class="gitrow" data-git-row>
      <input type="hidden" name="git_type_${i}" value="${esc(srv.type)}">
      <input type="hidden" name="git_id_${i}" value="${esc(srv.id)}">
      <div class="gitrow-head"><span class="srv-n">${ic('git')}<span class="badge">${esc(srv.label)}</span></span>${fresh ? ' <button type="button" class="linklike" data-git-cancel>Annuler</button>' : trash(`git_del_${i}`, 'Retirer ce serveur')}</div>
      <div class="grid2">
        <label class="field"><span class="lbl">URL du serveur</span><input name="git_host_${i}" value="${esc(srv.host)}" placeholder="https://git.mon-serveur.fr" autocomplete="off" spellcheck="false"></label>
        <label class="field"><span class="lbl">Token (lecture repo)</span><input name="git_token_${i}" type="password" placeholder="${srv.hasToken ? '•••••• (inchangé)' : ''}" autocomplete="new-password"></label>
      </div>
      <p class="hint" data-git-hint>${esc(hint)}</p>
      ${!fresh && srv.hasToken ? `<div class="row"><span class="hint">Un token est enregistré.</span>${trash(`git_token_clear_${i}`, 'Supprimer le token enregistré', { text: 'Supprimer le token' })}</div>` : ''}
    </div>`;
}

/**
 * Corbeille rouge à la place d'une case « supprimer » : un clic marque l'élément « à retirer » (public/app.js), un second l'annule ;
 * la suppression n'a lieu qu'à l'enregistrement du formulaire. L'état voyage dans un champ caché (vide = rien à supprimer).
 * `text` : libellé affiché à côté de l'icône (sinon icône seule, nom accessible compris dans `label`).
 */
const trash = (name, label, { text = '' } = {}) => `<span class="trash-wrap"><input type="hidden" name="${name}" value="" data-trash-input><button type="button" class="trash${text ? ' txt' : ''}" data-trash aria-pressed="false" aria-label="${esc(label)}" title="${esc(label)}">${ic('trash')}${text ? `<span>${esc(text)}</span>` : ''}</button><span class="trash-note" hidden>Sera retiré à l'enregistrement</span></span>`;

/** Case à cocher du design : le <input> natif reste là (clavier, lecteurs d'écran), la case dessinée suit son état. */
const check = (name, checked, text, { value = '' } = {}) => `<label class="opt"><input type="checkbox" name="${name}"${value ? ` value="${value}"` : ''}${checked ? ' checked' : ''}><span class="box">${ic('check')}</span><span>${text}</span></label>`;

/** Une ligne « webhook Discord » : adresse (jamais réaffichée) et événements reçus. `fresh` : ligne qui vient d'être ajoutée (gabarit). */
function hookRow(i, h, all, { fresh = false } = {}) {
  const n = typeof i === 'number' ? i + 1 : '';
  return `<div class="gitrow" data-discord-row>
      <input type="hidden" name="discord_id_${i}" value="${esc(h.id)}">
      <div class="gitrow-head"><span class="srv-n">${ic('discord')}<span class="badge" data-discord-title>Discord${n ? ` ${n}` : ''}</span></span>
        ${fresh ? ' <button type="button" class="linklike" data-discord-cancel>Annuler</button>' : `<span class="row"><button type="button" class="btn" data-notify-test data-hook="${esc(h.id)}">Envoyer un test</button>${trash(`discord_del_${i}`, 'Retirer ce webhook')}</span>`}</div>
      <fieldset class="evs"><legend class="lbl">${fresh ? '1. Quelles notifications veux-tu y recevoir ?' : 'Ce webhook reçoit'}</legend>
        <div class="checks">${Object.entries(all).map(([k, label]) => check(`discord_ev_${i}_${k}`, fresh ? CHANNEL_DEFAULT_EVENTS.includes(k) : h.events.includes(k), esc(label))).join('')}</div>
      </fieldset>
      <label class="field"><span class="lbl">${fresh ? '2. ' : ''}Lien du webhook Discord</span><input name="discord_url_${i}" type="password" placeholder="${fresh ? 'https://discord.com/api/webhooks/…' : '•••••• (inchangé)'}" autocomplete="off"><span class="hint">Discord : salon › Modifier › Intégrations › Webhooks › Nouveau webhook › Copier l'URL. Stocké chiffré.</span></label>
    </div>`;
}

// Notifications cochées d'office pour un nouveau canal : celles qu'on ne veut pas rater
const CHANNEL_DEFAULT_EVENTS = ['reply', 'job_error', 'abuse'];

/** Carte d'un canal (Slack, Telegram, e-mail) : notifications reçues, puis champs propres au canal. Masquée tant que le canal n'est pas ajouté avec « + ». */
function channelCard(type, label, s, fields) {
  const c = s.channels[type];
  return `<div class="gitrow" data-channel="${type}"${c ? '' : ' hidden'}>
      <div class="gitrow-head"><span class="srv-n">${ic(type === 'email' ? 'mail' : type)}<span class="badge">${label}</span></span>
        ${c ? `<span class="row"><button type="button" class="btn" data-notify-test data-channel="${type}">Envoyer un test</button>${trash(`${type}_del`, `Retirer ${label}`)}</span>` : '<button type="button" class="linklike" data-chan-cancel>Annuler</button>'}</div>
      <fieldset class="evs"><legend class="lbl">${c ? `${label} reçoit` : '1. Quelles notifications veux-tu y recevoir ?'}</legend>
        <div class="checks">${Object.entries(s.discord.all).map(([k, l]) => check(`${type}_ev_${k}`, c ? c.events.includes(k) : CHANNEL_DEFAULT_EVENTS.includes(k), esc(l))).join('')}</div>
      </fieldset>
      ${fields}
    </div>`;
}

/** Notifications que plus aucun canal ne reçoit : de quoi penser à en ajouter un. */
function uncovered(d, channels = {}) {
  const all = [...d.hooks, ...Object.values(channels)];
  if (!all.length) return '';
  const missing = Object.entries(d.all).filter(([k]) => !all.some((h) => h.events.includes(k))).map(([, l]) => esc(l));
  return missing.length ? `<p class="hint">Ajoute un canal pour recevoir aussi : ${missing.join(' · ')}.</p>` : '';
}

const SETTINGS_TOC = [['notif', 'Notifications'], ['git', 'Dépôts Git'], ['garde', 'Garde-fous'], ['budget', 'Budget et modèles IA'], ['prompts', 'Prompts IA']];

export function settingsPage({ email, s, saved }) {
  // Sélecteur de modèle en deux listes : les recommandés (avec une estimation relative du coût), puis tous les autres, plus compacts et sans estimation
  const priced = !!s.priced; // le « $ » relatif n'a de sens qu'avec une clé API (facturée à l'usage)
  const recTier = (m) => (priced ? `${m.tier} · ${m.cost}` : m.tier);
  const model = (name, v, title) => {
    const cur = RECOMMENDED.find((m) => m.id === v);
    const radio = (m, extra = '') => `<input type="radio" name="${name}" value="${m.id}"${m.id === v ? ' checked' : ''} data-mp-label="${esc(m.label)}" data-mp-tier="${esc(extra)}">`;
    return `<div class="field modelpick" data-modelpick>
      <span class="lbl" id="${name}-l">${title}</span>
      <details class="mp">
        <summary aria-labelledby="${name}-l"><span class="mp-cur"><b data-mp-name>${esc(cur ? cur.label : modelLabel(v))}</b> <em data-mp-tier-out>${cur ? esc(recTier(cur)) : ''}</em></span>${ic('down')}</summary>
        <div class="mp-pop" role="radiogroup" aria-labelledby="${name}-l">
          <p class="mp-h">Recommandés</p>
          ${RECOMMENDED.map((m) => `<label class="mp-rec">${radio(m, recTier(m))}<span class="mp-n"><b>${esc(m.label)}</b><small>${esc(m.note)}</small></span><span class="mp-t">${esc(m.tier)}${priced ? ` <i>${esc(m.cost)}</i>` : ''}</span></label>`).join('\n          ')}
          <hr class="mp-sep">
          <p class="mp-h mp-h-s">Autres modèles</p>
          <div class="mp-others">
            ${OTHERS.map((m) => `<label class="mp-o">${radio(m, '')}<span>${esc(m.label)}</span></label>`).join('\n            ')}
          </div>
        </div>
      </details>
    </div>`;
  };
  return layout({
    title: 'Réglages', email,
    body: `<div class="settings">
<nav class="toc" aria-label="Sections des réglages"><ol>
  ${SETTINGS_TOC.map(([id, label], i) => `<li><a href="#${id}"${i === 0 ? ' aria-current="true"' : ''}>${label}</a></li>`).join('\n  ')}
</ol></nav>
<div class="settings-main">
<h1 class="h1">Réglages</h1>
${saved ? `<p class="ok-box" role="status">${ic('check')}<span><b>Réglages enregistrés</b></span></p>` : ''}
<form method="post" action="/settings" class="settings-form">

<section class="card" id="notif" aria-labelledby="t-notif">
  <div class="card-h"><h2 id="t-notif">Notifications</h2><p>Où et quand AiTools te prévient : réponses de prospects, jobs terminés ou en erreur, alertes. Les liens et jetons sont stockés chiffrés et ne sont jamais réaffichés.</p></div>
  <label class="field"><span class="lbl">Email de réception (évolutions, rapport hebdo)</span><input name="notify_email" type="email" value="${esc(s.notify_email)}" placeholder="toi@exemple.fr"><span class="hint">Ces mails partent de l'adresse d'AiTools (SMTP du serveur).</span></label>
  ${check('weekly_report', s.weekly_report, 'Rapport hebdo le lundi à 8h (mail + canaux ci-dessous)')}
  <div class="save"><button type="button" class="btn" data-report-send>${ic('send')}Envoyer le rapport maintenant</button></div>

  <h3 class="sub">Canaux</h3>
  <p class="hint">Reçois les notifications dans l'outil de ton choix. Ajoute un canal avec « + » : tu choisis le service, les notifications voulues, puis tu colles le lien du webhook. Plusieurs canaux Discord sont possibles pour séparer ce qui est dit ou fait (réponses d'un côté, erreurs de l'autre).</p>
  <div class="chanlist" data-chanlist>
    <div class="gitlist" data-discordlist data-next="${s.discord.hooks.length}" data-max="${s.discord.max}">
      ${s.discord.hooks.map((h, i) => hookRow(i, h, s.discord.all)).join('\n      ')}
    </div>
    ${channelCard('slack', 'Slack', s, `<label class="field"><span class="lbl">Lien du webhook Slack</span><input name="slack_url" type="password" placeholder="${s.channels.slack ? '•••••• (inchangé)' : 'https://hooks.slack.com/services/…'}" autocomplete="off"><span class="hint">Slack : Apps → Incoming Webhooks.</span></label>`)}
    ${channelCard('telegram', 'Telegram', s, `<label class="field"><span class="lbl">Jeton du bot</span><input name="telegram_token" type="password" placeholder="${s.channels.telegram ? '•••••• (inchangé)' : '123456789:AA…'}" autocomplete="off"><span class="hint">Crée un bot avec @BotFather.</span></label>
      <label class="field"><span class="lbl">Identifiant de la conversation</span><input name="telegram_chat" value="${esc(s.channels.telegram?.chat || '')}" placeholder="123456789 ou @mon_canal" autocomplete="off"><span class="hint">Écris d'abord à ton bot, puis lis l'identifiant avec @userinfobot.</span></label>`)}
    ${channelCard('email', 'E-mail', s, `<label class="field"><span class="lbl">Adresse de réception</span><input name="email_to" type="email" value="${esc(s.channels.email?.to || '')}" placeholder="toi@exemple.fr" autocomplete="off"><span class="hint">${s.canEmail ? "Envoyé depuis l'adresse d'AiTools. Au plus 20 notifications par heure." : "Ce canal s'active dès que l'administrateur a réglé le SMTP du serveur."}</span></label>`)}
  </div>
  <template id="discord-row-tpl">${hookRow('__I__', { id: '', events: [] }, s.discord.all, { fresh: true })}</template>
  <p class="hint" data-chan-empty${s.discord.hooks.length || Object.keys(s.channels).length ? ' hidden' : ''}>Ajoute un canal ci-dessus pour recevoir les notifications.</p>
  ${uncovered(s.discord, s.channels)}
  <div class="gitadd">
    <details class="addmenu" data-addmenu>
      <summary class="btn">${ic('plus')}Ajouter un canal</summary>
      <div class="menu" role="menu" aria-label="Service de notification">
        <button type="button" role="menuitem" data-chan-pick="discord">${ic('discord')}<span><b>Discord</b><small>Un webhook par salon</small></span></button>
        <button type="button" role="menuitem" data-chan-pick="slack"${s.channels.slack ? ' hidden' : ''}>${ic('slack')}<span><b>Slack</b><small>Webhook entrant</small></span></button>
        <button type="button" role="menuitem" data-chan-pick="telegram"${s.channels.telegram ? ' hidden' : ''}>${ic('telegram')}<span><b>Telegram</b><small>Bot et conversation</small></span></button>
        <button type="button" role="menuitem" data-chan-pick="email"${s.channels.email ? ' hidden' : ''}>${ic('mail')}<span><b>E-mail</b><small>Une adresse de réception</small></span></button>
      </div>
    </details>
    <span class="hint" data-discord-max hidden>${s.discord.max} webhooks Discord au plus.</span>
  </div>
</section>

<section class="card" id="git" aria-labelledby="t-git">
  <div class="card-h"><h2 id="t-git">Dépôts Git</h2><p>GitHub est toujours accepté. Chaque token ne sert qu'à son serveur : il est stocké chiffré, jamais envoyé ailleurs, et jamais réaffiché.</p></div>
  <div class="gitlist" data-gitlist data-next="${s.git_servers.length}" data-max="${MAX_GIT_SERVERS}">
    <div class="gitrow">
      <div class="gitrow-head"><span class="srv-n">${ic('git')}<span class="badge">github.com</span></span></div>
      <label class="field"><span class="lbl">Token (dépôts privés, lecture seule)</span><input name="github_token" type="password" placeholder="${s.github_token_set ? '•••••• (inchangé)' : 'github_pat_…'}" autocomplete="new-password"></label>
      <div class="row">
        <button type="button" class="btn" data-github-test><span class="spin-inline" hidden></span><span data-label>Tester ce token</span></button>
        <span class="hint">Teste le token tapé ci-dessus, sinon celui qui est enregistré. Rien n'est modifié.</span>
      </div>
      <div class="gittest" data-github-result role="status" aria-live="polite" hidden></div>
      <p class="hint">Inutile pour un dépôt public. Crée un <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">token à portée limitée</a> : <em>Only select repositories</em> (tes dépôts) et la permission <em>Contents : Read-only</em>, rien d'autre.</p>
      ${s.github_token_set ? `<div class="row"><span class="hint">Un token est enregistré.</span>${trash('github_token_clear', 'Supprimer le token GitHub enregistré', { text: 'Supprimer le token' })}</div>` : ''}
    </div>
    ${s.git_servers.map((srv, i) => gitRow(i, srv)).join('\n    ')}
  </div>
  <template id="git-row-tpl">${gitRow('__I__', { type: '__TYPE__', label: '__LABEL__', host: '', hasToken: false, id: '' }, { fresh: true })}</template>
  <div class="gitadd">
    <button type="button" class="btn" data-git-add aria-expanded="false" aria-controls="git-type">${ic('plus')}Ajouter un serveur Git</button>
    <span class="sel"><select id="git-type" data-git-type hidden aria-label="Type de serveur Git">
      <option value="">Quel type de serveur ?</option>
      ${Object.entries(GIT_SERVER_TYPES).map(([k, t]) => `<option value="${k}" data-label="${esc(t.label)}" data-hint="${esc(t.hint)}">${esc(t.label)}</option>`).join('')}
    </select>${ic('down')}</span>
    <span class="hint" data-git-max hidden>${MAX_GIT_SERVERS} serveurs au plus.</span>
  </div>
</section>

<section class="card" id="garde" aria-labelledby="t-garde">
  <div class="card-h"><h2 id="t-garde">Garde-fous</h2><p>Des plafonds et des délais pour garder la main.</p></div>
  <div class="grid2">
    <label class="field"><span class="lbl">Plafond global mails / 24 h (max 300)</span><span class="unit"><input name="global_daily_cap" type="number" min="1" max="300" value="${esc(s.global_daily_cap)}"><span>mails</span></span></label>
    <label class="field"><span class="lbl">Délai min entre 2 mails</span><span class="unit"><input name="send_delay_min" type="number" min="5" value="${esc(s.send_delay_min)}"><span>secondes</span></span></label>
    <label class="field"><span class="lbl">Délai max entre 2 mails</span><span class="unit"><input name="send_delay_max" type="number" min="5" value="${esc(s.send_delay_max)}"><span>secondes</span></span></label>
  </div>
  ${check('read_receipt', s.read_receipt, 'Demander un accusé de lecture dans les mails de prospection')}
  <p class="hint">« Lu » repose sur l'accusé de lecture standard : la messagerie du destinataire lui demande s'il accepte de l'envoyer. « Lu » est donc un minimum ; « Répondu » vient de la boîte de réception du projet.</p>
  <div class="footer-opt" data-footer-opt data-on="${s.mail_footer ? '1' : '0'}">
    <h3>Pied de page des mails de prospection</h3>
    <p class="state ${s.mail_footer ? 'ok' : 'warn'}" data-footer-state role="status">${s.mail_footer
    ? 'Actif : chaque mail se termine par « Vous recevez ce message car l\'adresse … est publiée publiquement (source) » et un lien « Ne plus recevoir de messages ».'
    : 'Retiré : tes mails partent sans lien « Ne plus recevoir de messages » ni origine de l\'adresse.'}</p>
    <div class="ban ban-err" role="note">${ic('alert')}<span class="ban-t"><b>Attention, risques si tu le retires.</b>
      <ul>
        <li><strong>Légal</strong> : en prospection par e-mail, le RGPD et la CNIL demandent d'informer la personne de l'origine de son adresse et de lui offrir un moyen simple et gratuit de refuser tes messages ; c'est toi qui en portes la responsabilité (sanctions possibles).</li>
        <li><strong>Réputation</strong> : sans lien de désinscription, les destinataires cliquent « Spam », et Gmail ou Outlook peuvent bloquer ton adresse et ton domaine d'envoi.</li>
        <li><strong>Désinscriptions</strong> : rien dans le mail ne permet de se désinscrire ; la personne doit te répondre, et tu la marques toi-même en « Refus ».</li>
      </ul>
      Tu peux remettre le pied de page à tout moment.</span></div>
    <button type="button" class="btn danger" data-footer-off ${s.mail_footer ? '' : 'hidden'}>Retirer le pied de page des mails</button>
    <button type="button" class="btn" data-footer-on ${s.mail_footer ? 'hidden' : ''}>Remettre le pied de page</button>
  </div>
</section>

<section class="card" id="budget" aria-labelledby="t-budget">
  <div class="card-h"><h2 id="t-budget">${s.priced ? 'Budget IA' : 'Modèles IA'}</h2>${s.priced
    ? "<p>Avec ta clé API, chaque job est facturé par Anthropic : en équivalent $ API remonté par Claude Code. Au-delà d'un plafond, les jobs IA attendent sans être perdus ; envois et relances continuent. Renseigne un montant pour activer un plafond.</p>"
    : "<p>Avec ton abonnement Claude rien n'est facturé en plus : le garde-fou est ton quota Claude (affiché en haut), pas un budget en $.</p>"}</div>
  <div class="grid2">
    ${s.priced ? `<label class="field"><span class="lbl">Plafond sur 24 h glissantes</span><span class="unit"><input name="budget_day_usd" inputmode="decimal" value="${esc(s.budget_day_usd)}" placeholder="ex. 2"><span>$</span></span></label>
    <label class="field"><span class="lbl">Plafond sur 30 jours glissants</span><span class="unit"><input name="budget_month_usd" inputmode="decimal" value="${esc(s.budget_month_usd)}" placeholder="ex. 30"><span>$</span></span></label>` : ''}
    ${model('prospect_model', s.prospect_model, 'Modèle pour la prospection')}
    ${model('analyze_model', s.analyze_model, "Modèle pour l'analyse de projet")}
    ${model('write_model', s.write_model, 'Modèle pour la rédaction (mails, relances, posts LinkedIn)')}
  </div>
  <p class="hint">Haiku suffit pour la plupart des projets : passe à Sonnet ou Opus seulement si les fiches ou les textes manquent de précision. Les estimations (économe, intermédiaire, plus cher) sont relatives : avec ton abonnement elles se voient dans ton quota Claude, avec une clé API dans le prix. Chaque modèle a ses propres prompts, réglables plus bas.</p>
</section>


<section class="card" id="prompts" aria-labelledby="t-prompts" data-prompts data-pscope="*">
  <div class="card-h"><h2 id="t-prompts">Prompts IA</h2><p>Les consignes que Claude reçoit pour chaque tâche. Modifie-les pour changer le style, le ton ou les règles. Le contexte du projet et le format de réponse restent ajoutés automatiquement : un prompt modifié ne peut pas casser la lecture de la réponse.</p></div>
  <p class="hint">Chaque gamme de modèle a ses propres consignes, adaptées à sa façon de travailler (un petit modèle a besoin d'une méthode pas à pas, un grand d'un peu plus de recul). Un texte écrit dans « Tous les modèles » s'applique à toutes les gammes qui n'ont pas le leur. Ce qui est vide revient au texte par défaut.</p>
  <div class="pscope-bar" role="group" aria-label="Gamme de modèle">
    ${s.prompts.scopes.map((sc, i) => `<button type="button" class="pscope-tab" data-pscope-tab="${sc.id}" aria-pressed="${i === 0}">${esc(sc.label)}${sc.count ? ` <span class="badge warn">${sc.count}</span>` : ''}</button>`).join('\n    ')}
  </div>
  ${s.prompts.tasks.map((t) => `<details class="prompt-def"${Object.values(t.scopes).some((x) => x.custom) ? ' open' : ''}>
    <summary><span>${esc(t.label)}</span><span class="muted small">modèle : ${esc(t.uses)}</span>${Object.values(t.scopes).some((x) => x.custom) ? ' <span class="badge warn">modifié</span>' : ''}</summary>
    ${s.prompts.scopes.map((sc) => `<div class="pscope-box" data-pscope-box="${sc.id}">
      <label class="field"><span class="lbl">Consignes · ${esc(sc.label)}${t.scopes[sc.id].custom ? ' (modifié)' : ''}</span>
        <textarea name="${sc.id === '*' ? `prompt_${t.key}` : `prompt_${sc.id}_${t.key}`}" rows="14" maxlength="${s.promptMax}" data-prompt-text>${esc(t.scopes[sc.id].text)}</textarea></label>
      <div class="row-actions"><button type="button" class="btn small" data-prompt-reset data-default="${esc(t.scopes[sc.id].def)}">${ic('repeat')}Revenir au texte par défaut</button></div>
    </div>`).join('\n    ')}
    <p class="muted small">${esc(t.fixed)}${t.vars.length ? ` Valeurs insérées automatiquement : ${t.vars.map((v) => `<code>[[${v}]]</code>`).join(', ')}.` : ''}</p>
  </details>`).join('\n  ')}
</section>
<div class="savebar" data-savebar hidden><p>Notifications, dépôts Git, garde-fous, modèles et prompts s'enregistrent ensemble.</p><button class="btn primary">Enregistrer les réglages</button></div>
</form>

</div>
</div>`,
  });
}

export function unsubPage({ email, done, valid }) {
  return layout({
    title: 'Désinscription',
    body: `<section class="login card">
${!valid ? '<p class="error">Lien invalide.</p>'
  : done ? `<p>C'est fait : <strong>${esc(email)}</strong> ne sera plus contacté.</p>`
  : `<p>Ne plus recevoir de messages à <strong>${esc(email)}</strong> ?</p>
     <form method="post"><button class="btn primary">Confirmer la désinscription</button></form>`}
</section>`,
  });
}
