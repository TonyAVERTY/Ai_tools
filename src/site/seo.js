// Référencement technique et en-têtes de sécurité du site : robots.txt, sitemap.xml, CSP et compagnie.
import { absoluteUrl } from './layout.js';

/** Pages publiques à indexer (et seulement elles) : alimentent le sitemap et l'exception du noindex. */
export const INDEXABLE_PATHS = ['/', '/fonctionnement', '/tarifs', '/docs', '/docs/api', '/docs/mcp', '/mentions-legales', '/confidentialite', '/cgu'];

// Pages d'application : jamais explorées (le noindex des pages est posé en plus, par en-tête et par balise)
export const DISALLOWED_PATHS = ['/admin', '/account', '/settings', '/mails', '/calendar', '/cal/', '/developer', '/link', '/api/', '/auth/', '/u/', '/logout'];

export function robotsTxt(appUrl) {
  return [
    'User-agent: *',
    'Allow: /',
    ...DISALLOWED_PATHS.map((p) => `Disallow: ${p}`),
    '',
    `Sitemap: ${absoluteUrl(appUrl, '/sitemap.xml')}`,
    '',
  ].join('\n');
}

export function sitemapXml(appUrl) {
  const urls = INDEXABLE_PATHS.map((p) => `  <url><loc>${absoluteUrl(appUrl, p)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

// Tout vient de l'application elle-même : ni script, ni style, ni police, ni image d'un autre domaine.
// Pas de style en ligne : les largeurs, couleurs et animations passent par des classes de public/*.css.
// form-action liste les fournisseurs de connexion et de paiement : un formulaire (« Choisir cette offre », « Gérer mon abonnement ») répond par une REDIRECTION vers Stripe,
// et Chrome applique form-action aux redirections ; sans ces deux adresses, le paiement serait bloqué dans le navigateur.
const directives = (extra = {}) => [
  "default-src 'self'",
  `script-src 'self'${extra.script ? ` ${extra.script}` : ''}`,
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  ...(extra.frame ? [`frame-src ${extra.frame}`] : []),
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com https://appleid.apple.com https://checkout.stripe.com https://billing.stripe.com",
  "frame-ancestors 'none'",
].join('; ');
const CSP = directives();

// reCAPTCHA : uniquement les domaines que Google documente pour la version 3, et uniquement sur la page de connexion
// (le script n'y est chargé qu'après le consentement de l'utilisateur, voir public/captcha.js).
const RECAPTCHA_CSP = directives({
  script: 'https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/',
  frame: 'https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/',
});

/** CSP de la page : celle de la connexion autorise reCAPTCHA quand il est configuré, toutes les autres jamais. */
export const cspFor = (pathname, recaptcha) => (recaptcha && pathname.replace(/(.)\/$/, '$1') === '/login' ? RECAPTCHA_CSP : CSP);

/** En-têtes posés sur toutes les réponses. HSTS seulement si le site est servi en https. */
export function securityHeaders(appUrl) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': CSP,
  };
  if (/^https:\/\//i.test(String(appUrl))) headers['Strict-Transport-Security'] = 'max-age=31536000';
  return headers;
}

const INDEXABLE = new Set([...INDEXABLE_PATHS, '/robots.txt', '/sitemap.xml']);

/** En-tête X-Robots-Tag : noindex partout sauf sur les pages publiques à référencer. */
export const robotsHeaderFor = (pathname) => (INDEXABLE.has(pathname.replace(/(.)\/$/, '$1')) ? null : 'noindex, nofollow');
