// Gabarit du site public (design Claude Design) : balisage sémantique, métadonnées (title, description, canonical, Open Graph),
// lien d'évitement, en-tête, pied de page. Aucune ressource externe : CSS, images, icônes (sprite SVG en ligne) et favicon sont
// servis par l'application ; un seul script, site.js, pour les petits plus (période des tarifs, sommaire légal).
import { esc } from '../http.js';
import { assetUrl, brandMark, iconLinks } from '../assets.js';
import { SPRITE, ic } from '../icons.js';

export { ic };

export const SITE_NAME = 'AiTools';
const OG_IMAGE = '/static/img/share_img.jpg'; // 1024 x 541, aperçu des liens partagés
export const CONTACT_EMAIL = 'contact@tony-averty.dev';

const NAV = [
  ['/fonctionnement', 'Fonctionnement'],
  ['/tarifs', 'Tarifs'],
  ['/docs', 'Docs'],
];

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
<link rel="stylesheet" href="${assetUrl('/static/responsive.css')}">
${['/static/site.js', '/static/responsive.js', ...scripts].map((src) => `<script src="${esc(assetUrl(src))}" defer></script>\n`).join('')}${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>\n` : ''}</head>
<body class="site">
<a class="skip" href="#contenu">Aller au contenu</a>
<div class="page-ribbon" aria-hidden="true"><svg viewBox="0 0 100 1000" preserveAspectRatio="none" focusable="false">
<defs><linearGradient id="g-page" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="1000"><stop offset="0" stop-color="#1288b7"></stop><stop offset="1" stop-color="#0db8c5"></stop></linearGradient></defs>
<path d="M108 -20 C90 40 62 30 58 130 S20 200 4 300 S-2 420 4 480 S40 540 96 620 S102 700 96 760 S60 830 4 900 S-2 960 20 1030"></path>
</svg></div>
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
