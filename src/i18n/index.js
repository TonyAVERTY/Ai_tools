// Langue d'affichage du site : français (par défaut), anglais ou espagnol. Elle ne change QUE si la personne la choisit (Réglages → Langue, ou le choix en bas du site
// public) : ni langue du navigateur, ni deviner. Le choix est gardé dans le cookie « lang » (préférence, 1 an, comme le thème) et, pour un compte, dans ses réglages
// (il suit la personne d'un appareil à l'autre). Les pages sont écrites en français puis traduites au moment de partir (voir html.js) ; le navigateur traduit ce qui
// arrive ensuite (public/i18n.js).
import { AsyncLocalStorage } from 'node:async_hooks';
import { parseCookies } from '../http.js';
import { assetUrl } from '../assets.js';
import { makeLookup } from './core.js';
import { entriesFor } from './dictionary.js';

export const LANGS = ['fr', 'en', 'es'];
export const LANG_LABELS = { fr: 'Français', en: 'English', es: 'Español' };
export const LANG_COOKIE = 'lang';
export const DEFAULT_LANG = 'fr';

export const isLang = (v) => LANGS.includes(v);
export const langOfCookie = (req) => { const v = parseCookies(req)[LANG_COOKIE]; return isLang(v) ? v : null; };

// Le magasin est un objet modifiable : la langue enregistrée sur le compte n'est connue qu'une fois la session lue
const store = new AsyncLocalStorage();
export const withLang = (lang, fn) => store.run({ lang: isLang(lang) ? lang : DEFAULT_LANG }, fn);
export const currentLang = () => store.getStore()?.lang ?? DEFAULT_LANG;
export const setCurrentLang = (lang) => { const s = store.getStore(); if (s && isLang(lang)) s.lang = lang; };

const lookups = new Map();
/** Fonctions de recherche de la langue (null pour le français : rien à traduire). Construites une fois. */
export function lookupFor(lang) {
  if (lang === DEFAULT_LANG || !isLang(lang)) return null;
  if (!lookups.has(lang)) lookups.set(lang, makeLookup(entriesFor(lang)));
  return lookups.get(lang);
}

/** Balise du script de traduction du navigateur : seulement dans une autre langue que le français. */
export const i18nScript = () => (currentLang() === DEFAULT_LANG ? '' : `<script src="${assetUrl('/static/i18n.js')}" defer></script>`);
