// Gabarit du site public : balisage sémantique, métadonnées (title, description, canonical, Open Graph), liens
// d'évitement, navigation. Aucune ressource externe (CSS, images et favicon servis par l'application ; un seul script, site.js, pour le mouvement).
import { esc } from '../http.js';
import { assetUrl } from '../assets.js';

export const SITE_NAME = 'AiTools';
export const CONTACT_EMAIL = 'contact@tony-averty.dev';

const NAV = [
  ['/fonctionnement', 'Fonctionnement'],
  ['/tarifs', 'Tarifs'],
];

const LEGAL_NAV = [
  ['/mentions-legales', 'Mentions légales'],
  ['/confidentialite', 'Confidentialité'],
  ['/cgu', 'CGU'],
];

/**
 * Bloc « Et ensuite ? » en bas de page : des cartes qui renvoient vers les autres pages du site, pour qu'on ne tombe jamais
 * sur une impasse. Chaque item : [adresse, petit titre, titre, phrase].
 */
export function nextBlock(items, title = 'Et ensuite ?') {
  return `<section class="wrap block next" aria-labelledby="titre-ensuite">
  <h2 id="titre-ensuite">${esc(title)}</h2>
  <div class="next-grid">
    ${items.map(([href, kicker, name, text]) => `<a class="next-card" href="${esc(href)}" data-reveal>
      <span class="next-kicker">${esc(kicker)}</span>
      <span class="next-name">${esc(name)}</span>
      <span class="next-text">${esc(text)}</span>
    </a>`).join('\n    ')}
  </div>
</section>`;
}

/** Les cartes du parcours : accueil, fonctionnement, tarifs, connexion. On retire celle de la page en cours. */
export const JOURNEY = {
  home: ['/', 'Accueil', "L'idée en bref", "Ce qu'AiTools fait pour toi, en une page."],
  how: ['/fonctionnement', 'Étape par étape', 'Comment ça marche', 'Du premier clic à la réponse du client.'],
  pricing: ['/tarifs', 'Combien ça coûte', 'Les tarifs', 'Un plan gratuit, et ce que tu paies à part.'],
  login: ['/login', 'Prêt ?', 'Créer mon compte', 'Un clic avec Google, sans mot de passe.'],
};
export const journey = (...keys) => keys.map((k) => JOURNEY[k]);

/** URL absolue d'une page du site (canonical, Open Graph, sitemap). */
export function absoluteUrl(appUrl, path) {
  return `${String(appUrl).replace(/\/$/, '')}${path}`;
}

/**
 * @param {object} o
 * @param {string} o.appUrl      URL publique de l'application (config)
 * @param {string} o.path        chemin de la page (ex. /tarifs) : sert au canonical et à la navigation
 * @param {string} o.title       <title> complet (60 caractères environ)
 * @param {string} o.description meta description (160 caractères environ)
 * @param {string} o.body        contenu de <main>, déjà échappé
 * @param {boolean} [o.noindex]  page à ne pas indexer (connexion, 404)
 * @param {object} [o.jsonLd]    données structurées (bloc de données, non exécuté : compatible avec la CSP)
 * @param {string[]} [o.scripts] scripts de l'application (chemins /static/…) ; aucun par défaut
 */
export function siteLayout({ appUrl, path, title, description, body, noindex = false, jsonLd = null, scripts = [] }) {
  const url = absoluteUrl(appUrl, path === '/' ? '/' : path);
  const year = new Date().getFullYear();
  const link = ([href, label]) => `<li><a href="${href}"${href === path ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow'}">
${noindex ? '' : `<link rel="canonical" href="${esc(url)}">\n`}<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f4f5f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111317" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:locale" content="fr_FR">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary">
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg">
<link rel="alternate icon" href="/favicon.ico">
<link rel="stylesheet" href="${assetUrl('/static/app.css')}">
<link rel="stylesheet" href="${assetUrl('/static/site.css')}">
${['/static/site.js', ...scripts].map((src) => `<script src="${esc(assetUrl(src))}" defer></script>\n`).join('')}${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>\n` : ''}</head>
<body class="site">
<a class="skip" href="#contenu">Aller au contenu</a>
<header class="site-head">
  <div class="wrap head-in">
    <a class="brand" href="/" aria-label="${SITE_NAME}, accueil"><span class="mark" aria-hidden="true"></span>${SITE_NAME}</a>
    <nav class="site-nav" aria-label="Navigation principale">
      <ul>
        ${NAV.map(link).join('\n        ')}
        <li><a href="/login"${path === '/login' ? ' aria-current="page"' : ''}>Connexion</a></li>
        <li><a class="btn primary" href="/login">Créer mon compte</a></li>
      </ul>
    </nav>
  </div>
</header>
<main id="contenu" tabindex="-1">
${body}
</main>
<footer class="site-foot">
  <div class="wrap foot-in">
    <div>
      <a class="brand" href="/"><span class="mark" aria-hidden="true"></span>${SITE_NAME}</a>
      <p>Un panel qui pilote Claude Code pour prospecter par mail, avec ton propre accès Claude.</p>
      <p class="fine">Édité par Tony AVERTY, entrepreneur individuel. © ${year}</p>
    </div>
    <nav aria-label="Pages du site">
      <h2>Le site</h2>
      <ul>
        <li><a href="/">Accueil</a></li>
        ${NAV.map(link).join('\n        ')}
        <li><a href="/login">Connexion</a></li>
      </ul>
    </nav>
    <nav aria-label="Informations légales">
      <h2>Légal et contact</h2>
      <ul>
        ${LEGAL_NAV.map(link).join('\n        ')}
        <li><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></li>
      </ul>
    </nav>
  </div>
</footer>
</body>
</html>`;
}
