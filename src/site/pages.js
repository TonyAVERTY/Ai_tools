// Pages publiques du site (direction artistique : docs/DESIGN.md) (rendu serveur ; scripts : public/site.js pour les tarifs et le
// sommaire légal, plus la vérification anti-robot de la connexion). Les textes sont écrits en mots de tous les jours :
// rien ici ne promet un résultat, rien n'est chiffré au-delà de ce que le code fait réellement.
import { esc } from '../http.js';
import { brandMark, assetUrl } from '../assets.js';
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
const LIMIT_COLS = [['Projets', (l) => l.projects], ['Contacts', (l) => fr(l.prospects)], ['Mails par mois', (l) => fr(l.mails)], ['Tâches IA par mois', (l) => l.aiJobs], ['Jobs IA simultanés', (l) => l.parallelJobs], ["Places d'équipe", (l) => l.seats]];
const limitCells = (l) => LIMIT_COLS.map(([label, f]) => `<td data-label="${label}"><b>${f(l)}</b></td>`).join('');

/** « Google » ou « Google ou Apple » selon la configuration réelle de la connexion. */
export const providersText = (apple) => (apple ? 'Google ou Apple' : 'Google');

const btn = (cls, href, label) => `<a class="btn ${cls}" href="${href}">${label}</a>`;

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
    title: 'Connexion · iaboss',
    description: `Connecte-toi à iaboss avec ton compte ${providersText(apple)}. Ton compte est créé à la première connexion, sans mot de passe.`,
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
  <p class="safe">${ic('shield')}Tu te connectes en un clic avec ${providersText(apple)}.</p>
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
    title: 'Page introuvable · iaboss',
    description: "Cette page n'existe pas ou a changé d'adresse.",
    body: `<div class="stage-p"><div class="wrap">
<section class="nf" aria-labelledby="n-h">
  <h1 id="n-h">Cette page n'existe pas</h1>
  <p>Le lien est peut-être cassé, ou la page a changé d'adresse. Voilà où aller :</p>
  <ul class="nf-links"><li><a href="/">Accueil</a></li><li><a href="/fonctionnement">Comment ça marche</a></li><li><a href="/tarifs">Tarifs</a></li><li><a href="/docs">Documentation</a></li></ul>
</section>
</div></div>`,
  });
}

// ---------- Accueil ----------
const HOME_JSON_LD = (appUrl) => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'iaboss',
  url: `${appUrl}/`,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  inLanguage: 'fr',
  description: 'Panel qui pilote ton IA (Claude, ChatGPT ou Gemini) pour analyser un projet, trouver des prospects, rédiger et envoyer des mails de prospection, relancer et suivre les réponses.',
  offers: [
    { '@type': 'Offer', name: 'Gratuit', price: '0', priceCurrency: 'EUR', description: `Plan gratuit : ${FREE.projects} projet, ${FREE.prospects} prospects, ${FREE.mails} mails et ${FREE.aiJobs} jobs IA par mois` },
    ...PAID.map((k) => ({ '@type': 'Offer', name: PLAN_LABELS[k], price: String(PLAN_PRICES[k]), priceCurrency: 'EUR', description: `${PLAN_LABELS[k]} : ${PLAN_PRICES[k]} € TTC par mois, ou ${annualPrice(k)} € TTC par an (${ANNUAL_FREE_MONTHS} mois offerts)` })),
  ],
  publisher: { '@type': 'Person', name: 'Tony AVERTY' },
});

const badge = (cls, icon, text) => `<span class="badge${cls ? ` ${cls}` : ''}">${icon ? ic(icon) : ''}${text}</span>`;

// La lettre d'exemple : le produit réel (un mail préparé pour un prospect, l'accroche tirée de son site, la validation avant l'envoi).
// Entreprise, adresse et contenu sont fictifs et signalés comme tels.
const LETTER = `<figure class="v-letter" aria-labelledby="lt-cap">
  <figcaption class="v-letter-cap" id="lt-cap">Exemple fictif : un mail préparé pour un cabinet de kinésithérapie.</figcaption>
  <dl class="v-letter-head">
    <dt>À</dt><dd class="mono">accueil@cabinet-exemple.fr</dd>
    <dt>Objet</dt><dd>Vos patients qui appellent pour décaler un rendez-vous</dd>
  </dl>
  <div class="v-letter-body">
    <p>Bonjour,</p>
    <p><mark>Sur votre site, vous demandez de téléphoner pour déplacer un rendez-vous.</mark> Agenda Kiné laisse vos patients le faire seuls, et leur envoie le rappel à votre place.</p>
    <p>Je peux vous montrer ça en dix minutes ?</p>
    <p>Tony</p>
  </div>
  <p class="v-note"><b>Accroche tirée de leur site.</b> L'IA cite une phrase de la page « Contact » du cabinet pour que le mail ne ressemble pas à un envoi en masse.</p>
  <div class="v-letter-foot"><span class="v-flag">${ic('clock')}À valider</span><span>Rien ne part tant que tu n'as pas relu et confirmé.</span></div>
</figure>`;

const FACTS = [
  ['Il cherche des entreprises', "À partir de ton dépôt, il repère celles qui pourraient avoir besoin de ton projet, ne garde que des adresses professionnelles publiées au grand jour, et note la page d'où vient chacune."],
  ['Il écrit chaque mail', "Un mail court par entreprise, avec une accroche tirée de son site. Tu relis, tu corriges, tu valides."],
  ['Il relance une fois', "Pas de réponse ? Si tu l'as activée, une seule relance part dans la même conversation."],
  ['Il suit les réponses', "Tu vois qui a répondu, qui attend et qui reste à contacter, sans ouvrir ta boîte pour le savoir."],
  ['Il écrit tes posts LinkedIn', "Il rédige, tu relis et tu publies quand ça te va."],
  ['Il prépare tes devis', "Quand un prospect dit oui, le devis, l'acompte et la facture se font depuis le même projet."],
];
// Du premier mail à la facture : la suite logique, dans l'application
const CHAIN = [
  ['01', 'Prospecter', 'La cible, les contacts et les mails, relus par toi.'],
  ['02', 'Suivre', 'Les réponses et les rendez-vous, sans ouvrir ta boîte.'],
  ['03', 'Facturer', 'Devis, acompte, facture et avoir, rattachés au projet.'],
  ['04', 'Encaisser', 'Ce qui reste à encaisser, marqué payé en un clic.'],
  ['05', 'Déclarer', 'Le montant à saisir sur ta déclaration URSSAF.'],
];
const STEPS = [
  ['Relie ton IA', "Tu choisis Claude, ChatGPT ou Gemini et tu connectes ta propre clé ou ton compte."],
  ['Ajoute ton dépôt Git', 'GitHub ou ton propre serveur : ton IA lit ton projet pour comprendre ce que tu proposes.'],
  ['Valide la cible', "Il te dit à qui il pense parler. Tu corriges, puis tu valides."],
  ['Lance la recherche', "Il trouve les contacts et écrit les mails. Tu les relis et tu confirmes l'envoi."],
];
const TRUST = (apple) => [
  ['Rien ne part sans ton accord', "Le premier envoi attend ta confirmation, chaque post attend ton clic."],
  ['Tes données restent cloisonnées', "Personne d'autre ne voit tes prospects ni tes brouillons."],
  ['Tes secrets sont chiffrés', 'Tes accès sont stockés chiffrés, jamais affichés en clair.'],
  ['Une connexion en un clic', `Tu te connectes avec ${providersText(apple)}, sans mot de passe à retenir.`],
];

const planLimits = (l) => LIMIT_COLS.map(([label, f]) => [label, f(l)]);
// Une carte par offre payante : prix selon la période (public/site.js bascule data-billing), plafonds, prévenir à l'ouverture
const planCard = (k) => `<article class="v-plan${k === 'growth' ? ' v-plan-hi' : ''}" aria-labelledby="pc-${k}">
        <div class="v-plan-h"><h3 id="pc-${k}">${PLAN_LABELS[k]}</h3><span class="v-flag v-flag-n">Bientôt</span></div>
        <p class="v-plan-p"><span class="when-month">${euros(PLAN_PRICES[k])}<small>par mois, TTC</small></span><span class="when-year">${euros(annualPrice(k))}<small>par an, TTC (${12 - ANNUAL_FREE_MONTHS} mois payés)</small></span></p>
        <p class="v-plan-t">${PLAN_BLURBS[k]}</p>
        <dl class="v-plim">${planLimits(PLAN_LIMITS[k]).map(([lab, v]) => `<div><dt>${lab}</dt><dd>${v}</dd></div>`).join('')}</dl>
        <a class="btn btn-secondary" href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Me prévenir : offre ${PLAN_LABELS[k]}`)}">Me prévenir à l'ouverture</a>
      </article>`;
const HOME_FAQ = [
  ['Faut-il une carte bancaire ?', "Non. Le plan Gratuit s'ouvre sans carte bancaire et sans limite de durée."],
  ['Dois-je fournir mon propre accès à une IA ?', "Oui, Claude, ChatGPT ou Gemini au choix. Ton accès est facturé par son fournisseur, directement à toi : c'est ce qui explique les prix bas."],
  ['Mon projet doit-il avoir un dépôt Git ?', "Oui. Ton IA lit ton dépôt (GitHub ou ton propre serveur) pour comprendre ce que tu proposes, sans rien y modifier."],
  ['Les mails partent-ils tout seuls ?', "Non. Chaque lot attend ta confirmation, et les mails partent de ta propre boîte, avec un lien de désinscription. Tu n'écris qu'à des professionnels."],
  ['Puis-je facturer mes clients avec iaboss ?', "Oui : devis, acompte, facture et avoir, rattachés au projet, puis le suivi des encaissements et le montant à déclarer à l'URSSAF."],
  ["Que se passe-t-il quand j'atteins un plafond ?", "La nouvelle action est refusée, mais rien n'est supprimé. Les plafonds repartent de zéro le 1er du mois, à l'heure de Paris."],
];

export function homePage({ appUrl, apple = false }) {
  return siteLayout({
    appUrl, path: '/',
    title: 'iaboss : trouve des clients par mail avec ta propre IA',
    description: 'iaboss lit ton projet, trouve des entreprises qui pourraient avoir besoin de toi, écrit et envoie tes mails, relance et suit les réponses. Gratuit pour commencer.',
    jsonLd: HOME_JSON_LD(appUrl),
    body: `<section class="v-hero" aria-labelledby="h1">
  <div class="wrap v-hero-g">
    <div class="v-hero-t">
      <h1 class="v-h1" id="h1">Ton IA écrit tes mails de prospection. Toi, tu les relis et tu les signes.</h1>
      <p class="v-lead-xl">Pour les indépendants qui vendent un projet. iaboss part de ton dépôt Git, cherche des entreprises qui pourraient avoir besoin de ton projet et prépare un mail pour chacune. Les mails partent de ta propre boîte, et jamais sans ton accord.</p>
      <div class="v-btns">
        ${guest('big', btn('btn-primary btn-lg', '/login', 'Créer mon compte'))}
        <a class="btn btn-secondary btn-lg" href="#etapes">Voir comment ça marche</a>
      </div>
      <p class="v-fine">Gratuit pour commencer, sans carte bancaire. Connexion avec ${providersText(apple)}.</p>
    </div>
    ${LETTER}
  </div>
</section>

<section class="v-sec v-paper" aria-labelledby="h-b">
  <div class="wrap v-split">
    <div class="v-split-h">
      <h2 class="v-h2" id="h-b">Ce que ton IA fait pour toi</h2>
      <p class="v-lead v-narrow">Elle travaille avec ton propre accès, Claude, ChatGPT ou Gemini, pendant que tu fais autre chose.</p>
    </div>
    <dl class="v-facts">
      ${FACTS.map(([t, p]) => `<div><dt>${esc(t)}</dt><dd>${esc(p)}</dd></div>`).join('\n      ')}
    </dl>
  </div>
</section>

<section class="v-sec" id="suite" aria-labelledby="h-x">
  <div class="wrap v-stack">
    <h2 class="v-h2" id="h-x">Du premier mail à la facture</h2>
    <p class="v-lead">Quand un prospect dit oui, tu continues au même endroit : devis, facture, encaissement et déclaration.</p>
    <ol class="v-chain">
      ${CHAIN.map(([n, t, p]) => `<li><span class="v-n">${n}</span><h3>${esc(t)}</h3><p>${esc(p)}</p></li>`).join('\n      ')}
    </ol>
  </div>
</section>

<section class="v-sec v-edge" id="etapes" aria-labelledby="h-e">
  <div class="wrap v-stack">
    <h2 class="v-h2" id="h-e">Comment ça marche</h2>
    <p class="v-lead">Quatre étapes, et la main reste chez toi du début à la fin.</p>
    <ol class="v-steps">
      ${STEPS.map(([t, p], i) => `<li><span class="v-step-n">${i + 1}</span><h3>${esc(t)}</h3><p>${esc(p)}</p></li>`).join('\n      ')}
    </ol>
    <a class="v-link" href="/fonctionnement">Voir chaque étape en détail</a>
  </div>
</section>

<section class="v-sec v-ink" aria-labelledby="h-c">
  <div class="wrap v-stack">
    <h2 class="v-h2" id="h-c">Tu gardes la main</h2>
    <p class="v-lead">Une IA peut se tromper : relis les fiches avant d'envoyer, et n'écris qu'à des professionnels.</p>
    <div class="v-trust">
      ${TRUST(apple).map(([t, p]) => `<div><h3>${esc(t)}</h3><p>${esc(p)}</p></div>`).join('\n      ')}
    </div>
    <a class="v-link" href="/fonctionnement#envois">Voir comment les envois sont encadrés</a>
  </div>
</section>

<section class="v-sec" id="tarifs" aria-labelledby="h-t">
  <div class="wrap v-stack v-stack-l">
    <div class="v-row">
      <div class="v-stack">
        <h2 class="v-h2" id="h-t">Des tarifs simples</h2>
        <p class="v-lead">Seul le plan Gratuit est ouvert aujourd'hui. Les ${['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six'][PAID.length] || PAID.length} plans payants ouvrent prochainement.</p>
      </div>
      <div class="v-bill" data-bill hidden>
        <div class="v-seg" role="group" aria-label="Période de facturation">
          <button class="seg-b" type="button" data-period="month" aria-pressed="true">Au mois</button>
          <button class="seg-b" type="button" data-period="year" aria-pressed="false">À l'année</button>
        </div>
        <span class="v-flag v-flag-ok">${ic('check')}${ANNUAL_FREE_MONTHS} mois offerts à l'année</span>
      </div>
    </div>
    <div class="v-plans" data-billing="month">
      <article class="v-free" aria-labelledby="pc-free">
        <div class="v-free-t">
          <div class="v-plan-h"><h3 id="pc-free">Gratuit</h3><span class="v-flag v-flag-ok">${ic('check')}Disponible</span></div>
          <p class="v-free-p"><b>0 €</b> · sans limite de durée, sans carte bancaire</p>
        </div>
        <ul class="v-free-l">${planLimits(FREE).map(([k, v]) => `<li><b>${v}</b><span>${k}</span></li>`).join('')}</ul>
        ${guest('plan', '<a class="btn btn-primary" href="/login">Créer mon compte</a>')}
      </article>
      <div class="v-plan-g">
        ${PAID.map(planCard).join('\n        ')}
      </div>
    </div>
    <p class="v-small">Prix TTC : l'éditeur est en franchise de TVA (art. 293 B du CGI). Ton accès à l'IA est facturé par son fournisseur (Anthropic, OpenAI ou Google), directement à toi. Un compte n'envoie jamais plus de 300 mails par 24 heures, quelle que soit l'offre.</p>
    <a class="v-link" href="/tarifs">Voir tous les tarifs</a>
  </div>
</section>

<section class="v-sec v-edge" aria-labelledby="faq-h">
  <div class="wrap v-faq-g">
    <h2 class="v-h2" id="faq-h">Questions fréquentes</h2>
    <div class="v-faq">
      ${HOME_FAQ.map(([q, a], i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n      ')}
    </div>
  </div>
</section>

<div class="wrap v-end-w">
  <section class="v-end" aria-labelledby="h-f">
    <div><h2 id="h-f">Essaie sur un de tes projets</h2><p>Crée ton compte avec ${providersText(apple)}, ajoute un dépôt et regarde ce que ton IA prépare. Rien ne part sans ta validation.</p></div>
    ${guest('big', btn('btn-primary btn-lg', '/login', 'Créer mon compte'))}
  </section>
</div>`,
  });
}

// ---------- Fonctionnement ----------
const shot = (label, inner) => `<div class="shot" role="img" aria-label="${esc(label)}">${inner}</div>`;
const how = ({ icon, title, tip, rev = false, n, text, mock }) => `<section class="stp${rev ? ' rev' : ''}" id="etape-${n}" aria-labelledby="e${n}">
  <div class="stp-t">
    <span class="num" aria-hidden="true">${n}</span>
    <h2 id="e${n}">${esc(title)}</h2>
    ${text}
    ${tip ? `<p class="tip">${ic(icon)}${esc(tip)}</p>` : ''}
  </div>
  ${mock}
</section>`;

export function howPage({ appUrl, apple = false }) {
  const steps = [
    how({
      n: 1, icon: 'lock', tip: 'Tes accès sont stockés chiffrés.', title: 'Relie ton IA',
      text: `<p>Tu te connectes avec ${providersText(apple)}, puis tu choisis ton IA, Claude, ChatGPT ou Gemini, et tu relies ton propre accès : une clé API, ou ton abonnement quand l'IA le permet (avec un risque à connaître, expliqué sur la page <a href="/tarifs#acces-ia">Tarifs</a>). C'est elle qui cherche, écrit et suit les réponses. Son coût est facturé à part, par son fournisseur.</p>`,
      mock: shot('Maquette : IA connectée, secret chiffré', `<div class="sh-h"><span class="sh-t">Ton IA</span>${badge('b-ok', 'check', 'Connecté')}</div>
    <div class="row"><span class="row-l"><span class="ico">${ic('link')}</span><span><b>Ton accès à l'IA</b><span class="sh-s"> · facturé par ton fournisseur</span></span></span></div>
    <div class="row"><span class="row-l"><span class="ico">${ic('lock')}</span><span><b>Secret chiffré</b></span></span>${badge('b-info', '', 'Cloisonné par compte')}</div>`),
    }),
    how({
      n: 2, rev: true, title: 'Ajoute ton dépôt Git',
      text: `<p>GitHub, ou ton propre serveur (Forgejo, Gitea, GitLab) ajouté dans les réglages. Si le dépôt est privé, tu donnes un token en lecture seule. Ton IA lit le README, les fichiers de description et les pages principales (une quinzaine de fichiers au plus), sans rien modifier, dans un espace isolé. Il en sort une fiche : ce que tu proposes, à qui, et pourquoi.</p>`,
      mock: shot('Maquette : choix entre GitHub et mon serveur, champ adresse du dépôt', `<div class="sh-h"><span class="sh-t">Ton dépôt</span>${badge('', '', 'Étape 2 sur 4')}</div>
    <div class="opts"><span class="opt opt-on">${ic('git')}GitHub<span>Sélectionné</span></span><span class="opt">${ic('git')}Mon serveur<span>Adresse Git</span></span></div>
    <div><p class="lbl">Adresse du dépôt</p><span class="fld">github.com/ton-compte/ton-projet</span></div>`),
    }),
    how({
      n: 3, title: 'Valide la cible',
      text: `<p>Ton IA te dit à qui elle pense parler : des métiers, une zone, une taille d'entreprise, la personne à contacter. Tu corriges ce qui ne va pas, puis tu valides. Tant que tu n'as pas cliqué sur « Valider la cible », la recherche reste verrouillée.</p>`,
      mock: shot('Maquette : cible proposée par l\'IA, à valider', `<div class="sh-h"><span class="sh-t">Atelier Exemple</span>${badge('b-warn', 'clock', 'Cible à valider')}</div>
    <p class="sh-s">Cible proposée par ton IA</p>
    <div class="chips"><span class="chip">Menuisiers</span><span class="chip">Artisans du bâtiment</span><span class="chip">Bretagne</span></div>
    <div class="btns"><span class="btn btn-secondary">Modifier</span><span class="btn btn-primary">${ic('check')}Valider la cible</span></div>`),
    }),
    how({
      n: 4, rev: true, title: 'Lance la recherche, valide les mails',
      text: `<p>Ton IA trouve de 1 à 50 contacts à la fois, tout de suite ou « cette nuit ». Elle doit ne garder que des adresses pro publiées au grand jour, sans jamais les deviner, et noter la page d'où elles viennent. Il peut se tromper : relis les fiches.</p>
    <p>Il écrit ensuite un mail court, un deuxième objet pour comparer, et une relance. Tu relis, tu ajustes, tu valides, puis tu confirmes chaque lot (100 mails au plus), envoyé depuis ta boîte avec une pause au hasard entre deux mails. La relance est facultative, il n'y en a qu'une. Les réponses se suivent dans le tableau de bord.</p>`,
      mock: shot('Maquette : recherche de contacts à 64 %, brouillon de mail à valider', `<div class="sh-h"><span class="sh-t">Atelier Exemple</span>${badge('b-ok', 'check', 'Cible validée')}</div>
    <div><div class="prog-h"><span>Recherche de contacts</span><span>64 %</span></div><div class="track"><div class="bar"></div></div></div>
    <div class="mail"><span class="mail-s">Objet : une idée pour votre atelier</span><span class="mail-p">Bonjour, j'ai vu votre atelier à Vannes…</span></div>
    <div class="btns"><span class="btn btn-secondary">Relire</span><span class="btn btn-primary">${ic('send')}Valider l'envoi</span></div>`),
    }),
  ].join('\n\n');

  const guards = [
    ['Un budget que tu fixes', "Tu peux limiter la dépense en IA sur 24 heures et sur 30 jours. Quand la limite est atteinte, les tâches IA attendent (elles ne sont pas perdues) et les envois aussi, car chaque mail est relu par ton IA avant de partir. Une tâche déjà commencée n'est jamais coupée."],
    ['Un œil sur ton quota', "Avec un abonnement Claude, la carte « Consommation Claude » de la page Projets montre le quota restant que Claude indique lui-même. Avec ChatGPT ou Gemini, la carte porte le nom de ton IA et estime le coût. Au-delà de 85 %, l'analyse et les idées d'évolution sont reportées pour garder de la marge à la recherche de contacts."],
    ['Des envois encadrés', "Des professionnels uniquement, un lien de désinscription dans chaque mail, une liste d'opposition respectée pour tout le monde, des plafonds sur 24 heures par projet et pour tout ton compte. Les règles qui t'incombent sont rappelées sur la page <a href=\"/tarifs#envois\">Tarifs</a>."],
    ['Des modèles économes au départ', 'La recherche, l\'analyse et la rédaction utilisent par défaut le modèle le plus économe de ton IA (Haiku pour Claude). Dans les réglages, tu choisis un autre modèle de ton IA pour chacune, et tu adaptes les consignes à chaque modèle.'],
  ];

  return siteLayout({
    appUrl, path: '/fonctionnement',
    title: 'Comment ça marche : de ton projet aux réponses · iaboss',
    description: "Comment iaboss lit ton projet, trouve des contacts, écrit et envoie les mails, relance et suit les réponses : étape par étape, avec ce qu'il ne sait pas faire.",
    body: `<div class="page">
<div class="wrap">
  <h1 class="h1">Comment ça marche, pas à pas</h1>
  <p class="lead">Quatre étapes. À chacune, tu vois ce que ton IA prépare, et rien ne part sans ton accord.</p>

${steps}

  <section class="guard" id="envois" aria-labelledby="h-g">
    <h2 class="block-h" id="h-g">Pour ne pas te faire déborder</h2>
    <div class="grid g2">
      ${guards.map(([t, p]) => `<article class="card"><h3>${esc(t)}</h3><p>${p}</p></article>`).join('\n      ')}
    </div>
  </section>

  <section class="end" aria-labelledby="h-f">
    <div><h2 id="h-f">Prêt à essayer ?</h2><p>Le plan Gratuit te laisse tout tester, sans carte bancaire.</p></div>
    <div class="end-b">${guest('big', btn('btn-primary btn-lg', '/login', 'Créer mon compte'))}<a class="btn btn-secondary btn-lg" href="/tarifs">Voir les tarifs</a></div>
  </section>
</div>
</div>`,
  });
}

// ---------- Tarifs ----------
const FAQ = [
  ['Faut-il une carte bancaire ?', 'Non. Le plan Gratuit s\'ouvre sans carte bancaire.'],
  ['Quand puis-je passer à un plan payant ?', 'Le plan Gratuit est ouvert aujourd\'hui et te permet de tout tester. Les plans payants ouvriront prochainement : tu seras prévenu avant toute facturation.'],
  ['Dois-je fournir mon propre accès à une IA ?', 'Oui, Claude, ChatGPT ou Gemini au choix. Ton accès est facturé par son fournisseur (Anthropic, OpenAI ou Google), directement à toi. C\'est ce qui explique les prix bas : tu ne paies à iaboss que l\'outil (les projets, les contacts, les envois et le suivi), pas la machine qui réfléchit.'],
  ['Combien me coûtera mon IA ?', 'Ça dépend de ton usage et de ton contrat avec ton fournisseur. Tu fixes un budget maximum dans les réglages. Pour comprendre ce qui consomme quoi, regarde <a href="/fonctionnement">comment ça marche</a>.'],
  ['Que se passe-t-il quand j\'atteins un plafond ?', 'La nouvelle action est refusée, mais rien n\'est supprimé. Les plafonds repartent de zéro le 1er du mois, à l\'heure de Paris.'],
  [`Que veut dire « ${ANNUAL_FREE_MONTHS} mois offerts » ?`, `En payant à l'année, tu règles ${12 - ANNUAL_FREE_MONTHS} mois et tu profites de 12. Par exemple ${PLAN_LABELS.growth} : ${euros(annualPrice('growth'))} par an au lieu de ${euros(PLAN_PRICES.growth * 12)}.`],
  ["Comment fonctionne l'équipe ?", "Tu invites des collègues par email, tu choisis ce que chacun peut faire (membre ou administrateur) et tu partages les projets que tu veux. Ils travaillent avec <em>ton</em> offre, ton SMTP et ton accès à l'IA : pas besoin d'abonnement pour eux. Le nombre de places dépend de l'offre."],
  ['Les prix incluent-ils la TVA ?', 'Oui, ce sont des prix TTC. L\'éditeur est en franchise de TVA (art. 293 B du CGI), donc aucun supplément ne s\'ajoute.'],
  ['Puis-je supprimer mon compte ?', 'Oui, quand tu veux, depuis Mon compte. Ça efface tes projets, tes contacts, tes modèles, tes réglages et la copie de ton code. Seule la liste d\'opposition, qui protège les personnes désinscrites, est gardée.'],
];

export function pricingPage({ appUrl }) {
  // Une ligne par offre, une colonne par plafond : on compare d'un coup d'œil. Sur téléphone, chaque ligne devient un bloc libellé par plafond.
  const paidRow = (k) => `<tr class="plan-row" aria-labelledby="plan-${k}">
        <th scope="row"><h2 id="plan-${k}">${PLAN_LABELS[k]}</h2>${badge('b-info', 'clock', 'Bientôt')}<p class="tag">${PLAN_BLURBS[k]}</p></th>
        <td data-label="Prix"><span class="price when-month">${euros(PLAN_PRICES[k])} <small>par mois, TTC</small></span><span class="price when-year">${euros(annualPrice(k))} <small>par an, TTC</small></span>
          <small class="sub when-month">ou ${euros(annualPrice(k))} par an, ${ANNUAL_FREE_MONTHS} mois offerts</small><small class="sub when-year">soit ${euros(annualPrice(k) / 12)} par mois, ${ANNUAL_FREE_MONTHS} mois offerts</small></td>
        ${limitCells(PLAN_LIMITS[k])}
        <td class="plan-act"><a class="btn btn-secondary" href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Me prévenir : offre ${PLAN_LABELS[k]}`)}">Me prévenir à l'ouverture</a></td>
      </tr>`;
  return siteLayout({
    appUrl, path: '/tarifs',
    title: 'Tarifs : gratuit, puis 10 à 100 € par mois · iaboss',
    description: `Plan gratuit, puis des offres de ${PLAN_PRICES.starter} € à ${PLAN_PRICES.intensive} € TTC par mois, avec ${ANNUAL_FREE_MONTHS} mois offerts en annuel. Ton accès à l'IA (Claude, ChatGPT ou Gemini) est facturé à part, par son fournisseur.`,
    body: `<div class="page">
<div class="wrap">
  <h1 class="h1">Des tarifs simples, sans surprise</h1>
  <p class="lead">Seul le plan Gratuit est ouvert aujourd'hui, sans carte bancaire. Les plans payants, de ${euros(PLAN_PRICES.starter)} à ${euros(PLAN_PRICES.intensive)} TTC par mois, ouvrent prochainement.</p>

  <div class="claude-n" role="note">
    ${ic('info')}
    <p><b>Ton accès à l'IA est facturé par son fournisseur, directement à toi.</b><span>C'est ce qui explique les prix bas.</span></p>
  </div>

  <div class="bill" data-bill hidden>
    <div class="seg" role="group" aria-label="Période de facturation">
      <button class="seg-b" type="button" data-period="month" aria-pressed="true">Au mois</button>
      <button class="seg-b" type="button" data-period="year" aria-pressed="false">À l'année</button>
    </div>
    ${badge('b-ok', 'check', `${ANNUAL_FREE_MONTHS} mois offerts`)}
  </div>

  <div class="plans" data-billing="month">
    <div class="tw"><table class="plan-table">
      <caption class="sr-only">Offres et plafonds</caption>
      <thead><tr><th scope="col">Offre</th><th scope="col">Prix</th>${LIMIT_COLS.map(([label]) => `<th scope="col">${label}</th>`).join('')}<th scope="col"><span class="sr-only">Action</span></th></tr></thead>
      <tbody>
      <tr class="plan-row plan-free" aria-labelledby="plan-gratuit">
        <th scope="row"><h2 id="plan-gratuit">Gratuit</h2>${badge('b-ok', 'check', 'Disponible')}<p class="tag">Pour tout tester, sans carte bancaire.</p></th>
        <td data-label="Prix"><span class="price">0 €</span><small class="sub">Sans limite de durée</small></td>
        ${limitCells(FREE)}
        <td class="plan-act">${guest('plan', '<a class="btn btn-primary" href="/login">Créer mon compte</a>')}</td>
      </tr>
      ${PAID.map(paidRow).join('\n      ')}
      </tbody>
    </table></div>
  </div>

  <div class="mentions">
    <p>Prix TTC. L'éditeur est en franchise de TVA (art. 293 B du CGI) : le prix affiché est le prix payé. En annuel, tu paies ${12 - ANNUAL_FREE_MONTHS} mois et tu en profites 12. Les offres payantes ouvrent prochainement : tu seras prévenu avant toute facturation.</p>
    <p>Ces plafonds sont appliqués par le serveur. Les mails et les tâches IA se comptent par mois (heure de Paris) et repartent de zéro le 1er. Quand un plafond est atteint, la nouvelle action est refusée, mais rien n'est supprimé. Un compte ne peut pas envoyer plus de 300 mails par 24 heures, quelle que soit l'offre : c'est une protection pour la réputation de ton adresse.</p>
  </div>

  <section class="more" id="acces-ia" aria-labelledby="h-ia">
    <h2 class="block-h" id="h-ia">Ton accès à l'IA : Claude, ChatGPT ou Gemini</h2>
    <div class="grid g2">
      <article class="card">
        <h3>Une clé API (recommandé)</h3>
        <p>Tu crées une clé chez ton fournisseur : console.anthropic.com pour Claude, platform.openai.com pour ChatGPT, aistudio.google.com pour Gemini. Il te facture à l'usage, selon ses tarifs, sur ton compte. C'est la façon prévue pour brancher un outil comme celui-ci. Tu peux fixer une limite de dépense par jour et par mois dans les réglages d'iaboss.</p>
        <p>Avec Gemini, une clé gratuite suffit pour essayer, mais Google peut alors utiliser les données envoyées pour améliorer ses produits : n'y mets pas de données de prospects, et active la facturation sur ton projet Google pour un vrai usage.</p>
      </article>
      <article class="card">
        <h3>Ton abonnement Claude ou ChatGPT, avec un risque</h3>
        <p>Avec Claude (Pro, Max) ou ChatGPT (Plus, Pro, Business), tu te connectes à ton compte et iaboss récupère l'accès tout seul. Pas de facture en plus, mais les règles d'Anthropic et d'OpenAI peuvent ne pas autoriser d'utiliser un abonnement à travers une application comme iaboss. Ton compte pourrait être limité, suspendu ou fermé. Gemini se relie par clé API ; l'abonnement Google AI n'est proposé que si l'éditeur l'a activé, et Google n'a pas dit clairement si c'est permis.</p>
        <p>iaboss ne peut pas l'empêcher et n'en est pas responsable. Une fenêtre d'avertissement et une case à cocher te le rappellent avant toute connexion, et ton accord est enregistré avec sa date. Lis les <a href="https://www.anthropic.com/legal/consumer-terms" rel="noopener noreferrer">conditions d'Anthropic</a> ou celles d'OpenAI avant de choisir. Ce mode peut aussi être désactivé sur le service.</p>
        <a class="btn btn-secondary" href="/link?start=claude">Choisir mon IA</a>
        <p class="fine">Pas encore de compte iaboss ? Le bouton te demande d'abord de te connecter, puis te ramène ici.</p>
      </article>
    </div>
  </section>

  <section class="more" id="envois" aria-labelledby="h-envois">
    <h2 class="block-h" id="h-envois">Tu restes responsable de tes envois</h2>
    <p class="sec-lead">iaboss t'aide à rester dans les clous. Il ne remplace pas ta responsabilité d'expéditeur.</p>
    <div class="grid g3">
      <article class="card">
        <h3>Entre professionnels, pas aux particuliers</h3>
        <p>Écrire à un professionnel est en général possible sans son accord préalable, à condition que le message ait un lien avec son activité et qu'il puisse facilement dire stop. Pour un particulier, il faut son accord : n'utilise pas iaboss pour ça.</p>
      </article>
      <article class="card">
        <h3>Se désinscrire, et être respecté</h3>
        <p>Chaque mail contient un lien de désinscription en un clic. Une adresse qui se désinscrit, refuse ou rejette un mail entre dans une liste d'opposition qu'iaboss respecte pour tous les comptes.</p>
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
