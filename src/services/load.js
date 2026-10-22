// Charge du serveur : rapport entre la charge moyenne (1 min) et le nombre de cœurs. Remplace la pause thermique du Raspberry.
import os from 'node:os';

/** 0 = machine au repos, 1 = tous les cœurs occupés. Toujours 0 sous Windows (loadavg y vaut 0). */
export function loadRatio() {
  const cores = Math.max(1, os.availableParallelism?.() ?? os.cpus().length);
  return os.loadavg()[0] / cores;
}
