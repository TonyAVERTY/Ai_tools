// Le nom de l'IA de l'utilisateur (Claude, ChatGPT ou Gemini) dans les textes de l'application.
//  - Pages et réponses : le nom est rangé le temps de la requête (AsyncLocalStorage, posé par server.js) ; les vues appellent `aiName()`.
//  - Jobs : le nom est celui du propriétaire du job ; dans leurs messages d'avancement, de journal et d'erreur, « Claude » désigne
//    toujours « l'IA de la personne » et est remplacé à l'écriture par son nom (`forAi`). Un texte propre à Claude (jeton d'abonnement,
//    limites de session, liaison) ne passe jamais par `forAi` : il s'écrit « Claude » sur la page de cette IA seulement.
//  - Navigateur : <body data-ai="…"> (layout), lu par public/app.js (`AiTools.aiName()`).
import { AsyncLocalStorage } from 'node:async_hooks';

export const DEFAULT_AI_NAME = 'Claude';
const store = new AsyncLocalStorage();

/** Exécute `fn` avec ce nom d'IA pour toutes les vues rendues pendant son exécution. */
export const withAiName = (name, fn) => store.run({ name: name || DEFAULT_AI_NAME }, fn);

/** Nom de l'IA de l'utilisateur de la requête en cours ; « Claude » hors requête, ou sans liaison. */
export const aiName = () => store.getStore()?.name ?? DEFAULT_AI_NAME;

/** Remplace « Claude » (mot entier) par le nom de l'IA dans un message de job. Aucun effet pour un utilisateur de Claude. */
export function forAi(text, name) {
  const s = String(text ?? '');
  return !name || name === DEFAULT_AI_NAME ? s : s.replace(/\bClaude\b/g, name);
}
