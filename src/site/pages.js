// Pages publiques du site, d'après le design Claude Design (rendu serveur ; scripts : public/site.js pour les tarifs et le
// sommaire légal, plus la vérification anti-robot de la connexion). Les textes sont écrits en mots de tous les jours :
// rien ici ne promet un résultat, rien n'est chiffré au-delà de ce que le code fait réellement.
import { esc } from '../http.js';
import { brandMark } from '../assets.js';
import { siteLayout, ic, guest, CONTACT_EMAIL } from './layout.js';
import { PLAN_LIMITS, PLAN_PRICES, PLAN_LABELS, ANNUAL_FREE_MONTHS, annualPrice } from '../limits.js';

const FREE = PLAN_LIMITS.free;
/** Montant en euros à la française (« 8,33 € ») ; entier sans décimales. */
const euros = (n) => `${Number.isInteger(n) ? n : n.toFixed(2).replace('.', ',')} €`;
const PAID = Object.keys(PLAN_PRICES);
const PLAN_BLURBS = {
  starter: 'Pour lancer un premier vrai projet.',
  growth: 'Pour prospecter chaque semaine, sur plusieurs projets.',
  business: 'Pour une activité qui repose sur la prospection.',
  intensive: 'Pour le plus gros volume que le service permet.',
};
const fr = (n) => n.toLocaleString('fr-FR');
const limitRows = (l) => [
  ['Projets', l.projects], ['Contacts', fr(l.prospects)], ['Mails par mois', fr(l.mails)], ['Tâches IA par mois', l.aiJobs], ['Jobs IA simultanés', l.parallelJobs], ["Places d'équipe", l.seats],
].map(([label, v]) => `<li><span>${label}</span><b>${v}</b></li>`).join('\n          ');

/** « Google » ou « Google ou Apple » selon la configuration réelle de la connexion. */
export const providersText = (apple) => (apple ? 'Google ou Apple' : 'Google');

const btnArrow = (cls, href, label) => `<a class="btn ${cls}" href="${href}">${label}${ic('arrow')}</a>`;

// ---------- Connexion ----------
// Avec reCAPTCHA (clés configurées), la vérification se fait toute seule : public/captcha.js charge le script de Google
// dès l'ouverture de la page, et le jeton est produit au clic sur le bouton de connexion. Les boutons sont alors des
// formulaires POST qui portent le jeton ; sans reCAPTCHA, ce sont de simples liens.
function captchaBox(siteKey) {
  return `<div class="captcha" data-captcha data-sitekey="${esc(siteKey)}">
      <p class="fine" role="status" data-captcha-status>Vérification anti-robot en cours, ça prend une seconde…</p>
      <p><button type="button" class="btn btn-secondary" data-captcha-load hidden>Réessayer la vérification</button></p>
      <noscript><p class="msg msg-err">JavaScript est nécessaire pour la vérification anti-robot.</p></noscript>
    </div>`;
}

// Vrais logos des deux fournisseurs (Google : les quatre couleurs de la marque ; Apple : monochrome, il suit la couleur du texte)
const PROVIDERS = [['google', `<svg class="prov" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`, 'Google'], ['apple', `<svg class="prov" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>`, 'Apple']];
const loginButtons = ({ apple, captcha }) => PROVIDERS.filter(([k]) => k === 'google' || apple).map(([k, logo, name]) => {
  const inner = `${logo}Se connecter avec ${name}`;
  return captcha
    ? `<form method="post" action="/auth/${k}" data-captcha-form><input type="hidden" name="captcha" value=""><button class="btn btn-secondary btn-lg btn-block" disabled>${inner}</button></form>`
    : `<a class="btn btn-secondary btn-lg btn-block" href="/auth/${k}">${inner}</a>`;
}).join('\n      ');

export function loginPage({ appUrl, error = null, apple = false, bye = false, captcha = null }) {
  return siteLayout({
    appUrl, path: '/login', noindex: true, scripts: captcha ? ['/static/captcha.js'] : [],
    title: 'Connexion · AiTools',
    description: `Connecte-toi à AiTools avec ton compte ${providersText(apple)}. Ton compte est créé à la première connexion, sans mot de passe.`,
    body: `<div class="stage-p"><div class="wrap">
<section class="auth" aria-labelledby="c-h">
  ${brandMark()}
  <div>
    <h1 id="c-h">Connexion</h1>
    <p class="sub">Choisis le compte avec lequel tu te connectes. Ton compte se crée tout seul la première fois.</p>
  </div>
  ${bye ? '<p class="msg msg-ok" role="status">Ton compte et toutes ses données ont été supprimés.</p>' : ''}
  ${error ? `<p class="msg msg-err" role="alert">${esc(error)}</p>` : ''}
  ${captcha ? captchaBox(captcha.siteKey) : ''}
  <div class="auth-b">
      ${loginButtons({ apple, captcha })}
  </div>
  <p class="safe">${ic('shield')}Aucun mot de passe à créer ni à retenir.</p>
  ${captcha ? `<p class="fine">Ce site est protégé par Google reCAPTCHA, qui vérifie tout seul que tu es bien une personne (<a href="/confidentialite#destinataires">en savoir plus</a>). La <a href="https://policies.google.com/privacy" rel="noopener noreferrer">politique de confidentialité</a> et les <a href="https://policies.google.com/terms" rel="noopener noreferrer">conditions d'utilisation</a> de Google s'appliquent.</p>` : ''}
  <p class="fine">En continuant, tu acceptes les <a href="/cgu">CGU</a> et la <a href="/confidentialite">politique de confidentialité</a>. Tu veux d'abord comprendre ? Regarde <a href="/fonctionnement">comment ça marche</a> ou <a href="/tarifs">les tarifs</a>.</p>
</section>
</div></div>`,
  });
}

// ---------- 404 ----------
export function notFoundPage({ appUrl }) {
  return siteLayout({
    appUrl, path: '/404', noindex: true,
    title: 'Page introuvable · AiTools',
    description: "Cette page n'existe pas ou a changé d'adresse.",
    body: `<div class="stage-p"><div class="wrap">
<section class="nf" aria-labelledby="n-h">
  <p class="code">Erreur 404</p>
  <svg class="rib" aria-hidden="true" focusable="false" viewBox="0 0 160 24"><path d="M8 16 C40 2 70 26 100 12 S140 8 152 6" fill="none" stroke="url(#g-nf)" stroke-width="10" stroke-linecap="round"></path></svg>
  <h1 id="n-h">Cette page n'existe pas</h1>
  <p>Le lien est peut-être cassé, ou la page a été déplacée.</p>
  <div class="btns"><a class="btn btn-primary btn-lg" href="/">${ic('back')}Retour à l'accueil</a></div>
</section>
</div></div>`,
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

const badge = (cls, icon, text) => `<span class="badge${cls ? ` ${cls}` : ''}">${icon ? ic(icon) : ''}${text}</span>`;

// Maquette du tableau de bord : données d'exemple, clairement signalées comme telles
const HERO_MOCK = `<div class="art-hero">
  <div class="mock" role="img" aria-label="Maquette du tableau de bord : projet Atelier Exemple, cible validée, recherche de contacts à 64 %, trois contacts avec leurs statuts">
    <div class="mock-h">
      <div><p class="mock-t">Atelier Exemple</p><p class="mock-s">Menuiserie · Bretagne</p></div>
      ${badge('b-ok', 'check', 'Cible validée')}
    </div>
    <div>
      <div class="prog-h"><span>Recherche de contacts</span><span>64 %</span></div>
      <div class="track"><div class="bar"></div></div>
    </div>
    <div class="tw">
      <table>
        <thead><tr><th scope="col">Contact</th><th scope="col">Statut</th></tr></thead>
        <tbody>
          <tr><td>Boulangerie Exemple<span class="td-s">Rennes</span></td><td>${badge('b-info', 'mail', 'À contacter')}</td></tr>
          <tr><td>Cabinet Exemple<span class="td-s">Vannes</span></td><td>${badge('b-warn', 'clock', 'Contacté')}</td></tr>
          <tr><td>Garage Exemple<span class="td-s">Lorient</span></td><td>${badge('b-ok', 'reply', 'A répondu')}</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>`;

const BENEFITS = [
  ['mail', 'Prospection par mail avec ton propre Claude', 'Il trouve des entreprises qui te correspondent et prépare chaque mail.'],
  ['reply', 'Relance automatique dans le même fil', "Pas de réponse ? Si tu l'as activée, une seule relance arrive dans la même conversation."],
  ['eye', 'Suivi des réponses', "Tu vois en un coup d'œil qui a répondu, qui attend, qui reste à contacter."],
  ['pen', 'Posts LinkedIn écrits par Claude', 'Il rédige, tu relis et tu publies quand ça te va.'],
];
const STEPS = [
  ['Relie ton accès Claude', "Tu connectes ta propre clé Anthropic ou ton abonnement Claude. C'est ton accès qui travaille, pas celui d'AiTools."],
  ['Ajoute ton dépôt Git', 'GitHub ou ton propre serveur : Claude lit ton projet pour comprendre ce que tu proposes.'],
  ['Valide la cible', "Il te dit à qui il pense parler. Tu corriges, puis tu valides."],
  ['Lance la recherche', "Il trouve les contacts et écrit les mails. Tu les relis et tu confirmes l'envoi."],
];
const TRUST = (apple) => [
  ['shield', 'Rien ne part sans ton accord', "Le premier envoi attend ta confirmation, chaque post attend ton clic. La relance, c'est toi qui l'actives."],
  ['box', 'Tes données restent cloisonnées par compte', "Personne d'autre ne voit tes prospects ni tes brouillons. Un clic dans Mon compte et tout est effacé."],
  ['lock', 'Tes secrets sont chiffrés', 'Tes accès sont stockés chiffrés, jamais en clair.'],
  ['user', 'Aucun mot de passe', `Tu te connectes avec ${providersText(apple)}.`],
];

export function homePage({ appUrl, apple = false }) {
  return siteLayout({
    appUrl, path: '/',
    title: 'AiTools : trouve des clients par mail avec ton propre Claude',
    description: 'AiTools lit ton projet, trouve des entreprises qui pourraient avoir besoin de toi, écrit et envoie tes mails, relance et suit les réponses. Gratuit pour commencer.',
    jsonLd: HOME_JSON_LD(appUrl),
    body: `<section class="hero" aria-labelledby="h1">
  <div class="wrap hero-in">
    <div>
      <span class="eyebrow">${ic('check')}Tu valides avant le premier envoi</span>
      <h1 class="h1" id="h1">Trouve de nouveaux clients, sans y passer tes soirées</h1>
      <p class="lead">Claude cherche des entreprises, écrit les mails et suit les réponses pendant que toi, tu valides. Les mails partent de ta propre boîte.</p>
      <div class="hero-btns">
        ${guest('big', btnArrow('btn-primary btn-lg', '/login', 'Créer mon compte'))}
        <a class="btn btn-secondary btn-lg" href="/fonctionnement">${ic('down')}Voir comment ça marche</a>
      </div>
      <p class="hero-note">Gratuit pour commencer, sans carte bancaire. Connexion avec ${providersText(apple)}.</p>
    </div>
    ${HERO_MOCK}
  </div>
</section>

<section class="sec sec-alt" aria-labelledby="h-b">
  <div class="wrap">
    <h2 class="h2" id="h-b">Ce que Claude fait pour toi</h2>
    <div class="grid g4">
      ${BENEFITS.map(([i, t, p]) => `<article class="card"><span class="card-i">${ic(i)}</span><h3>${esc(t)}</h3><p>${esc(p)}</p></article>`).join('\n      ')}
    </div>
  </div>
</section>

<section class="sec" id="etapes" aria-labelledby="h-e">
  <div class="wrap">
    <h2 class="h2" id="h-e">Comment ça marche</h2>
    <p class="sec-lead">Quatre étapes, et la main reste chez toi du début à la fin.</p>
    <ol class="steps">
      ${STEPS.map(([t, p], i) => `<li><span class="num">${i + 1}</span><h3>${esc(t)}</h3><p>${esc(p)}</p></li>`).join('\n      ')}
    </ol>
    <a class="lnk" href="/fonctionnement">Voir chaque étape en détail${ic('arrow')}</a>
  </div>
</section>

<section class="sec sec-alt" aria-labelledby="h-c">
  <div class="wrap">
    <h2 class="h2" id="h-c">Tu gardes la main</h2>
    <p class="sec-lead">Rien ne part dans ton dos. Claude peut se tromper : relis les fiches avant d'envoyer, et n'écris qu'à des professionnels.</p>
    <div class="trust">
      ${TRUST(apple).map(([i, t, p]) => `<div class="tr"><span class="card-i">${ic(i)}</span><div><h3>${esc(t)}</h3><p>${esc(p)}</p></div></div>`).join('\n      ')}
    </div>
    <a class="lnk" href="/fonctionnement#envois">Voir comment les envois sont encadrés${ic('arrow')}</a>
  </div>
</section>

<section class="sec" id="tarifs" aria-labelledby="h-t">
  <div class="wrap">
    <h2 class="h2" id="h-t">Des tarifs simples</h2>
    <p class="sec-lead">Tu commences gratuitement, tu passes à un plan payant quand ça te rapporte.</p>
    <div class="price-g">
      <article class="card"><div class="ph"><h3>Gratuit</h3>${badge('b-ok', 'check', 'Disponible')}</div><p class="price">0 €</p>
        <ul class="list"><li>${ic('check')}${FREE.projects} projet, ${fr(FREE.prospects)} contacts, ${fr(FREE.mails)} mails et ${FREE.aiJobs} tâches IA par mois</li><li>${ic('check')}Sans carte bancaire, sans limite de durée</li></ul></article>
      <article class="card"><div class="ph"><h3>Plans payants</h3>${badge('', 'clock', 'Bientôt')}</div><p class="price">${PLAN_PRICES.starter} à ${PLAN_PRICES.intensive} € <small>TTC par mois</small></p>
        <ul class="list"><li>${ic('check')}${['Un', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six'][PAID.length - 1] ?? PAID.length} plans, de ${PLAN_LABELS[PAID[0]]} à ${PLAN_LABELS[PAID.at(-1)]}</li><li>${ic('check')}En annuel, ${ANNUAL_FREE_MONTHS} mois offerts</li></ul></article>
    </div>
    <p class="price-n">Ton accès à Claude est facturé à part, par Anthropic : AiTools n'achète pas de Claude à ta place.</p>
    <a class="lnk" href="/tarifs">Voir tous les tarifs${ic('arrow')}</a>
  </div>
</section>

<div class="wrap">
  <section class="cta" aria-labelledby="h-f">
    <div><h2 id="h-f">Prêt à remplir ton agenda ?</h2><p>Crée ton compte en une minute, avec ${providersText(apple)}.</p></div>
    ${guest('big', btnArrow('btn-primary btn-lg', '/login', 'Créer mon compte'))}
  </section>
</div>`,
  });
}

// ---------- Fonctionnement ----------
const shot = (label, inner) => `<div class="shot" role="img" aria-label="${esc(label)}">${inner}</div>`;
const how = ({ icon, title, tip, rev = false, n, text, mock }) => `<section class="stp${rev ? ' rev' : ''}" id="etape-${n}" aria-labelledby="e${n}">
  <div class="stp-t">
    <span class="num">${n}</span>
    <h2 id="e${n}">${esc(title)}</h2>
    ${text}
    ${tip ? `<p class="tip">${ic(icon)}${esc(tip)}</p>` : ''}
  </div>
  ${mock}
</section>`;

export function howPage({ appUrl, apple = false }) {
  const steps = [
    how({
      n: 1, icon: 'lock', tip: 'Tes accès sont stockés chiffrés.', title: 'Relie ton accès Claude',
      text: `<p>Tu te connectes avec ${providersText(apple)}, puis tu relies ton propre accès à Claude : une clé Anthropic, ou ton abonnement Claude (avec un risque à connaître, expliqué sur la page <a href="/tarifs#acces-claude">Tarifs</a>). C'est lui qui cherche, écrit et suit les réponses. Son coût est facturé à part, par Anthropic.</p>`,
      mock: shot('Maquette : accès Claude connecté, secret chiffré', `<div class="sh-h"><span class="sh-t">Accès Claude</span>${badge('b-ok', 'check', 'Connecté')}</div>
    <div class="row"><span class="row-l"><span class="ico">${ic('link')}</span><span><b>Ton compte Claude</b><span class="sh-s"> · facturé par Anthropic</span></span></span></div>
    <div class="row"><span class="row-l"><span class="ico">${ic('lock')}</span><span><b>Secret chiffré</b></span></span>${badge('b-info', '', 'Cloisonné par compte')}</div>`),
    }),
    how({
      n: 2, rev: true, title: 'Ajoute ton dépôt Git',
      text: `<p>GitHub, ou ton propre serveur (Forgejo, Gitea, GitLab) ajouté dans les réglages. Si le dépôt est privé, tu donnes un token en lecture seule. Claude lit le README, les fichiers de description et les pages principales (une quinzaine de fichiers au plus), sans rien modifier, dans un espace isolé. Il en sort une fiche : ce que tu proposes, à qui, et pourquoi.</p>`,
      mock: shot('Maquette : choix entre GitHub et mon serveur, champ adresse du dépôt', `<div class="sh-h"><span class="sh-t">Ton dépôt</span>${badge('', '', 'Étape 2 sur 4')}</div>
    <div class="opts"><span class="opt opt-on">${ic('git')}GitHub<span>Sélectionné</span></span><span class="opt">${ic('git')}Mon serveur<span>Adresse Git</span></span></div>
    <div><p class="lbl">Adresse du dépôt</p><span class="fld">github.com/ton-compte/ton-projet</span></div>`),
    }),
    how({
      n: 3, title: 'Valide la cible',
      text: `<p>Claude te dit à qui il pense parler : des métiers, une zone, une taille d'entreprise, la personne à contacter. Tu corriges ce qui ne va pas, puis tu valides. Tant que tu n'as pas cliqué sur « Valider la cible », la recherche reste verrouillée.</p>`,
      mock: shot('Maquette : cible proposée par Claude, à valider', `<div class="sh-h"><span class="sh-t">Atelier Exemple</span>${badge('b-warn', 'clock', 'Cible à valider')}</div>
    <p class="sh-s">Cible proposée par Claude</p>
    <div class="chips"><span class="chip">Menuisiers</span><span class="chip">Artisans du bâtiment</span><span class="chip">Bretagne</span></div>
    <div class="btns"><span class="btn btn-secondary">Modifier</span><span class="btn btn-primary">${ic('check')}Valider la cible</span></div>`),
    }),
    how({
      n: 4, rev: true, title: 'Lance la recherche, valide les mails',
      text: `<p>Claude trouve de 1 à 50 contacts à la fois, tout de suite ou « cette nuit ». Il doit ne garder que des adresses pro publiées au grand jour, sans jamais les deviner, et noter la page d'où elles viennent. Il peut se tromper : relis les fiches.</p>
    <p>Il écrit ensuite un mail court, un deuxième objet pour comparer, et une relance. Tu relis, tu ajustes, tu valides, puis tu confirmes chaque lot (100 mails au plus), envoyé depuis ta boîte avec une pause au hasard entre deux mails. La relance est facultative, il n'y en a qu'une. Les réponses se suivent dans le tableau de bord.</p>`,
      mock: shot('Maquette : recherche de contacts à 64 %, brouillon de mail à valider', `<div class="sh-h"><span class="sh-t">Atelier Exemple</span>${badge('b-ok', 'check', 'Cible validée')}</div>
    <div><div class="prog-h"><span>Recherche de contacts</span><span>64 %</span></div><div class="track"><div class="bar"></div></div></div>
    <div class="mail"><span class="mail-s">Objet : une idée pour ton atelier</span><span class="mail-p">Bonjour, j'ai vu votre atelier à Vannes…</span></div>
    <div class="btns"><span class="btn btn-secondary">Relire</span><span class="btn btn-primary">${ic('send')}Valider l'envoi</span></div>`),
    }),
  ].join('\n\n');

  const guards = [
    ['Un budget que tu fixes', "Tu peux limiter la dépense en IA sur 24 heures et sur 30 jours. Quand la limite est atteinte, les tâches IA attendent (elles ne sont pas perdues) et les envois continuent. Une tâche déjà commencée n'est jamais coupée."],
    ['Un œil sur ton quota', "Avec un abonnement, la barre du haut montre le quota restant que Claude indique lui-même. Au-delà de 85 %, l'analyse et les idées d'évolution sont reportées pour garder de la marge à la recherche de contacts."],
    ['Des envois encadrés', "Pas de particuliers, un lien de désinscription dans chaque mail, une liste d'opposition respectée pour tout le monde, des plafonds sur 24 heures par projet et pour tout ton compte. Les règles qui t'incombent sont rappelées sur la page <a href=\"/tarifs#envois\">Tarifs</a>."],
    ['Des modèles économes au départ', 'La recherche, l\'analyse et la rédaction utilisent Haiku par défaut (le plus léger). Dans les réglages, tu choisis un autre modèle Claude pour chacune, et tu adaptes les consignes à chaque modèle.'],
  ];

  return siteLayout({
    appUrl, path: '/fonctionnement',
    title: 'Comment ça marche : de ton projet aux réponses · AiTools',
    description: "Comment AiTools lit ton projet, trouve des contacts, écrit et envoie les mails, relance et suit les réponses : étape par étape, avec ce qu'il ne sait pas faire.",
    body: `<div class="page">
<div class="wrap">
  <h1 class="h1">Comment ça marche, pas à pas</h1>
  <p class="lead">Quatre étapes. À chacune, tu vois ce que Claude prépare, et rien ne part sans ton accord.</p>

${steps}

  <section class="guard" id="envois" aria-labelledby="h-g">
    <h2 class="h2 block-h" id="h-g">Pour ne pas te faire déborder</h2>
    <div class="grid g2">
      ${guards.map(([t, p]) => `<article class="card"><h3>${esc(t)}</h3><p>${p}</p></article>`).join('\n      ')}
    </div>
  </section>

  <section class="cta" aria-labelledby="h-f">
    <div><h2 id="h-f">Prêt à essayer ?</h2><p>Le plan Gratuit te laisse tout tester, sans carte bancaire.</p></div>
    <div class="cta-b">${guest('big', btnArrow('btn-primary btn-lg', '/login', 'Créer mon compte'))}<a class="btn btn-secondary btn-lg" href="/tarifs">Voir les tarifs</a></div>
  </section>
</div>
</div>`,
  });
}

// ---------- Tarifs ----------
const FAQ = [
  ['Faut-il une carte bancaire ?', 'Non. Le plan gratuit n\'en demande pas, et le paiement n\'existe pas encore dans l\'outil.'],
  ['Quand puis-je passer à un plan payant ?', 'Les plans payants ne sont pas encore ouverts : rien n\'est facturé aujourd\'hui, et tu seras prévenu avant toute ouverture. Le plan Gratuit te permet de tout tester dès maintenant.'],
  ['Dois-je fournir mon propre accès à Claude ?', 'Oui. Ton accès à Claude est facturé à part, par Anthropic : AiTools n\'achète pas de Claude à ta place. C\'est ce qui explique les prix bas : tu ne paies à AiTools que l\'outil (les projets, les contacts, les envois et le suivi), pas la machine qui réfléchit.'],
  ['Combien me coûtera Claude ?', 'Ça dépend de ton usage et de ton contrat avec Anthropic. AiTools ne peut pas le prévoir à ta place, mais tu peux fixer un budget maximum dans les réglages. Pour comprendre ce qui consomme quoi, regarde <a href="/fonctionnement">comment ça marche</a>.'],
  ['Que se passe-t-il quand j\'atteins un plafond ?', 'La nouvelle action est refusée, mais rien n\'est supprimé. Les plafonds repartent de zéro le 1er du mois, à l\'heure de Paris.'],
  [`Que veut dire « ${ANNUAL_FREE_MONTHS} mois offerts » ?`, `En payant à l'année, tu règles ${12 - ANNUAL_FREE_MONTHS} mois et tu profites de 12. Par exemple ${PLAN_LABELS.growth} : ${euros(annualPrice('growth'))} par an au lieu de ${euros(PLAN_PRICES.growth * 12)}.`],
  ["Comment fonctionne l'équipe ?", "Tu invites des collègues par email, tu choisis ce que chacun peut faire (membre ou administrateur) et tu partages les projets que tu veux. Ils travaillent avec <em>ton</em> offre, ton SMTP et ton accès Claude : pas besoin d'abonnement pour eux. Le nombre de places dépend de l'offre."],
  ['Les prix incluent-ils la TVA ?', 'Oui, ce sont des prix TTC. L\'éditeur est en franchise de TVA (art. 293 B du CGI), donc aucun supplément ne s\'ajoute.'],
  ['Puis-je supprimer mon compte ?', 'Oui, quand tu veux, depuis Mon compte. Ça efface tes projets, tes contacts, tes modèles, tes réglages et la copie de ton code. Seule la liste d\'opposition, qui protège les personnes désinscrites, est gardée.'],
];

export function pricingPage({ appUrl }) {
  const paidPlan = (k) => `<article class="plan" aria-labelledby="plan-${k}">
        <div class="ph"><h2 id="plan-${k}">${PLAN_LABELS[k]}</h2>${badge('b-info', 'clock', 'Bientôt')}</div>
        <p class="tag">${PLAN_BLURBS[k]}</p>
        <div>
          <p class="price when-month">${euros(PLAN_PRICES[k])} <small>par mois, TTC</small></p>
          <p class="price when-year">${euros(annualPrice(k))} <small>par an, TTC</small></p>
          <p class="sub when-month">ou ${euros(annualPrice(k))} par an, ${ANNUAL_FREE_MONTHS} mois offerts</p>
          <p class="sub when-year">soit ${euros(annualPrice(k) / 12)} par mois, ${ANNUAL_FREE_MONTHS} mois offerts</p>
        </div>
        <ul class="lim">
          ${limitRows(PLAN_LIMITS[k])}
        </ul>
        <a class="btn btn-secondary" href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Me prévenir : offre ${PLAN_LABELS[k]}`)}">Me prévenir à l'ouverture</a>
      </article>`;
  return siteLayout({
    appUrl, path: '/tarifs',
    title: 'Tarifs : gratuit, puis 10 à 100 € par mois · AiTools',
    description: `Plan gratuit, puis des offres de ${PLAN_PRICES.starter} € à ${PLAN_PRICES.intensive} € TTC par mois, avec ${ANNUAL_FREE_MONTHS} mois offerts en annuel. Ton accès Claude est facturé à part, par Anthropic.`,
    body: `<div class="page">
<div class="wrap">
  <h1 class="h1">Des tarifs simples, sans surprise</h1>
  <p class="lead">Un plan gratuit pour tout tester. Les plans payants arrivent bientôt, de ${euros(PLAN_PRICES.starter)} à ${euros(PLAN_PRICES.intensive)} TTC par mois.</p>

  <div class="claude-n" role="note">
    ${ic('info')}
    <p><b>Ton accès à Claude est facturé à part, par Anthropic : AiTools n'achète pas de Claude à ta place.</b><span>C'est ce qui explique les prix bas.</span></p>
  </div>

  <div class="bill" data-bill hidden>
    <div class="seg" role="group" aria-label="Période de facturation">
      <button class="seg-b" type="button" data-period="month" aria-pressed="true">Au mois</button>
      <button class="seg-b" type="button" data-period="year" aria-pressed="false">À l'année</button>
    </div>
    ${badge('b-ok', 'check', `${ANNUAL_FREE_MONTHS} mois offerts`)}
  </div>

  <div class="plans" data-billing="month">
      <article class="plan plan-free" aria-labelledby="plan-gratuit">
        <div class="ph"><h2 id="plan-gratuit">Gratuit</h2>${badge('b-ok', 'check', 'Disponible')}</div>
        <p class="tag">Pour tout tester, sans carte bancaire.</p>
        <div><p class="price">0 €</p><p class="sub">Sans limite de durée</p></div>
        <ul class="lim">
          ${limitRows(FREE)}
        </ul>
        ${guest('plan', '<a class="btn btn-primary" href="/login">Créer mon compte</a>')}
      </article>
      ${PAID.map(paidPlan).join('\n      ')}
  </div>

  <div class="mentions">
    <p>Prix TTC. L'éditeur est en franchise de TVA (art. 293 B du CGI) : le prix affiché est le prix payé. En annuel, tu paies ${12 - ANNUAL_FREE_MONTHS} mois et tu en profites 12. Les offres payantes ne sont pas encore ouvertes : rien n'est facturé aujourd'hui, et tu seras prévenu avant toute ouverture.</p>
    <p>Ces plafonds sont appliqués par le serveur. Les mails et les tâches IA se comptent par mois (heure de Paris) et repartent de zéro le 1er. Quand un plafond est atteint, la nouvelle action est refusée, mais rien n'est supprimé. Un compte ne peut pas envoyer plus de 300 mails par 24 heures, quelle que soit l'offre : c'est une protection pour la réputation de ton adresse.</p>
  </div>

  <section class="more" id="acces-claude" aria-labelledby="h-claude">
    <h2 class="h2 block-h" id="h-claude">Ton accès à Claude : deux façons, deux coûts</h2>
    <div class="grid g2">
      <article class="card">
        <h3>Une clé Anthropic (recommandé)</h3>
        <p>Tu crées une clé sur console.anthropic.com. Anthropic te facture à l'usage, selon ses tarifs, sur ton compte. C'est la façon prévue pour brancher un outil comme celui-ci. Tu peux fixer une limite de dépense par jour et par mois dans les réglages d'AiTools.</p>
      </article>
      <article class="card">
        <h3>Ton abonnement Claude (Pro, Max), avec un risque</h3>
        <p>Tu te connectes à Claude, tu recopies le petit code qu'il te montre, et AiTools récupère le jeton tout seul. Pas de facture en plus, mais les règles d'Anthropic peuvent ne pas autoriser d'utiliser un abonnement à travers une application comme AiTools. Ton compte Claude pourrait être limité, suspendu ou fermé.</p>
        <p>AiTools ne peut pas l'empêcher et n'en est pas responsable. Une fenêtre d'avertissement et une case à cocher te le rappellent avant toute connexion, et ton accord est enregistré avec sa date. Lis les <a href="https://www.anthropic.com/legal/consumer-terms" rel="noopener noreferrer">conditions d'Anthropic</a> avant de choisir. Ce mode peut aussi être désactivé sur le service.</p>
        <a class="btn btn-secondary" href="/link?start=claude">Se connecter avec Claude</a>
        <p class="fine">Pas encore de compte AiTools ? Le bouton te demande d'abord de te connecter, puis te ramène ici.</p>
      </article>
    </div>
  </section>

  <section class="more" id="envois" aria-labelledby="h-envois">
    <h2 class="h2 block-h" id="h-envois">Tu restes responsable de tes envois</h2>
    <p class="sec-lead">AiTools t'aide à rester dans les clous. Il ne remplace pas ta responsabilité d'expéditeur.</p>
    <div class="grid g3">
      <article class="card">
        <h3>Entre professionnels, pas aux particuliers</h3>
        <p>Écrire à un professionnel est en général possible sans son accord préalable, à condition que le message ait un lien avec son activité et qu'il puisse facilement dire stop. Pour un particulier, il faut son accord : n'utilise pas AiTools pour ça.</p>
      </article>
      <article class="card">
        <h3>Se désinscrire, et être respecté</h3>
        <p>Chaque mail contient un lien de désinscription en un clic. Une adresse qui se désinscrit, refuse ou rejette un mail entre dans une liste d'opposition qu'AiTools respecte pour tous les comptes.</p>
      </article>
      <article class="card">
        <h3>Dire d'où vient l'adresse</h3>
        <p>Chaque mail rappelle où l'adresse du destinataire a été trouvée. Pour les données de tes contacts, c'est toi le responsable : la <a href="/confidentialite">politique de confidentialité</a> et les <a href="/cgu">conditions d'utilisation</a> détaillent qui fait quoi.</p>
      </article>
    </div>
  </section>

  <section class="faq" aria-labelledby="faq-h">
    <h2 class="h2" id="faq-h">Questions fréquentes</h2>
    <div class="acc">
      ${FAQ.map(([q, a], i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(q)}${ic('chev')}</summary><p class="acc-b">${a}</p></details>`).join('\n      ')}
    </div>
  </section>
</div>
</div>`,
  });
}
