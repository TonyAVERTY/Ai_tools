// Exécution isolée de Claude : bac à sable bubblewrap + environnement du processus enfant assaini.
// Chaque lancement a son propre HOME jetable ; seul le répertoire de travail de l'utilisateur est monté.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const SANDBOX_HOME = '/home/sandbox';

// Seules variables héritées du serveur. Rien d'autre : ni SECRET_KEY, ni DB_*, ni GOOGLE_*, ni APPLE_*.
const INHERITED = ['PATH', 'LANG'];
// Développement sous Windows : sans elles Node ne démarre pas correctement (aucune n'est un secret)
const INHERITED_WINDOWS = ['SystemRoot', 'PATHEXT', 'TEMP', 'TMP', 'COMSPEC'];
// Les deux seuls secrets qu'un processus enfant peut recevoir, et toujours ceux de l'utilisateur du job
export const SECRET_ENV_NAMES = new Set(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']);

/** Environnement du processus enfant : liste blanche stricte + le secret de l'utilisateur concerné. */
export function buildChildEnv(parent, { secretEnv = {}, home }) {
  const env = {};
  for (const k of [...INHERITED, ...(process.platform === 'win32' ? INHERITED_WINDOWS : [])]) {
    if (parent[k] !== undefined) env[k] = parent[k];
  }
  env.LANG ||= 'C.UTF-8';
  env.HOME = home;
  for (const [k, v] of Object.entries(secretEnv)) {
    if (!SECRET_ENV_NAMES.has(k)) throw new Error(`Variable d'environnement non autorisée pour le processus enfant : ${k}`);
    if (v) env[k] = v;
  }
  return env;
}

/** Chemin réel de l'exécutable (suit les liens symboliques) ; null s'il est introuvable. */
export function resolveBin(bin, pathEnv = process.env.PATH || '') {
  const candidates = bin.includes('/') || bin.includes(sep)
    ? [resolve(bin)]
    : pathEnv.split(delimiter).filter(Boolean).map((d) => join(d, bin));
  for (const c of candidates) {
    try { accessSync(c, constants.X_OK); return realpathSync(c); } catch { /* suivant */ }
  }
  return null;
}

/** Le chemin est-il à l'intérieur de `root` (ou égal) ? Sert à n'accepter que le dossier de CET utilisateur. */
export function isInside(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Ligne de commande bubblewrap (sans le binaire `bwrap` lui-même). Fonction pure, testée unitairement.
 *  - racine reconstruite en lecture seule (/usr, /etc, bibliothèques) : ni /home, ni /root, ni /var, ni le dossier de l'application ;
 *  - /tmp et HOME en tmpfs vides, propres à chaque exécution ;
 *  - seul `workDir` (clone du projet de l'utilisateur) est monté, en lecture seule ;
 *  - PID, IPC et UTS isolés, le réseau est conservé ;
 *  - aucun secret dans cette ligne (visible dans `ps`) : le secret passe par l'environnement du processus.
 * @param {object} o
 * @param {string|null} o.workDir      clone du projet (absolu), ou null
 * @param {string[]} o.command         commande à exécuter dans le bac à sable
 * @param {string[]} [o.roBinds]       dossiers supplémentaires en lecture seule (binaire Claude, Node…)
 */
export function buildBwrapArgs({ workDir = null, command, roBinds = [] }) {
  if (!Array.isArray(command) || !command.length) throw new Error('Commande vide');
  if (workDir !== null && !isAbsolute(workDir)) throw new Error('Le répertoire de travail doit être absolu');
  const args = [
    '--die-with-parent', '--new-session',
    '--unshare-pid', '--unshare-ipc', '--unshare-uts',
    '--cap-drop', 'ALL',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind-try', '/bin', '/bin',
    '--ro-bind-try', '/sbin', '/sbin',
    '--ro-bind-try', '/lib', '/lib',
    '--ro-bind-try', '/lib64', '/lib64',
    '--ro-bind', '/etc', '/etc',
    '--ro-bind-try', '/run/systemd/resolve', '/run/systemd/resolve', // resolv.conf pointe souvent ici
    '--proc', '/proc', '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--tmpfs', SANDBOX_HOME,
  ];
  for (const p of roBinds) args.push('--ro-bind', p, p);
  if (workDir) args.push('--ro-bind', workDir, workDir);
  args.push('--chdir', workDir || SANDBOX_HOME, '--', ...command);
  return args;
}

const bwrapOk = new Map();
/** bwrap est-il installé et capable de créer un bac à sable (espaces de noms utilisateur) ? */
export function bwrapAvailable(bin = 'bwrap') {
  if (bwrapOk.get(bin)) return true;
  const r = spawnSync(bin, ['--version'], { stdio: 'ignore', timeout: 5000 });
  const ok = !r.error && r.status === 0;
  if (ok) bwrapOk.set(bin, true);
  return ok;
}

/**
 * Prépare un lancement : commande, arguments, environnement assaini, nettoyage.
 * @param {object} o
 * @param {string} o.bin             exécutable Claude
 * @param {string[]} o.args          arguments du CLI
 * @param {string} [o.cwd]           clone du projet ; doit être dans `allowedRoot`
 * @param {string} [o.allowedRoot]   dossier des clones de CET utilisateur
 * @param {Record<string,string>} [o.secretEnv]  le secret de l'utilisateur (clé API ou jeton)
 * @param {object} o.sandbox         cfg.sandbox : { enabled, production, bwrapBin, roBinds }
 * @param {object} [deps]            { parentEnv, hasBwrap, resolveBin } (tests)
 */
export function prepareLaunch(o, deps = {}) {
  const sb = o.sandbox;
  if (!sb) throw new Error('Configuration du bac à sable requise');
  const parentEnv = deps.parentEnv || process.env;
  const cwd = o.cwd ? resolve(o.cwd) : null;
  if (cwd && o.allowedRoot && !isInside(o.allowedRoot, cwd)) {
    throw new Error("Répertoire de travail hors du dossier de l'utilisateur : exécution refusée");
  }
  // Production : le bac à sable n'est jamais optionnel, même si la configuration dit le contraire
  if (sb.production && !sb.enabled) throw new Error('Bac à sable obligatoire en production : exécution refusée');
  const nice = ['nice', '-n', '10']; // le serveur web reste réactif pendant qu'un job tourne

  if (!sb.enabled) {
    // Développement uniquement (SANDBOX=off). HOME jetable : la configuration du CLI de la machine n'est jamais lue.
    const home = mkdtempSync(join(tmpdir(), 'aitools-home-'));
    return {
      command: nice[0], args: [...nice.slice(1), o.bin, ...o.args], cwd: cwd || undefined, sandboxed: false,
      env: buildChildEnv(parentEnv, { secretEnv: o.secretEnv, home }),
      cleanup: () => { rmSync(home, { recursive: true, force: true }); },
    };
  }

  if (!(deps.hasBwrap || bwrapAvailable)(sb.bwrapBin)) {
    throw new Error('Bac à sable (bwrap) indisponible : exécution refusée');
  }
  const real = (deps.resolveBin || resolveBin)(o.bin, parentEnv.PATH);
  if (!real) throw new Error(`Exécutable Claude introuvable : ${o.bin}`);
  const roBinds = [...new Set([...(sb.roBinds || []), ...(real.startsWith('/usr/') ? [] : [dirname(real)])])];
  const bwrap = buildBwrapArgs({
    workDir: cwd, roBinds, command: [real, ...o.args],
  });
  return {
    command: nice[0], args: [...nice.slice(1), sb.bwrapBin, ...bwrap], cwd: tmpdir(), sandboxed: true,
    // Le secret n'est jamais dans argv : bwrap transmet son propre environnement au processus du bac à sable
    env: buildChildEnv(parentEnv, { secretEnv: o.secretEnv, home: SANDBOX_HOME }),
    cleanup: () => {},
  };
}

export const sandboxStartupMessages = (sb) => [
  ...(sb.offIgnored ? ['SANDBOX=off est ignoré en production : le bac à sable reste obligatoire.'] : []),
  ...(!sb.enabled ? ['SANDBOX=off : les jobs IA tournent SANS bac à sable (développement uniquement).'] : []),
  ...(sb.enabled && !bwrapAvailable(sb.bwrapBin) ? [`${sb.bwrapBin} introuvable ou inutilisable : les jobs IA seront refusés (installe bubblewrap).`] : []),
];
