// Clone / mise à jour des dépôts Git (GitHub, ou le serveur Git perso de l'utilisateur). Clone superficiel (--depth 1) : léger sur le SSD.
// Le token passe par variables d'env GIT_CONFIG_* : jamais écrit dans .git/config, invisible dans `ps`.
// L'URL vient de l'utilisateur : https seulement, aucun hook ni sous-module, délai et taille bornés.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildChildEnv } from './sandbox.js';
import { tmpdir } from 'node:os';

export const GIT_TIMEOUT_MS = 2 * 60_000;
export const GIT_MAX_BYTES = 300 * 1024 * 1024;

/** Hôtes acceptés d'office, sans réglage : GitHub (dépôts publics). Le serveur Git personnel d'un utilisateur s'y ajoute. */
export const DEFAULT_GIT_HOSTS = ['github.com'];

/**
 * @param {string} url
 * @param {string|string[]} [allowedHosts]  hôtes (avec port éventuel) où le dépôt peut se trouver ; omis = pas de contrôle d'hôte
 */
export function validateGitUrl(url, allowedHosts) {
  let u;
  try { u = new URL(url); } catch { throw new Error('URL Git invalide'); }
  if (u.protocol !== 'https:') throw new Error('Seules les URL https:// sont acceptées');
  if (u.username || u.password) throw new Error("Ne mets pas d'identifiants dans l'URL, configure le token dans Réglages");
  const hosts = [allowedHosts].flat().filter(Boolean);
  if (hosts.length && !hosts.includes(u.host)) throw new Error(`Le repo doit être sur ${hosts.join(' ou ')}`);
  if (!/^\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/.test(u.pathname)) throw new Error('Format attendu : https://hôte/utilisateur/repo.git');
  return u.toString().replace(/\/$/, '');
}

/**
 * Environnement de git : liste blanche (aucun secret du serveur), https seulement, aucune configuration
 * globale ou système lue, aucune invite.
 */
export function gitEnv(token, { parentEnv = process.env, scheme = 'token', user = 'x-access-token' } = {}) {
  const env = {
    ...buildChildEnv(parentEnv, { home: tmpdir() }),
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'https',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  };
  if (token) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.extraHeader';
    // GitHub et GitLab veulent l'authentification Basic sur leurs points d'accès git (comme actions/checkout) ; Forgejo/Gitea acceptent « token »
    env.GIT_CONFIG_VALUE_0 = scheme === 'basic'
      ? `Authorization: Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`
      : `Authorization: token ${token}`;
  }
  return env;
}

// Réglages passés à CHAQUE commande : pas de hooks (ni ceux du dépôt cloné), pas de sous-modules, https seul,
// pas de filtres ni de commandes externes déclenchées par le contenu du dépôt
export const GIT_HARDENING = [
  '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always',
  '-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'),
  '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false', '-c', 'core.symlinks=false',
];

// Épinglage : git se connecte à l'adresse déjà vérifiée (pas de seconde résolution DNS) et ne suit aucune redirection,
// qui pourrait mener vers un hôte interne. Nécessite git >= 2.37 pour http.curloptResolve (ignoré sur une version plus ancienne).
export function pinArgs(pin) {
  if (!pin) return [];
  const addr = pin.family === 6 ? `[${pin.address}]` : pin.address;
  return ['-c', `http.curloptResolve=${pin.host}:${pin.port}:${addr}`, '-c', 'http.followRedirects=false'];
}

export const cloneArgs = (url, dir, pin = null) => [...GIT_HARDENING, ...pinArgs(pin), 'clone', '--depth', '1', '--single-branch', '--no-tags', '--no-recurse-submodules', url, dir];
export const fetchArgs = (pin = null) => [...GIT_HARDENING, ...pinArgs(pin), 'fetch', '--depth', '1', '--no-tags', '--no-recurse-submodules', 'origin', 'HEAD'];

/** Taille d'un dossier en octets (sans suivre les liens symboliques). Coupe court dès que `limit` est dépassé. */
export function dirSize(dir, limit = Infinity) {
  let total = 0;
  const stack = [dir];
  while (stack.length && total <= limit) {
    const d = stack.pop();
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { total += statSync(p).size; } catch { /* disparu */ } }
    }
  }
  return total;
}

// Lance git avec délai et taille bornés : au-delà, le processus est tué et le dossier surveillé effacé par l'appelant
function runGit(args, { token, scheme, user, cwd, watchDir, timeoutMs = GIT_TIMEOUT_MS, maxBytes = GIT_MAX_BYTES, gitBin = 'git' }) {
  return new Promise((resolve, reject) => {
    const child = spawn(gitBin, args, { env: gitEnv(token, { scheme, user }), cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', killed = null;
    const kill = (why) => { killed = why; child.kill('SIGKILL'); };
    const timer = setTimeout(() => kill('Délai dépassé'), timeoutMs);
    const size = watchDir ? setInterval(() => { if (dirSize(watchDir, maxBytes) > maxBytes) kill('Dépôt trop volumineux'); }, 1500) : null;
    child.stdout.on('data', (c) => { stdout = (stdout + c).slice(-8000); });
    child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-8000); });
    child.on('error', (e) => { clearTimeout(timer); clearInterval(size); reject(Object.assign(e, { stderr })); });
    child.on('close', (code) => {
      clearTimeout(timer); clearInterval(size);
      if (killed) return reject(Object.assign(new Error(killed), { stderr: killed }));
      if (code !== 0) return reject(Object.assign(new Error(`git a échoué (code ${code})`), { stderr }));
      resolve({ stdout });
    });
  });
}

// Clone ou met à jour. Retourne le hash du commit HEAD.
export async function syncRepo(url, dir, token, opts = {}) {
  try {
    // L'URL est relue en base : on revalide ici (pas de file://, ext::, ssh) quel que soit l'appelant
    url = validateGitUrl(url);
    // `opts.scheme` / `opts.user` viennent du type de serveur ; à défaut, GitHub est en Basic et le reste en « token »
    const scheme = opts.scheme ?? (new URL(url).hostname === 'github.com' ? 'basic' : 'token');
    const { user } = opts;
    if (existsSync(`${dir}/.git`)) {
      await runGit(fetchArgs(opts.pin), { token, scheme, user, cwd: dir, watchDir: dir, ...opts });
      await runGit([...GIT_HARDENING, 'reset', '--hard', 'FETCH_HEAD'], { token, scheme, user, cwd: dir, ...opts });
    } else {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dirname(dir), { recursive: true });
      try { await runGit(cloneArgs(url, dir, opts.pin), { token, scheme, user, watchDir: dir, ...opts }); }
      catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
    }
    const { stdout } = await runGit([...GIT_HARDENING, 'rev-parse', 'HEAD'], { cwd: dir, ...opts });
    return stdout.trim();
  } catch (e) {
    // On ne remonte jamais stderr brut (pourrait contenir l'en-tête d'auth)
    const msg = String(e.stderr || e.message).replace(/Authorization: (?:token|Basic) \S+/gi, 'Authorization: ***');
    const raw = msg.split('\n').filter(Boolean).slice(-2).join(' ');
    const hint = authHint(raw, url, !!token);
    throw new Error(hint ? `Git : ${hint} (${raw})` : `Git : ${raw}`);
  }
}

/**
 * Traduit un refus d'accès de git en une phrase qui dit quoi faire. Le message de git est le même quand aucun token n'a été
 * envoyé et quand le serveur l'a refusé (« could not read Username ») : seul ce qu'on a réellement envoyé permet de les distinguer.
 * @returns {string|null} null : l'échec n'a rien à voir avec l'authentification
 */
export function authHint(stderr, url, tokenSent) {
  let host;
  try { host = new URL(url).host; } catch { return null; }
  const where = host === 'github.com' ? 'GitHub' : host;
  const notFound = /Repository not found|not found|returned error: (?:403|404)/i.test(stderr);
  const refused = /could not read Username|Authentication failed|Invalid username|returned error: 401|terminal prompts disabled/i.test(stderr);
  if (!notFound && !refused) return null;
  if (!tokenSent) {
    return `Dépôt privé ou introuvable : aucun token n'est configuré pour ${where}. Ajoute-le dans Réglages → Dépôts Git, puis clique sur « Réanalyser ».`;
  }
  return notFound && !refused
    ? `Le token n'a pas accès à ce dépôt (ou il n'existe pas). Ajoute-le aux dépôts du token sur ${where}, puis clique sur « Réanalyser ».`
    : `${where} a refusé le token (invalide, expiré, révoqué ou sans accès à ce dépôt). Vérifie-le dans Réglages${host === 'github.com' ? ' avec « Tester ce token »' : ''}, puis clique sur « Réanalyser ».`;
}

/** Versions de git trop anciennes pour ce qu'on lui demande ; à afficher au démarrage. */
export function gitVersionNotes(versionOutput) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(versionOutput));
  if (!m) return [];
  const v = Number(m[1]) * 1000 + Number(m[2]);
  return [
    ...(v < 2031 ? [`git ${m[0]} : trop ancien pour l'authentification par token (GIT_CONFIG_COUNT demande git ≥ 2.31) : les dépôts privés ne pourront pas être clonés.`] : []),
    ...(v < 2037 ? [`git ${m[0]} : l'épinglage d'adresse (http.curloptResolve) demande git ≥ 2.37, il sera ignoré.`] : []),
  ];
}

export function removeRepo(dir) { rmSync(dir, { recursive: true, force: true }); }
