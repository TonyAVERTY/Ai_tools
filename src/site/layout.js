// Gabarit du site public (design Claude Design) : balisage sémantique, métadonnées (title, description, canonical, Open Graph),
// lien d'évitement, en-tête, pied de page. Aucune ressource externe : CSS, images, icônes (sprite SVG en ligne) et favicon sont
// servis par l'application ; un seul script, site.js, pour les petits plus (période des tarifs, sommaire légal).
import { esc } from '../http.js';
import { assetUrl, brandMark, iconLinks } from '../assets.js';

export const SITE_NAME = 'AiTools';
const OG_IMAGE = '/static/img/share_img.jpg'; // 1024 x 541, aperçu des liens partagés
export const CONTACT_EMAIL = 'contact@tony-averty.dev';

const NAV = [
  ['/fonctionnement', 'Fonctionnement'],
  ['/tarifs', 'Tarifs'],
];

// Icônes du design (tracé au trait, 24 x 24). Une seule fois par page, appelées par <use>.
const SYMBOLS = {
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"></rect><path d="m4 8 8 6 8-6"></path>',
  reply: '<path d="M9 14 4 9l5-5"></path><path d="M4 9h10a6 6 0 0 1 6 6v3"></path>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"></path>',
  clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
  pen: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"></path>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"></path><circle cx="12" cy="12" r="3"></circle>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"></path>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"></path>',
  shield: '<path d="M12 3 4.5 6v6c0 4.5 3.2 7.6 7.5 9 4.3-1.4 7.5-4.5 7.5-9V6z"></path><path d="m9 12 2.2 2.2L15 10"></path>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="3"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>',
  box: '<rect x="4" y="4" width="16" height="16" rx="4"></rect><path d="M9 4v16M4 12h5"></path>',
  user: '<circle cx="12" cy="8" r="4"></circle><path d="M4.5 20a7.5 7.5 0 0 1 15 0"></path>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"></path><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"></path>',
  git: '<circle cx="6" cy="5" r="2.2"></circle><circle cx="6" cy="19" r="2.2"></circle><circle cx="18" cy="8" r="2.2"></circle><path d="M6 7.2v9.6M18 10.2c0 4-6 3-12 6"></path>',
  target: '<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="4.5"></circle><path d="M12 12v.01"></path>',
  send: '<path d="M21 3 10 14"></path><path d="m21 3-7 18-4-7-7-4z"></path>',
  info: '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8v.01"></path>',
  chev: '<path d="m6 9 6 6 6-6"></path>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"></path>',
};
const SPRITE = `<svg class="defs" aria-hidden="true" focusable="false" viewBox="0 0 64 64">
<defs>
<linearGradient id="g-hero" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="800" y2="0"><stop offset="0" stop-color="#1288b7"></stop><stop offset="1" stop-color="#0db8c5"></stop></linearGradient>
<linearGradient id="g-nf" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="160" y2="0"><stop offset="0" stop-color="#1288b7"></stop><stop offset="1" stop-color="#0db8c5"></stop></linearGradient>
</defs>
${Object.entries(SYMBOLS).map(([k, d]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${d}</symbol>`).join('\n')}
</svg>`;

/** Icône du sprite : `ic('check')`. Décorative (le mot est toujours écrit à côté). */
export const ic = (name) => `<svg class="ic" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${name}"></use></svg>`;

const lockup = (label = true) => `<a class="lockup" href="/"${label ? ` aria-label="${SITE_NAME}, accueil"` : ''}>${brandMark()}<span class="wordmark">${SITE_NAME}</span></a>`;

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
  const here = (href) => (href === path ? ' aria-current="page"' : '');
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow'}">
${noindex ? '' : `<link rel="canonical" href="${esc(url)}">\n`}<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f4f7fc" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0b1224" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:locale" content="fr_FR">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(absoluteUrl(appUrl, assetUrl(OG_IMAGE)))}">
<meta property="og:image:width" content="1024">
<meta property="og:image:height" content="541">
<meta property="og:image:alt" content="${SITE_NAME} : prospection, relances et posts LinkedIn pilotés par Claude">
<meta name="twitter:card" content="summary_large_image">
${iconLinks()}
<link rel="stylesheet" href="${assetUrl('/static/tokens.css')}">
<link rel="stylesheet" href="${assetUrl('/static/site.css')}">
${['/static/site.js', ...scripts].map((src) => `<script src="${esc(assetUrl(src))}" defer></script>\n`).join('')}${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>\n` : ''}</head>
<body class="site">
<a class="skip" href="#contenu">Aller au contenu</a>
${SPRITE}
<header class="top">
  <div class="wrap top-in">
    ${lockup()}
    <nav class="nav" aria-label="Navigation principale">
      ${NAV.map(([href, label]) => `<a href="${href}"${here(href)}>${esc(label)}</a>`).join('\n      ')}
    </nav>
    <div class="top-cta">
      <a class="btn btn-secondary" href="/login"${here('/login')}>Connexion</a>
      <a class="btn btn-primary" href="/login">Créer mon compte</a>
    </div>
  </div>
</header>
<main id="contenu" tabindex="-1">
${body}
</main>
<footer class="foot">
  <div class="wrap">
    <div class="foot-g">
      <div>${lockup()}<p class="foot-n">Prospection, relances et posts LinkedIn pilotés par Claude.</p></div>
      <nav aria-label="Produit"><h3>Produit</h3><ul>
        <li><a href="/">Accueil</a></li>
        ${NAV.map(([href, label]) => `<li><a href="${href}"${here(href)}>${esc(label)}</a></li>`).join('\n        ')}
        <li><a href="/login">Connexion</a></li>
      </ul></nav>
      <nav aria-label="Informations"><h3>Infos</h3><ul>
        <li><a href="/mentions-legales"${here('/mentions-legales')}>Mentions légales</a></li>
        <li><a href="/confidentialite"${here('/confidentialite')}>Confidentialité</a></li>
        <li><a href="/cgu"${here('/cgu')}>CGU</a></li>
        <li><a href="mailto:${CONTACT_EMAIL}">Contact</a></li>
      </ul></nav>
    </div>
    <p class="legal">Édité par Tony AVERTY, entrepreneur individuel. © ${year}</p>
  </div>
</footer>
</body>
</html>`;
}
