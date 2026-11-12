// Adresses des fichiers statiques avec leur empreinte (`?v=…`) : quand un fichier change, son adresse change, et le
// navigateur ne peut plus réutiliser l'ancienne copie qu'il avait en cache (les fichiers sont servis avec max-age).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const cache = new Map();

/** '/static/app.js' devient '/static/app.js?v=1a2b3c4d5e' (empreinte du contenu, lue une fois). */
export function assetUrl(path) {
  if (!cache.has(path)) {
    let v = '0';
    try { v = createHash('sha1').update(readFileSync(join(PUBLIC, path.replace(/^\/static\//, '')))).digest('hex').slice(0, 10); } catch { /* fichier absent : adresse sans empreinte utile */ }
    cache.set(path, `${path}?v=${v}`);
  }
  return cache.get(path);
}

/**
 * Logo de marque (un « i » : tige et point Safran) en SVG : les couleurs viennent des jetons (barre du haut Pétrole, site sur Lin), donc thème clair et sombre sans second fichier.
 * Décoratif (le nom « iaboss » est écrit à côté), d'où l'alt vide.
 */
export function brandMark(cls = '') {
  return `<svg class="brand-mark${cls ? ` ${cls}` : ''}" viewBox="0 0 48 48" width="28" height="28" aria-hidden="true" focusable="false"><rect class="lg-bg" width="48" height="48" rx="13"/><circle class="lg-dot" cx="24" cy="14.5" r="4.8"/><rect class="lg-stem" x="19.2" y="23" width="9.6" height="16" rx="4.8"/></svg>`;
}

/** Liens d'icônes du <head> (onglet du navigateur, écran d'accueil iOS). */
export function iconLinks() {
  return `<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="32x32" href="${assetUrl('/static/img/favicon-32.png')}">
<link rel="apple-touch-icon" href="${assetUrl('/static/img/apple-touch-icon.png')}">`;
}
