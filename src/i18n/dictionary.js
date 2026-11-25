// Dictionnaire de l'interface. Chaque fichier de src/i18n/dict/ est une liste de lignes [français, anglais, espagnol] : une seule ligne par texte, donc les trois
// langues restent ensemble (test/i18n.test.js vérifie qu'aucune n'est vide et que les { trous } sont les mêmes partout). Le français est la clé de recherche :
// il doit être écrit EXACTEMENT comme dans l'interface (« » et apostrophes comprises, balises sans attributs pour une phrase qui en contient).
import core from './dict/core.js';

export const AREAS = { core };
export const ROWS = Object.values(AREAS).flat();

const INDEX = { en: 1, es: 2 };

/** { texte français: traduction } pour une langue. */
export function entriesFor(lang) {
  const i = INDEX[lang];
  if (!i) return {};
  const out = {};
  for (const row of ROWS) out[row[0]] = row[i];
  return out;
}
