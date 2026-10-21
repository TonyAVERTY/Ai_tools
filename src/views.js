import { esc } from './http.js';
import { STATUSES } from './services/crm.js';

const fmtDate = (ts) => (ts ? new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }) : '—');

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
${email ? `<header class="top">
  <a class="brand" href="/">AiTools</a>
  <div class="sys" id="sys" aria-live="polite"></div>
  <nav><a href="/settings">Réglages</a>
  <form method="post" action="/logout"><button class="link">Déconnexion</button></form></nav>
</header>` : ''}
<main>${body}</main>
</body>
</html>`;
}

export function loginPage(error) {
  return layout({
    title: 'Connexion',
    body: `<section class="login card">
  <h1>AiTools</h1>
  <p class="muted">Accès réservé.</p>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <a class="btn primary" href="/auth/google">Se connecter avec Google</a>
</section>`,
  });
}

function targetForm(p) {
  const t = p.target || {};
  const list = (a) => esc((a || []).join('\n'));
  return `<form class="target" data-action="target" data-id="${p.id}">
  <h4>Cible ${p.targetValidated ? '<span class="badge ok">validée</span>' : '<span class="badge warn">à valider</span>'}</h4>
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
  return `<details class="config"><summary>Configuration du projet</summary>
<form data-action="smtp" data-id="${p.id}" class="cfg">
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
</form>
</details>`;
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
  return `<details class="project card" data-id="${p.id}">
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

  ${profile ? targetForm(p) : ''}

  <div class="actions">
    <button class="btn primary" data-panel="prospect">Prospecter</button>
    <button class="btn" data-panel="evolution">Évolution</button>
    <button class="btn" data-panel="recap">Récapitulatif</button>
  </div>

  <section class="panel" data-panel-body="prospect" hidden>
    <form data-action="prospect" data-id="${p.id}" class="inline">
      <label>Prospects à chercher<input name="count" type="number" min="1" max="50" value="10"></label>
      <label>Quand<select name="when"><option value="now">Maintenant</option><option value="night">Cette nuit (1h-6h)</option></select></label>
      <button class="btn primary">Lancer la recherche</button>
    </form>
    <div class="job" data-job="prospect"></div>

    ${templateForm(p, 'initial')}

    <form data-action="send" data-id="${p.id}" class="inline send">
      <label>Mails à envoyer<input name="count" type="number" min="1" value="10"></label>
      <button class="btn primary" disabled>Envoyer</button>
      <span class="muted small" data-send-info></span>
    </form>
    <div class="job" data-job="send"></div>
    <p class="inbox small" data-inbox></p>

    <section class="followup">
      <h4>Relance automatique</h4>
      <form data-action="followup" data-id="${p.id}" class="inline">
        <label class="check"><input type="checkbox" name="enabled" ${p.followupEnabled ? 'checked' : ''}> Relancer une fois les prospects sans réponse</label>
        <label>Après (jours)<input name="days" type="number" min="2" max="30" value="${p.followupDays}"></label>
        <button class="btn">Enregistrer</button>
      </form>
      <p class="muted small" data-followup-info></p>
      ${templateForm(p, 'followup')}
      <div class="job" data-job="followup"></div>
    </section>

    <details class="prospects"><summary>Prospects <span data-count></span></summary>
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
      <div class="pager" data-pager></div>
    </details>
  </section>

  <section class="panel" data-panel-body="evolution" hidden>
    <form data-action="evolution" data-id="${p.id}" class="inline">
      <label>Nombre d'évolutions<input name="count" type="number" min="1" max="20" value="5"></label>
      <label>Raisonnement<select name="level">
        <option value="rapide">Rapide (Haiku)</option>
        <option value="normal" selected>Normal (Sonnet)</option>
        <option value="approfondi">Approfondi (Opus, coûteux)</option>
      </select></label>
      <label>Quand<select name="when"><option value="now">Maintenant</option><option value="night">Cette nuit (1h-6h)</option></select></label>
      <button class="btn primary">Chercher et envoyer par mail</button>
    </form>
    <div class="job" data-job="evolution"></div>
  </section>

  <section class="panel" data-panel-body="recap" hidden>
    <div class="recap" data-recap><p class="muted">Chargement…</p></div>
  </section>

  ${configForms(p, smtp, dbCfg, imap)}
</div>
</details>`;
}

export function dashboardPage({ email, projects, forgejoHost }) {
  return layout({
    title: 'Projets', email,
    body: `<div class="row head">
  <h1>Projets</h1>
</div>
<details class="card new">
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
  <button class="btn primary">Enregistrer</button>
</form>

<section class="card">
  <h4>Liste d'opposition</h4>
  <p class="muted small">${s.blacklist_count} adresse(s) désinscrite(s). Elles ne seront plus jamais contactées, tous projets confondus.</p>
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
