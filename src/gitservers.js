// Serveurs Git d'un utilisateur : GitHub (toujours là, seul son token se règle) et une liste de serveurs ajoutés dans les Réglages
// (Forgejo, Gitea, GitLab), chacun avec son URL et son token. Chaque token n'est présenté qu'à SON hôte.
import { randomBytes } from 'node:crypto';
import { getSetting, setSetting } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { HttpError } from './http.js';
import { checkGitHost } from './netguard.js';

/** `scheme` : forme de l'en-tête d'authentification de git sur ce type de serveur ; `user` : identifiant de l'auth Basic. */
export const GIT_SERVER_TYPES = {
  forgejo: { label: 'Forgejo', scheme: 'token', hint: 'Token créé dans Paramètres → Applications, avec la portée read:repository seulement.' },
  gitea: { label: 'Gitea', scheme: 'token', hint: 'Token créé dans Paramètres → Applications, avec la portée read:repository seulement.' },
  gitlab: { label: 'GitLab', scheme: 'basic', user: 'oauth2', hint: "Token d'accès personnel, avec la portée read_repository seulement." },
};
export const GITHUB = { host: 'github.com', scheme: 'basic', user: 'x-access-token' };
export const MAX_GIT_SERVERS = 5;
const MAX_TOKEN = 600;

const readList = (raw) => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch { return null; } };

/**
 * Les serveurs de l'utilisateur. Un compte qui n'a jamais enregistré la liste garde son ancien réglage unique
 * (`forgejo_host` + `forgejo_token_enc`) comme premier serveur : rien à migrer, et la première sauvegarde des Réglages le range dans la liste.
 * @returns {Promise<{id:string, type:string, host:string, tokenEnc:string|null}[]>}
 */
export async function listGitServers(db, userId) {
  const stored = readList(await getSetting(db, userId, 'git_servers_json'));
  if (stored) return stored.filter((s) => GIT_SERVER_TYPES[s?.type] && s.host).map((s) => ({ id: String(s.id), type: s.type, host: String(s.host), tokenEnc: s.tokenEnc || null }));
  const host = await getSetting(db, userId, 'forgejo_host');
  if (!host) return [];
  return [{ id: 'legacy', type: 'forgejo', host, tokenEnc: (await getSetting(db, userId, 'forgejo_token_enc')) || null }];
}

/** Ce que l'interface a le droit de voir : jamais le token, seulement s'il existe. */
export const publicGitServers = (list) => list.map((s) => ({ id: s.id, type: s.type, label: GIT_SERVER_TYPES[s.type].label, host: s.host, hasToken: !!s.tokenEnc }));

/** Hôtes où un dépôt peut se trouver pour cet utilisateur : GitHub d'office, puis ses serveurs. */
export async function allowedGitHosts(db, userId) {
  return [GITHUB.host, ...(await listGitServers(db, userId)).map((s) => s.host)];
}

const normalizeHost = (v) => String(v ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();

/**
 * Enregistre la liste à partir du formulaire des Réglages (champs git_type_i, git_host_i, git_token_i, git_id_i, git_del_i,
 * git_token_clear_i). Un token n'est conservé que pour le même hôte : si l'URL d'une ligne change, l'ancien token ne la suit pas.
 */
export async function saveGitServers(app, userId, body) {
  const { db, cfg } = app;
  const current = new Map((await listGitServers(db, userId)).map((s) => [s.id, s]));
  const rows = [...new Set(Object.keys(body).map((k) => /^git_host_(\d{1,2})$/.exec(k)?.[1]).filter(Boolean))].map(Number).sort((a, b) => a - b);
  const out = [];
  const seen = new Set();
  for (const i of rows) {
    if (body[`git_del_${i}`]) continue;
    const host = normalizeHost(body[`git_host_${i}`]);
    if (!host) continue; // ligne laissée vide : ignorée
    const type = String(body[`git_type_${i}`] ?? '');
    if (!GIT_SERVER_TYPES[type]) throw new HttpError(400, 'Type de serveur Git inconnu');
    if (host === GITHUB.host) throw new HttpError(400, 'GitHub est déjà là : renseigne seulement son token, en haut.');
    if (seen.has(host)) throw new HttpError(400, `${host} est renseigné deux fois`);
    seen.add(host);
    await checkGitHost(app, userId, host);
    const before = current.get(String(body[`git_id_${i}`] ?? ''));
    const typed = String(body[`git_token_${i}`] ?? '').trim().slice(0, MAX_TOKEN);
    let tokenEnc = null;
    if (typed) tokenEnc = encrypt(cfg.secretKey, typed);
    else if (before?.host === host && !body[`git_token_clear_${i}`]) tokenEnc = before.tokenEnc;
    out.push({ id: before?.id ?? randomBytes(4).toString('hex'), type, host, tokenEnc });
  }
  if (out.length > MAX_GIT_SERVERS) throw new HttpError(400, `${MAX_GIT_SERVERS} serveurs Git au plus`);
  await setSetting(db, userId, 'git_servers_json', JSON.stringify(out));
  // L'ancien réglage unique est désormais dans la liste : on l'efface pour qu'il ne revienne pas après une suppression
  await setSetting(db, userId, 'forgejo_host', null);
  await setSetting(db, userId, 'forgejo_token_enc', null);
}

/** Token GitHub de l'utilisateur : `typed` le remplace, `clear` l'efface, sinon inchangé. */
export async function saveGithubToken(app, userId, { typed, clear }) {
  const t = String(typed ?? '').trim().slice(0, MAX_TOKEN);
  if (t) await setSetting(app.db, userId, 'github_token_enc', encrypt(app.cfg.secretKey, t));
  else if (clear) await setSetting(app.db, userId, 'github_token_enc', null);
}

const reveal = (app, enc, label) => {
  try { return enc ? decrypt(app.cfg.secretKey, enc) : null; }
  catch { console.warn(`[secrets] token ${label} illisible, à ressaisir`); return null; }
};

/**
 * Identifiants à présenter à git pour cette URL, ou null (dépôt public, hôte inconnu, pas de token). Chaque token n'est destiné
 * qu'à son hôte exact : jamais à un autre (il fuiterait vers un service tiers), ni à un hôte qui ressemble au sien.
 * @returns {Promise<{token:string, scheme:'token'|'basic', user?:string} | null>}
 */
export async function gitCredentialFor(app, userId, url) {
  let host;
  try { host = new URL(url).host; } catch { return null; }
  if (host === GITHUB.host) {
    const token = reveal(app, await getSetting(app.db, userId, 'github_token_enc'), 'GitHub');
    return token ? { token, scheme: GITHUB.scheme, user: GITHUB.user } : null;
  }
  const server = (await listGitServers(app.db, userId)).find((s) => s.host === host);
  const token = server && reveal(app, server.tokenEnc, GIT_SERVER_TYPES[server.type].label);
  return token ? { token, scheme: GIT_SERVER_TYPES[server.type].scheme, user: GIT_SERVER_TYPES[server.type].user } : null;
}

export const gitTokenFor = async (app, userId, url) => (await gitCredentialFor(app, userId, url))?.token ?? null;
