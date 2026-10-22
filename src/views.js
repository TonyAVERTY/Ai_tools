import { esc } from './http.js';
import { STATUSES } from './services/crm.js';
import { MODE_LABELS, CONSENT_TEXT, CONSENT_CHECKBOX, CONSENT_VERSION } from './claudelink.js';

const fmtDate = (ts) => (ts ? new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }) : '—');

// Icônes en SVG inline (attributs de présentation uniquement : compatible avec la CSP sans style inline)
const svg = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  spark: svg('<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/>'),
  chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  send: svg('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>'),
  repeat: svg('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>'),
  users: svg('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
};

/** Section dépliable animée. `title` peut contenir du HTML de confiance (badges), jamais de donnée utilisateur brute. */
function acc(key, icon, title, sub, body, { open = false, cls = '' } = {}) {
  return `<details class="acc anim ${cls}" data-acc="${key}"${open ? ' open' : ''}>
  <summary><span class="acc-ico">${ICONS[icon]}</span><span class="acc-txt"><span class="acc-title">${title}</span>${sub ? `<span class="acc-sub">${sub}</span>` : ''}</span><span class="chev" aria-hidden="true"></span></summary>
  <div class="acc-body">${body}</div>
</details>`;
}

export function layout({ title, body, email }) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · AiTools</title>
<link rel="stylesheet" href="/static/app.css">
<script src="/static/app.js" defer></script>
</head>
<body>
<canvas id="bg" aria-hidden="true"></canvas>
${email ? `<header class="top">
  <a class="brand" href="/"><span class="logo" aria-hidden="true"></span>AiTools</a>
  <div class="sys" id="sys" aria-live="polite"></div>
  <div class="jobs" id="jobs" hidden>
    <button type="button" class="jobs-btn" aria-expanded="false" aria-controls="jobs-pop"><span class="spin-inline"></span><span data-jobs-count></span><span class="chev" aria-hidden="true"></span></button>
    <div class="jobs-pop" id="jobs-pop" role="region" aria-label="Jobs en cours" hidden>
      <div class="jobs-head"><strong>Activité</strong><span class="muted small" data-jobs-sub></span></div>
      <div data-jobs-list></div>
    </div>
  </div>
  <nav><a href="/account">Mon compte</a><a href="/settings">Réglages</a>
  <form method="post" action="/logout"><button class="link">Déconnexion</button></form></nav>
</header>` : ''}
<main>${body}</main>
</body>
</html>`;
}

// Usage du mois : une barre par plafond du plan (largeurs par classes w-N, la CSP interdit le style en ligne)
export function usagePanel(u) {
  if (!u) return '';
  const rows = u.items.map((i) => `<li><div class="run-head"><span>${esc(i.label)}</span><span class="jpct">${i.used}${i.limit == null ? '' : ` / ${i.limit}`}</span></div>${i.limit == null ? '' : `<div class="bar usage${i.full ? ' full' : ''}"><span class="w-${Math.round(i.pct / 5) * 5}"></span></div>`}</li>`).join('');
  const full = u.items.filter((i) => i.full);
  return `<section class="card usage-card">
  <h4>Usage du mois <span class="badge">plan ${esc(u.planLabel)}</span></h4>
  <ul class="usage-list">${rows}</ul>
  ${full.length ? `<p class="error small">Plafond atteint : ${full.map((i) => esc(i.label.toLowerCase())).join(', ')}. Rien n'est perdu. <a href="/tarifs">Voir les tarifs</a></p>` : u.plan === 'free' ? '<p class="muted small">Les plafonds se renouvellent le 1er du mois (heure de Paris). <a href="/tarifs">Voir les tarifs</a></p>' : ''}
</section>`;
}

const PROVIDER_NAMES = { google: 'Google', apple: 'Apple' };

// Section « Liaison Claude » de Mon compte : état, test, changement de mode, déliaison. Jamais le secret, ni même un masque
// plus long que les 4 derniers caractères de la clé API.
function linkSection(link, consent) {
  if (!link) {
    return `<section class="card">
  <h4>Liaison Claude</h4>
  <p class="muted">Aucun accès Claude n'est relié : l'application reste bloquée sur la page de liaison.</p>
  <a class="btn primary" href="/link">Relier Claude</a>
</section>`;
  }
  return `<section class="card">
  <h4>Liaison Claude</h4>
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
  <p class="muted small">Délier efface le secret chiffré et annule tes jobs IA en attente ou en cours.${consent && !link.consentAt ? ` Dernier consentement au mode abonnement : ${fmtDate(consent.at)}.` : ''}</p>
</section>`;
}

export function accountPage({ user, error, link = null, consent = null, notice = null, usage = null }) {
  return layout({
    title: 'Mon compte', email: user.email,
    body: `<h1>Mon compte</h1>
<section class="card">
  <dl class="account">
    <dt>Email</dt><dd>${esc(user.email)}</dd>
    <dt>Connexion</dt><dd>${esc(PROVIDER_NAMES[user.provider] || '—')}</dd>
  </dl>
  ${user.isAdmin ? '<p><a class="btn small" href="/admin">Administration</a></p>' : ''}
</section>
${notice ? `<p class="${notice.ok ? 'ok' : 'error'}">${esc(notice.text)}</p>` : ''}
${usagePanel(usage)}
${linkSection(link, consent)}
<section class="card">
  <h4>Supprimer mon compte</h4>
  <p class="muted small">Efface définitivement ton compte et toutes tes données : projets, prospects, notes, modèles de mail, journaux d'envoi, jobs, réglages et clones du code. Les adresses qui ont demandé à ne plus être contactées restent dans la liste d'opposition commune. Cette action est irréversible.</p>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <form method="post" action="/account/delete" class="cfg">
    <label>Pour confirmer, saisis ton email (${esc(user.email)})<input name="confirm" type="email" required autocomplete="off"></label>
    <button class="btn danger">Supprimer mon compte et mes données</button>
  </form>
</section>`,
  });
}

/**
 * Page « Relier Claude » : onboarding bloquant. Les trois modes sont des formulaires HTML classiques (POST) ;
 * la fenêtre d'avertissement du mode abonnement est un <dialog> ouvert par public/app.js.
 */
export function linkPage({ user, link, cliModeEnabled, error }) {
  const intro = link
    ? `<p class="muted">Accès actuel : <strong>${esc(link.label)}</strong>${link.valid ? '' : ' (à revalider)'}. Relier un autre accès remplace le précédent, dont le secret est effacé.</p>`
    : '<p class="muted">Pour utiliser AiTools, relie ton propre accès Claude. Les analyses, recherches et rédactions s\'exécutent avec TON accès, jamais celui d\'un autre utilisateur.</p>';
  const subscription = cliModeEnabled ? `
<section class="card">
  <h4>Connexion avec Claude (abonnement)</h4>
  <p class="muted small">Utilise ton abonnement Claude (Pro, Max) au lieu d'une clé API. Cette option comporte un risque pour ton compte Claude : une fenêtre d'avertissement s'affiche avant de continuer.</p>
  <button type="button" class="btn" data-open-dialog="consent-dialog">Connexion avec Claude (abonnement)</button>
</section>
<dialog class="prospect-dialog" id="consent-dialog" aria-labelledby="consent-title">
  <form method="post" action="/link/subscription" class="cfg">
    <h2 id="consent-title">Avant de continuer</h2>
    <div class="notice card">${CONSENT_TEXT.map((t) => `<p>${esc(t)}</p>`).join('')}</div>
    <label class="check"><input type="checkbox" name="accept" id="consent-accept" required> ${esc(CONSENT_CHECKBOX)}</label>
    <p class="muted small">Sur ta propre machine, lance la commande <code>claude setup-token</code>, connecte-toi à ton compte Claude quand le navigateur s'ouvre, puis copie le jeton affiché et colle-le ci-dessous. Le jeton est chiffré, utilisé uniquement pour tes jobs, et n'est jamais réaffiché.</p>
    <label>Jeton d'abonnement<input name="token" type="password" autocomplete="new-password" spellcheck="false" required></label>
    <p class="muted small">La vérification lance un appel minimal du CLI : quelques tokens sont décomptés de ton abonnement. Texte d'avertissement version ${esc(CONSENT_VERSION)}.</p>
    <div class="row-actions">
      <button type="button" class="btn" data-close-dialog>Annuler</button>
      <button class="btn primary" id="consent-submit" disabled>Relier avec mon abonnement</button>
    </div>
  </form>
</dialog>` : '';
  const server = user.isAdmin ? `
<section class="card">
  <h4>Claude du serveur (administrateurs)</h4>
  <p class="muted small">Utilise la configuration du CLI Claude déjà connectée sur la machine qui héberge AiTools.</p>
  <form method="post" action="/link/server"><button class="btn">Utiliser Claude du serveur</button></form>
</section>` : '';
  return layout({
    title: 'Relier Claude', email: user.email,
    body: `<h1>Relier Claude</h1>
${intro}
${error ? `<p class="error">${esc(error)}</p>` : ''}
<section class="card">
  <h4>Clé API Anthropic (recommandé)</h4>
  <p class="muted small">Crée une clé sur console.anthropic.com puis colle-la ici. Elle est vérifiée sans consommer de tokens, chiffrée, et ne sera plus jamais affichée (seuls ses 4 derniers caractères le seront).</p>
  <form method="post" action="/link/api-key" class="cfg">
    <label>Clé API<input name="apiKey" type="password" autocomplete="new-password" spellcheck="false" required placeholder="sk-ant-…"></label>
    <button class="btn primary">Vérifier et relier</button>
  </form>
</section>${subscription}${server}`,
  });
}

function targetForm(p) {
  const t = p.target || {};
  const list = (a) => esc((a || []).join('\n'));
  return `<form class="target" data-action="target" data-id="${p.id}">
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
  <button class="btn">${p.targetValidated ? 'Mettre à jour' : 'Valider la cible'}</button>
</form>`;
}

function configForms(p, smtp, dbCfg, imap) {
  return `<form data-action="smtp" data-id="${p.id}" class="cfg">
  <h4>SMTP d'envoi</h4>
  <div class="grid3">
    <label>Hôte<input name="host" value="${esc(smtp.host)}" required></label>
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
<form data-action="delete" data-id="${p.id}" data-confirm="Supprimer ${esc(p.name)} et tous ses prospects ?" class="cfg">
  <button class="btn danger">Supprimer le projet</button>
</form>`;
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
  return `<details class="project card anim" data-id="${p.id}">
<summary><span class="pname">${esc(p.name)}</span><span class="pstate" data-state></span></summary>
<div class="pbody">
  <label>Dépôt Git<input class="locked" value="${esc(p.gitUrl)}" readonly disabled></label>

  <section class="profile">
    <div class="row">
      <h4>Fiche projet</h4>
      <button class="btn small" data-run="analyze" data-id="${p.id}">Réanalyser</button>
    </div>
    ${profile
      ? `<p>${esc(profile.resume)}</p><p class="muted small">Analysé le ${fmtDate(p.profileAt)} · commit ${esc((p.profileCommit || '').slice(0, 8))} · ${esc(profile.stack || '')}</p>`
      : '<p class="muted">Pas encore analysé.</p>'}
  </section>

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
        <label class="check todo"><input type="checkbox" name="todo" value="1"> Actions à faire</label>
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

  ${acc('recap', 'chart', 'Récapitulatif', 'Chiffres business, prospection et courbes', `
    <div class="recap" data-recap><p class="muted">Chargement…</p></div>`, { cls: 'main' })}
  </div>

  ${acc('config', 'gear', 'Configuration du projet', 'SMTP, boîte IMAP, base de données', configForms(p, smtp, dbCfg, imap), { cls: 'config' })}
</div>
</details>`;
}

export function dashboardPage({ email, projects, forgejoHost, usage = null }) {
  return layout({
    title: 'Projets', email,
    body: `<div class="row head">
  <h1>Projets</h1>
</div>
${usagePanel(usage)}
<details class="card new anim">
  <summary class="btn primary">+ Nouveau projet</summary>
  <form data-action="create" class="cfg">
    <label>Nom<input name="name" required maxlength="80"></label>
    <label>Dépôt Git (Forgejo)<input name="gitUrl" required placeholder="https://${esc(forgejoHost || 'git.exemple.fr')}/Tony/MonProjet.git"></label>
    <p class="muted small">Le lien ne pourra plus être modifié. Le projet est cloné et analysé une fois (Sonnet).</p>
    <button class="btn primary">Créer et analyser</button>
  </form>
</details>
<dialog class="prospect-dialog" id="prospect-dialog" aria-label="Fiche prospect"><div data-dialog-body></div></dialog>
<div class="projects">
${projects.length ? projects.map((x) => projectItem(x.project, x.smtp, x.dbCfg, x.imap)).join('\n') : '<p class="muted">Aucun projet pour l\'instant.</p>'}
</div>`,
  });
}

export function settingsPage({ email, s, saved }) {
  return layout({
    title: 'Réglages', email,
    body: `<h1>Réglages</h1>
${saved ? '<p class="ok">Enregistré.</p>' : ''}
<form method="post" action="/settings" class="card cfg">
  <h4>Notifications</h4>
  <label>Email de réception (évolutions, rapport hebdo)<input name="notify_email" type="email" value="${esc(s.notify_email)}"></label>
  <label class="check"><input type="checkbox" name="weekly_report" ${s.weekly_report ? 'checked' : ''}> Rapport hebdo le lundi à 8h (mail + Discord)</label>
  <button type="button" class="btn small" data-report-send>Envoyer le rapport maintenant</button>

  <h4>Forgejo</h4>
  <div class="grid2">
    <label>Hôte autorisé<input name="forgejo_host" value="${esc(s.forgejo_host)}" placeholder="git.tony-averty.dev"></label>
    <label>Token d'accès (lecture repo)<input name="forgejo_token" type="password" placeholder="${s.forgejo_token_set ? '•••••• (inchangé)' : ''}" autocomplete="new-password"></label>
  </div>

  <h4>SMTP global (mails vers toi)</h4>
  <div class="grid3">
    <label>Hôte<input name="smtp_host" value="${esc(s.smtp.host)}"></label>
    <label>Port<input name="smtp_port" type="number" value="${esc(s.smtp.port || 587)}"></label>
    <label>Utilisateur<input name="smtp_user" value="${esc(s.smtp.user)}" autocomplete="off"></label>
    <label>Mot de passe<input name="smtp_pass" type="password" placeholder="${s.smtp.passSet ? '•••••• (inchangé)' : ''}" autocomplete="new-password"></label>
    <label>Expéditeur<input name="smtp_fromEmail" type="email" value="${esc(s.smtp.fromEmail)}"></label>
  </div>

  <h4>Notifications Discord</h4>
  <p class="muted small">Salon Discord › Modifier › Intégrations › Webhooks › Nouveau webhook › Copier l'URL.</p>
  <label>URL du webhook<input name="discord_webhook" type="password" placeholder="${s.discord.set ? '•••••• (inchangé)' : 'https://discord.com/api/webhooks/…'}" autocomplete="off"></label>
  ${s.discord.set ? '<label class="check"><input type="checkbox" name="discord_remove"> Supprimer le webhook</label>' : ''}
  <div class="checks">
    ${Object.entries(s.discord.all).map(([k, label]) => `<label class="check"><input type="checkbox" name="ev_${k}" ${s.discord.events.includes(k) ? 'checked' : ''}> ${esc(label)}</label>`).join('')}
  </div>
  ${s.discord.set ? '<button type="button" class="btn small" data-notify-test>Envoyer une notification de test</button>' : ''}

  <h4>Garde-fous</h4>
  <div class="grid3">
    <label>Plafond global mails / 24 h (max 300)<input name="global_daily_cap" type="number" min="1" max="300" value="${esc(s.global_daily_cap)}"></label>
    <label>Délai min entre 2 mails (s)<input name="send_delay_min" type="number" min="5" value="${esc(s.send_delay_min)}"></label>
    <label>Délai max (s)<input name="send_delay_max" type="number" min="5" value="${esc(s.send_delay_max)}"></label>
  </div>
  <h4>Budget IA</h4>
  <p class="muted small">En équivalent $ API remonté par Claude Code (ton abonnement Pro ne facture rien en plus : c'est un garde-fou pour ton quota).
  Au-delà, les jobs IA attendent sans être perdus ; envois et relances continuent. Vide = pas de limite.</p>
  <div class="grid2">
    <label>Plafond sur 24 h glissantes ($)<input name="budget_day_usd" inputmode="decimal" value="${esc(s.budget_day_usd)}" placeholder="ex. 2"></label>
    <label>Plafond sur 30 jours glissants ($)<input name="budget_month_usd" inputmode="decimal" value="${esc(s.budget_month_usd)}" placeholder="ex. 30"></label>
  </div>
  <label>Modèle pour la prospection<select name="prospect_model">
    <option value="haiku" ${s.prospect_model === 'haiku' ? 'selected' : ''}>Haiku (économe)</option>
    <option value="sonnet" ${s.prospect_model === 'sonnet' ? 'selected' : ''}>Sonnet (plus précis, plus cher)</option>
  </select></label>
  <label>Modèle pour l'analyse de projet<select name="analyze_model">
    <option value="haiku" ${s.analyze_model === 'haiku' ? 'selected' : ''}>Haiku (économe)</option>
    <option value="sonnet" ${s.analyze_model === 'sonnet' ? 'selected' : ''}>Sonnet (plus précis, plus cher)</option>
  </select></label>
  <p class="muted small">Haiku suffit pour la plupart des projets. Repasse en Sonnet uniquement si la fiche générée manque de précision.</p>
  <button class="btn primary">Enregistrer</button>
</form>

<section class="card">
  <h4>Liste d'opposition</h4>
  <p class="muted small">${s.blacklist_count} de tes prospects ont demandé à ne plus être contactés. La liste d'opposition est commune à tous les comptes : une adresse désinscrite n'est plus jamais contactée, quel que soit le projet.</p>
</section>`,
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
