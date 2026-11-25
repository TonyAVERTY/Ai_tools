// Langue des contenus d'un projet : celle dans laquelle l'IA s'adresse aux prospects et aux clients du projet (mails de prospection et de relance,
// accroches, posts LinkedIn et Instagram, newsletter, vidéo de promotion, pied de page des mails, page de désinscription).
// Indépendante de la langue d'affichage du site : une personne peut utiliser iaboss en français et prospecter en anglais.
import { AsyncLocalStorage } from 'node:async_hooks';

export const CONTENT_LANGS = ['fr', 'en', 'es'];
export const DEFAULT_CONTENT_LANG = 'fr';
export const CONTENT_LANG_LABELS = { fr: 'Français', en: 'English', es: 'Español' };
/** Nom de la langue en anglais, pour une consigne (« Write in French »). */
export const CONTENT_LANG_NAMES = { fr: 'French', en: 'English', es: 'Spanish' };
/** « en français », « in English », « en español » : se glisse dans une consigne française. */
export const CONTENT_LANG_IN_FR = { fr: 'en français', en: 'en anglais', es: 'en espagnol' };

export const isContentLang = (v) => typeof v === 'string' && CONTENT_LANGS.includes(v);
export const contentLangOf = (v) => (isContentLang(v) ? v : DEFAULT_CONTENT_LANG);

// La langue des contenus du projet en cours de traitement : posée une fois par le lanceur de tâches, lue par les prompts
const store = new AsyncLocalStorage();
export const withContentLang = (lang, fn) => store.run(contentLangOf(lang), fn);
export const currentContentLang = () => store.getStore() ?? DEFAULT_CONTENT_LANG;

/** Les <option> d'un sélecteur de langue des contenus. `selected` : la langue choisie. */
export const contentLangOptions = (selected) => CONTENT_LANGS.map((code) => `<option value="${code}"${code === contentLangOf(selected) ? ' selected' : ''}>${CONTENT_LANG_LABELS[code]}</option>`).join('');
