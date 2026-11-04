// File d'attente par utilisateur : les exécutions d'un même compte passent l'une après l'autre.
// Sert à la connexion par compte ChatGPT : Codex renouvelle lui-même son fichier de connexion (jeton de rafraîchissement à usage unique),
// et la documentation d'OpenAI exige « un seul flux de jobs à la fois » par fichier. Deux exécutions en même temps se voleraient le jeton.
const tails = new Map(); // user_id → fin de la dernière exécution mise en file

/**
 * Exécute `fn` dès que les exécutions précédentes du même utilisateur sont finies (réussies ou non).
 * Un arrêt demandé (`signal`) pendant l'attente sort de la file sans lancer `fn`.
 */
export async function withUserLock(userId, fn, { signal } = {}) {
  const key = Number(userId);
  const previous = tails.get(key) ?? Promise.resolve();
  let release;
  const mine = new Promise((r) => { release = r; });
  const tail = previous.then(() => mine);
  tails.set(key, tail);
  tail.finally(() => { if (tails.get(key) === tail) tails.delete(key); }).catch(() => {});
  try {
    await new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('Annulé'));
      signal?.addEventListener('abort', () => reject(new Error('Annulé')), { once: true });
      previous.then(resolve, resolve);
    });
    return await fn();
  } finally { release(); }
}

/** Nombre d'utilisateurs qui ont une exécution en cours ou en attente (tests). */
export const lockedUsers = () => tails.size;
