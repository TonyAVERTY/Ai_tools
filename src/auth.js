// Connexion Google et Apple (OIDC, code flow), sessions en base liées à users.id.
// Pas de mot de passe : l'inscription est automatique à la première connexion réussie.
import { createHash, createPrivateKey, createPublicKey, sign, verify, timingSafeEqual } from 'node:crypto';
import { now } from './db.js';
import { randomId, hashSid } from './crypto.js';
import { parseCookies, setCookie, redirect, HttpError } from './http.js';
import { loginIdentity } from './users.js';

const SESSION_COOKIE = 'sid';
const BIND_COOKIE = 'oauth_b';
const SESSION_TTL = 30 * 24 * 3600;
const STATE_TTL = 600;
const JWKS_TTL = 3600;
const APPLE_AUD = 'https://appleid.apple.com';

export const PROVIDERS = {
  google: {
    label: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    scope: 'openid email profile',
    extra: { prompt: 'select_account' },
    pkce: true,
  },
  apple: {
    label: 'Apple',
    authUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    issuers: [APPLE_AUD],
    scope: 'name email',
    extra: { response_mode: 'form_post' }, // obligatoire dès que le scope demande le nom ou l'email
    pkce: false,
  },
};

// ---------- Sessions ----------

/** Session valide d'un compte actif. Un compte suspendu n'a plus de session utilisable (elles sont supprimées). */
export async function getSession(db, req) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (!sid) return null;
  const s = await db.prepare(`SELECT s.id, s.user_id, u.email, u.name, u.provider, u.status, u.is_admin
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`).get(hashSid(sid), now());
  if (!s) return null;
  if (s.status !== 'active') {
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(s.user_id);
    return null;
  }
  return {
    id: s.id, userId: Number(s.user_id), email: s.email,
    user: { id: Number(s.user_id), email: s.email, name: s.name, provider: s.provider, status: s.status, isAdmin: !!s.is_admin },
  };
}

export async function createSession(db, res, userId) {
  const id = randomId();
  await db.prepare('INSERT INTO sessions(id, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)')
    .run(hashSid(id), userId, now(), now() + SESSION_TTL); // en base : l'empreinte ; le cookie garde l'identifiant
  setCookie(res, SESSION_COOKIE, id, { maxAge: SESSION_TTL });
}

export async function destroySession(db, req, res) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (sid) await db.prepare('DELETE FROM sessions WHERE id = ?').run(hashSid(sid));
  setCookie(res, SESSION_COOKIE, '', { maxAge: 0 });
}

/** Suspension : toutes les sessions du compte tombent tout de suite. */
export async function destroyUserSessions(db, userId) {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export async function purgeExpired(db) {
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  await db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(now() - STATE_TTL);
}

// ---------- JWT ----------

const b64json = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

export function decodeJwtPayload(jwt) {
  const part = String(jwt).split('.')[1];
  if (!part) throw new HttpError(401, 'id_token invalide');
  try { return b64json(part); } catch { throw new HttpError(401, 'id_token invalide'); }
}

/**
 * Secret client Apple : un JWT signé en ES256 avec la clé privée du compte développeur
 * (APPLE_KEY_ID / APPLE_TEAM_ID / APPLE_CLIENT_ID). Signature brute r||s (ieee-p1363), comme l'exige JWS.
 */
export function appleClientSecret(apple, { at = now(), ttl = 300 } = {}) {
  const head = b64({ alg: 'ES256', kid: apple.keyId, typ: 'JWT' });
  const body = b64({ iss: apple.teamId, iat: at, exp: at + ttl, aud: APPLE_AUD, sub: apple.clientId });
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: createPrivateKey(apple.privateKey), dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}

const fetcher = (app) => app.fetch || fetch;

async function loadJwks(app, url) {
  const r = await fetcher(app)(url, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new HttpError(502, `Clés publiques indisponibles (${r.status})`);
  const keys = (await r.json()).keys;
  if (!Array.isArray(keys)) throw new HttpError(502, 'Clés publiques invalides');
  return keys;
}

// Clés du fournisseur en cache ; une clé inconnue (rotation) déclenche une seule relecture, pas plus d'une par minute
async function findJwk(app, url, kid) {
  const cache = (app.jwksCache ??= new Map());
  let entry = cache.get(url);
  const find = (e) => e?.keys.find((k) => k.kid === kid && k.kty === 'RSA');
  if (!entry || now() - entry.at > JWKS_TTL) {
    entry = { keys: await loadJwks(app, url), at: now() };
    cache.set(url, entry);
  } else if (!find(entry) && now() - entry.at > 60) {
    entry = { keys: await loadJwks(app, url), at: now() };
    cache.set(url, entry);
  }
  return find(entry);
}

/** Vérifie la signature RS256 d'un id_token avec les JWKS du fournisseur, et renvoie ses claims (pas encore validés). */
export async function verifyIdTokenSignature(app, jwt, jwksUrl) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) throw new HttpError(401, 'id_token invalide');
  let header;
  try { header = b64json(parts[0]); } catch { throw new HttpError(401, 'id_token invalide'); }
  if (header.alg !== 'RS256') throw new HttpError(401, 'Algorithme de signature refusé');
  const jwk = await findJwk(app, jwksUrl, header.kid);
  if (!jwk) throw new HttpError(401, 'Clé de signature inconnue');
  let ok = false;
  try {
    ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  } catch { ok = false; }
  if (!ok) throw new HttpError(401, 'Signature de l\'id_token invalide');
  return decodeJwtPayload(jwt);
}

/**
 * Valide les claims d'un id_token déjà authentifié (signature vérifiée) : émetteur, audience, expiration,
 * nonce, identifiant (sub) et email vérifié. Renvoie l'identité à inscrire / connecter.
 */
export function checkIdTokenClaims(claims, { issuers, clientId, nonce, at = now() }) {
  if (!issuers.includes(claims.iss)) throw new HttpError(401, 'Émetteur invalide');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new HttpError(401, 'Audience invalide');
  if (!claims.exp || claims.exp < at) throw new HttpError(401, 'Token expiré');
  if (!claims.nonce || claims.nonce !== nonce) throw new HttpError(401, 'Nonce invalide');
  if (!claims.sub) throw new HttpError(401, 'Identifiant fournisseur manquant');
  // Apple renvoie parfois "true" en chaîne
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw new HttpError(403, 'Email non vérifié par le fournisseur');
  const email = String(claims.email || '').trim().toLowerCase();
  if (!email) throw new HttpError(401, 'Email manquant');
  return { sub: String(claims.sub), email, name: claims.name || null };
}

// ---------- Flux OAuth ----------

const hashBind = (v) => createHash('sha256').update(String(v)).digest('hex');

function providerOf(cfg, name) {
  const p = PROVIDERS[name];
  if (!p || (name === 'apple' && !cfg.apple)) throw new HttpError(404, 'Fournisseur de connexion indisponible');
  return p;
}

const clientIdOf = (cfg, name) => (name === 'apple' ? cfg.apple.clientId : cfg.google.clientId);
const redirectUri = (cfg, name) => `${cfg.appUrl}/auth/${name}/callback`;

/**
 * Démarre la connexion : state + nonce (+ PKCE pour Google) en base, et un cookie qui lie le flux à CE navigateur.
 * Le retour d'Apple est un POST cross-site (form_post) : ni le cookie de session ni un cookie SameSite=Lax ne
 * suivent. Le cookie de liaison est donc SameSite=None, Secure, HttpOnly, limité à /auth et à 10 minutes.
 */
export async function startLogin(app, name, res) {
  const { db, cfg } = app;
  const p = providerOf(cfg, name);
  const state = randomId(24);
  const nonce = randomId(24);
  const verifier = randomId(48);
  const bind = randomId(24);
  await db.prepare('INSERT INTO oauth_states(state, provider, verifier, nonce, binding, created_at) VALUES(?, ?, ?, ?, ?, ?)')
    .run(state, name, verifier, nonce, hashBind(bind), now());
  setCookie(res, BIND_COOKIE, bind, { maxAge: STATE_TTL, sameSite: 'None', path: '/auth' });
  const q = new URLSearchParams({
    client_id: clientIdOf(cfg, name),
    redirect_uri: redirectUri(cfg, name),
    response_type: 'code',
    scope: p.scope,
    state, nonce,
    ...p.extra,
  });
  if (p.pkce) {
    q.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    q.set('code_challenge_method', 'S256');
  }
  redirect(res, `${p.authUrl}?${q}`);
}

// Apple n'envoie le nom que lors de la toute première autorisation, dans le champ `user` du formulaire
function appleName(raw) {
  try {
    const n = JSON.parse(raw)?.name;
    return [n?.firstName, n?.lastName].filter((x) => typeof x === 'string').join(' ').trim() || null;
  } catch { return null; }
}

/**
 * Termine la connexion. `params` = paramètres de retour (query pour Google, corps du POST pour Apple).
 * Contrôles : state connu, à usage unique, non expiré, du bon fournisseur et lié au navigateur (cookie) ;
 * signature RS256 de l'id_token vérifiée avec les JWKS du fournisseur ; iss / aud / exp / nonce validés.
 */
export async function finishLogin(app, name, params, req, res) {
  const { db, cfg } = app;
  const p = providerOf(cfg, name);
  const get = (k) => (typeof params.get === 'function' ? params.get(k) : params[k]);
  const state = get('state');
  const row = state
    ? await db.prepare('SELECT * FROM oauth_states WHERE state = ? AND created_at > ?').get(String(state), now() - STATE_TTL)
    : null;
  if (state) await db.prepare('DELETE FROM oauth_states WHERE state = ?').run(String(state)); // usage unique
  setCookie(res, BIND_COOKIE, '', { maxAge: 0, sameSite: 'None', path: '/auth' });

  if (get('error')) throw new HttpError(401, get('error') === 'user_cancelled_authorize' ? 'Connexion annulée' : `Connexion refusée (${String(get('error')).slice(0, 60)})`);
  const code = get('code');
  if (!code || !state) throw new HttpError(400, 'Paramètres OAuth manquants');
  if (!row || row.provider !== name) throw new HttpError(400, 'State OAuth invalide ou expiré');
  const bind = parseCookies(req)[BIND_COOKIE];
  const a = Buffer.from(hashBind(bind || ''));
  const b = Buffer.from(String(row.binding));
  if (!bind || a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(400, 'Connexion démarrée depuis un autre navigateur');

  const body = new URLSearchParams({
    code: String(code),
    client_id: clientIdOf(cfg, name),
    client_secret: name === 'apple' ? appleClientSecret(cfg.apple) : cfg.google.clientSecret,
    redirect_uri: redirectUri(cfg, name),
    grant_type: 'authorization_code',
  });
  if (p.pkce) body.set('code_verifier', row.verifier);
  const r = await fetcher(app)(p.tokenUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new HttpError(401, `Échange du code ${p.label} refusé (${r.status})`);
  const tokens = await r.json();

  const claims = await verifyIdTokenSignature(app, tokens.id_token, p.jwksUrl);
  const id = checkIdTokenClaims(claims, { issuers: p.issuers, clientId: clientIdOf(cfg, name), nonce: row.nonce });
  if (name === 'apple') id.name = appleName(get('user')) || id.name;

  const user = await loginIdentity(db, cfg, { provider: name, sub: id.sub, email: id.email, name: id.name });
  await createSession(db, res, user.id);
  redirect(res, '/');
}

// Anti-CSRF : toute requête non-GET doit venir de notre origine (en plus de SameSite=Lax)
export function checkOrigin(req, cfg) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.origin || '';
  if (origin !== cfg.appUrl) throw new HttpError(403, 'Origine refusée');
}
