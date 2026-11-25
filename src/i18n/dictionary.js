// Dictionnaire de l'interface. Chaque fichier de src/i18n/dict/ est une liste de lignes [français, anglais, espagnol] : une seule ligne par texte, donc les trois
// langues restent ensemble (test/i18n.test.js vérifie qu'aucune n'est vide et que les { trous } sont les mêmes partout). Le français est la clé de recherche :
// il doit être écrit EXACTEMENT comme dans l'interface (« » et apostrophes comprises, balises sans attributs pour une phrase qui en contient).
import core from './dict/core.js';
import shell from './dict/shell.js';
import today from './dict/today.js';
import checklist from './dict/checklist.js';
import settings from './dict/settings.js';
import account from './dict/account.js';
import accueil from './dict/accueil.js';
import tarifs from './dict/tarifs.js';
import fonctionnement from './dict/fonctionnement.js';
import link from './dict/link.js';
import chat from './dict/chat.js';
import docs from './dict/docs.js';
import docs_mcp from './dict/docs-mcp.js';
import docs_api from './dict/docs-api.js';
import welcome from './dict/welcome.js';
import project from './dict/project.js';
import misc1 from './dict/misc1.js';
import misc2 from './dict/misc2.js';
import tabs1 from './dict/tabs1.js';
import tabs2 from './dict/tabs2.js';
import toasts from './dict/toasts.js';
import srv1 from './dict/srv1.js';
import tour from './dict/tour.js';
import compta2 from './dict/compta2.js';

export const AREAS = { compta2, tour, srv1, toasts, tabs2, tabs1, misc2, misc1, project, welcome, docs_api, docs_mcp, docs, chat, link, fonctionnement, tarifs, accueil, account, settings, core, shell, today, checklist };
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
