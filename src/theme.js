// Thème choisi par la personne (cookie « theme » : clair ou sombre ; sans cookie, le réglage du système). Même principe que services/ainame.js :
// la requête porte la valeur, les pages la lisent au moment de s'écrire. Le serveur l'inscrit dans <html data-theme="…">, donc pas de clignotement.
import { AsyncLocalStorage } from 'node:async_hooks';
import { parseCookies } from './http.js';

export const THEME_COOKIE = 'theme';
export const THEMES = ['light', 'dark'];
const store = new AsyncLocalStorage();

export const themeOf = (req) => { const v = parseCookies(req)[THEME_COOKIE]; return THEMES.includes(v) ? v : null; };
export const withTheme = (theme, fn) => store.run(theme, fn);
/** Attribut à mettre sur <html> : ` data-theme="dark"`, ou rien (le système décide). */
export const themeAttr = () => { const t = store.getStore(); return t ? ` data-theme="${t}"` : ''; };
