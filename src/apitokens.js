// Mode développeur et jetons d'API. Le mode est un réglage du compte ; un jeton ne fonctionne que tant qu'il est actif.
// Un jeton = « iaboss_ » + 32 octets aléatoires. Les jetons « aitk_ » créés avant le renommage restent valides (même longueur, même hachage). Il n'est montré qu'à sa création : la base ne garde que son SHA-256.
import { randomBytes } from 'node:crypto';
import { now, getSetting, setSetting } from './db.js';
import { hashSid } from './crypto.js';
import { HttpError } from './http.js';

export const SCOPES = {
  read: 'Lire les projets, prospects, réponses et statistiques',
  write: 'Modifier : ajouter des prospects et des notes, changer un statut ou une prochaine action',
  jobs: 'Lancer des tâches : analyse, recherche, régénération d\'accroche, audit, envoi de mails',
};
export const MAX_TOKENS = 5;
const PREFIX = 'iaboss_';
const TOKEN_RE = /^(?:iaboss|aitk)_[A-Za-z0-9_-]{43}$/;

export const developerMode = async (db, userId) => (await getSetting(db, userId, 'developer_mode', '0')) === '1';
export const setDeveloperMode = (db, userId, on) => setSetting(db, userId, 'developer_mode', on ? '1' : '0');

const cleanScopes = (list) => {
  const s = [...new Set((Array.isArray(list) ? list : String(list || '').split(',')).map((x) => String(x).trim()).filter((x) => SCOPES[x]))];
  return s.length ? s : ['read'];
};

/** Crée un jeton. @returns {{id, token, scopes}} `token` n'est renvoyé qu'ici. */
export async function createApiToken(db, userId, { name, scopes }) {
  if (!(await developerMode(db, userId))) throw new HttpError(403, 'Active le mode développeur avant de créer un jeton', { expose: true });
  const count = Number((await db.prepare('SELECT COUNT(*) n FROM api_tokens WHERE user_id = ?').get(Number(userId))).n);
  if (count >= MAX_TOKENS) throw new HttpError(400, `${MAX_TOKENS} jetons au plus : supprime-en un avant d'en créer un autre`, { expose: true });
  const label = String(name || '').trim().slice(0, 100) || 'Jeton sans nom';
  const sc = cleanScopes(scopes);
  const token = PREFIX + randomBytes(32).toString('base64url');
  const r = await db.prepare('INSERT INTO api_tokens(user_id, name, token_hash, prefix, scopes, created_at) VALUES(?, ?, ?, ?, ?, ?)')
    .run(Number(userId), label, hashSid(token), token.slice(0, 9), sc.join(','), now());
  return { id: Number(r.lastInsertRowid), token, scopes: sc };
}

export async function listApiTokens(db, userId) {
  return (await db.prepare('SELECT id, name, prefix, scopes, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY id').all(Number(userId)))
    .map((t) => ({ id: Number(t.id), name: t.name, prefix: t.prefix, scopes: t.scopes.split(','), createdAt: Number(t.created_at), lastUsedAt: t.last_used_at ? Number(t.last_used_at) : null }));
}

export async function revokeApiToken(db, userId, id) {
  return (await db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(Number(id), Number(userId))).changes > 0;
}

/**
 * Authentifie une requête d'API : en-tête « Authorization: Bearer iaboss_… ». Les cookies ne comptent jamais ici.
 * Le compte doit être actif ET en mode développeur : désactiver le mode coupe tous ses jetons d'un coup.
 * @returns {Promise<{userId:number, tokenId:number, scopes:string[], user:object}>}
 */
export async function authenticateApi(db, req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!m || !TOKEN_RE.test(m[1])) throw new HttpError(401, 'Jeton d\'API manquant ou invalide', { expose: true, code: 'invalid_token', headers: { 'WWW-Authenticate': 'Bearer' } });
  const row = await db.prepare(`SELECT t.id, t.user_id, t.scopes, u.email, u.status, u.plan FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`).get(hashSid(m[1]));
  if (!row) throw new HttpError(401, 'Jeton d\'API manquant ou invalide', { expose: true, code: 'invalid_token', headers: { 'WWW-Authenticate': 'Bearer' } });
  if (row.status !== 'active') throw new HttpError(403, 'Compte suspendu', { expose: true, code: 'suspended' });
  if (!(await developerMode(db, row.user_id))) throw new HttpError(403, 'Le mode développeur est désactivé sur ce compte', { expose: true, code: 'developer_mode_off' });
  // « dernière utilisation » : au plus une écriture par minute et par jeton
  await db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)').run(now(), row.id, now() - 60);
  return { userId: Number(row.user_id), tokenId: Number(row.id), scopes: row.scopes.split(','), email: row.email };
}

export function needScope(api, scope) {
  if (!api.scopes.includes(scope)) throw new HttpError(403, `Ce jeton n'a pas le droit « ${scope} »`, { expose: true, code: 'insufficient_scope' });
}
