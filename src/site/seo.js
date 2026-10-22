// Référencement technique et en-têtes de sécurité du site : robots.txt, sitemap.xml, CSP et compagnie.
import { absoluteUrl } from './layout.js';

/** Pages publiques à indexer (et seulement elles) : alimentent le sitemap et l'exception du noindex. */
export const INDEXABLE_PATHS = ['/', '/fonctionnement', '/tarifs', '/mentions-legales', '/confidentialite', '/cgu'];

// Pages d'application : jamais explorées (le noindex des pages est posé en plus, par en-tête et par balise)
export const DISALLOWED_PATHS = ['/account', '/settings', '/link', '/api/', '/auth/', '/u/', '/logout'];

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
// form-action liste les fournisseurs de connexion (un formulaire ne les vise pas aujourd'hui, la redirection oui).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com https://appleid.apple.com",
  "frame-ancestors 'none'",
].join('; ');

/** En-têtes posés sur toutes les réponses. HSTS seulement si le site est servi en https. */
export function securityHeaders(appUrl) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': CSP,
  };
  if (/^https:\/\//i.test(String(appUrl))) headers['Strict-Transport-Security'] = 'max-age=31536000';
  return headers;
}

const INDEXABLE = new Set([...INDEXABLE_PATHS, '/robots.txt', '/sitemap.xml']);

/** En-tête X-Robots-Tag : noindex partout sauf sur les pages publiques à référencer. */
export const robotsHeaderFor = (pathname) => (INDEXABLE.has(pathname.replace(/(.)\/$/, '$1')) ? null : 'noindex, nofollow');
