// Audit de la traduction : quels textes d'une page ne sont pas encore dans le dictionnaire ? Utilisé par scripts/i18n-audit.mjs (la liste de travail) et par
// test/i18n-coverage.test.js (le garde-fou : une page couverte qui reçoit un texte sans traduction fait échouer le test).
import { canonInline, decodeEntities, normalize } from './core.js';
import { translateHtml } from './html.js';
import { lookupFor } from './index.js';

/** Un texte mérite-t-il une traduction ? (au moins une lettre ; ni adresse e-mail ou web, ni suite de chiffres et de signes) */
export function isCandidate(s) {
  if (s.length < 2 || !/\p{L}/u.test(s)) return false; // une lettre seule : initiale d'un avatar
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(s) || /^https?:\/\/\S+$/i.test(s)) return false;
  if (/^[\d\s.,:;%€$£+\-–/()]+$/.test(s)) return false;
  // Dates : l'application les écrit dans la langue choisie (src/i18n/locale.js), elles ne passent pas par le dictionnaire
  if (/^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)?\.?\s*\d{1,2}\s+(janv|févr|mars|avr|mai|juin|juil|août|sept|oct|nov|déc)[a-zéû]*\.?(\s+\d{4})?$/i.test(s)) return false;
  return s.length <= 1200;
}

/** Tous les textes qu'une page demanderait à traduire : { clé → true }. Une phrase à balises compte pour UNE clé (ses morceaux ne sont pas listés en plus). */
export function collectTexts(html) {
  const keys = new Set();
  const recorder = {
    text(raw) { const k = normalize(decodeEntities(raw)); if (k && isCandidate(k)) keys.add(k); return null; },
    // une phrase à balises : sa traduction « identité » la fait passer pour traduite, donc ses morceaux ne sont pas redemandés
    inline(inner) { const k = canonInline(inner); if (isCandidate(k.replace(/<[^>]+>/g, ''))) keys.add(k); return k; },
  };
  translateHtml(html, recorder, 'fr');
  return keys;
}

/** Les clés sans traduction dans une langue (en ou es). */
export function missingIn(keys, lang, ignore = new Set()) {
  const lookup = lookupFor(lang);
  return [...keys].filter((k) => !ignore.has(k) && (k.includes('<') ? lookup.inline(k) : lookup.text(k)) == null);
}
