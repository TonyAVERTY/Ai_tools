// Test d'un token GitHub : à qui il appartient, à quels dépôts il donne accès, et si les projets de l'utilisateur en font partie.
// Un seul hôte, fixe (api.github.com) : rien de saisi par l'utilisateur n'est appelé (pas de risque SSRF). Le token n'est jamais renvoyé.
import { HttpError } from './http.js';

const API = 'https://api.github.com';
export const MAX_REPOS = 100;

const headers = (token) => ({
  Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'iaboss',
});

/** `owner/repo` d'une URL de dépôt GitHub, en minuscules (GitHub ne distingue pas la casse), ou null. */
export function repoOfUrl(url) {
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(String(url));
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

async function call(app, path, token) {
  try { return await (app.fetch || fetch)(`${API}${path}`, { headers: headers(token), signal: AbortSignal.timeout(15_000) }); }
  catch { throw new HttpError(502, "Impossible de joindre GitHub pour tester le token (réseau). Réessaie dans un instant.", { expose: true }); }
}

/**
 * @param {object} app
 * @param {string} token        token à tester (jamais journalisé ni renvoyé)
 * @param {{name:string, url:string}[]} projects  projets de l'utilisateur, pour dire lesquels sont accessibles
 * @returns {Promise<{ok:true, login:string, kind:string, expiresAt:string|null, warning:string|null, repos:object[], truncated:boolean, projects:object[]} | {ok:false, message:string}>}
 */
export async function checkGithubToken(app, token, projects = []) {
  const me = await call(app, '/user', token);
  if (me.status === 401) return { ok: false, message: 'GitHub refuse ce token : invalide, expiré ou révoqué.' };
  if (me.status === 403 || me.status === 429) return { ok: false, message: 'GitHub limite temporairement les requêtes : réessaie dans quelques minutes.' };
  if (!me.ok) throw new HttpError(502, `GitHub ne répond pas normalement (HTTP ${me.status}).`, { expose: true });
  const user = await me.json().catch(() => null);

  const list = await call(app, `/user/repos?per_page=${MAX_REPOS}&sort=pushed&affiliation=owner,collaborator,organization_member`, token);
  if (!list.ok) throw new HttpError(502, `GitHub n'a pas donné la liste des dépôts (HTTP ${list.status}).`, { expose: true });
  const body = await list.json().catch(() => []);
  const repos = (Array.isArray(body) ? body : []).slice(0, MAX_REPOS).map((r) => ({ name: String(r.full_name), private: !!r.private }));
  const truncated = /rel="next"/.test(list.headers.get('link') ?? '');

  // Classique (ghp_) : la portée « repo » donne la lecture ET l'écriture sur tous les dépôts ; fine-grained (github_pat_) : limité à ceux choisis
  const scopes = (me.headers.get('x-oauth-scopes') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const kind = token.startsWith('github_pat_') ? 'fine-grained' : scopes.length || token.startsWith('ghp_') ? 'classique' : 'autre';
  const warning = kind === 'classique'
    ? "Token classique : il donne accès à tous tes dépôts, souvent en écriture. Préfère un token « fine-grained » limité aux dépôts voulus, en lecture seule (Contents : Read-only)."
    : null;

  const known = new Set(repos.map((r) => r.name.toLowerCase()));
  return {
    ok: true, login: String(user?.login ?? ''), kind, warning,
    expiresAt: me.headers.get('github-authentication-token-expiration') || null,
    repos, truncated,
    // Un projet absent d'une liste tronquée n'est pas forcément inaccessible : on ne le dit pas à tort (access: null)
    projects: projects.map((p) => {
      const repo = repoOfUrl(p.url);
      return { name: p.name, repo, access: !repo ? null : known.has(repo) ? true : truncated ? null : false };
    }).filter((p) => p.repo),
  };
}
