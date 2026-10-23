import { esc } from './http.js';
import { STATUSES } from './services/crm.js';
import { assetUrl, brandMark, iconLinks } from './assets.js';
import { SPRITE, ic } from './icons.js';
import { GIT_SERVER_TYPES, MAX_GIT_SERVERS } from './gitservers.js';
import { MODE_LABELS, CONSENT_TEXT, CONSENT_CHECKBOX, CONSENT_VERSION } from './claudelink.js';

const fmtDate = (ts) => (ts ? new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }) : '—');

// Icônes de la section : noms du sprite (src/icons.js), une seule fois par page
const SECTION_ICONS = { target: 'target', search: 'search', spark: 'spark', chart: 'chart', mail: 'mail', linkedin: 'pen', send: 'send', repeat: 'repeat', users: 'users', gear: 'gear', git: 'git' };

/** Section dépliable. `title` peut contenir du HTML de confiance (badges), jamais de donnée utilisateur brute. */
function acc(key, icon, title, sub, body, { open = false, cls = '' } = {}) {
  return `<details class="acc anim ${cls}" data-acc="${key}"${open ? ' open' : ''}>
  <summary><span class="acc-ico">${ic(SECTION_ICONS[icon])}</span><span class="acc-txt"><span class="acc-title">${title}</span>${sub ? `<span class="acc-sub">${sub}</span>` : ''}</span><span class="chev" aria-hidden="true"></span></summary>
  <div class="acc-body">${body}</div>
</details>`;
}

const NAV = [['/', 'folder', 'Projets'], ['/team', 'users', 'Équipe']];

export function layout({ title, body, email }) {
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
<script src="${assetUrl('/static/app.js')}" defer></script>
</head>
<body class="app">
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
function linkSection(link, consent) {
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
    <dt>État</dt><dd>${link.valid ? '<span class="ok">Valide</span>' : '<span class="error">À revalider (teste ou relie de nouveau)</span>'}</dd>
    ${link.last4 ? `<dt>Clé API</dt><dd>sk-ant-…${esc(link.last4)}</dd>` : ''}
    <dt>Reliée le</dt><dd>${fmtDate(link.linkedAt)}</dd>
    <dt>Dernier test</dt><dd>${fmtDate(link.lastTestAt)}</dd>
    ${link.consentAt ? `<dt>Risque accepté</dt><dd>${fmtDate(link.consentAt)} (texte ${esc(link.consentVersion)})</dd>` : ''}
  </dl>
  <div class="row-actions">
    <form method="post" action="/link/test"><button class="btn">Tester</button></form>
    <a class="btn" href="/link?change=1">Changer de mode</a>
    <form method="post" action="/link/unlink"><button class="btn danger">Délier</button></form>
  </div>
  <p class="hint">Délier efface le secret chiffré et annule tes jobs IA en attente ou en cours.${consent && !link.consentAt ? ` Dernier consentement au mode abonnement : ${fmtDate(consent.at)}.` : ''}</p>
</section>`;
}

export function accountPage({ user, error, link = null, consent = null, notice = null, usage = null }) {
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
${linkSection(link, consent)}
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
  const source = { project: 'Ce projet envoie avec son propre SMTP.', settings: 'Ce projet utilise le SMTP des Réglages (aucun SMTP propre).', null: "Aucun SMTP : renseigne-en un ici ou dans les Réglages, sinon rien ne peut partir." }[p.smtpSource ?? 'null'];
  return `<form data-action="smtp" data-id="${p.id}" class="cfg">
  <h4>SMTP d'envoi de ce projet</h4>
  <p class="muted small" data-smtp-source>${source} <strong>Laisse l'hôte vide pour utiliser le SMTP des Réglages.</strong> Un SMTP propre au projet permet d'envoyer depuis une autre adresse (une boîte par projet).</p>
  <div class="grid3">
    <label>Hôte<input name="host" value="${esc(smtp.host)}" placeholder="vide = SMTP des Réglages"></label>
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
  <button class="btn danger">Supprimer le projet</button>
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

function projectItem(p, smtp, dbCfg, imap) {
  const profile = p.profile;
  return `<details class="project anim" data-id="${p.id}">
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

  ${acc('linkedin', 'linkedin', 'LinkedIn', 'Relie un compte, Claude écrit des posts, tu relis et publies', `
    <div class="linkedin" data-linkedin><p class="muted">Chargement…</p></div>
    <div class="job" data-job="linkedin_post"></div>`, { cls: 'main' })}

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
  ${projects.length ? projects.map((x) => projectItem(x.project, x.smtp, x.dbCfg, x.imap)).join('\n') : `<div class="empty">
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
      <div class="gitrow-head"><span class="srv-n">${ic('git')}<span class="badge">${esc(srv.label)}</span></span>${fresh ? ' <button type="button" class="linklike" data-git-cancel>Annuler</button>' : ''}</div>
      <div class="grid2">
        <label class="field"><span class="lbl">URL du serveur</span><input name="git_host_${i}" value="${esc(srv.host)}" placeholder="https://git.mon-serveur.fr" autocomplete="off" spellcheck="false"></label>
        <label class="field"><span class="lbl">Token (lecture repo)</span><input name="git_token_${i}" type="password" placeholder="${srv.hasToken ? '•••••• (inchangé)' : ''}" autocomplete="new-password"></label>
      </div>
      <p class="hint" data-git-hint>${esc(hint)}</p>
      ${fresh ? '' : `${srv.hasToken ? check(`git_token_clear_${i}`, false, 'Supprimer le token enregistré', { value: '1' }) : ''}
      ${check(`git_del_${i}`, false, 'Retirer ce serveur', { value: '1' })}`}
    </div>`;
}

/** Case à cocher du design : le <input> natif reste là (clavier, lecteurs d'écran), la case dessinée suit son état. */
const check = (name, checked, text, { value = '' } = {}) => `<label class="opt"><input type="checkbox" name="${name}"${value ? ` value="${value}"` : ''}${checked ? ' checked' : ''}><span class="box">${ic('check')}</span><span>${text}</span></label>`;

const SETTINGS_TOC = [['notif', 'Notifications'], ['git', 'Dépôts Git'], ['smtp', 'SMTP global'], ['discord', 'Discord'], ['garde', 'Garde-fous'], ['budget', 'Budget IA'], ['opposition', "Liste d'opposition"]];

export function settingsPage({ email, s, saved }) {
  const model = (name, v) => `<span class="sel"><select name="${name}">
    <option value="haiku" ${v === 'haiku' ? 'selected' : ''}>Haiku (économe)</option>
    <option value="sonnet" ${v === 'sonnet' ? 'selected' : ''}>Sonnet (plus précis, plus cher)</option>
  </select>${ic('down')}</span>`;
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
  <div class="card-h"><h2 id="t-notif">Notifications</h2><p>Où et quand AiTools te prévient.</p></div>
  <label class="field"><span class="lbl">Email de réception (évolutions, rapport hebdo)</span><input name="notify_email" type="email" value="${esc(s.notify_email)}" placeholder="toi@exemple.fr"></label>
  ${check('weekly_report', s.weekly_report, 'Rapport hebdo le lundi à 8h (mail + Discord)')}
  <div class="save"><button type="button" class="btn" data-report-send>${ic('send')}Envoyer le rapport maintenant</button></div>
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
      ${s.github_token_set ? check('github_token_clear', false, 'Supprimer le token GitHub enregistré', { value: '1' }) : ''}
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

<section class="card" id="smtp" aria-labelledby="t-smtp">
  <div class="card-h"><h2 id="t-smtp">SMTP global</h2><p>Mails vers toi, et envoi des projets qui n'ont pas leur propre SMTP.</p></div>
  <div class="grid2">
    <label class="field"><span class="lbl">Hôte</span><input name="smtp_host" value="${esc(s.smtp.host)}" placeholder="smtp.exemple.fr"></label>
    <label class="field"><span class="lbl">Port</span><input name="smtp_port" type="number" value="${esc(s.smtp.port || 587)}"></label>
    <label class="field"><span class="lbl">Utilisateur</span><input name="smtp_user" value="${esc(s.smtp.user)}" autocomplete="off"></label>
    <label class="field"><span class="lbl">Mot de passe</span><input name="smtp_pass" type="password" placeholder="${s.smtp.passSet ? '•••••• (inchangé)' : ''}" autocomplete="new-password"><span class="hint">Stocké chiffré.</span></label>
    <label class="field"><span class="lbl">Expéditeur</span><input name="smtp_fromEmail" type="email" value="${esc(s.smtp.fromEmail)}"></label>
  </div>
</section>

<section class="card" id="discord" aria-labelledby="t-discord">
  <div class="card-h"><h2 id="t-discord">Discord</h2><p>Reçois les réponses et les alertes dans un salon. Salon Discord › Modifier › Intégrations › Webhooks › Nouveau webhook › Copier l'URL.</p></div>
  <label class="field"><span class="lbl">URL du webhook</span><input name="discord_webhook" type="password" placeholder="${s.discord.set ? '•••••• (inchangé)' : 'https://discord.com/api/webhooks/…'}" autocomplete="off"><span class="hint">Stocké chiffré.</span></label>
  ${s.discord.set ? check('discord_remove', false, 'Supprimer le webhook') : ''}
  <div class="checks">
    ${Object.entries(s.discord.all).map(([k, label]) => check(`ev_${k}`, s.discord.events.includes(k), esc(label))).join('')}
  </div>
  ${s.discord.set ? `<div class="save"><button type="button" class="btn" data-notify-test>Envoyer une notification de test</button></div>` : ''}
</section>

<section class="card" id="garde" aria-labelledby="t-garde">
  <div class="card-h"><h2 id="t-garde">Garde-fous</h2><p>Des plafonds et des délais pour garder la main.</p></div>
  <div class="grid2">
    <label class="field"><span class="lbl">Plafond global mails / 24 h (max 300)</span><span class="unit"><input name="global_daily_cap" type="number" min="1" max="300" value="${esc(s.global_daily_cap)}"><span>mails</span></span></label>
    <label class="field"><span class="lbl">Délai min entre 2 mails</span><span class="unit"><input name="send_delay_min" type="number" min="5" value="${esc(s.send_delay_min)}"><span>secondes</span></span></label>
    <label class="field"><span class="lbl">Délai max entre 2 mails</span><span class="unit"><input name="send_delay_max" type="number" min="5" value="${esc(s.send_delay_max)}"><span>secondes</span></span></label>
  </div>
</section>

<section class="card" id="budget" aria-labelledby="t-budget">
  <div class="card-h"><h2 id="t-budget">Budget IA</h2><p>En équivalent $ API remonté par Claude Code (ton abonnement Pro ne facture rien en plus : c'est un garde-fou pour ton quota). Au-delà, les jobs IA attendent sans être perdus ; envois et relances continuent. Vide = pas de limite.</p></div>
  <div class="grid2">
    <label class="field"><span class="lbl">Plafond sur 24 h glissantes</span><span class="unit"><input name="budget_day_usd" inputmode="decimal" value="${esc(s.budget_day_usd)}" placeholder="ex. 2"><span>$</span></span></label>
    <label class="field"><span class="lbl">Plafond sur 30 jours glissants</span><span class="unit"><input name="budget_month_usd" inputmode="decimal" value="${esc(s.budget_month_usd)}" placeholder="ex. 30"><span>$</span></span></label>
    <label class="field"><span class="lbl">Modèle pour la prospection</span>${model('prospect_model', s.prospect_model)}</label>
    <label class="field"><span class="lbl">Modèle pour l'analyse de projet</span>${model('analyze_model', s.analyze_model)}</label>
  </div>
  <p class="hint">Haiku suffit pour la plupart des projets. Repasse en Sonnet uniquement si la fiche générée manque de précision.</p>
</section>

<div class="save"><button class="btn primary">Enregistrer</button></div>
</form>

<section class="card" id="opposition" aria-labelledby="t-opp">
  <div class="card-h"><h2 id="t-opp">Liste d'opposition</h2></div>
  <p class="card-d">${s.blacklist_count} de tes prospects ont demandé à ne plus être contactés. La liste d'opposition est commune à tous les comptes : une adresse désinscrite n'est plus jamais contactée, quel que soit le projet.</p>
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
