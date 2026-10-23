// Pages publiques du site (rendu serveur ; le seul script est public/site.js, pour le mouvement, plus la vérification anti-robot
// de la connexion). Les textes sont écrits en mots de tous les jours, pour être lus tels quels par n'importe qui :
// rien ici ne promet un résultat, rien n'est chiffré au-delà de ce que le code fait réellement.
import { esc } from '../http.js';
import { brandMark } from '../assets.js';
import { siteLayout, nextBlock, journey, CONTACT_EMAIL } from './layout.js';
import { PLAN_LIMITS, PLAN_PRICES, PLAN_LABELS, ANNUAL_FREE_MONTHS, annualPrice } from '../limits.js';

const FREE = PLAN_LIMITS.free;
/** Montant en euros à la française (« 8,33 € ») ; entier sans décimales. */
const euros = (n) => `${Number.isInteger(n) ? n : n.toFixed(2).replace('.', ',')}\u00a0€`;
const PAID = Object.keys(PLAN_PRICES);
const PLAN_BLURBS = {
  starter: 'Pour lancer un premier vrai projet.',
  growth: 'Pour prospecter chaque semaine, sur plusieurs projets.',
  business: 'Pour une activité qui repose sur la prospection.',
  intensive: 'Pour le plus gros volume que le service permet.',
};
const limitRows = (l) => `<li><span>Projets</span><strong>${l.projects}</strong></li>
        <li><span>Contacts</span><strong>${l.prospects.toLocaleString('fr-FR')}</strong></li>
        <li><span>Mails par mois</span><strong>${l.mails.toLocaleString('fr-FR')}</strong></li>
        <li><span>Tâches IA par mois</span><strong>${l.aiJobs}</strong></li>
        <li><span>Places d'équipe</span><strong>${l.seats}</strong></li>`;

/** « Google » ou « Google ou Apple » selon la configuration réelle de la connexion. */
export const providersText = (apple) => (apple ? 'Google ou Apple' : 'Google');

// ---------- Connexion ----------
// Avec reCAPTCHA (clés configurées), la vérification se fait toute seule : public/captcha.js charge le script de Google
// dès l'ouverture de la page, et le jeton est produit au clic sur le bouton de connexion. Les boutons sont alors des
// formulaires POST qui portent le jeton ; sans reCAPTCHA, ce sont de simples liens.
function captchaBox(siteKey) {
  return `<div class="captcha" data-captcha data-sitekey="${esc(siteKey)}">
      <p class="fine" role="status" data-captcha-status>Vérification anti-robot en cours, ça prend une seconde…</p>
      <p><button type="button" class="btn" data-captcha-load hidden>Réessayer la vérification</button></p>
      <noscript><p class="error">JavaScript est nécessaire pour la vérification anti-robot.</p></noscript>
    </div>`;
}

const loginButtons = ({ apple, captcha }) => (captcha
  ? `<form method="post" action="/auth/google" data-captcha-form><input type="hidden" name="captcha" value=""><button class="btn primary" disabled>Se connecter avec Google</button></form>
      ${apple ? '<form method="post" action="/auth/apple" data-captcha-form><input type="hidden" name="captcha" value=""><button class="btn apple" disabled>Se connecter avec Apple</button></form>' : ''}
      <p class="fine">Ce site est protégé par Google reCAPTCHA, qui vérifie tout seul que tu es bien une personne (<a href="/confidentialite#destinataires">en savoir plus</a>). La <a href="https://policies.google.com/privacy" rel="noopener noreferrer">politique de confidentialité</a> et les <a href="https://policies.google.com/terms" rel="noopener noreferrer">conditions d'utilisation</a> de Google s'appliquent.</p>`
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
    <p class="lead">Ton compte se crée tout seul la première fois, sans mot de passe. Juste après, tu relies ton accès Claude : sans lui, rien ne peut se lancer.</p>
    <p class="fine">Tu n'as pas encore de compte ? C'est le même bouton. Le plan gratuit ne demande pas de carte bancaire. Tu veux d'abord comprendre ? Regarde <a href="/fonctionnement">comment ça marche</a> ou <a href="/tarifs">les tarifs</a>.</p>
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
</div>
${nextBlock(journey('how', 'pricing', 'home'), 'Pas encore sûr ?')}`,
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
  offers: [
    { '@type': 'Offer', name: 'Gratuit', price: '0', priceCurrency: 'EUR', description: `Plan gratuit : ${FREE.projects} projet, ${FREE.prospects} prospects, ${FREE.mails} mails et ${FREE.aiJobs} jobs IA par mois` },
    ...PAID.map((k) => ({ '@type': 'Offer', name: PLAN_LABELS[k], price: String(PLAN_PRICES[k]), priceCurrency: 'EUR', description: `${PLAN_LABELS[k]} : ${PLAN_PRICES[k]} € TTC par mois, ou ${annualPrice(k)} € TTC par an (${ANNUAL_FREE_MONTHS} mois offerts)` })),
  ],
  publisher: { '@type': 'Person', name: 'Tony AVERTY' },
});

// Maquette du tableau de bord : les vrais composants (.card, .badge, .running, .bar, table), des données d'exemple.
// La barre avance et une alerte « réponse » apparaît en boucle (CSS seul, coupé si on réduit les animations).
const MOCKUP = `<figure class="shot">
  <div class="mock" role="img" aria-label="Aperçu du tableau de bord : un projet dont la cible est validée, une recherche de contacts en cours et trois contacts avec leur statut">
    <div class="mock-top"><span class="brand">${brandMark()}AiTools</span><span class="push">Mon compte · Réglages</span></div>
    <div class="card">
      <div class="mock-name"><span>Atelier Exemple</span><span class="badge ok">cible validée</span></div>
      <p class="mock-sub">Fiche du projet écrite à partir de ton code</p>
      <div class="running"><div>
        <div class="run-head"><span>Recherche de contacts</span><span class="jpct">en cours</span></div>
        <p class="mock-sub">Dernier trouvé : Menuiserie Exemple</p>
        <div class="bar"><span class="w-60 grow"></span></div>
      </div></div>
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Entreprise</th><th class="col-city">Ville</th><th>Note</th><th>Où ça en est</th></tr></thead>
        <tbody>
          <tr><td>Menuiserie Exemple</td><td class="col-city">Lyon</td><td>8</td><td class="st-new">À contacter</td></tr>
          <tr><td>Garage Exemple</td><td class="col-city">Nantes</td><td>7</td><td class="st-replied">A répondu</td></tr>
          <tr><td>Cabinet Exemple</td><td class="col-city">Lille</td><td>6</td><td>Contacté</td></tr>
        </tbody>
      </table></div>
    </div>
    <span class="btn small primary">Lancer la recherche</span> <span class="btn small">Modèle de mail</span>
    <span class="ping" aria-hidden="true">Nouvelle réponse : Garage Exemple</span>
  </div>
  <figcaption class="fine">Ton tableau de bord, avec des exemples.</figcaption>
</figure>`;

// Galerie d'écrans (images de public/img) : chaque écran renvoie vers l'étape correspondante de « Fonctionnement »
const SCREENS = [
  ['ecran-projet', "Il lit ton projet", "Claude regarde ton code et écrit une fiche : ce que tu proposes, et à qui.", '/fonctionnement#etape-2', "Ton projet, lu en quelques minutes"],
  ['ecran-cible', "Tu choisis la cible", "Qui, où, combien : rien ne démarre sans ton feu vert.", '/fonctionnement#etape-3', "La cible, c'est toi qui décides"],
  ['ecran-prospects', "Il trouve des contacts", "Des entreprises avec une adresse pro publiée, une note et la page d'où elle vient.", '/fonctionnement#etape-4', "Des contacts trouvés pour toi"],
  ['ecran-mail', "Il écrit les mails", "Un modèle que tu relis, que tu corriges, puis que tu valides.", '/fonctionnement#etape-5', "Un mail écrit, que tu relis"],
  ['ecran-reponses', "Tu suis les réponses", "Qui a répondu, qui relancer, quoi faire ensuite : tout au même endroit.", '/fonctionnement#etape-7', "Les réponses, au même endroit"],
];
const gallery = () => `<section class="wrap block gallery-block" aria-labelledby="titre-galerie">
  <div class="gallery-head" data-reveal>
    <h2 id="titre-galerie">Un coup d'œil, écran par écran</h2>
    <p class="lead">Voilà à quoi ça ressemble, de ton projet jusqu'à la réponse de ton futur client.</p>
  </div>
  <div class="gallery" data-gallery>
    <ul class="track" data-track aria-label="Les écrans d'AiTools">
      ${SCREENS.map(([img, title, text, href, alt], i) => `<li class="slide" data-slide>
        <a class="slide-link" href="${href}">
          <span class="slide-n">${i + 1}</span>
          <h3>${esc(title)}</h3>
          <p>${esc(text)}</p>
          <img src="/static/img/${img}.svg" alt="${esc(alt)}" width="300" height="560" loading="lazy">
          <span class="slide-more">Voir cette étape</span>
        </a>
      </li>`).join('\n      ')}
    </ul>
    <div class="gallery-ctl">
      <button type="button" class="ctl" data-prev aria-label="Écran précédent">&larr;</button>
      <span class="dots">${SCREENS.map((s, i) => `<button type="button" class="dot" data-dot aria-label="Écran ${i + 1}" aria-current="${i === 0}"></button>`).join('')}</span>
      <button type="button" class="ctl" data-next aria-label="Écran suivant">&rarr;</button>
    </div>
  </div>
</section>`;

export function homePage({ appUrl, apple = false }) {
  return siteLayout({
    appUrl, path: '/',
    title: 'AiTools : trouve des clients par mail avec ton propre Claude',
    description: 'AiTools lit ton projet, trouve des entreprises qui pourraient avoir besoin de toi, écrit et envoie tes mails, relance et suit les réponses. Gratuit pour commencer.',
    jsonLd: HOME_JSON_LD(appUrl),
    body: `<div class="hero-bg">
<span class="blob b1" aria-hidden="true"></span><span class="blob b2" aria-hidden="true"></span>
<section class="wrap hero" aria-labelledby="titre-accueil">
  <div class="hero-text">
    <p class="eyebrow"><span class="mark" aria-hidden="true"></span>Trouver des clients par mail</p>
    <h1 id="titre-accueil">Trouve de nouveaux clients, <span class="rot" data-rotate="sans y passer tes soirées|sans te prendre la tête|sans rien oublier|sans partir de zéro">sans y passer tes soirées</span></h1>
    <p class="lead">AiTools lit ton projet, cherche des entreprises qui pourraient avoir besoin de toi, écrit les mails et les envoie depuis ta propre boîte mail. Toi, tu choisis qui contacter, tu relis, et tu décides combien de mails partent.</p>
    <div class="cta-row">
      <a class="btn primary" href="/login">Créer mon compte</a>
      <a class="textlink" href="/fonctionnement">Voir comment ça marche</a>
    </div>
    <p class="fine">Gratuit pour commencer, sans carte bancaire (<a href="/tarifs">voir les tarifs</a>). Tu te connectes avec ${providersText(apple)}, sans mot de passe.</p>
  </div>
  ${MOCKUP}
</section>
</div>

<div class="rule" aria-hidden="true"></div>

<section class="wrap block counters" aria-label="Le plan gratuit en chiffres">
  <ul class="count-row">
    <li data-reveal><strong data-count="${FREE.projects}">${FREE.projects}</strong><span>projet</span></li>
    <li data-reveal><strong data-count="${FREE.prospects}">${FREE.prospects}</strong><span>contacts</span></li>
    <li data-reveal><strong data-count="${FREE.mails}">${FREE.mails}</strong><span>mails par mois</span></li>
    <li data-reveal><strong data-count="${FREE.aiJobs}">${FREE.aiJobs}</strong><span>tâches IA par mois</span></li>
  </ul>
  <p class="fine center" data-reveal>Ce que tu as sans payer, tous les mois. <a href="/tarifs">Tous les détails sur la page Tarifs.</a></p>
</section>

${gallery()}

<div class="rule" aria-hidden="true"></div>

<section class="wrap block" aria-labelledby="titre-regles">
  <div class="split">
    <div class="sticky" data-reveal>
      <h2 id="titre-regles">C'est toi qui tiens les commandes</h2>
      <p>AiTools fait le gros du travail. Ton accès à Claude et ta boîte mail restent les tiens.</p>
    </div>
    <ul class="facts">
      <li data-reveal>
        <h3>Ton accès à Claude</h3>
        <p>Tu branches ta propre clé Anthropic, ou ton abonnement Claude en un clic (avec un risque à connaître, expliqué sur la page <a href="/tarifs#acces-claude">Tarifs</a>). AiTools ne te revend rien.</p>
      </li>
      <li data-reveal>
        <h3>Ta boîte mail</h3>
        <p>Les mails partent de ton adresse, depuis ta messagerie. Les réponses arrivent dans ta boîte, comme d'habitude, et AiTools les repère pour toi.</p>
      </li>
      <li data-reveal>
        <h3>Tes règles</h3>
        <p>On écrit à des professionnels, jamais à des particuliers. Chaque mail a un lien pour ne plus en recevoir, et ce choix est toujours respecté. <a href="/fonctionnement#envois">Voir comment les envois sont encadrés.</a></p>
      </li>
      <li data-reveal>
        <h3>Tes données</h3>
        <p>Chaque compte est séparé des autres. Un clic dans Mon compte et tout est effacé. <a href="/confidentialite">Lire la politique de confidentialité.</a></p>
      </li>
    </ul>
  </div>
</section>

<section class="wrap block" aria-labelledby="titre-etapes">
  <h2 id="titre-etapes" data-reveal>De ton projet à la réponse du client</h2>
  <ol class="steps compact">
    <li data-reveal><h3>Il lit ton projet</h3><p>Claude parcourt ton code sans rien modifier, puis écrit une fiche : ce que tu fais, pour qui, et pourquoi c'est utile.</p></li>
    <li data-reveal><h3>Tu choisis la cible</h3><p>Quels métiers, quelle région, quelle taille d'entreprise. Rien ne démarre tant que tu n'as pas dit oui.</p></li>
    <li data-reveal><h3>Il cherche des contacts</h3><p>Des adresses pro publiées sur le web, avec la page d'où elles viennent et une note de pertinence.</p></li>
    <li data-reveal><h3>Il écrit les mails</h3><p>Un mail, une variante pour tester, une relance. Tu corriges ce que tu veux, puis tu valides.</p></li>
    <li data-reveal><h3>Il envoie sans se presser</h3><p>Par petits lots, à la vitesse que tu fixes, avec une pause entre chaque mail pour rester naturel.</p></li>
    <li data-reveal><h3>Il suit les réponses</h3><p>Qui a répondu, qui relancer, quoi noter. Tu gardes une fiche par contact.</p></li>
  </ol>
  <p data-reveal><a class="textlink" href="/fonctionnement">Voir chaque étape en détail</a></p>
</section>

<section class="wrap block" aria-labelledby="titre-limites">
  <h2 id="titre-limites" data-reveal>Ce qu'AiTools ne fait pas</h2>
  <div class="statement">
    <p data-reveal>Il ne promet aucune réponse : un bon mail reste un mail envoyé à quelqu'un qui n'a rien demandé.</p>
    <p data-reveal>Il demande à Claude de ne garder que des adresses pro publiées au grand jour, sans jamais les deviner. Claude peut quand même se tromper : relis les fiches avant d'envoyer.</p>
    <p data-reveal>Il n'écrit pas aux particuliers, et il n'envoie rien dans ton dos : les premiers mails partent quand tu confirmes, la relance quand tu l'actives.</p>
  </div>
</section>

<div class="rule" aria-hidden="true"></div>

<section class="wrap block" aria-labelledby="titre-fin">
  <div class="closing" data-reveal>
    <div>
      <h2 id="titre-fin">Commence avec le plan gratuit</h2>
      <p>${FREE.projects} projet, ${FREE.prospects} contacts, ${FREE.mails} mails et ${FREE.aiJobs} tâches IA par mois. Des offres de ${euros(PLAN_PRICES.starter)} à ${euros(PLAN_PRICES.intensive)} TTC par mois arrivent, avec ${ANNUAL_FREE_MONTHS} mois offerts en annuel : <a href="/tarifs">tout est expliqué sur la page Tarifs</a>.</p>
    </div>
    <a class="btn primary" href="/login">Créer mon compte</a>
  </div>
</section>

${nextBlock(journey('how', 'pricing', 'login'))}`,
  });
}

// ---------- Fonctionnement ----------
export function howPage({ appUrl, apple = false }) {
  return siteLayout({
    appUrl, path: '/fonctionnement',
    title: 'Comment ça marche : de ton projet aux réponses · AiTools',
    description: "Comment AiTools lit ton projet, trouve des contacts, écrit et envoie les mails, relance et suit les réponses : étape par étape, avec ce qu'il ne sait pas faire.",
    body: `<div class="wrap page-head">
  <p class="eyebrow"><span class="mark" aria-hidden="true"></span>Fonctionnement</p>
  <h1>Comment ça marche, vraiment</h1>
  <p class="lead">Sept étapes, dans cet ordre. Pour chacune : ce que fait l'outil, ce que tu décides, et ce qu'il ne sait pas faire. Pour voir des images d'abord, passe par <a href="/#titre-galerie">la galerie de l'accueil</a>.</p>
</div>

<div class="rule" aria-hidden="true"></div>

<section class="wrap block" aria-label="Les étapes">
  <ol class="steps">
    <li id="etape-1" data-reveal>
      <h2>Tu relies ton accès à Claude</h2>
      <p>Tu te connectes avec ${providersText(apple)}, puis AiTools te demande ton propre accès à Claude. Tant que ce n'est pas fait, tu peux gérer ton compte, mais rien ne se lance.</p>
      <ul>
        <li>Soit une clé Anthropic (un code secret que tu crées sur ton compte Anthropic). Elle est vérifiée sans rien consommer, rangée sous clé, et on ne réaffiche que ses 4 derniers caractères.</li>
        <li>Soit ton abonnement Claude : tu cliques sur « Se connecter avec Claude », tu te connectes sur le site de Claude, tu recopies le petit code qu'il affiche, et AiTools récupère le jeton tout seul. Ça comporte un risque, détaillé sur la page <a href="/tarifs#acces-claude">Tarifs</a>.</li>
      </ul>
    </li>
    <li id="etape-2" data-reveal>
      <h2>Tu ajoutes un projet</h2>
      <p>Un projet, c'est l'adresse de ton code sur Git (l'endroit où il est rangé), sur le Forgejo que tu indiques dans les réglages. Si c'est privé, tu fournis un code d'accès en lecture seule. AiTools en fait une copie sur le serveur et Claude la lit : le README, les fichiers de description, les pages principales, une quinzaine de fichiers au plus.</p>
      <p>Il en sort une fiche : ce que fait ton produit, ce qu'il apporte, les arguments qui comptent, et une cible conseillée. Ça ne se fait qu'une fois, puis quand tu le demandes. Chaque tâche IA tourne dans un espace isolé qui ne voit que la copie de ton projet.</p>
    </li>
    <li id="etape-3" data-reveal>
      <h2>Tu valides la cible</h2>
      <p>La fiche propose une cible : une description, des métiers, une zone, une taille d'entreprise, la personne à contacter, des recherches à faire. Tu corriges ce qui ne va pas. Tant que tu n'as pas cliqué sur « Valider la cible », la recherche reste verrouillée.</p>
    </li>
    <li id="etape-4" data-reveal>
      <h2>Il cherche des contacts</h2>
      <p>Tu demandes de 1 à 50 contacts, tout de suite ou « cette nuit » (entre 1 h et 6 h, heure de Paris). Claude cherche sur le web. Il doit ne garder que des adresses pro publiées au grand jour, sans jamais les deviner, et noter la page exacte où il les a vues.</p>
      <p>Chaque fiche contient l'entreprise, l'adresse mail, le site, la ville, le métier, une phrase d'accroche écrite d'après leur site, la source et une note de 1 à 10. Les adresses de la liste d'opposition sont écartées. Tu peux aussi importer ta propre liste (un fichier CSV de 2 000 lignes au plus).</p>
      <p><strong>Ce qu'il ne sait pas faire :</strong> Claude peut se tromper d'adresse ou mal juger une entreprise. Relis les fiches.</p>
    </li>
    <li id="etape-5" data-reveal>
      <h2>Il écrit les mails</h2>
      <p>Claude propose un premier mail court, un deuxième objet pour comparer lequel marche le mieux (les envois alternent entre les deux), et un mail de relance. Tu modifies, tu enregistres, puis tu valides. Des mots-clés comme <code>{{entreprise}}</code>, <code>{{ville}}</code> et <code>{{accroche}}</code> personnalisent chaque mail.</p>
      <p>Le lien pour ne plus recevoir de mails, et la mention d'où vient l'adresse, sont ajoutés tout seuls à chaque envoi.</p>
    </li>
    <li id="etape-6" data-reveal>
      <h2>Il envoie, sans se presser</h2>
      <p>Tu choisis la taille de chaque lot (100 mails au plus) et tu confirmes. Les mails partent depuis ta messagerie, avec une pause au hasard entre deux envois (20 à 60 secondes au départ). Il y a des plafonds sur 24 heures : par projet (réglable, 200 au plus) et pour tout ton compte (réglable, 300 au plus). Un contact n'est écrit qu'une seule fois.</p>
      <p><strong>Ce qu'il ne sait pas faire :</strong> protéger la réputation de ton adresse d'envoi. Ça dépend de ton nom de domaine, et il vaut mieux commencer par de petits lots.</p>
    </li>
    <li id="etape-7" data-reveal>
      <h2>Il suit les réponses, et relance une fois</h2>
      <p>Si tu renseignes ta boîte de réception, AiTools la consulte toutes les 15 minutes. Une réponse passe le contact en « A répondu ». Les réponses automatiques (absence, vacances) sont ignorées. Un mail qui revient en erreur passe le contact en « Rejeté » et l'adresse part dans la liste d'opposition.</p>
      <p>La relance est facultative : tu l'actives, et il n'y en a qu'une, après le nombre de jours que tu choisis (7 au départ), dans la même conversation. Elle part seulement aux heures de bureau (du lundi au vendredi, de 9 h à 18 h, heure de Paris), si ta boîte a été consultée dans les deux dernières heures, et dans la limite des plafonds.</p>
      <p>Chaque contact a sa fiche : l'historique des mails, une prochaine action avec une date, des notes. Tu peux filtrer et exporter en CSV. Le récap affiche tes envois et tes réponses semaine par semaine.</p>
    </li>
  </ol>
  <p class="fine" data-reveal>En plus : un rapport par mail chaque semaine, des alertes sur Discord, et un bouton « Évolution » qui t'envoie par mail des idées d'améliorations tirées de ton propre code.</p>
</section>

<div class="rule" aria-hidden="true"></div>

<section class="wrap block" id="envois" aria-labelledby="titre-garde-fous">
  <div class="split">
    <div class="sticky" data-reveal>
      <h2 id="titre-garde-fous">Pour ne pas te faire déborder</h2>
      <p>Des limites que tu fixes toi-même, pour garder la main sur ton compte Claude et sur tes envois.</p>
    </div>
    <ul class="facts">
      <li data-reveal>
        <h3>Un budget que tu fixes</h3>
        <p>Tu peux limiter la dépense en IA sur 24 heures et sur 30 jours. Quand la limite est atteinte, les tâches IA attendent (elles ne sont pas perdues) et les envois continuent. Une tâche déjà commencée n'est jamais coupée : la limite peut donc être dépassée d'une tâche.</p>
      </li>
      <li data-reveal>
        <h3>Un œil sur ton quota</h3>
        <p>Avec un abonnement, la barre du haut montre ce que Claude indique lui-même comme quota restant. Au-delà de 85 %, l'analyse et les idées d'évolution sont reportées pour garder de la marge à la recherche de contacts.</p>
      </li>
      <li data-reveal>
        <h3>Des modèles économes au départ</h3>
        <p>La recherche et l'analyse utilisent Haiku par défaut (le plus léger). Tu passes à Sonnet dans les réglages si les fiches manquent de précision.</p>
      </li>
      <li data-reveal>
        <h3>Des envois encadrés</h3>
        <p>Pas de particuliers, un lien de désinscription dans chaque mail, une liste d'opposition respectée pour tout le monde. Les règles qui t'incombent sont rappelées sur la page <a href="/tarifs#envois">Tarifs</a>.</p>
      </li>
    </ul>
  </div>
</section>

<section class="wrap block" aria-labelledby="titre-suite">
  <div class="closing" data-reveal>
    <div>
      <h2 id="titre-suite">Prêt à essayer ?</h2>
      <p>Le plan gratuit suffit pour un premier projet. Les limites sont sur la page <a href="/tarifs">Tarifs</a>.</p>
    </div>
    <a class="btn primary" href="/login">Créer mon compte</a>
  </div>
</section>

${nextBlock(journey('home', 'pricing', 'login'))}`,
  });
}

// ---------- Tarifs ----------
export function pricingPage({ appUrl }) {
  return siteLayout({
    appUrl, path: '/tarifs',
    title: 'Tarifs : gratuit, puis 10 à 100 € par mois · AiTools',
    description: `Plan gratuit, puis des offres de ${PLAN_PRICES.starter} € à ${PLAN_PRICES.intensive} € TTC par mois, avec ${ANNUAL_FREE_MONTHS} mois offerts en annuel. Ton accès Claude est facturé à part, par Anthropic.`,
    body: `<div class="wrap page-head">
  <p class="eyebrow"><span class="mark" aria-hidden="true"></span>Tarifs</p>
  <h1>Gratuit pour commencer, de ${euros(PLAN_PRICES.starter)} à ${euros(PLAN_PRICES.intensive)} par mois ensuite</h1>
  <p class="lead">Le plan gratuit existe déjà. Les offres payantes arrivent : voici leurs prix, pour que tu saches où tu vas. Ton accès à Claude reste un coût à part, qui ne passe pas par AiTools, et c'est pour ça que nos prix sont bas.</p>
</div>

<section class="wrap" aria-label="Plans">
  <div class="billing">
    <input type="radio" name="billing" id="bill-month" checked>
    <label for="bill-month">Au mois</label>
    <input type="radio" name="billing" id="bill-year">
    <label for="bill-year">À l'année <span class="badge ok">${ANNUAL_FREE_MONTHS} mois offerts</span></label>
    <div class="plans plan-grid">
    <article class="card plan" aria-labelledby="plan-gratuit" data-reveal>
      <h2 id="plan-gratuit">Gratuit</h2>
      <p class="plan-blurb">Pour tout tester, sans carte bancaire.</p>
      <p class="price">0 €</p>
      <p class="price-sub">sans limite de durée</p>
      <ul class="limits">
        ${limitRows(FREE)}
      </ul>
      <a class="btn primary" href="/login">Créer mon compte</a>
    </article>
    ${PAID.map((k) => `<article class="card plan soon" aria-labelledby="plan-${k}" data-reveal>
      <h2 id="plan-${k}">${PLAN_LABELS[k]} <span class="badge warn">Bientôt</span></h2>
      <p class="plan-blurb">${PLAN_BLURBS[k]}</p>
      <p class="price when-month">${euros(PLAN_PRICES[k])} <small>par mois, TTC</small></p>
      <p class="price when-year">${euros(annualPrice(k))} <small>par an, TTC</small></p>
      <p class="price-sub when-month">payé chaque mois</p>
      <p class="price-sub when-year">soit ${euros(annualPrice(k) / 12)} par mois, ${ANNUAL_FREE_MONTHS} mois offerts</p>
      <ul class="limits">
        ${limitRows(PLAN_LIMITS[k])}
      </ul>
      <a class="btn" href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Me prévenir : offre ${PLAN_LABELS[k]}`)}">Me prévenir à l'ouverture</a>
    </article>`).join('\n    ')}
    </div>
  </div>
  <p class="fine plan-note">Prix TTC. L'éditeur est en franchise de TVA (art. 293 B du CGI) : le prix affiché est le prix payé. En annuel, tu paies ${12 - ANNUAL_FREE_MONTHS} mois et tu en profites 12. Les offres payantes ne sont pas encore ouvertes : rien n'est facturé aujourd'hui, et tu seras prévenu avant toute ouverture.</p>
  <p class="fine plan-note">Ces plafonds sont appliqués par le serveur. Les mails et les tâches IA se comptent par mois (heure de Paris) et repartent de zéro le 1er. Quand un plafond est atteint, la nouvelle action est refusée, mais rien n'est supprimé. Un compte ne peut pas envoyer plus de 300 mails par 24 heures, quelle que soit l'offre : c'est une protection pour la réputation de ton adresse.</p>
</section>

<section class="wrap block" id="acces-claude" aria-labelledby="titre-claude">
  <div class="split">
    <div class="sticky" data-reveal>
      <h2 id="titre-claude">Ton accès à Claude : deux façons, deux coûts</h2>
      <p>AiTools n'achète pas de Claude à ta place. Chaque tâche IA utilise ton accès à toi, et rien que le tien.</p>
    </div>
    <ul class="facts">
      <li data-reveal>
        <h3>Une clé Anthropic (recommandé)</h3>
        <p>Tu crées une clé sur console.anthropic.com. Anthropic te facture à l'usage, selon ses tarifs, sur ton compte. C'est la façon prévue pour brancher un outil comme celui-ci. Tu peux fixer une limite de dépense par jour et par mois dans les réglages d'AiTools.</p>
      </li>
      <li data-reveal>
        <h3>Ton abonnement Claude (Pro, Max), avec un risque</h3>
        <p>Tu cliques sur le bouton ci-dessous : un lien s'affiche en quelques secondes, tu te connectes à Claude, tu recopies le petit code qu'il te montre, et AiTools récupère le jeton tout seul. Pas de facture en plus, mais les règles d'Anthropic peuvent ne pas autoriser d'utiliser un abonnement à travers une application comme AiTools. Ton compte Claude pourrait être limité, suspendu ou fermé.</p>
        <p>AiTools ne peut pas l'empêcher et n'en est pas responsable. Une fenêtre d'avertissement et une case à cocher te le rappellent avant toute connexion, et ton accord est enregistré avec sa date. Lis les <a href="https://www.anthropic.com/legal/consumer-terms" rel="noopener noreferrer">conditions d'Anthropic</a> avant de choisir. Ce mode peut aussi être désactivé sur le service.</p>
        <p><a class="btn primary" href="/link?start=claude">Se connecter avec Claude</a></p>
        <p class="fine">Pas encore de compte AiTools ? Le bouton te demande d'abord de te connecter, puis te ramène ici.</p>
      </li>
    </ul>
  </div>
</section>

<section class="wrap block" id="envois" aria-labelledby="titre-envois">
  <div class="split">
    <div class="sticky" data-reveal>
      <h2 id="titre-envois">Tu restes responsable de tes envois</h2>
      <p>AiTools t'aide à rester dans les clous. Il ne remplace pas ta responsabilité d'expéditeur.</p>
    </div>
    <ul class="facts">
      <li data-reveal>
        <h3>Entre professionnels, pas aux particuliers</h3>
        <p>Écrire à un professionnel est en général possible sans son accord préalable, à condition que le message ait un lien avec son activité et qu'il puisse facilement dire stop. Pour un particulier, il faut son accord : n'utilise pas AiTools pour ça.</p>
      </li>
      <li data-reveal>
        <h3>Se désinscrire, et être respecté</h3>
        <p>Chaque mail contient un lien de désinscription en un clic. Une adresse qui se désinscrit, refuse ou rejette un mail entre dans une liste d'opposition qu'AiTools respecte pour tous les comptes.</p>
      </li>
      <li data-reveal>
        <h3>Dire d'où vient l'adresse</h3>
        <p>Chaque mail rappelle où l'adresse du destinataire a été trouvée. Pour les données de tes contacts, c'est toi le responsable : la <a href="/confidentialite">politique de confidentialité</a> et les <a href="/cgu">conditions d'utilisation</a> détaillent qui fait quoi.</p>
      </li>
    </ul>
  </div>
</section>

<section class="wrap block" aria-labelledby="titre-questions">
  <h2 id="titre-questions" data-reveal>Questions fréquentes</h2>
  <div class="statement" data-reveal>
    <h3>Faut-il une carte bancaire ?</h3>
    <p>Non. Le plan gratuit n'en demande pas, et le paiement n'existe pas encore dans l'outil.</p>
    <h3>Pourquoi des prix aussi bas ?</h3>
    <p>Parce que l'intelligence artificielle n'est pas dans notre facture : tu utilises ton propre accès à Claude. Tu ne paies donc à AiTools que l'outil (les projets, les contacts, les envois et le suivi), pas la machine qui réfléchit.</p>
    <h3>Que veut dire « ${ANNUAL_FREE_MONTHS} mois offerts » ?</h3>
    <p>En payant à l'année, tu règles ${12 - ANNUAL_FREE_MONTHS} mois et tu profites de 12. Par exemple ${PLAN_LABELS.growth} : ${euros(annualPrice('growth'))} par an au lieu de ${euros(PLAN_PRICES.growth * 12)}.</p>
    <h3>Comment fonctionne l'équipe ?</h3>
    <p>Tu invites des collègues par email, tu choisis ce que chacun peut faire (membre ou administrateur) et tu partages les projets que tu veux. Ils travaillent avec <em>ton</em> offre, ton SMTP et ton accès Claude : pas besoin d'abonnement pour eux. Le nombre de places dépend de l'offre.</p>
    <h3>Les prix incluent-ils la TVA ?</h3>
    <p>Oui, ce sont des prix TTC. L'éditeur est en franchise de TVA (art. 293 B du CGI), donc aucun supplément ne s'ajoute.</p>
    <h3>Puis-je supprimer mon compte ?</h3>
    <p>Oui, quand tu veux, depuis Mon compte. Ça efface tes projets, tes contacts, tes modèles, tes réglages et la copie de ton code. Seule la liste d'opposition, qui protège les personnes désinscrites, est gardée.</p>
    <h3>Combien me coûtera Claude ?</h3>
    <p>Ça dépend de ton usage et de ton contrat avec Anthropic. AiTools ne peut pas le prévoir à ta place, mais tu peux fixer un budget maximum. Pour comprendre ce qui consomme quoi, regarde <a href="/fonctionnement">comment ça marche</a>.</p>
  </div>
</section>

${nextBlock(journey('how', 'home', 'login'))}`,
  });
}
