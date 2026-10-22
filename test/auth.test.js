import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { now } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { PROVIDERS, appleClientSecret } from '../src/auth.js';
import { startApp, APP_URL } from './helpers/server.js';
import { makeProvider } from './helpers/oidc.js';
import { addUser } from './helpers/users.js';

// Flux Google et Apple avec des fournisseurs simulés : aucun appel réseau, tout passe par app.fetch.
const prov = makeProvider();
const PEM_HEAD = '-----BEGIN ' + 'PRIVATE KEY-----', PEM_FOOT = '-----END ' + 'PRIVATE KEY-----'; // faux contenu de .p8
let s, base, issue, calls;

before(async () => {
  s = await startApp({ cfg: { apple: prov.apple, adminEmails: ['admin@x.fr'] } });
  base = s.base;
  s.app.fetch = async (url, opts = {}) => {
    calls.push({ url, body: opts.body ? Object.fromEntries(new URLSearchParams(opts.body)) : null });
    if (url === PROVIDERS.google.jwksUrl || url === PROVIDERS.apple.jwksUrl) return { ok: true, status: 200, json: async () => ({ keys: [prov.jwk] }) };
    if (url === PROVIDERS.google.tokenUrl || url === PROVIDERS.apple.tokenUrl) {
      return issue ? { ok: true, status: 200, json: async () => ({ id_token: issue(url) }) } : { ok: false, status: 400, json: async () => ({}) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
});
after(() => s.close());

const GOOGLE_CLAIMS = (nonce, o = {}) => ({
  iss: 'https://accounts.google.com', aud: 'gid', sub: 'g-100', exp: now() + 600, iat: now(),
  nonce, email: 'Ada@Example.com', email_verified: true, name: 'Ada L.', ...o,
});
const APPLE_CLAIMS = (nonce, o = {}) => ({
  iss: 'https://appleid.apple.com', aud: prov.apple.clientId, sub: '001234.abcd.5678', exp: now() + 600, iat: now(),
  nonce, email: 'bob@privaterelay.appleid.com', email_verified: 'true', ...o,
});

const cookieOf = (r, name) => r.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));

/** Démarre une connexion : state, nonce et cookie de liaison du « navigateur ». */
async function start(provider) {
  calls = [];
  const r = await fetch(`${base}/auth/${provider}`, { redirect: 'manual' });
  assert.equal(r.status, 303);
  const loc = new URL(r.headers.get('location'));
  const set = cookieOf(r, 'oauth_b');
  return { loc, set, state: loc.searchParams.get('state'), nonce: loc.searchParams.get('nonce'), bind: set?.split(';')[0] };
}

const google = ({ state, bind, code = 'code-1' }) => fetch(`${base}/auth/google/callback?${new URLSearchParams({ code, state })}`,
  { redirect: 'manual', headers: bind ? { cookie: bind } : {} });
// Retour d'Apple : POST cross-site (form_post), l'origine est celle d'Apple
const apple = ({ state, bind, code = 'code-1', user, error }) => fetch(`${base}/auth/apple/callback`, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://appleid.apple.com', ...(bind ? { cookie: bind } : {}) },
  body: new URLSearchParams({ ...(code ? { code } : {}), state, ...(user ? { user } : {}), ...(error ? { error } : {}) }).toString(),
});

const failure = (r) => decodeURIComponent(new URL(r.headers.get('location'), base).searchParams.get('e') || '');
const sessions = async () => (await s.db.prepare('SELECT COUNT(*) n FROM sessions').get()).n;
const userByEmail = (email) => s.db.prepare('SELECT * FROM users WHERE email = ?').get(email);

test('Google : inscription automatique à la première connexion, session, PKCE et secret client', async () => {
  const st = await start('google');
  assert.equal(st.loc.host, 'accounts.google.com');
  assert.equal(st.loc.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(st.loc.searchParams.get('scope'), 'openid email profile');
  assert.match(st.set, /SameSite=None/);
  assert.match(st.set, /Secure/);
  assert.match(st.set, /HttpOnly/);
  assert.match(st.set, /Path=\/auth/);

  issue = () => prov.idToken(GOOGLE_CLAIMS(st.nonce));
  const before = await sessions();
  const r = await google(st);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/');
  const sid = cookieOf(r, 'sid');
  assert.ok(sid, 'cookie de session');
  assert.equal(await sessions(), before + 1);

  const exchange = calls.find((c) => c.url === PROVIDERS.google.tokenUrl).body;
  assert.equal(exchange.client_secret, 'gsecret');
  assert.ok(exchange.code_verifier, 'PKCE');
  assert.equal(exchange.redirect_uri, `${APP_URL}/auth/google/callback`);

  const u = await userByEmail('ada@example.com');
  assert.equal(u.provider, 'google');
  assert.equal(u.provider_sub, 'g-100');
  assert.equal(u.name, 'Ada L.');
  assert.equal(u.status, 'active');
  assert.equal(u.is_admin, 0);
  assert.equal(u.plan, 'free');
  assert.ok(u.last_login_at);
  assert.equal(u.claude_link_json, null);

  const home = await s.client(sid.split(';')[0]).get('/', { headers: { accept: 'text/html' } });
  // Nouveau compte sans liaison Claude : l'onboarding bloquant renvoie vers la page de liaison
  assert.equal(home.status, 303);
  assert.equal(home.headers.get('location'), '/link');
  assert.equal((await s.client(sid.split(';')[0]).get('/link')).status, 200, 'la session ouvre la page de liaison');
});

test('Google : seconde connexion = même compte, pas de doublon', async () => {
  const st = await start('google');
  issue = () => prov.idToken(GOOGLE_CLAIMS(st.nonce, { email: 'ada@example.com' }));
  const r = await google(st);
  assert.equal(r.headers.get('location'), '/');
  assert.equal((await s.db.prepare("SELECT COUNT(*) n FROM users WHERE email = 'ada@example.com'").get()).n, 1);
});

test('Google : id_token invalide refusé (signature, alg, kid, émetteur, audience, expiration, nonce, email)', async () => {
  const cases = {
    'signature forgée (clé du faussaire)': [(n) => prov.idToken(GOOGLE_CLAIMS(n, { sub: 'evil' }), { key: prov.forgerKey }), /Signature/],
    'alg none': [(n) => prov.idToken(GOOGLE_CLAIMS(n), { alg: 'none' }), /Algorithme/],
    'alg HS256 (confusion de clé)': [(n) => prov.idToken(GOOGLE_CLAIMS(n), { alg: 'HS256' }), /Algorithme/],
    'kid inconnu': [(n) => prov.idToken(GOOGLE_CLAIMS(n), { kid: 'autre' }), /Clé de signature/],
    'émetteur': [(n) => prov.idToken(GOOGLE_CLAIMS(n, { iss: 'https://evil.example' })), /Émetteur/],
    'audience': [(n) => prov.idToken(GOOGLE_CLAIMS(n, { aud: 'autre-client' })), /Audience/],
    'expiré': [(n) => prov.idToken(GOOGLE_CLAIMS(n, { exp: now() - 10 })), /expiré/],
    'nonce': [() => prov.idToken(GOOGLE_CLAIMS('autre-nonce')), /Nonce/],
    'email non vérifié': [(n) => prov.idToken(GOOGLE_CLAIMS(n, { email_verified: false })), /vérifié/],
    'sans sub': [(n) => prov.idToken(GOOGLE_CLAIMS(n, { sub: undefined })), /Identifiant/],
    'jeton mal formé': [() => 'pas.un.jwt', /invalide/],
  };
  const known = (await s.db.prepare('SELECT COUNT(*) n FROM users').get()).n;
  for (const [name, [make, re]] of Object.entries(cases)) {
    const st = await start('google');
    issue = () => make(st.nonce);
    const sessionsBefore = await sessions();
    const r = await google(st);
    assert.equal(r.status, 303, name);
    assert.match(failure(r), re, name);
    assert.equal(cookieOf(r, 'sid'), undefined, `${name} : aucune session`);
    assert.equal(await sessions(), sessionsBefore, name);
  }
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM users').get()).n, known, 'aucun compte créé par un jeton invalide');
  assert.equal(await userByEmail('evil@x.fr'), undefined);
});

test('state, nonce et liaison au navigateur : inconnus, rejoués, expirés ou d\'un autre navigateur → refusés', async () => {
  issue = null;
  // state inconnu
  let r = await google({ state: 'forge', bind: 'oauth_b=x' });
  assert.match(failure(r), /State OAuth invalide/);
  // paramètres manquants
  r = await fetch(`${base}/auth/google/callback`, { redirect: 'manual' });
  assert.match(failure(r), /manquants/);

  // cookie absent (le flux n'a pas été démarré dans ce navigateur : login CSRF)
  let st = await start('google');
  issue = () => prov.idToken(GOOGLE_CLAIMS(st.nonce, { sub: 'g-csrf', email: 'csrf@x.fr' }));
  r = await google({ state: st.state, bind: null });
  assert.match(failure(r), /autre navigateur/);
  assert.equal(await userByEmail('csrf@x.fr'), undefined);

  // mauvais cookie
  st = await start('google');
  r = await google({ state: st.state, bind: 'oauth_b=pas-le-bon' });
  assert.match(failure(r), /autre navigateur/);

  // state à usage unique
  st = await start('google');
  issue = () => prov.idToken(GOOGLE_CLAIMS(st.nonce));
  assert.equal((await google(st)).headers.get('location'), '/');
  r = await google(st);
  assert.match(failure(r), /State OAuth invalide/, 'rejeu refusé');

  // state expiré
  st = await start('google');
  await s.db.prepare('UPDATE oauth_states SET created_at = ? WHERE state = ?').run(now() - 3600, st.state);
  r = await google(st);
  assert.match(failure(r), /State OAuth invalide/);

  // state Google présenté sur le callback Apple
  st = await start('google');
  r = await apple({ state: st.state, bind: st.bind });
  assert.match(failure(r), /State OAuth invalide/);
  // le fournisseur refuse (code invalide) : échec propre, rien n'est créé
  st = await start('google');
  issue = null;
  r = await google(st);
  assert.match(failure(r), /refusé/);
});

test('Apple : redirection form_post avec state + nonce, cookie de liaison SameSite=None', async () => {
  const st = await start('apple');
  assert.equal(st.loc.origin + st.loc.pathname, PROVIDERS.apple.authUrl);
  assert.equal(st.loc.searchParams.get('response_mode'), 'form_post');
  assert.equal(st.loc.searchParams.get('response_type'), 'code');
  assert.equal(st.loc.searchParams.get('scope'), 'name email');
  assert.equal(st.loc.searchParams.get('client_id'), prov.apple.clientId);
  assert.equal(st.loc.searchParams.get('redirect_uri'), `${APP_URL}/auth/apple/callback`);
  assert.ok(st.state && st.nonce);
  assert.match(st.set, /SameSite=None/);
  assert.match(st.set, /Secure/);
});

test('Apple : POST cross-site accepté (state + nonce + cookie), nom reçu à la première connexion, secret client ES256 valide', async () => {
  const st = await start('apple');
  issue = () => prov.idToken(APPLE_CLAIMS(st.nonce));
  const r = await apple({ ...st, user: JSON.stringify({ name: { firstName: 'Bob', lastName: 'Martin' }, email: 'bob@privaterelay.appleid.com' }) });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/');
  assert.ok(cookieOf(r, 'sid'));
  const u = await userByEmail('bob@privaterelay.appleid.com');
  assert.equal(u.provider, 'apple');
  assert.equal(u.provider_sub, '001234.abcd.5678');
  assert.equal(u.name, 'Bob Martin');

  // Le secret client envoyé à Apple est un JWT ES256 signé avec la clé privée du compte développeur
  const secret = calls.find((c) => c.url === PROVIDERS.apple.tokenUrl).body.client_secret;
  const [h, p, sig] = secret.split('.');
  const head = JSON.parse(Buffer.from(h, 'base64url'));
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.deepEqual({ alg: head.alg, kid: head.kid }, { alg: 'ES256', kid: prov.apple.keyId });
  assert.equal(claims.iss, prov.apple.teamId);
  assert.equal(claims.sub, prov.apple.clientId);
  assert.equal(claims.aud, 'https://appleid.apple.com');
  assert.ok(claims.exp > claims.iat && claims.exp - claims.iat <= 600);
  assert.equal(Buffer.from(sig, 'base64url').length, 64, 'signature brute r||s');
  assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key: prov.apple.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
  assert.equal(calls.find((c) => c.url === PROVIDERS.apple.tokenUrl).body.client_id, prov.apple.clientId);
});

test('Apple : id_token forgé, mauvais nonce / audience / émetteur, POST sans cookie → refusés', async () => {
  const cases = {
    'signature forgée': [(n) => prov.idToken(APPLE_CLAIMS(n, { sub: 'evil' }), { key: prov.forgerKey }), /Signature/],
    'nonce': [() => prov.idToken(APPLE_CLAIMS('autre')), /Nonce/],
    'audience': [(n) => prov.idToken(APPLE_CLAIMS(n, { aud: 'dev.autre.app' })), /Audience/],
    'émetteur': [(n) => prov.idToken(APPLE_CLAIMS(n, { iss: 'https://accounts.google.com' })), /Émetteur/],
    'expiré': [(n) => prov.idToken(APPLE_CLAIMS(n, { exp: now() - 1 })), /expiré/],
    'email non vérifié': [(n) => prov.idToken(APPLE_CLAIMS(n, { email_verified: 'false' })), /vérifié/],
  };
  for (const [name, [make, re]] of Object.entries(cases)) {
    const st = await start('apple');
    issue = () => make(st.nonce);
    const r = await apple(st);
    assert.match(failure(r), re, name);
    assert.equal(cookieOf(r, 'sid'), undefined, name);
  }
  // Login CSRF : un POST d'un site tiers avec un state connu mais sans le cookie de ce navigateur
  const st = await start('apple');
  issue = () => prov.idToken(APPLE_CLAIMS(st.nonce, { sub: 'attacker', email: 'attacker@x.fr' }));
  const r = await apple({ state: st.state, bind: null });
  assert.match(failure(r), /autre navigateur/);
  assert.equal(await userByEmail('attacker@x.fr'), undefined);
  // refus de l'utilisateur côté Apple
  const st2 = await start('apple');
  assert.match(failure(await apple({ state: st2.state, bind: st2.bind, code: null, error: 'user_cancelled_authorize' })), /annulée/);
});

test('page de connexion : bouton Apple seulement si Apple est configuré', async () => {
  let r = await s.anon.get('/login');
  let page = await r.text();
  assert.match(page, /Se connecter avec Google/);
  assert.match(page, /Se connecter avec Apple/);

  const bare = await startApp();
  try {
    page = await (await bare.anon.get('/login')).text();
    assert.match(page, /Se connecter avec Google/);
    assert.doesNotMatch(page, /Apple/);
    assert.equal((await bare.anon.get('/auth/apple')).status, 404, 'route Apple inexistante sans configuration');
    assert.equal((await bare.anon.post('/auth/apple/callback', {}, { origin: null })).status, 303, 'le retour Apple échoue proprement');
  } finally { await bare.close(); }
});

test('configuration : variables Apple toutes présentes ou toutes absentes, ADMIN_EMAILS, plus de ALLOWED_EMAILS', () => {
  const keep = { ...process.env };
  try {
    Object.assign(process.env, {
      SECRET_KEY: '00'.repeat(32), APP_URL: 'https://x.test/', GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b',
      DB_HOST: 'h', DB_USER: 'u', DB_NAME: 'n', ADMIN_EMAILS: ' Tony@X.fr, b@x.fr ,',
    });
    for (const k of ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_CLIENT_ID', 'APPLE_PRIVATE_KEY', 'ALLOWED_EMAILS']) delete process.env[k];
    let cfg = loadConfig();
    assert.equal(cfg.apple, null);
    assert.deepEqual(cfg.adminEmails, ['tony@x.fr', 'b@x.fr']);
    assert.equal('allowedEmails' in cfg, false);

    Object.assign(process.env, { APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K' });
    assert.throws(() => loadConfig(), /Apple.*APPLE_CLIENT_ID, APPLE_PRIVATE_KEY/);

    Object.assign(process.env, { APPLE_CLIENT_ID: 'C', APPLE_PRIVATE_KEY: `${PEM_HEAD}\\nABC\\n${PEM_FOOT}` });
    cfg = loadConfig();
    assert.deepEqual({ ...cfg.apple, privateKey: undefined }, { teamId: 'T', keyId: 'K', clientId: 'C', privateKey: undefined });
    assert.equal(cfg.apple.privateKey, `${PEM_HEAD}\nABC\n${PEM_FOOT}`,'les \\n littéraux du .env redeviennent des retours à la ligne');
    // la clé fournie par prov.apple se relit telle quelle
    assert.ok(appleClientSecret(prov.apple).split('.').length === 3);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
  }
});

test('ADMIN_EMAILS désigne les admins ; le compte préparé par la migration est retrouvé par son email', async () => {
  // Compte propriétaire préparé (sans fournisseur) avec ses données
  const prepared = await addUser(s.db, { email: 'admin@x.fr', provider: null, sub: null, admin: false });
  await s.db.prepare('UPDATE users SET provider = NULL, provider_sub = NULL WHERE id = ?').run(prepared);
  await s.db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(prepared, 'Existant', 'https://git.test/e.git', now());

  const st = await start('google');
  issue = () => prov.idToken(GOOGLE_CLAIMS(st.nonce, { sub: 'g-admin', email: 'ADMIN@x.fr' }));
  assert.equal((await google(st)).headers.get('location'), '/');
  const u = await userByEmail('admin@x.fr');
  assert.equal(Number(u.id), prepared, 'même compte, pas de doublon');
  assert.equal(u.provider, 'google');
  assert.equal(u.provider_sub, 'g-admin');
  assert.equal(u.is_admin, 1);
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM projects WHERE user_id = ?').get(prepared)).n, 1, 'ses données sont toujours là');

  // un non-admin n'est pas promu, et ADMIN_EMAILS fait foi au démarrage
  assert.equal((await userByEmail('ada@example.com')).is_admin, 0);
});

test('un email déjà lié à un autre fournisseur n\'est pas fusionné automatiquement', async () => {
  const st = await start('apple');
  issue = () => prov.idToken(APPLE_CLAIMS(st.nonce, { sub: 'apple-ada', email: 'ada@example.com' }));
  const r = await apple(st);
  assert.match(failure(r), /déjà associé à un compte Google/);
  assert.equal(cookieOf(r, 'sid'), undefined);
  assert.equal((await s.db.prepare("SELECT COUNT(*) n FROM users WHERE email = 'ada@example.com'").get()).n, 1);
});

test('compte suspendu : connexion refusée, session existante inutilisable et supprimée', async () => {
  const u = await s.newUser({ email: 'susp@x.fr' });
  assert.equal((await u.get('/api/system')).status, 200);
  await s.db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(u.id);

  let r = await u.get('/api/system');
  assert.equal(r.status, 401, 'la session existante ne marche plus');
  r = await u.get('/');
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/login');
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(u.id)).n, 0, 'sessions supprimées');
  r = await u.post('/api/projects', { name: 'x', gitUrl: 'https://a/b/c.git' });
  assert.equal(r.status, 401);

  // et il ne peut pas se reconnecter
  await s.db.prepare('UPDATE users SET provider = ?, provider_sub = ? WHERE id = ?').run('google', 'g-susp', u.id);
  const st = await start('google');
  issue = () => prov.idToken(GOOGLE_CLAIMS(st.nonce, { sub: 'g-susp', email: 'susp@x.fr' }));
  const login = await google(st);
  assert.match(failure(login), /suspendu/);
  assert.equal(cookieOf(login, 'sid'), undefined);
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(u.id)).n, 0);

  // réactivé : tout refonctionne
  await s.db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(u.id);
  const st2 = await start('google');
  issue = () => prov.idToken(GOOGLE_CLAIMS(st2.nonce, { sub: 'g-susp', email: 'susp@x.fr' }));
  assert.equal((await google(st2)).headers.get('location'), '/');
});

test('déconnexion : la session est détruite côté serveur', async () => {
  const u = await s.newUser();
  assert.equal((await u.get('/api/system')).status, 200);
  const r = await u.post('/logout', {}, { form: true });
  assert.equal(r.status, 303);
  assert.equal((await u.get('/api/system')).status, 401);
});
