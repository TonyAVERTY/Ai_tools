// Format des dates et des nombres de l'INTERFACE selon la langue choisie. Les documents et mails destinés à d'autres personnes (factures, devis, mails de prospection,
// rapports) restent en français : ils n'utilisent pas ce module.
import { currentLang } from './index.js';

export const LOCALES = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' };
export const localeOf = (lang = currentLang()) => LOCALES[lang] || LOCALES.fr;
