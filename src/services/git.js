// Clone / mise à jour des repos Forgejo. Clone superficiel (--depth 1) : léger sur le SSD.
// Le token passe par variables d'env GIT_CONFIG_* : jamais écrit dans .git/config, invisible dans `ps`.
import { execFile } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export function validateGitUrl(url, allowedHost) {
  let u;
  try { u = new URL(url); } catch { throw new Error('URL Git invalide'); }
  if (u.protocol !== 'https:') throw new Error('Seules les URL https:// sont acceptées');
  if (u.username || u.password) throw new Error("Ne mets pas d'identifiants dans l'URL, configure le token dans Réglages");
  if (allowedHost && u.host !== allowedHost) throw new Error(`Le repo doit être sur ${allowedHost}`);
  if (!/^\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/.test(u.pathname)) throw new Error('Format attendu : https://hôte/utilisateur/repo.git');
  return u.toString().replace(/\/$/, '');
}

function gitEnv(token) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (token) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.extraHeader';
    env.GIT_CONFIG_VALUE_0 = `Authorization: token ${token}`;
  }
  return env;
}

const opts = (token, cwd) => ({ env: gitEnv(token), cwd, timeout: 5 * 60_000, maxBuffer: 1024 * 1024 });

// Clone ou met à jour. Retourne le hash du commit HEAD.
export async function syncRepo(url, dir, token) {
  try {
    if (existsSync(`${dir}/.git`)) {
      await run('git', ['fetch', '--depth', '1', 'origin', 'HEAD'], opts(token, dir));
      await run('git', ['reset', '--hard', 'FETCH_HEAD'], opts(token, dir));
    } else {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dirname(dir), { recursive: true });
      await run('git', ['clone', '--depth', '1', '--single-branch', url, dir], opts(token));
    }
    const { stdout } = await run('git', ['rev-parse', 'HEAD'], opts(null, dir));
    return stdout.trim();
  } catch (e) {
    // On ne remonte jamais stderr brut (pourrait contenir l'en-tête d'auth)
    const msg = String(e.stderr || e.message).replace(/Authorization: token \S+/g, 'Authorization: ***');
    throw new Error(`Git : ${msg.split('\n').filter(Boolean).slice(-2).join(' ')}`);
  }
}

export function removeRepo(dir) { rmSync(dir, { recursive: true, force: true }); }
