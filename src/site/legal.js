// Pages légales : mentions légales, politique de confidentialité, conditions d'utilisation.
// Textes rédigés d'après le code (données réellement collectées, cookies réellement posés) pour l'entrepreneur
// individuel Tony AVERTY. Ce sont des modèles sérieux, pas un avis juridique : voir docs/JOURNAL.md pour ce qui reste
// à compléter (marqueurs visibles) et à faire relire.
import { siteLayout, nextBlock, journey, CONTACT_EMAIL } from './layout.js';
import { PLAN_LIMITS, PLAN_PRICES, PLAN_LABELS, ANNUAL_FREE_MONTHS, annualPrice } from '../limits.js';

/**
 * Marqueurs visibles tant que l'information n'est pas fournie ou validée. Leur liste est aussi dans docs/JOURNAL.md
 * (section « Marqueurs à compléter ») ; un test compare les deux pour qu'aucun ne soit oublié.
 */
export const MARKERS = {
  address: '[À COMPLÉTER : adresse du siège]',
  host: '[À COMPLÉTER : hébergeur]',
  phone: '[À COMPLÉTER : téléphone]',
  retention: '[À VALIDER : durées de conservation]',
  transfers: '[À VALIDER : transferts hors UE]',
  processing: '[À VALIDER : cadre de sous-traitance]',
  liability: '[À VALIDER : limitation de responsabilité]',
};
export const LEGAL_MARKERS = Object.values(MARKERS);
const todo = (key) => `<mark class="todo">${MARKERS[key]}</mark>`;

export const LEGAL_UPDATED = '22 octobre 2026';

/** Gabarit commun : titre, sommaire, sections numérotées par ancre. */
function legalPage({ appUrl, path, title, description, h1, lead, sections }) {
  const toc = sections.map((s) => `<li><a href="#${s.id}">${s.title}</a></li>`).join('');
  const body = sections.map((s) => `<h2 id="${s.id}">${s.title}</h2>\n${s.html}`).join('\n');
  return siteLayout({
    appUrl, path, title, description,
    body: `<div class="wrap page-head">
  <p class="eyebrow"><span class="mark" aria-hidden="true"></span>Informations légales</p>
  <h1>${h1}</h1>
  <p class="lead">${lead}</p>
  <p class="updated">Dernière mise à jour : ${LEGAL_UPDATED}</p>
</div>
<div class="wrap prose-wrap">
  <nav class="toc" aria-label="Sommaire"><h2>Sommaire</h2><ol>${toc}</ol></nav>
  <div class="prose">
${body}
  </div>
</div>
${nextBlock(journey('home', 'how', 'pricing'), 'Retour au site')}`,
  });
}

// ---------- Mentions légales ----------
export function mentionsPage({ appUrl }) {
  return legalPage({
    appUrl, path: '/mentions-legales',
    title: 'Mentions légales · AiTools',
    description: "Éditeur, directeur de la publication, hébergeur et contact du site AiTools, édité par Tony AVERTY, entrepreneur individuel.",
    h1: 'Mentions légales',
    lead: "Qui édite AiTools, qui l'héberge et comment nous joindre.",
    sections: [
      {
        id: 'editeur', title: 'Éditeur du site',
        html: `<dl>
  <dt>Nom</dt><dd>Tony AVERTY, entrepreneur individuel (micro-entreprise)</dd>
  <dt>SIRET</dt><dd>100 142 819 00018</dd>
  <dt>Code APE</dt><dd>62.01Z (programmation informatique)</dd>
  <dt>Siège</dt><dd>${todo('address')}</dd>
  <dt>Email</dt><dd><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></dd>
  <dt>Téléphone</dt><dd>${todo('phone')}</dd>
  <dt>TVA</dt><dd>TVA non applicable, art. 293 B du CGI</dd>
  <dt>Directeur de la publication</dt><dd>Tony AVERTY</dd>
</dl>`,
      },
      {
        id: 'hebergeur', title: 'Hébergeur',
        html: `<p>Le site et le service sont hébergés par : ${todo('host')}</p>`,
      },
      {
        id: 'propriete', title: 'Propriété intellectuelle',
        html: `<p>Le site, son code, ses textes et son identité visuelle sont la propriété de leur éditeur. Toute reproduction sans accord écrit est interdite, hors citation courte avec mention de la source.</p>
<p>Les contenus que tu saisis dans AiTools (projets, prospects, modèles de mail) restent les tiens. Claude et Anthropic sont des marques d'Anthropic ; Google et Apple sont des marques de leurs propriétaires. Ils sont cités pour décrire le fonctionnement du service, sans lien d'affiliation.</p>`,
      },
      {
        id: 'responsabilite', title: 'Responsabilité et liens externes',
        html: `<p>L'éditeur s'efforce de publier des informations exactes mais ne peut garantir qu'elles soient exemptes d'erreur. Le site contient quelques liens vers des sites tiers, dont l'éditeur ne maîtrise pas le contenu.</p>
<p>Les conditions d'usage du service sont dans les <a href="/cgu">conditions générales d'utilisation</a>.</p>`,
      },
      {
        id: 'donnees', title: 'Données personnelles et cookies',
        html: `<p>Le traitement des données personnelles et l'usage des cookies sont décrits dans la <a href="/confidentialite">politique de confidentialité</a>. Le site ne pose que des cookies strictement nécessaires à son fonctionnement.</p>`,
      },
      {
        id: 'signalement', title: 'Contact et signalement',
        html: `<p>Pour toute question, ou pour signaler un contenu illicite ou un mail reçu à tort depuis AiTools : <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>
<p>Droit applicable : le droit français.</p>`,
      },
    ],
  });
}

// ---------- Politique de confidentialité ----------
// `captcha` : reCAPTCHA configuré. Les paragraphes qui le concernent n'apparaissent que dans ce cas, comme Apple.
export function privacyPage({ appUrl, apple = false, captcha = false, inactiveMonths = 24 }) {
  return legalPage({
    appUrl, path: '/confidentialite',
    title: 'Politique de confidentialité · AiTools',
    description: "Quelles données AiTools collecte, pourquoi, combien de temps, qui les reçoit et comment exercer tes droits. Rôles : responsable de traitement et sous-traitant.",
    h1: 'Politique de confidentialité',
    lead: "Ce que le service collecte, ce qu'il en fait, et comment reprendre la main. Écrit pour être lu.",
    sections: [
      {
        id: 'roles', title: 'Qui est responsable de quoi',
        html: `<p>AiTools est édité par Tony AVERTY, entrepreneur individuel (SIRET 100 142 819 00018), siège : ${todo('address')}. Contact : <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>. Il n'y a pas de délégué à la protection des données.</p>
<ul>
  <li><strong>Pour ton compte</strong> (identité, connexion, liaison Claude, réglages), AiTools est <strong>responsable de traitement</strong>.</li>
  <li><strong>Pour les données de tes prospects</strong> (entreprises et adresses professionnelles que tu recherches, importes ou contactes), c'est <strong>toi le responsable de traitement</strong> : tu décides à qui tu écris et pourquoi. AiTools agit comme <strong>sous-traitant</strong> : il les traite uniquement pour faire fonctionner le service que tu utilises, sur tes instructions, avec les garanties de sécurité décrites plus bas, et les supprime avec ton compte. ${todo('processing')}</li>
</ul>`,
      },
      {
        id: 'donnees', title: 'Les données collectées',
        html: `<div class="table-wrap"><table>
  <caption>Données réellement enregistrées par AiTools</caption>
  <thead><tr><th scope="col">Catégorie</th><th scope="col">Contenu</th><th scope="col">Pourquoi et sur quelle base</th></tr></thead>
  <tbody>
    <tr><th scope="row">Compte</th><td>Email et nom fournis par ${apple ? 'Google ou Apple' : 'Google'}, fournisseur de connexion et identifiant chez lui, plan, dates de création et de dernière connexion.</td><td>Créer ton compte et te connecter. Exécution du contrat.</td></tr>
    <tr><th scope="row">Session</th><td>Un identifiant de session aléatoire (cookie), un cookie de liaison pendant la connexion.</td><td>Te garder connecté et sécuriser la connexion. Exécution du contrat, intérêt légitime.</td></tr>
    <tr><th scope="row">Liaison Claude</th><td>Ta clé API ou ton jeton d'abonnement, chiffrés. Les 4 derniers caractères d'une clé API, les dates de liaison et de test, la date et la version du texte d'avertissement accepté pour le mode abonnement.</td><td>Lancer tes jobs avec ton accès, garder la preuve de ton acceptation. Exécution du contrat, intérêt légitime.</td></tr>
    <tr><th scope="row">Projets</th><td>Nom, adresse du dépôt Git, fiche projet, cible, modèles de mail, copie du dépôt sur le serveur.</td><td>Fournir le service. Exécution du contrat.</td></tr>
    <tr><th scope="row">Configuration</th><td>Identifiants SMTP et IMAP, accès à la base de données de ton projet (récapitulatif), jeton Forgejo, adresse du webhook Discord, plafonds et budgets. Les mots de passe, jetons et adresses de webhook sont chiffrés.</td><td>Envoyer, lire les réponses, notifier. Exécution du contrat.</td></tr>
    <tr><th scope="row">Prospects</th><td>Entreprise, adresse professionnelle, site, ville, secteur, phrase d'accroche, page source, score, statut, notes, prochaine action, historique d'envoi, objet et date d'une réponse.</td><td>Fournir le service pour ton compte (voir « rôles »). La base légale du démarchage est la tienne, en B2B en règle générale l'intérêt légitime.</td></tr>
    <tr><th scope="row">Activité</th><td>Type, état, durée, coût et nombre de tokens de chaque job IA, résultat du job. Chaque jour, trois nombres lus dans la base de ton projet si tu l'as reliée (utilisateurs, clients, revenu).</td><td>Fournir le service, appliquer tes budgets et plafonds. Exécution du contrat.</td></tr>
    <tr><th scope="row">Adresse IP</th><td>Ton adresse IP sert à limiter le nombre de requêtes (protection contre les abus). Elle reste en mémoire du serveur, quelques minutes à quelques heures, et n'est pas enregistrée en base de données.</td><td>Sécurité du service. Intérêt légitime.</td></tr>
    <tr><th scope="row">Modération</th><td>Actions d'administration sur un compte (suspension, plan, suppression) et pauses d'envoi décidées quand trop de mails sont rejetés : date, action, identifiant du compte et adresse masquée.</td><td>Sécurité du service et lutte contre les abus. Intérêt légitime.</td></tr>
    <tr><th scope="row">Liste d'opposition</th><td>Adresse email, motif (désinscription, refus, mail rejeté) et date.</td><td>Ne plus jamais contacter une personne qui s'y est opposée, pour tous les comptes. Obligation légale, intérêt légitime.</td></tr>
  </tbody>
</table></div>
<p>AiTools ne collecte ni statistiques de visite, ni identifiant publicitaire, et ne charge aucun pixel de suivi.</p>`,
      },
      {
        id: 'durees', title: 'Combien de temps',
        html: `<div class="table-wrap"><table>
  <caption>Durées de conservation ${todo('retention')}</caption>
  <thead><tr><th scope="col">Donnée</th><th scope="col">Durée</th></tr></thead>
  <tbody>
    <tr><th scope="row">Compte et toutes ses données</th><td>Tant que le compte existe. Effacés quand tu supprimes ton compte depuis Mon compte, copie du code comprise.</td></tr>
    <tr><th scope="row">Compte inactif</th><td>${inactiveMonths ? `Suppression automatique après ${inactiveMonths} mois sans connexion ni job, avec un mail d'avertissement 30 jours avant. Un compte suspendu ou administrateur n'est pas concerné.` : 'Aucune suppression automatique pour inactivité.'}</td></tr>
    <tr><th scope="row">Journal d'administration</th><td>12 mois. Il note les actions des administrateurs (suspension, changement de plan, suppression) et les pauses d'envoi, avec un identifiant et une adresse masquée.</td></tr>
    <tr><th scope="row">Session</th><td>30 jours au plus, effacée à la déconnexion. Les états de connexion durent 10 minutes.</td></tr>
    <tr><th scope="row">Clé API ou jeton Claude</th><td>Jusqu'à ce que tu le délies ou supprimes ton compte.</td></tr>
    <tr><th scope="row">Prospects, notes et journaux d'envoi</th><td>Jusqu'à la suppression du projet ou du compte. En tant que responsable de traitement, ne garde pas une fiche plus de 3 ans après le dernier contact.</td></tr>
    <tr><th scope="row">Liste d'opposition</th><td>Conservée après la suppression d'un compte, tant qu'il faut respecter l'opposition de la personne.</td></tr>
    <tr><th scope="row">Sauvegardes</th><td>Environ 14 jours : une donnée effacée disparaît des sauvegardes à leur expiration.</td></tr>
    <tr><th scope="row">Journaux d'accès du serveur web</th><td>12 mois au plus (adresse IP, date, page demandée), pour la sécurité.</td></tr>
  </tbody>
</table></div>`,
      },
      {
        id: 'destinataires', title: 'Qui reçoit les données',
        html: `<p>Aucune donnée n'est vendue ni cédée. Elles sont accessibles aux seuls prestataires nécessaires au service :</p>
<ul>
  <li><strong>Google</strong> pour la connexion : il nous transmet ton email, ton nom et un identifiant. <a href="https://policies.google.com/privacy" rel="noopener noreferrer">Politique de Google</a>.</li>
  ${apple ? '<li><strong>Apple</strong> pour la connexion avec Apple : même principe, avec la possibilité de masquer ton email. <a href="https://www.apple.com/legal/privacy/fr-fr/" rel="noopener noreferrer">Politique d\'Apple</a>.</li>' : ''}
  <li><strong>Anthropic</strong>, par l'intermédiaire de <em>ton</em> accès Claude : le code de ton projet lu par Claude, la fiche et la cible, les domaines des prospects déjà connus pour éviter les doublons, et ce que Claude trouve sur le web transitent par ton compte Anthropic, selon les conditions que tu as acceptées avec lui. <a href="https://www.anthropic.com/legal/privacy" rel="noopener noreferrer">Politique d'Anthropic</a>.</li>
  ${captcha ? `<li><strong>Google reCAPTCHA</strong> (Google Ireland Limited, Google LLC) : protège la connexion contre les envois automatisés. Son script est chargé automatiquement à l'ouverture de la page de connexion, sans action de ta part. Il dépose des cookies et transmet à Google ton adresse IP, des informations sur ton navigateur et sur ton comportement sur la page. Base légale : l'intérêt légitime d'AiTools à protéger la connexion contre les abus. AiTools ne conserve pas le résultat de la vérification. Sans elle, la connexion n'est pas possible. Si cela te pose problème, écris-nous. <a href="https://policies.google.com/privacy" rel="noopener noreferrer">Politique de Google</a>.</li>` : ''}
  <li><strong>L'hébergeur</strong> du serveur : ${todo('host')}</li>
  <li><strong>Tes propres services</strong>, quand tu les configures : serveur SMTP et IMAP de ta messagerie, Forgejo, base de données de ton projet, Discord. AiTools s'y connecte avec tes identifiants.</li>
</ul>
<p>Les adresses de tes prospects ne sont pas transmises à d'autres utilisateurs. Chaque compte est cloisonné : une ressource d'un autre compte répond « introuvable ».</p>`,
      },
      {
        id: 'transferts', title: 'Transferts hors de l\'Union européenne',
        html: `<p>${apple ? 'Google, Apple et Anthropic' : 'Google et Anthropic'} peuvent traiter des données aux États-Unis. Ils s'appuient pour cela sur les mécanismes prévus par le RGPD (clauses contractuelles types, cadre de protection des données UE-États-Unis) décrits dans leurs politiques. ${todo('transfers')}</p>
<p>Le reste du service (base de données, application) est hébergé selon les indications de la section « hébergeur ».</p>`,
      },
      {
        id: 'cookies', title: 'Cookies et traceurs',
        html: `<p>AiTools ne pose que des cookies <strong>strictement nécessaires</strong> au service. Ceux d'AiTools sont exemptés de consentement : c'est pourquoi aucun bandeau ne s'affiche${captcha ? ' (ceux de Google, sur la page de connexion, sont décrits plus bas)' : ''}. Pas d'analyse d'audience, pas de publicité, pas de police ni de script chargés depuis un autre site${captcha ? ', sauf la vérification anti-robot de Google, uniquement sur la page de connexion (voir plus bas)' : ''}.</p>
<div class="table-wrap"><table>
  <caption>Cookies posés par AiTools</caption>
  <thead><tr><th scope="col">Nom</th><th scope="col">Rôle</th><th scope="col">Durée</th></tr></thead>
  <tbody>
    <tr><th scope="row"><code>sid</code></th><td>Te garder connecté (identifiant de session aléatoire). Sécurisé : HttpOnly, Secure, SameSite=Lax.</td><td>30 jours au plus</td></tr>
    <tr><th scope="row"><code>oauth_b</code></th><td>Relier une tentative de connexion à ton navigateur, pour empêcher qu'un tiers la détourne. Limité aux adresses de connexion.</td><td>10 minutes</td></tr>
    ${captcha ? `<tr><th scope="row">Cookies de Google reCAPTCHA</th><td>Déposés par Google sur la page de connexion, pendant la vérification anti-robot automatique. Ils servent à distinguer un humain d'un programme.</td><td>Durée fixée par Google</td></tr>` : ''}
  </tbody>
</table></div>
<p>Le tableau de bord retient aussi, dans la mémoire de session de ton navigateur, le projet que tu as ouvert en dernier ; cette mémoire est effacée à la fermeture de l'onglet et rien n'est envoyé au serveur.</p>
${captcha
  ? `<p>Sur la page de connexion, la vérification anti-robot de Google se charge toute seule. Aucune autre page du site ne charge quoi que ce soit depuis Google.</p>`
  : `<p>Si un traceur non essentiel devait un jour être ajouté, un choix « Accepter » ou « Refuser » apparaîtrait avant tout dépôt, et cette page serait mise à jour.</p>`}`,
      },
      {
        id: 'droits', title: 'Tes droits',
        html: `<p>Tu peux demander l'accès à tes données, leur rectification, leur effacement, la limitation ou l'opposition à leur traitement, et leur portabilité.</p>
<ul>
  <li><strong>Suppression :</strong> directement dans Mon compte. Elle efface ton compte et ses données, immédiatement.</li>
  <li><strong>Export :</strong> tes prospects s'exportent en CSV depuis le tableau de bord. Pour le reste de tes données, écris-nous.</li>
  <li><strong>Autres demandes :</strong> par email à <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>. Réponse sous un mois au plus. Nous pouvons demander une preuve que la demande vient bien de toi.</li>
</ul>
<p>Tu peux aussi saisir la CNIL : <a href="https://www.cnil.fr/fr/plaintes" rel="noopener noreferrer">cnil.fr/fr/plaintes</a>.</p>`,
      },
      {
        id: 'prospects', title: 'Tu as reçu un mail envoyé avec AiTools ?',
        html: `<p>L'expéditeur est un utilisateur d'AiTools : c'est lui le responsable du traitement de ton adresse professionnelle. Le pied du mail indique la page publique où elle a été trouvée.</p>
<ul>
  <li><strong>Ne plus recevoir de messages :</strong> clique sur le lien de désinscription du mail. Ton adresse entre dans une liste d'opposition respectée par tous les utilisateurs d'AiTools.</li>
  <li><strong>Accès, effacement, opposition :</strong> adresse-toi à l'expéditeur. Tu peux aussi écrire à <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> : nous inscrivons ton adresse en liste d'opposition et transmettons ta demande.</li>
</ul>`,
      },
      {
        id: 'securite', title: 'Sécurité',
        html: `<ul>
  <li>Connexions chiffrées (HTTPS) et cookies sécurisés.</li>
  <li>Aucun mot de passe : la connexion passe par ${apple ? 'Google ou Apple' : 'Google'}.</li>
  <li>Clés, jetons et mots de passe de services enregistrés chiffrés (AES-256-GCM), jamais réaffichés, jamais écrits dans les journaux.</li>
  <li>Comptes cloisonnés : chaque requête est filtrée par utilisateur.</li>
  <li>Les jobs IA s'exécutent dans un environnement isolé qui ne voit que le clone du projet de leur propriétaire.</li>
</ul>
<p>En cas de violation de données susceptible de te porter préjudice, tu seras prévenu, et la CNIL le sera dans les 72 heures lorsque la loi l'exige.</p>`,
      },
      {
        id: 'public', title: 'Public concerné et mises à jour',
        html: `<p>Le service s'adresse à des professionnels majeurs. Cette page peut évoluer ; la date de mise à jour figure en haut, et un changement important sera signalé aux utilisateurs.</p>`,
      },
    ],
  });
}

// ---------- Conditions générales d'utilisation ----------
export function termsPage({ appUrl, apple = false }) {
  return legalPage({
    appUrl, path: '/cgu',
    title: "Conditions générales d'utilisation · AiTools",
    description: "Les règles d'usage d'AiTools : compte, plan gratuit, liaison de ton accès Claude (y compris le risque de l'abonnement), usages interdits, responsabilités, résiliation.",
    h1: "Conditions générales d'utilisation",
    lead: "Les règles du jeu entre toi et AiTools. À lire avant de relier ton accès Claude.",
    sections: [
      {
        id: 'objet', title: 'Objet et éditeur',
        html: `<p>AiTools est un service en ligne édité par Tony AVERTY, entrepreneur individuel (voir les <a href="/mentions-legales">mentions légales</a>). Il pilote Claude Code, avec ton propre accès Claude, pour analyser un projet, rechercher des prospects professionnels, rédiger et envoyer des mails de prospection, relancer et suivre les réponses.</p>
<p>Utiliser le service, c'est accepter ces conditions. Si tu ne les acceptes pas, ne crée pas de compte.</p>`,
      },
      {
        id: 'acces', title: 'Accès et public',
        html: `<p>Le service est réservé aux personnes majeures qui l'utilisent pour leurs besoins professionnels. Il n'est pas destiné aux consommateurs.</p>`,
      },
      {
        id: 'compte', title: 'Ton compte',
        html: `<p>Le compte est créé à la première connexion avec ${apple ? 'Google ou Apple' : 'Google'}. Un compte correspond à une personne. Tu es responsable de la sécurité de l'accès à ton compte de connexion, et de tout ce qui est fait depuis ton compte AiTools. Préviens-nous sans attendre si tu penses qu'un tiers y a accès.</p>`,
      },
      {
        id: 'claude', title: 'Ton accès Claude',
        html: `<p>Pour lancer un job, tu relies ton propre accès à Claude. AiTools ne fournit ni crédits ni abonnement.</p>
<ul>
  <li><strong>Clé API Anthropic :</strong> Anthropic te facture directement, selon ses tarifs. Tu es responsable de cette dépense. Les budgets réglables dans AiTools sont des garde-fous, pas une garantie.</li>
  <li><strong>Abonnement Claude (jeton) :</strong> les conditions d'Anthropic peuvent ne pas autoriser l'usage d'un abonnement via une application tierce. Si tu choisis ce mode, <strong>ton compte Claude peut être limité, suspendu ou fermé</strong> par Anthropic. L'éditeur d'AiTools n'a aucun contrôle sur cette décision et n'en est pas responsable, dans la mesure permise par la loi. Avant la liaison, une fenêtre d'avertissement te demande de cocher « J'ai compris et j'accepte ce risque ». Cette acceptation est enregistrée avec sa date et la version du texte. Ce mode peut être désactivé à tout moment.</li>
</ul>
<p>Tu peux délier ton accès à tout moment depuis Mon compte : le secret est alors effacé et tes jobs IA en attente sont annulés.</p>`,
      },
      {
        id: 'plans', title: 'Plan gratuit et plans payants',
        html: `<p>Le plan gratuit comprend ${PLAN_LIMITS.free.projects} projet, ${PLAN_LIMITS.free.prospects} prospects, ${PLAN_LIMITS.free.mails} mails et ${PLAN_LIMITS.free.aiJobs} jobs IA par mois. Ces limites peuvent évoluer, avec information préalable.</p>
<p>Des plans payants sont prévus : ${Object.keys(PLAN_PRICES).map((k) => `${PLAN_LABELS[k]} (${PLAN_PRICES[k]} € TTC par mois, ou ${annualPrice(k)} € TTC par an, ${ANNUAL_FREE_MONTHS} mois offerts)`).join(', ')}. Les prix sont TTC ; l'éditeur est en franchise de TVA (art. 293 B du CGI). Ces plans ne sont pas encore ouverts à la vente : aucun paiement n'est demandé aujourd'hui, et rien ne sera facturé sans ton accord exprès.</p>`,
      },
      {
        id: 'envois', title: 'Tes envois',
        html: `<p>Tu es seul responsable des mails envoyés depuis ton compte, de leur contenu, de tes destinataires et de la manière dont tu as obtenu leurs adresses. En particulier :</p>
<ul>
  <li>tu ne prospectes que des professionnels, à propos de leur activité professionnelle ;</li>
  <li>tu laisses en place le lien de désinscription et la mention de la source, ajoutés automatiquement ;</li>
  <li>tu ne recontactes pas une personne qui s'est opposée, et tu respectes les demandes d'effacement qu'elle t'adresse ;</li>
  <li>tu relis ce que Claude propose avant d'envoyer : il peut se tromper.</li>
</ul>
<p>Tu configures toi-même ton serveur d'envoi. La réputation de ton domaine (SPF, DKIM, DMARC, volume) t'appartient.</p>`,
      },
      {
        id: 'interdits', title: 'Usages interdits',
        html: `<ul>
  <li>Envoyer du spam, ou des mails sans base légale.</li>
  <li>Démarcher des particuliers sans leur consentement préalable (prospection « B2C »).</li>
  <li>Utiliser des adresses devinées, achetées sans garantie de conformité, ou collectées de façon déloyale.</li>
  <li>Tromper les destinataires : fausse identité, objet mensonger, usurpation.</li>
  <li>Envoyer des contenus illicites, haineux, frauduleux, ou des logiciels malveillants.</li>
  <li>Contourner les limites du service, le surcharger, tenter d'accéder aux données d'un autre compte ou d'attaquer le service.</li>
  <li>Partager ton compte, ou revendre l'accès au service.</li>
</ul>`,
      },
      {
        id: 'donnees', title: 'Données personnelles',
        html: `<p>Les rôles de chacun sont décrits dans la <a href="/confidentialite">politique de confidentialité</a> : tu es responsable de traitement pour les données de tes prospects, AiTools est ton sous-traitant. Tu t'engages à n'enregistrer que des données que tu as le droit de traiter, et à informer les personnes concernées comme la loi l'exige. ${todo('processing')}</p>`,
      },
      {
        id: 'garanties', title: 'Disponibilité et résultats',
        html: `<p>Le service est fourni en l'état. Il peut être interrompu pour maintenance ou en cas d'incident, et l'éditeur ne garantit pas une disponibilité continue. Aucun résultat n'est garanti : ni nombre de réponses, ni clients obtenus. Les textes et analyses produits par Claude peuvent contenir des erreurs ; tu les vérifies avant de les utiliser.</p>`,
      },
      {
        id: 'propriete', title: 'Propriété intellectuelle',
        html: `<p>Tes contenus (projets, prospects, modèles de mail) restent à toi. Tu donnes à l'éditeur l'autorisation de les traiter uniquement pour faire fonctionner le service pour toi. Le service lui-même (code, textes, identité visuelle) reste la propriété de l'éditeur ; tu reçois un droit d'usage personnel, non exclusif et non transférable, le temps de ton compte.</p>`,
      },
      {
        id: 'responsabilite', title: 'Responsabilité',
        html: `<p>L'éditeur répond des dommages directs qui lui sont imputables. Dans la mesure permise par la loi, il n'est pas responsable des dommages indirects, de la suspension ou de la fermeture de ton compte Claude, des frais facturés par Anthropic ou tes autres prestataires, de la réputation de ton domaine d'envoi, ni de l'usage que tu fais du service en violation de ces conditions. Rien ici n'exclut la responsabilité en cas de faute lourde ou de dol, ni celle que la loi interdit de limiter. ${todo('liability')}</p>`,
      },
      {
        id: 'suspension', title: 'Suspension et résiliation',
        html: `<p><strong>Par toi :</strong> tu peux supprimer ton compte à tout moment depuis Mon compte. Tes données sont alors effacées, sauf la liste d'opposition.</p>
<p><strong>Par l'éditeur :</strong> en cas de manquement à ces conditions, d'abus, de plaintes de destinataires, de risque pour la sécurité ou la réputation du service, ton compte peut être suspendu, puis supprimé. Nous t'en informons quand c'est possible. Une suspension peut être immédiate quand l'urgence l'exige.</p>`,
      },
      {
        id: 'modifications', title: 'Modification des conditions',
        html: `<p>Ces conditions peuvent évoluer. Un changement important est annoncé aux utilisateurs avant son entrée en vigueur ; continuer à utiliser le service après cette date vaut acceptation. Si tu refuses, supprime ton compte.</p>`,
      },
      {
        id: 'droit', title: 'Droit applicable et litiges',
        html: `<p>Ces conditions sont soumises au droit français. En cas de difficulté, écris d'abord à <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> : nous cherchons une solution amiable. À défaut, les tribunaux français sont compétents.</p>`,
      },
    ],
  });
}
