import { RECOMMENDED, OTHERS, modelLabel } from './services/models.js';
import { esc } from './http.js';
import { STATUSES } from './services/crm.js';
import { icalBox } from './icalview.js';
import { devLinks } from './devlinks.js';
import { assetUrl, brandMark, iconLinks } from './assets.js';
import { SPRITE, ic } from './icons.js';
import { GIT_SERVER_TYPES, MAX_GIT_SERVERS } from './gitservers.js';
import { MODE_LABELS, CONSENT_TEXT, CONSENT_CHECKBOX, CONSENT_VERSION } from './claudelink.js';

const fmtDate = (ts) => (ts ? new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }) : '—');

// Icônes de la section : noms du sprite (src/icons.js), une seule fois par page
const SECTION_ICONS = { target: 'target', search: 'search', spark: 'spark', chart: 'chart', mail: 'mail', linkedin: 'pen', send: 'send', repeat: 'repeat', users: 'users', gear: 'gear', git: 'git', computer: 'computer', film: 'film' };

/** Section dépliable. `title` peut contenir du HTML de confiance (badges), jamais de donnée utilisateur brute. */
function acc(key, icon, title, sub, body, { open = false, cls = '' } = {}) {
  return `<details class="acc anim ${cls}" data-acc="${key}"${open ? ' open' : ''}>
  <summary><span class="acc-ico">${ic(SECTION_ICONS[icon])}</span><span class="acc-txt"><span class="acc-title">${title}</span>${sub ? `<span class="acc-sub">${sub}</span>` : ''}</span><span class="chev" aria-hidden="true"></span></summary>
  <div class="acc-body">${body}</div>
</details>`;
}

const NAV = [['/', 'folder', 'Projets'], ['/mails', 'mail', 'Mails'], ['/calendar', 'clock', 'Calendrier'], ['/team', 'users', 'Équipe']];

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
<script src="${assetUrl('/static/app.js')}" defer></script>
<script src="${assetUrl('/static/responsive.js')}" defer></script>
<script src="${assetUrl('/static/fx.js')}" defer></script>
<script src="${assetUrl('/static/ajax.js')}" defer></script>
${scripts.map((src) => `<script src="${assetUrl(src)}" defer></script>`).join('\n')}
</head>
<body class="app">
<canvas id="bg" aria-hidden="true"></canvas>
${SPRITE}
<a class="skip" href="#contenu">Aller au contenu</a>
${email ? `<header class="top">
  <div class="top-in">
    <a class="lockup" href="/" aria-label="AiTools, projets">${brandMark()}<span class="wordmark">AiTools</span></a>
    <nav class="pills" aria-label="Navigation de l'application">
      ${NAV.map(([href, icon, label]) => `<a class="pill" href="${href}">${ic(icon)}${label}</a>`).join('\n      ')}
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
        <summary class="ia-link" aria-label="Assistant IA : Claude ou Support">${ic('spark')}<span>IA</span></summary>
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
          <form method="post" action="/logout"><button>${ic('out')}Déconnexion</button></form>
        </div>
      </details>
    </div>
  </div>
  <div class="strip" id="sys" aria-live="polite"></div>
</header>` : ''}
<main id="contenu" tabindex="-1"><div class="page">${body}</div></main>
</body>
</html>`;
}

// Usage du mois : une barre par plafond du plan (largeurs par classes w-N, la CSP interdit le style en ligne)
export function usagePanel(u) {
  if (!u) return '';
  const rows = u.items.map((i) => `<li class="g"><div class="g-h"><span>${esc(i.label)}</span><span class="g-v">${i.used}${i.limit == null ? '' : ` / ${i.limit}`}</span></div>${i.limit == null ? '' : `<div class="bar usage${i.full ? ' full' : ''}" role="progressbar" aria-label="${esc(i.label)}" aria-valuemin="0" aria-valuemax="${i.limit}" aria-valuenow="${i.used}"><span class="w-${Math.round(i.pct / 5) * 5}"></span></div>`}</li>`).join('');
  const full = u.items.filter((i) => i.full);
  return `<section class="panel usage-card" aria-labelledby="h-usage">
  <div class="panel-h"><h2 id="h-usage">Usage du mois</h2><span class="badge">plan ${esc(u.planLabel)}</span></div>
  <ul class="usage-list">${rows}</ul>
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
  if (mode === 'api_key') return `${head}<p class="hint">Avec une clé API, il n'y a pas de limite de session ni de semaine : Anthropic facture ce que tu consommes.</p>`;
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
  <p class="card-d">Aucun accès Claude n'est relié : l'application reste bloquée sur la page de liaison.</p>
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

export function accountPage({ user, error, link = null, consent = null, notice = null, usage = null, developer = false, ical = null, appUrl = '', quota = null }) {
  return layout({
    title: 'Mon compte', email: user.email,
    body: `<div class="narrow">
<h1 class="h1">Mon compte</h1>
<section class="card">
  <div class="card-h"><h2>Connexion</h2></div>
  <div class="ident"><span class="avatar" aria-hidden="true">${esc(String(user.email).trim().charAt(0).toUpperCase())}</span>
    <span class="sp"><b>${esc(user.email)}</b><span class="hint">Connecté avec ${esc(PROVIDER_NAMES[user.provider] || '—')}, sans mot de passe</span></span>
    <span class="badge">${esc(PROVIDER_NAMES[user.provider] || '—')}</span></div>
  ${user.isAdmin ? '<div class="row"><a class="btn small" href="/admin">Administration</a></div>' : ''}
</section>
${notice ? `<p class="${notice.ok ? 'msg msg-ok' : 'msg msg-err'}" role="status">${esc(notice.text)}</p>` : ''}
${usagePanel(usage)}
${linkSection(link, consent, quota)}
<section class="card">
  <div class="card-h"><h2>Agenda</h2><p>Connecte ton agenda (Google, Apple, Outlook) : tes prochaines actions et tes posts LinkedIn programmés s'y affichent. <a href="/calendar">Voir le calendrier</a></p></div>
  ${icalBox(ical, '/account')}
</section>
<section class="card">
  <div class="card-h"><h2>Mode développeur</h2><p>L'API d'AiTools et le serveur MCP (relier Claude à ton panel) ne sont disponibles que si tu actives ce mode.</p></div>
  <div class="row"><span class="badge ${developer ? 'ok' : ''}">${developer ? 'Activé' : 'Désactivé'}</span><a class="btn small" href="/developer">${ic('key')}${developer ? 'Jetons et documentation' : 'Activer'}</a></div>
  ${developer ? devLinks(appUrl) : `<p class="muted small">Une fois le mode activé, les adresses de l'API et du serveur MCP, leurs documentations et tes jetons s'affichent ici et sur la page Développeur.</p>`}
</section>
<section class="card danger">
  <div class="card-h"><h2>Zone de danger</h2></div>
  <p class="card-d">Supprimer ton compte efface définitivement ton compte et toutes tes données : projets, prospects, notes, modèles de mail, journaux d'envoi, jobs, réglages et clones du code. Les adresses qui ont demandé à ne plus être contactées restent dans la liste d'opposition commune. Cette action est irréversible.</p>
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
    : '<p class="lead">Choisis comment AiTools accède à ton Claude. Les analyses, recherches et rédactions s\'exécutent avec TON accès, jamais celui d\'un autre utilisateur.</p>';
  const box = `<label class="check opt"><input type="checkbox" name="accept" data-consent required><span class="box">${ic('check')}</span><span>${esc(CONSENT_CHECKBOX)}</span></label>`;
  const notice = `<div class="notice">${CONSENT_TEXT.map((t) => `<p>${esc(t)}</p>`).join('')}</div>`;
  // Connexion guidée (public/app.js) : le bouton demande le lien au serveur, avec un petit chargement, puis l'étape 2
  // attend le code que Claude affiche ; le serveur récupère le jeton tout seul.
  const cards = cliModeEnabled ? `
<article class="optc">
  <div class="optc-h"><span class="optc-i">${ic('link')}</span></div>
  <h3>Se connecter avec Claude</h3>
  <p>Utilise ton abonnement Claude (Pro, Max) au lieu d'une clé API. Cette option comporte un risque pour ton compte Claude : une fenêtre d'avertissement s'affiche avant de continuer.</p>
  <button type="button" class="btn" data-open-dialog="consent-dialog">Se connecter avec Claude</button>
</article>
<article class="optc">
  <div class="optc-h"><span class="optc-i">${ic('paste')}</span></div>
  <h3>Jeton collé à la main</h3>
  <p>Colle un jeton d'abonnement Claude. Pour les cas où la connexion directe ne passe pas.</p>
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
</article>` : '';
  const dialog = cliModeEnabled ? `<dialog class="prospect-dialog modal" id="consent-dialog" aria-labelledby="consent-title"${start ? ' data-autoopen' : ''}>
  <div class="cfg">
    <h2 id="consent-title">${ic('alert')}Avant de continuer</h2>
    <form class="cfg" data-claude-login data-consent-form>
      ${notice}
      ${box}
      <p class="hint">Un lien de connexion va s'afficher. Tu te connectes à Claude, puis tu recopies ici le petit code qu'il te montre : AiTools récupère le jeton tout seul. Texte d'avertissement version ${esc(CONSENT_VERSION)}.</p>
      <div class="modal-f"><button type="button" class="btn" data-close-dialog>Annuler</button><button class="btn primary" data-consent-submit disabled><span class="spin-inline" hidden></span><span data-label>Continuer</span></button></div>
      <p class="hint" role="status" data-claude-status></p>
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
      </form>
      <p class="msg msg-err" role="alert" data-claude-error2 hidden></p>
    </div>
  </div>
</dialog>` : '';
  return layout({
    title: 'Relier Claude', email: user.email,
    body: `<div class="narrow">
<h1 class="h1">Relier Claude</h1>
${intro}
${error ? `<p class="msg msg-err" role="alert">${esc(error)}</p>` : ''}
<div class="opts">
<article class="optc optc-rec">
  <div class="optc-h"><span class="optc-i">${ic('key')}</span><span class="badge ok">${ic('check')}Recommandée</span></div>
  <h3>Clé API Anthropic</h3>
  <p>Crée une clé sur console.anthropic.com puis colle-la ici. Elle est vérifiée sans consommer de tokens, chiffrée, et ne sera plus jamais affichée (seuls ses 4 derniers caractères le seront). Tu paies à l'usage, directement chez Anthropic.</p>
  <form method="post" action="/link/api-key" class="cfg">
    <label class="field"><span class="lbl">Clé API</span><input name="apiKey" type="password" autocomplete="new-password" spellcheck="false" required placeholder="sk-ant-…"></label>
    <button class="btn primary">Vérifier et relier</button>
  </form>
</article>${cards}
</div>
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
  <p class="muted small">Utilise un compte en lecture seule. Chaque requête doit renvoyer un seul nombre.</p>
  <div class="grid3">
    <label>Type<select name="type"><option value="mysql" ${dbCfg.type !== 'pg' ? 'selected' : ''}>MySQL / MariaDB</option><option value="pg" ${dbCfg.type === 'pg' ? 'selected' : ''}>PostgreSQL</option></select></label>
    <label>Hôte<input name="host" value="${esc(dbCfg.host)}"></label>
    <label>Port<input name="port" type="number" value="${esc(dbCfg.port)}"></label>
    <label>Base<input name="database" value="${esc(dbCfg.database)}"></label>
    <label>Utilisateur<input name="user" value="${esc(dbCfg.user)}" autocomplete="off"></label>
    <label>Mot de passe<input name="password" type="password" placeholder="${dbCfg.passwordSet ? '•••••• (inchangé)' : ''}" autocomplete="new-password"></label>
  </div>
  <label class="check"><input type="checkbox" name="ssl" ${dbCfg.ssl ? 'checked' : ''}> SSL</label>
  <label>Nb utilisateurs<input name="sql_users" value="${esc(dbCfg.sql_users)}" placeholder="SELECT COUNT(*) FROM users"></label>
  <label>Nb clients payants<input name="sql_clients" value="${esc(dbCfg.sql_clients)}" placeholder="SELECT COUNT(*) FROM subscriptions WHERE status='active'"></label>
  <label>Revenu total (€)<input name="sql_revenue" value="${esc(dbCfg.sql_revenue)}" placeholder="SELECT SUM(amount)/100 FROM payments"></label>
  <button class="btn">Enregistrer BDD</button>
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
      <p class="muted small">Variables : {{entreprise}} {{ville}}${initial ? ' {{accroche}}' : ''} {{expediteur}}. Le lien de désinscription est ajouté automatiquement.</p>
      <label>Objet${initial ? '' : ' <span class="muted small">(vide = « Re: » + objet du premier mail, dans le même fil)</span>'}<input name="subject"></label>
      ${initial ? '<label>Objet B <span class="muted small">(optionnel : test A/B, les envois alternent entre les deux objets)</span><input name="subjectB"></label>' : ''}
      <label>Corps<textarea name="body" rows="${initial ? 9 : 5}"></textarea></label>
      <div class="row">
        <button class="btn" name="mode" value="save">Enregistrer</button>
        <button class="btn primary" name="mode" value="validate">Valider le modèle</button>
      </div>
    </form>
    <div class="job" data-job="${job}"></div>`;
}

function projectItem(p, smtp, dbCfg, imap, { open = false } = {}) {
  const profile = p.profile;
  return `<details class="project anim" data-id="${p.id}"${open ? ' open' : ''}>
<summary><span class="pname">${esc(p.name)}</span>${p.access !== 'owner' ? `<span class="badge" title="Projet partagé par ${esc(p.ownerEmail || '')}">équipe de ${esc(p.ownerEmail || '')}</span>` : p.teamId ? '<span class="badge ok">partagé</span>' : ''}<span class="pcfg badge" data-cfg title="Afficher la liste de mise en route" hidden></span><span class="pstate" data-state></span></summary>
<div class="pbody"><div class="pcard">
  ${acc('header', 'git', 'En-tête', 'Dépôt Git et fiche projet', `
  <div class="field"><span class="lbl">Dépôt Git</span><div class="ro">${ic('lock', 'ic-s')}<span>${esc(p.gitUrl)}</span><span class="badge">lecture seule</span></div></div>
  <section class="profile fiche">
    <div class="fiche-h">
      <b>Fiche projet</b>
      <button class="btn secondary" data-run="analyze" data-id="${p.id}">${ic('repeat')}Réanalyser</button>
    </div>
    ${profile
      ? `<p>${esc(profile.resume)}</p><p class="meta"><span>Analysé le ${fmtDate(p.profileAt)}</span><span>Commit <code>${esc((p.profileCommit || '').slice(0, 8))}</code></span><span>${esc(profile.stack || '')}</span></p>`
      : '<p class="muted">Pas encore analysé.</p>'}
  </section>`, { open: true })}

  ${profile ? acc('target', 'target',
    `Cible ${p.targetValidated ? '<span class="badge ok">validée</span>' : '<span class="badge warn">à valider</span>'}`,
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
        <a class="btn small" data-export href="/api/projects/${p.id}/prospects.csv" download>Exporter (CSV)</a>
        <label class="btn small file">Importer un CSV<input type="file" accept=".csv,text/csv" data-import="${p.id}" hidden></label>
        <span class="muted small">Colonnes reconnues : entreprise, email, site, ville, secteur, score, source, accroche.</span>
      </div>
      <div data-import-report></div>
      <div data-prospects></div>
      <div class="pager" data-pager></div>`, { cls: 'sub prospects' })}
  `, { cls: 'main' })}

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
  </div>

  ${p.access !== 'member' ? acc('config', 'gear', 'Configuration du projet', 'SMTP, boîte IMAP, base de données', configForms(p, smtp, dbCfg, imap), { cls: 'config' }) : ''}
</div></div>
</details>`;
}

export function dashboardPage({ email, projects, gitHosts = [], usage = null, pauseMessage = null }) {
  return layout({
    title: 'Projets', email,
    body: `<div class="dash">
<section class="col-p" aria-labelledby="h-projets">
  <div class="hd"><h1 id="h-projets">Projets</h1><button type="button" class="btn primary" data-new-toggle aria-expanded="false" aria-controls="new-project">${ic('plus')}Nouveau projet</button></div>
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
  ${projects.length ? projects.map((x) => projectItem(x.project, x.smtp, x.dbCfg, x.imap, { open: projects.length === 1 })).join('\n') : `<div class="empty">
    <span class="empty-i">${ic('folder')}</span>
    <h3>Aucun projet pour l'instant</h3>
    <p>Crée ton premier projet : donne-lui un nom et l'adresse de son dépôt Git, Claude s'occupe de l'analyser.</p>
  </div>`}
  </div>
</section>
${usagePanel(usage)}
</div>
${projects.length ? '<aside class="todo" id="todo" aria-label="Mise en route du projet" hidden></aside>' : ''}`,
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
  return missing.length ? `<p class="hint">Aucun canal ne reçoit pour l'instant : ${missing.join(' · ')}.</p>` : '';
}

const SETTINGS_TOC = [['notif', 'Notifications'], ['git', 'Dépôts Git'], ['garde', 'Garde-fous'], ['budget', 'Budget et modèles IA'], ['prompts', 'Prompts IA'], ['opposition', "Liste d'opposition"]];

export function settingsPage({ email, s, saved }) {
  // Sélecteur de modèle en deux listes : les recommandés (avec une estimation relative du coût), puis tous les autres, plus compacts et sans estimation
  const recTier = (m) => `${m.tier} · ${m.cost}`;
  const model = (name, v, title) => {
    const cur = RECOMMENDED.find((m) => m.id === v);
    const radio = (m, extra = '') => `<input type="radio" name="${name}" value="${m.id}"${m.id === v ? ' checked' : ''} data-mp-label="${esc(m.label)}" data-mp-tier="${esc(extra)}">`;
    return `<div class="field modelpick" data-modelpick>
      <span class="lbl" id="${name}-l">${title}</span>
      <details class="mp">
        <summary aria-labelledby="${name}-l"><span class="mp-cur"><b data-mp-name>${esc(cur ? cur.label : modelLabel(v))}</b> <em data-mp-tier-out>${cur ? esc(recTier(cur)) : ''}</em></span>${ic('down')}</summary>
        <div class="mp-pop" role="radiogroup" aria-labelledby="${name}-l">
          <p class="mp-h">Recommandés</p>
          ${RECOMMENDED.map((m) => `<label class="mp-rec">${radio(m, recTier(m))}<span class="mp-n"><b>${esc(m.label)}</b><small>${esc(m.note)}</small></span><span class="mp-t">${esc(m.tier)} <i>${esc(m.cost)}</i></span></label>`).join('\n          ')}
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
  <label class="field"><span class="lbl">Email de réception (évolutions, rapport hebdo)</span><input name="notify_email" type="email" value="${esc(s.notify_email)}" placeholder="toi@exemple.fr"><span class="hint">Ces mails partent de l'adresse d'AiTools (SMTP du serveur), jamais de celle d'un projet.</span></label>
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
    ${channelCard('email', 'E-mail', s, `<label class="field"><span class="lbl">Adresse de réception</span><input name="email_to" type="email" value="${esc(s.channels.email?.to || '')}" placeholder="toi@exemple.fr" autocomplete="off"><span class="hint">${s.canEmail ? "Envoyé depuis l'adresse d'AiTools. Au plus 20 notifications par heure." : "Le SMTP du serveur n'est pas configuré : aucun mail ne peut partir pour l'instant."}</span></label>`)}
  </div>
  <template id="discord-row-tpl">${hookRow('__I__', { id: '', events: [] }, s.discord.all, { fresh: true })}</template>
  <p class="hint" data-chan-empty${s.discord.hooks.length || Object.keys(s.channels).length ? ' hidden' : ''}>Aucun canal pour l'instant.</p>
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
  <div class="save"><button class="btn primary">Enregistrer les réglages</button></div>
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
  <p class="hint">Alternative au suivi d'ouverture : aucun pixel espion, aucun lien traqué. La messagerie du destinataire lui demande s'il accepte d'envoyer un accusé ; beaucoup refusent ou l'ignorent, « Lu » est donc un minimum, jamais un « non lu ».</p>
</section>

<section class="card" id="budget" aria-labelledby="t-budget">
  <div class="card-h"><h2 id="t-budget">${s.priced ? 'Budget IA' : 'Modèles IA'}</h2>${s.priced
    ? "<p>Avec ta clé API, chaque job est facturé par Anthropic : en équivalent $ API remonté par Claude Code. Au-delà d'un plafond, les jobs IA attendent sans être perdus ; envois et relances continuent. Vide = pas de limite.</p>"
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

<div class="save"><button class="btn primary">Enregistrer</button></div>

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
  <div class="save"><button class="btn primary">Enregistrer les réglages</button></div>
</section>
</form>

<section class="card" id="opposition" aria-labelledby="t-opp">
  <div class="card-h"><h2 id="t-opp">Liste d'opposition</h2></div>
  <p class="card-d">Une personne qui se désinscrit, refuse ou dont l'adresse est invalide n'est plus jamais contactée ni proposée, quel que soit le compte ou le projet. Cette liste est commune à tous les comptes et personne ne peut la consulter : tu ne vois que le statut de tes propres prospects.</p>
</section>
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
