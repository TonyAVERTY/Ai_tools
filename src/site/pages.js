// Pages publiques du site (rendu serveur, sans script, sauf la vérification anti-robot de la connexion). Les textes sont écrits pour être lus tels quels :
// rien ici ne promet un résultat, rien n'est chiffré au-delà de ce que le code fait réellement.
import { esc } from '../http.js';
import { siteLayout } from './layout.js';

/** « Google » ou « Google ou Apple » selon la configuration réelle de la connexion. */
export const providersText = (apple) => (apple ? 'Google ou Apple' : 'Google');

// ---------- Connexion ----------
// Avec reCAPTCHA (clés configurées), la page demande d'abord le consentement : rien n'est chargé depuis Google avant le
// clic sur « Charger la vérification anti-robot » (public/captcha.js). Les boutons sont alors des formulaires POST qui
// portent le jeton ; sans reCAPTCHA, ce sont de simples liens.
function captchaBox(siteKey) {
  return `<div class="captcha" data-captcha data-sitekey="${esc(siteKey)}">
      <h3>Vérification anti-robot</h3>
      <p>Pour protéger la connexion contre les programmes automatiques, AiTools utilise Google reCAPTCHA. Il n'est chargé qu'avec ton accord : Google dépose alors des cookies et reçoit ton adresse IP, des informations sur ton navigateur et sur ton comportement sur la page. Rien n'est envoyé à Google avant ton clic. <a href="/confidentialite#destinataires">En savoir plus</a></p>
      <p><button type="button" class="btn" data-captcha-load>Charger la vérification anti-robot</button></p>
      <p class="fine" role="status" data-captcha-status>Les boutons de connexion s'activent une fois la vérification chargée.</p>
      <noscript><p class="error">JavaScript est nécessaire pour la vérification anti-robot.</p></noscript>
    </div>`;
}

const loginButtons = ({ apple, captcha }) => (captcha
  ? `<form method="post" action="/auth/google" data-captcha-form><input type="hidden" name="captcha" value=""><button class="btn primary" disabled>Se connecter avec Google</button></form>
      ${apple ? '<form method="post" action="/auth/apple" data-captcha-form><input type="hidden" name="captcha" value=""><button class="btn apple" disabled>Se connecter avec Apple</button></form>' : ''}
      <p class="fine">Ce site est protégé par reCAPTCHA : la <a href="https://policies.google.com/privacy" rel="noopener noreferrer">politique de confidentialité</a> et les <a href="https://policies.google.com/terms" rel="noopener noreferrer">conditions d'utilisation</a> de Google s'appliquent.</p>`
  : `<a class="btn primary" href="/auth/google">Se connecter avec Google</a>
      ${apple ? '<a class="btn apple" href="/auth/apple">Se connecter avec Apple</a>' : ''}`);

export function loginPage({ appUrl, error = null, apple = false, bye = false, captcha = null }) {
  return siteLayout({
    appUrl, path: '/login', noindex: true, scripts: captcha ? ['/static/captcha.js'] : [],
    title: 'Connexion · AiTools',
    description: `Connecte-toi à AiTools avec ton compte ${providersText(apple)}. Ton compte est créé à la première connexion, sans mot de passe.`,
    body: `<div class="wrap auth">
  <div>
    <p class="eyebrow"><span class="mark" aria-hidden="true"></span>Connexion</p>
    <h1>Entre dans ton espace</h1>
    <p class="lead">Ton compte est créé à la première connexion, sans mot de passe. Juste après, tu relies ton accès Claude : sans lui, aucun job ne se lance.</p>
    <p class="fine">Tu n'as pas encore de compte ? C'est le même bouton. Le plan gratuit ne demande pas de carte bancaire.</p>
  </div>
  <section class="card" aria-labelledby="connexion-titre">
    <h2 id="connexion-titre">Continuer avec</h2>
    ${bye ? '<p class="ok" role="status">Ton compte et toutes ses données ont été supprimés.</p>' : ''}
    ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
    ${captcha ? captchaBox(captcha.siteKey) : ''}
    <div class="login-btns">
      ${loginButtons({ apple, captcha })}
    </div>
    <p class="fine">En te connectant, tu acceptes les <a href="/cgu">conditions d'utilisation</a> et tu reconnais avoir pris connaissance de la <a href="/confidentialite">politique de confidentialité</a>.</p>
  </section>
</div>`,
  });
}

// ---------- 404 ----------
export function notFoundPage({ appUrl }) {
  return siteLayout({
    appUrl, path: '/404', noindex: true,
    title: 'Page introuvable · AiTools',
    description: "Cette page n'existe pas ou a changé d'adresse.",
    body: `<div class="wrap page-head">
  <p class="eyebrow"><span class="mark" aria-hidden="true"></span>Erreur 404</p>
  <h1>Cette page n'existe pas</h1>
  <p class="lead">L'adresse est peut-être mal saisie, ou la page a changé de place. Voici où aller ensuite.</p>
  <div class="cta-row">
    <a class="btn primary" href="/">Retour à l'accueil</a>
    <a class="textlink" href="/fonctionnement">Voir le fonctionnement</a>
    <a class="textlink" href="/tarifs">Voir les tarifs</a>
  </div>
</div>`,
  });
}

// ---------- Accueil ----------
const HOME_JSON_LD = (appUrl) => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'AiTools',
  url: `${appUrl}/`,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  inLanguage: 'fr',
  description: 'Panel qui pilote Claude Code pour analyser un projet, trouver des prospects, rédiger et envoyer des mails de prospection, relancer et suivre les réponses.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR', description: 'Plan gratuit : 1 projet, 50 prospects, 100 mails et 5 jobs IA par mois' },
  publisher: { '@type': 'Person', name: 'Tony AVERTY' },
});

// Maquette du tableau de bord : les vrais composants (.card, .badge, .running, .bar, table), des données d'exemple
const MOCKUP = `<figure class="shot">
  <div class="mock" role="img" aria-label="Aperçu du tableau de bord : un projet dont la cible est validée, une recherche de prospects en cours et trois prospects avec leur statut">
    <div class="mock-top"><span class="brand"><span class="mark"></span>AiTools</span><span class="push">Mon compte · Réglages</span></div>
    <div class="card">
      <div class="mock-name"><span>Atelier Exemple</span><span class="badge ok">cible validée</span></div>
      <p class="mock-sub">Fiche projet générée depuis le dépôt Git</p>
      <div class="running"><div>
        <div class="run-head"><span>Recherche de prospects</span><span class="jpct">6 / 10</span></div>
        <p class="mock-sub">Dernier trouvé : Menuiserie Exemple</p>
        <div class="bar"><span class="w-60"></span></div>
      </div></div>
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Entreprise</th><th class="col-city">Ville</th><th>Score</th><th>Statut</th></tr></thead>
        <tbody>
          <tr><td>Menuiserie Exemple</td><td class="col-city">Lyon</td><td>8</td><td class="st-new">À contacter</td></tr>
          <tr><td>Garage Exemple</td><td class="col-city">Nantes</td><td>7</td><td class="st-replied">A répondu</td></tr>
          <tr><td>Cabinet Exemple</td><td class="col-city">Lille</td><td>6</td><td>Contacté</td></tr>
        </tbody>
      </table></div>
    </div>
    <span class="btn small primary">Lancer la recherche</span> <span class="btn small">Modèle de mail</span>
  </div>
  <figcaption class="fine">Le tableau de bord, avec des données d'exemple.</figcaption>
</figure>`;

export function homePage({ appUrl, apple = false }) {
  return siteLayout({
    appUrl, path: '/',
    title: 'AiTools : prospection par mail avec ton propre Claude',
    description: 'Un panel qui pilote Claude Code pour analyser ton projet, trouver des prospects, rédiger et envoyer tes mails de prospection, relancer et suivre les réponses.',
    jsonLd: HOME_JSON_LD(appUrl),
    body: `<section class="wrap hero" aria-labelledby="titre-accueil">
  <div class="hero-text">
    <p class="eyebrow"><span class="mark" aria-hidden="true"></span>Prospection B2B par mail</p>
    <h1 id="titre-accueil">Un panel pour prospecter par mail, avec ton propre accès Claude</h1>
    <p class="lead">AiTools lit ton projet, cherche des entreprises qui pourraient en avoir besoin, rédige les mails, les envoie depuis ta boîte et suit les réponses. Tu valides la cible, tu relis le modèle, tu choisis combien de mails partent.</p>
    <div class="cta-row">
      <a class="btn primary" href="/login">Créer mon compte</a>
      <a class="textlink" href="/fonctionnement">Voir comment ça marche</a>
    </div>
    <p class="fine">Gratuit pour commencer, sans carte bancaire. Connexion avec ${providersText(apple)}, sans mot de passe.</p>
  </div>
  ${MOCKUP}
</section>

<div class="rule" aria-hidden="true"></div>

<section class="wrap block" aria-labelledby="titre-regles">
  <div class="split">
    <div class="sticky">
      <h2 id="titre-regles">Ton accès, ta boîte mail, tes règles</h2>
      <p>AiTools orchestre le travail. L'accès à Claude et la boîte d'envoi restent les tiens.</p>
    </div>
    <ul class="facts">
      <li>
        <h3>Ton accès Claude</h3>
        <p>Les analyses et les rédactions tournent avec ta clé API Anthropic, facturée par Anthropic selon ton usage, ou avec ton abonnement Claude, au risque expliqué sur la page <a href="/tarifs#acces-claude">Tarifs</a>. AiTools ne revend pas de crédits.</p>
      </li>
      <li>
        <h3>Ta boîte d'envoi</h3>
        <p>Les mails partent de ton serveur SMTP, depuis ton adresse. Les réponses sont lues dans ta boîte, en IMAP.</p>
      </li>
      <li>
        <h3>Tes envois, ta responsabilité</h3>
        <p>Prospection entre professionnels uniquement, lien de désinscription dans chaque mail, liste d'opposition respectée. Tu restes responsable de ce que tu envoies.</p>
      </li>
      <li>
        <h3>Tes données</h3>
        <p>Chaque compte est cloisonné. Depuis Mon compte, tu supprimes ton compte et tout ce qu'il contient.</p>
      </li>
    </ul>
  </div>
</section>

<section class="wrap block" aria-labelledby="titre-etapes">
  <h2 id="titre-etapes">Du dépôt Git à la réponse</h2>
  <ol class="steps compact">
    <li><h3>Il lit ton projet</h3><p>Claude parcourt ton dépôt en lecture seule et écrit une fiche : ce que fait le produit, pour qui, avec quels arguments.</p></li>
    <li><h3>Tu valides la cible</h3><p>Secteurs, zone, taille, décideur. Aucune recherche ne démarre tant que tu n'as pas validé.</p></li>
    <li><h3>Il cherche des prospects</h3><p>Des adresses professionnelles publiées sur le web, avec la page source et un score de pertinence.</p></li>
    <li><h3>Il rédige</h3><p>Un modèle de mail, un objet B pour un test A/B, une relance. Tu modifies, tu valides.</p></li>
    <li><h3>Il envoie, sans se presser</h3><p>Des lots de la taille que tu choisis, avec des plafonds par jour et un délai aléatoire entre deux mails.</p></li>
    <li><h3>Il suit les réponses</h3><p>Réponses, adresses invalides et relance unique dans le même fil, puis un CRM pour garder la trace.</p></li>
  </ol>
  <p><a class="textlink" href="/fonctionnement">Le détail, étape par étape</a></p>
</section>

<section class="wrap block" aria-labelledby="titre-limites">
  <h2 id="titre-limites">Ce qu'AiTools ne fait pas</h2>
  <div class="statement">
    <p>Il ne promet aucune réponse : un mail bien écrit reste un mail envoyé à quelqu'un qui n'a rien demandé.</p>
    <p>Il demande à Claude de ne retenir que des adresses professionnelles publiées publiquement, jamais devinées. Claude peut quand même se tromper : relis les fiches avant d'envoyer.</p>
    <p>Il ne contacte pas de particuliers, et il n'envoie rien dans ton dos. Les premiers mails partent quand tu confirmes un envoi, la relance automatique quand tu l'actives.</p>
  </div>
</section>

<div class="rule" aria-hidden="true"></div>

<section class="wrap block" aria-labelledby="titre-fin">
  <div class="closing">
    <div>
      <h2 id="titre-fin">Commence avec le plan gratuit</h2>
      <p>1 projet, 50 prospects, 100 mails et 5 jobs IA par mois. Le plan payant n'est pas ouvert : <a href="/tarifs">le détail est sur la page Tarifs</a>.</p>
    </div>
    <a class="btn primary" href="/login">Créer mon compte</a>
  </div>
</section>`,
  });
}

// ---------- Fonctionnement ----------
export function howPage({ appUrl, apple = false }) {
  return siteLayout({
    appUrl, path: '/fonctionnement',
    title: 'Fonctionnement : du dépôt Git aux réponses · AiTools',
    description: "Comment AiTools analyse ton projet, cherche des prospects, rédige et envoie les mails, relance et suit les réponses, étape par étape et avec ses limites.",
    body: `<div class="wrap page-head">
  <p class="eyebrow"><span class="mark" aria-hidden="true"></span>Fonctionnement</p>
  <h1>Comment ça marche, vraiment</h1>
  <p class="lead">Sept étapes, dans cet ordre. Pour chacune : ce que fait l'outil, ce que tu décides, et ce qu'il ne sait pas faire.</p>
</div>

<div class="rule" aria-hidden="true"></div>

<section class="wrap block" aria-label="Les étapes">
  <ol class="steps">
    <li>
      <h2>Tu relies ton accès Claude</h2>
      <p>Après la connexion (${providersText(apple)}), AiTools te demande ton propre accès à Claude. Sans lui, la seule chose possible est de gérer ton compte : aucun job ne se lance.</p>
      <ul>
        <li>Une clé API Anthropic : elle est vérifiée sans consommer de tokens, chiffrée, et seuls ses 4 derniers caractères restent affichés.</li>
        <li>Ou un jeton d'abonnement Claude, après un avertissement et une case à cocher. Les risques sont détaillés sur la page <a href="/tarifs#acces-claude">Tarifs</a>.</li>
      </ul>
    </li>
    <li>
      <h2>Tu ajoutes un projet</h2>
      <p>Un projet, c'est un dépôt Git en https sur le Forgejo que tu déclares dans les réglages, avec un jeton en lecture seule si le dépôt est privé. AiTools le clone sur le serveur et Claude le lit : README, manifestes, pages principales, une quinzaine de fichiers au plus.</p>
      <p>L'analyse produit une fiche : ce que fait le produit, la proposition de valeur, les arguments de vente, une cible suggérée. Elle ne tourne qu'une fois, puis à ta demande. En production, chaque job IA s'exécute dans un environnement isolé qui ne voit que le clone de ton projet.</p>
    </li>
    <li>
      <h2>Tu valides la cible</h2>
      <p>La fiche propose une cible : description, secteurs, zone, taille, décideur, requêtes de recherche. Tu corriges ce qui ne va pas. Tant que tu n'as pas cliqué sur « Valider la cible », la recherche de prospects reste verrouillée.</p>
    </li>
    <li>
      <h2>Il cherche des prospects</h2>
      <p>Tu demandes de 1 à 50 prospects, maintenant ou « cette nuit » (entre 1 h et 6 h, heure de Paris). Claude cherche sur le web. Il lui est demandé de ne garder que des adresses professionnelles publiées publiquement, jamais devinées, et de donner l'adresse exacte de la page où il les a vues.</p>
      <p>Chaque fiche contient l'entreprise, l'email, le site, la ville, le secteur, une phrase d'accroche écrite d'après leur site, la source et un score de 1 à 10. Les adresses déjà dans la liste d'opposition sont écartées. Tu peux aussi importer un CSV (2 000 lignes au plus).</p>
      <p><strong>Limite :</strong> Claude peut se tromper d'adresse ou juger mal une entreprise. Relis les fiches.</p>
    </li>
    <li>
      <h2>Il rédige les mails</h2>
      <p>Claude propose un premier mail court, un objet B pour un test A/B (les envois alternent entre les deux objets) et un mail de relance. Tu modifies, tu enregistres, puis tu valides le modèle. Les variables <code>{{entreprise}}</code>, <code>{{ville}}</code> et <code>{{accroche}}</code> personnalisent chaque envoi.</p>
      <p>Le lien de désinscription et la mention de la source de l'adresse sont ajoutés automatiquement à chaque mail.</p>
    </li>
    <li>
      <h2>Il envoie, sans se presser</h2>
      <p>Tu choisis la taille de chaque lot (100 mails au plus) et tu confirmes. Les mails partent depuis ton serveur SMTP, avec un délai aléatoire entre deux envois (20 à 60 secondes par défaut). Des plafonds sur 24 heures s'appliquent par projet (réglable, 200 au plus) et pour l'ensemble de ton compte (réglable, 300 au plus). Un prospect n'est contacté qu'une fois.</p>
      <p><strong>Limite :</strong> la réputation de ton domaine d'envoi dépend de toi. SPF, DKIM et DMARC doivent être en place, et il vaut mieux commencer petit.</p>
    </li>
    <li>
      <h2>Il suit les réponses et relance une fois</h2>
      <p>Si tu renseignes ta boîte de réception, AiTools la lit en IMAP toutes les 15 minutes. Une réponse fait passer le prospect en « A répondu ». Les absences et réponses automatiques sont ignorées. Un mail rejeté passe le prospect en « Rejeté » et l'adresse en liste d'opposition.</p>
      <p>La relance est facultative : tu l'actives, et il n'y en a qu'une, après le nombre de jours que tu fixes (7 par défaut), dans le même fil. Elle ne part qu'en heures ouvrées (du lundi au vendredi, de 9 h à 18 h, heure de Paris), si ta boîte a été lue dans les deux dernières heures, et dans la limite des plafonds.</p>
      <p>Chaque prospect a une fiche : l'historique des mails, une prochaine action datée, des notes. Tu filtres, tu exportes en CSV. Le récapitulatif affiche tes envois et tes réponses par semaine ; si tu donnes un accès en lecture seule à la base de données de ton projet, il suit aussi tes utilisateurs, tes clients et ton revenu.</p>
    </li>
  </ol>
  <p class="fine">En plus : un rapport hebdomadaire par mail, des notifications Discord, et un bouton « Évolution » qui t'envoie par mail des idées de fonctionnalités tirées de ton propre code.</p>
</section>

<div class="rule" aria-hidden="true"></div>

<section class="wrap block" aria-labelledby="titre-garde-fous">
  <div class="split">
    <div class="sticky">
      <h2 id="titre-garde-fous">Garde-fous pour ton compte Claude</h2>
    </div>
    <ul class="facts">
      <li>
        <h3>Un budget que tu fixes</h3>
        <p>Tu peux plafonner la dépense IA sur 24 heures et sur 30 jours. Une fois le plafond atteint, les jobs IA attendent sans être perdus, et les envois continuent. Un job déjà commencé n'est jamais coupé : le plafond peut être dépassé d'un job.</p>
      </li>
      <li>
        <h3>Un œil sur ton quota</h3>
        <p>Avec un abonnement, la barre du haut affiche le quota remonté par Claude lui-même. Au-delà de 85 %, l'analyse et les idées d'évolution sont reportées pour garder de la marge à la prospection.</p>
      </li>
      <li>
        <h3>Des modèles économes par défaut</h3>
        <p>La prospection et l'analyse utilisent Haiku par défaut. Tu passes à Sonnet dans les réglages si les fiches manquent de précision.</p>
      </li>
    </ul>
  </div>
</section>

<section class="wrap block" aria-labelledby="titre-suite">
  <div class="closing">
    <div>
      <h2 id="titre-suite">Prêt à essayer ?</h2>
      <p>Le plan gratuit suffit pour un premier projet. Les limites sont sur la page <a href="/tarifs">Tarifs</a>.</p>
    </div>
    <a class="btn primary" href="/login">Créer mon compte</a>
  </div>
</section>`,
  });
}

// ---------- Tarifs ----------
export function pricingPage({ appUrl }) {
  return siteLayout({
    appUrl, path: '/tarifs',
    title: 'Tarifs : plan gratuit et accès Claude à ta charge · AiTools',
    description: "Le plan gratuit d'AiTools : 1 projet, 50 prospects, 100 mails et 5 jobs IA par mois. Le plan payant n'est pas ouvert. Ton accès Claude est facturé à part, par Anthropic.",
    body: `<div class="wrap page-head">
  <p class="eyebrow"><span class="mark" aria-hidden="true"></span>Tarifs</p>
  <h1>Gratuit pour commencer, payant plus tard</h1>
  <p class="lead">Aujourd'hui, un seul plan existe, et il est gratuit. Ton accès Claude est un coût à part, qui ne passe pas par AiTools.</p>
</div>

<section class="wrap" aria-label="Plans">
  <div class="plans">
    <article class="card plan" aria-labelledby="plan-gratuit">
      <h2 id="plan-gratuit">Gratuit</h2>
      <p class="price">0 € <small>sans carte bancaire</small></p>
      <ul class="limits">
        <li><span>Projets</span><strong>1</strong></li>
        <li><span>Prospects</span><strong>50</strong></li>
        <li><span>Mails par mois</span><strong>100</strong></li>
        <li><span>Jobs IA par mois</span><strong>5</strong></li>
      </ul>
      <p class="fine">Ces plafonds sont annoncés dès maintenant. L'outil ne les applique pas encore automatiquement : cette vérification technique arrive prochainement.</p>
      <a class="btn primary" href="/login">Créer mon compte</a>
    </article>
    <article class="card plan soon" aria-labelledby="plan-payant">
      <h2 id="plan-payant">Plan payant <span class="badge warn">Bientôt</span></h2>
      <p>Plus de projets, plus de prospects, plus de mails. Le contenu exact et le prix ne sont pas arrêtés.</p>
      <p>Ils seront publiés sur cette page avant toute ouverture des paiements. Rien n'est facturé aujourd'hui.</p>
    </article>
  </div>
</section>

<section class="wrap block" id="acces-claude" aria-labelledby="titre-claude">
  <div class="split">
    <div class="sticky">
      <h2 id="titre-claude">Ton accès Claude : deux façons, deux coûts</h2>
      <p>AiTools n'achète pas de Claude pour toi. Chaque job IA utilise ton accès, et rien que le tien.</p>
    </div>
    <ul class="facts">
      <li>
        <h3>Clé API Anthropic (recommandé)</h3>
        <p>Tu crées une clé sur console.anthropic.com. Anthropic te facture à l'usage, selon ses propres tarifs, sur ton compte. C'est l'option prévue pour brancher un outil tiers. Tu peux plafonner la dépense par jour et par mois dans les réglages d'AiTools.</p>
      </li>
      <li>
        <h3>Abonnement Claude (Pro, Max), avec un risque</h3>
        <p>Tu génères un jeton avec <code>claude setup-token</code> et tu le colles dans AiTools. Pas de facture en plus, mais les conditions d'Anthropic peuvent ne pas autoriser l'usage d'un abonnement à travers une application tierce. Ton compte Claude pourrait être limité, suspendu ou fermé.</p>
        <p>AiTools ne peut pas l'empêcher et n'en est pas responsable. Une fenêtre d'avertissement et une case à cocher te le rappellent avant toute liaison, et l'acceptation est enregistrée avec sa date. Lis les <a href="https://www.anthropic.com/legal/consumer-terms" rel="noopener noreferrer">conditions d'Anthropic</a> avant de choisir. Ce mode peut aussi être désactivé sur le service.</p>
      </li>
    </ul>
  </div>
</section>

<section class="wrap block" id="envois" aria-labelledby="titre-envois">
  <div class="split">
    <div class="sticky">
      <h2 id="titre-envois">Tu es responsable de tes envois</h2>
      <p>AiTools aide à rester dans les clous. Il ne remplace pas ta responsabilité d'expéditeur.</p>
    </div>
    <ul class="facts">
      <li>
        <h3>Entre professionnels, pas aux particuliers</h3>
        <p>La prospection par mail vers un professionnel est possible, en règle générale, sans son accord préalable, à condition que le message ait un rapport avec son activité et qu'il puisse s'y opposer simplement. Vers un particulier, il faut son consentement : n'utilise pas AiTools pour cela.</p>
      </li>
      <li>
        <h3>Désinscription et liste d'opposition</h3>
        <p>Chaque mail contient un lien de désinscription en un clic. Une adresse qui se désinscrit, refuse ou rejette un mail entre dans une liste d'opposition qu'AiTools respecte pour tous les comptes.</p>
      </li>
      <li>
        <h3>Source et transparence</h3>
        <p>Chaque mail rappelle où l'adresse du destinataire a été trouvée. Pour les données de tes prospects, c'est toi le responsable de traitement : la <a href="/confidentialite">politique de confidentialité</a> et les <a href="/cgu">conditions d'utilisation</a> détaillent les rôles.</p>
      </li>
    </ul>
  </div>
</section>

<section class="wrap block" aria-labelledby="titre-questions">
  <h2 id="titre-questions">Questions fréquentes</h2>
  <div class="statement">
    <h3>Faut-il une carte bancaire ?</h3>
    <p>Non. Le plan gratuit n'en demande pas, et le paiement n'existe pas encore dans l'outil.</p>
    <h3>Puis-je supprimer mon compte ?</h3>
    <p>Oui, à tout moment, depuis Mon compte. Cela efface tes projets, tes prospects, tes modèles, tes réglages et le clone de ton code. Seule la liste d'opposition, qui protège les personnes désinscrites, est conservée.</p>
    <h3>Combien me coûtera Claude ?</h3>
    <p>Cela dépend de ton usage et de ton contrat avec Anthropic. AiTools ne peut pas le prévoir à ta place, mais tu peux fixer un budget maximum.</p>
  </div>
</section>`,
  });
}
