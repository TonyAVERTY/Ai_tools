// « Ce module est-il le programme lancé ? » Vrai avec `node src/server.js` (même par un lien symbolique) et sous pm2, qui charge le script par
// son propre conteneur (argv[1] est alors celui de pm2 : le chemin du script est dans la variable pm_exec_path que pm2 pose pour chaque processus).
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const real = (p) => { try { return realpathSync(p); } catch { return p; } };

/** @param {string} metaUrl  `import.meta.url` du module qui demande */
export function isEntryPoint(metaUrl, argv = process.argv, env = process.env) {
  const self = real(fileURLToPath(metaUrl));
  return [argv[1], env.pm_exec_path].filter(Boolean).some((candidate) => real(candidate) === self);
}
