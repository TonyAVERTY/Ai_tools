// Dernier filet du processus serveur (installé par server.js, jamais dans les tests) : une erreur qui échappe à tout le reste
// ne doit ni passer inaperçue ni arrêter les tâches en cours sans raison.
//  - promesse rejetée et oubliée : journalisée et signalée aux administrateurs, le serveur continue (l'état du processus est sain) ;
//  - exception non attrapée : journalisée et signalée, puis arrêt (l'état est incertain) ; systemd relance le service.
// L'alerte par mail est dédoublonnée et limitée par reportError ; elle ne lève jamais.
import { reportError } from './services/errormail.js';

export function installCrashGuards(app, { proc = process, report = reportError, exit = (code) => process.exit(code), graceMs = 3000, log = console } = {}) {
  proc.on('unhandledRejection', (reason) => {
    log.error('[unhandledRejection]', reason);
    Promise.resolve(report(app, reason, { method: 'PROCESS', path: 'unhandledRejection' })).catch(() => {});
  });
  let dying = false;
  proc.on('uncaughtException', (err) => {
    log.error('[uncaughtException]', err);
    if (dying) return;
    dying = true;
    // On laisse un court instant au mail pour partir, puis on s'arrête quoi qu'il arrive
    const sent = Promise.resolve(report(app, err, { method: 'PROCESS', path: 'uncaughtException' })).catch(() => {});
    const timeout = new Promise((resolve) => setTimeout(resolve, graceMs));
    Promise.race([sent, timeout]).then(() => exit(1));
  });
}
