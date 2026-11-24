// Écriture dans le dépôt du projet : créer une branche, commiter, pousser. Le code de l'application le fait, jamais l'IA.
// Jamais de push forcé ; la cible est le dépôt déjà enregistré du projet (https, jeton de SON serveur seulement).
import { GIT_HARDENING, pinArgs, runGit } from './git.js';

const COMMIT_IDENTITY = ['-c', 'user.name=iaboss', '-c', 'user.email=noreply@iaboss.fr'];

/** Nom de branche accepté : lettres, chiffres, point, tiret, souligné et barre oblique ; rien qui ressemble à une option ou à une remontée. */
export function validBranch(b) {
  const v = String(b ?? '');
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,98}[A-Za-z0-9]$/.test(v) && !/\.\.|\/\/|\.lock$|\/\.|\.$/.test(v);
}

const slug = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

/** `iaboss/<idée>-<numéro du job>` : unique, lisible, jamais une branche existante. */
export const newBranchName = (title, jobId) => `iaboss/${slug(title) || 'idee'}-${Number(jobId)}`;

const cleanMsg = (t) => String(t ?? '').replace(/[\0-\x08\x0b-\x1f]/g, ' ').trim().slice(0, 4000);
const redact = (t) => String(t ?? '').replace(/Authorization: (?:token|Basic) \S+/gi, 'Authorization: ***');

/** Branche par défaut du dépôt (celle que « Directement sur la branche principale » vise). */
export async function defaultBranch(auth) {
  const { stdout } = await runGit([...GIT_HARDENING, ...pinArgs(auth.pin), 'ls-remote', '--symref', 'origin', 'HEAD'], { ...auth }).catch((e) => { throw gitError(e); });
  const m = /^ref: refs\/heads\/(\S+)\s+HEAD/m.exec(stdout);
  if (!m || !validBranch(m[1])) throw new Error('Git : branche principale introuvable');
  return m[1];
}

function gitError(e) {
  const raw = redact(e.stderr || e.message).split('\n').filter(Boolean).slice(-2).join(' ');
  if (/denied|403|not permitted|insufficient|forbidden|permission|401/i.test(raw)) {
    return new Error(`Git : le token n'a pas le droit d'écrire dans ce dépôt. Donne-lui l'écriture sur le contenu (GitHub : « Contents : Read and write »), dans Réglages → Dépôts Git (${raw})`);
  }
  if (/protected branch|non-fast-forward|rejected|fetch first/i.test(raw)) return new Error(`Git : la branche refuse le push (protégée ou modifiée entre-temps) : choisis « Nouvelle branche » (${raw})`);
  return new Error(`Git : ${raw || 'échec'}`);
}

/**
 * Commit des fichiers listés (ajoutés, modifiés ou supprimés) puis push SANS force vers `branch`.
 * @param {string} dir clone du projet
 * @param {{ files: string[], branch: string, createBranch: boolean, message: string }} o
 * @param {{ token?: string, scheme?: string, user?: string, pin?: object }} auth
 * @returns {Promise<string>} hash du commit
 */
export async function commitAndPush(dir, { files, branch, createBranch, message }, auth) {
  if (!validBranch(branch)) throw new Error('Nom de branche invalide');
  if (!files.length || files.some((f) => !f || f.startsWith('-'))) throw new Error('Liste de fichiers invalide');
  const run = (args, withAuth = false) => runGit([...GIT_HARDENING, ...(withAuth ? pinArgs(auth.pin) : []), ...args], { cwd: dir, ...(withAuth ? auth : {}) });
  try {
    if (createBranch) await run(['checkout', '-b', branch]);
    await run(['add', '-A', '--', ...files]);
    await run([...COMMIT_IDENTITY, 'commit', '--no-verify', '-m', cleanMsg(message)]);
    const { stdout } = await run(['rev-parse', 'HEAD']);
    const sha = stdout.trim();
    await run(['push', 'origin', `HEAD:refs/heads/${branch}`], true);
    return sha;
  } catch (e) { throw gitError(e); }
}

/** Adresse où voir la branche sur le serveur Git (GitHub, GitLab, Gitea/Forgejo : même forme) ; null si l'adresse est inattendue. */
export function branchUrl(gitUrl, branch) {
  try {
    const u = new URL(gitUrl);
    return `${u.origin}${u.pathname.replace(/\.git$/, '').replace(/\/$/, '')}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`;
  } catch { return null; }
}
