// Auth Google (OIDC, code flow + PKCE) avec whitelist d'emails. Sessions en base.
import { createHash } from 'node:crypto';
import { now } from './db.js';
import { randomId } from './crypto.js';
import { parseCookies, setCookie, redirect, HttpError } from './http.js';

const SESSION_COOKIE = 'sid';
const SESSION_TTL = 30 * 24 * 3600;
const STATE_TTL = 600;
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

export async function getSession(db, req) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (!sid) return null;
  const s = await db.prepare('SELECT * FROM sessions WHERE id = ? AND expires_at > ?').get(sid, now());
  return s || null;
}

export async function createSession(db, res, email) {
  const id = randomId();
  await db.prepare('INSERT INTO sessions(id, email, created_at, expires_at) VALUES(?, ?, ?, ?)')
    .run(id, email, now(), now() + SESSION_TTL);
  setCookie(res, SESSION_COOKIE, id, { maxAge: SESSION_TTL });
}

export async function destroySession(db, req, res) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (sid) await db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
  setCookie(res, SESSION_COOKIE, '', { maxAge: 0 });
}

export async function purgeExpired(db) {
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  await db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(now() - STATE_TTL);
}

export async function startGoogleLogin(db, cfg, res) {
  const state = randomId(24);
  const nonce = randomId(24);
  const verifier = randomId(48);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  await db.prepare('INSERT INTO oauth_states(state, verifier, nonce, created_at) VALUES(?, ?, ?, ?)')
    .run(state, verifier, nonce, now());
  const q = new URLSearchParams({
    client_id: cfg.google.clientId,
    redirect_uri: `${cfg.appUrl}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email',
    state, nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  redirect(res, `${GOOGLE_AUTH}?${q}`);
}

// Vérifie les claims de l'id_token. Il est reçu directement de Google en TLS (code flow),
// la validation TLS remplace la vérification de signature (OIDC Core §3.1.3.7).
export function checkIdTokenClaims(claims, { clientId, nonce, allowedEmails, at = now() }) {
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)) throw new HttpError(401, 'Émetteur invalide');
  if (claims.aud !== clientId) throw new HttpError(401, 'Audience invalide');
  if (!claims.exp || claims.exp < at) throw new HttpError(401, 'Token expiré');
  if (claims.nonce !== nonce) throw new HttpError(401, 'Nonce invalide');
  if (!claims.email_verified) throw new HttpError(403, 'Email Google non vérifié');
  const email = String(claims.email || '').toLowerCase();
  if (!allowedEmails.includes(email)) throw new HttpError(403, 'Compte non autorisé');
  return email;
}

export function decodeJwtPayload(jwt) {
  const part = String(jwt).split('.')[1];
  if (!part) throw new HttpError(401, 'id_token invalide');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

export async function finishGoogleLogin(db, cfg, url, res) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) throw new HttpError(400, 'Paramètres OAuth manquants');

  const row = await db.prepare('SELECT * FROM oauth_states WHERE state = ? AND created_at > ?').get(state, now() - STATE_TTL);
  await db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);
  if (!row) throw new HttpError(400, 'State OAuth invalide ou expiré');

  const r = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.google.clientId,
      client_secret: cfg.google.clientSecret,
      redirect_uri: `${cfg.appUrl}/auth/google/callback`,
      grant_type: 'authorization_code',
      code_verifier: row.verifier,
    }),
  });
  if (!r.ok) throw new HttpError(401, `Échange du code Google refusé (${r.status})`);
  const tokens = await r.json();
  const email = checkIdTokenClaims(decodeJwtPayload(tokens.id_token), {
    clientId: cfg.google.clientId, nonce: row.nonce, allowedEmails: cfg.allowedEmails,
  });
  await createSession(db, res, email);
  redirect(res, '/');
}

// Anti-CSRF : toute requête non-GET doit venir de notre origine (en plus de SameSite=Lax)
export function checkOrigin(req, cfg) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.origin || '';
  if (origin !== cfg.appUrl) throw new HttpError(403, 'Origine refusée');
}
