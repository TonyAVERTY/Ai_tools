import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, parseTrustProxy, clientIp } from '../src/ratelimit.js';
import { RATE_LIMITS } from '../src/limits.js';
import { loadConfig } from '../src/config.js';
import { startApp } from './helpers/server.js';

// Limitation de débit : le limiteur, la lecture de l'adresse du client, et son effet sur les vraies routes.

const RULES = { demo: { ip: { max: 3, windowMs: 10_000 }, user: { max: 2, windowMs: 60_000 } } };

test('limiteur : fenêtre glissante, Retry-After exact, une requête refusée n\'est pas comptée', () => {
  let t = 1_000_000;
  const rl = new RateLimiter({ rules: { r: { ip: { max: 2, windowMs: 10_000 } } }, clock: () => t });
  assert.ok(rl.check('r', { ip: 'a' }).ok);
  t += 4000;
  assert.ok(rl.check('r', { ip: 'a' }).ok);
  const blocked = rl.check('r', { ip: 'a' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfter, 6, 'la 1re requête sort de la fenêtre dans 6 s');
  t += 3000;
  assert.equal(rl.check('r', { ip: 'a' }).retryAfter, 3, 'insister ne prolonge pas l\'attente');
  t += 3000; // 10 s après la 1re requête
  assert.ok(rl.check('r', { ip: 'a' }).ok, 'la fenêtre a glissé');
  assert.ok(rl.check('r', { ip: 'b' }).ok, 'une autre adresse a son propre compteur');
  assert.throws(() => rl.check('inconnue', {}), /Règle de débit inconnue/);
});

test('limiteur : portées IP et compte indépendantes, refus dès qu\'une portée est dépassée', () => {
  const rl = new RateLimiter({ rules: RULES, clock: () => 1000 });
  assert.ok(rl.check('demo', { ip: '1.1.1.1', userId: 7 }).ok);
  assert.ok(rl.check('demo', { ip: '2.2.2.2', userId: 7 }).ok);
  const r = rl.check('demo', { ip: '3.3.3.3', userId: 7 });
  assert.equal(r.ok, false);
  assert.equal(r.scope, 'user', 'changer d\'adresse ne contourne pas la limite du compte');
  assert.ok(rl.check('demo', { ip: '3.3.3.3', userId: 8 }).ok, 'un autre compte n\'est pas touché');
  // Le refus par le compte n'a pas consommé le quota de l'adresse 4.4.4.4
  assert.equal([1, 2, 3].filter(() => rl.check('demo', { ip: '4.4.4.4' }).ok).length, 3);
});

test('limiteur : les compteurs expirés sont libérés, la table reste bornée', () => {
  let t = 0;
  const rl = new RateLimiter({ rules: { r: { ip: { max: 1, windowMs: 1000 } } }, clock: () => t, maxKeys: 50 });
  for (let i = 0; i < 40; i++) rl.check('r', { ip: `10.0.0.${i}` });
  assert.equal(rl.hits.size, 40);
  t = 5000;
  rl.sweep();
  assert.equal(rl.hits.size, 0, 'tout a expiré');
  for (let i = 0; i < 200; i++) rl.check('r', { ip: `10.1.0.${i}` });
  rl.sweep();
  assert.ok(rl.hits.size <= 50, 'plafond mémoire');
});

// ---------- Adresse du client ----------

const req = (remote, xff) => ({ socket: { remoteAddress: remote }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } });

test('adresse du client : sans TRUST_PROXY, X-Forwarded-For forgé est ignoré', () => {
  assert.equal(clientIp(req('203.0.113.9', '1.2.3.4')), '203.0.113.9');
  assert.equal(clientIp(req('::ffff:203.0.113.9', '1.2.3.4'), parseTrustProxy('false')), '203.0.113.9');
  assert.equal(clientIp(req('127.0.0.1', '1.2.3.4'), null), '127.0.0.1', 'même venu d\'un proxy local, sans TRUST_PROXY on ne lit rien');
});

test('adresse du client : avec TRUST_PROXY, lecture de droite à gauche, seulement depuis un proxy de confiance', () => {
  const trust = parseTrustProxy('true');
  assert.equal(clientIp(req('127.0.0.1', '198.51.100.7'), trust), '198.51.100.7');
  assert.equal(clientIp(req('::1', '198.51.100.7'), trust), '198.51.100.7');
  assert.equal(clientIp(req('::ffff:127.0.0.1', '198.51.100.7'), trust), '198.51.100.7');
  // Le client écrit « 9.9.9.9 » à gauche ; Nginx ajoute SON adresse à droite : seule celle-ci compte
  assert.equal(clientIp(req('127.0.0.1', '9.9.9.9, 198.51.100.7'), trust), '198.51.100.7');
  assert.equal(clientIp(req('127.0.0.1', '9.9.9.9, 198.51.100.7, 127.0.0.1'), trust), '198.51.100.7', 'un 2e proxy local est sauté');
  // Une connexion directe (pas du proxy) qui envoie l'en-tête n'est pas crue
  assert.equal(clientIp(req('203.0.113.9', '1.2.3.4'), trust), '203.0.113.9');
  assert.equal(clientIp(req('127.0.0.1', undefined), trust), '127.0.0.1');
  assert.equal(clientIp(req('127.0.0.1', 'pas-une-ip'), trust), '127.0.0.1');
});

test('adresse du client : liste de proxys et plages CIDR, entrée invalide refusée', () => {
  const trust = parseTrustProxy('10.0.0.0/8, 192.0.2.1');
  assert.equal(clientIp(req('10.4.5.6', '198.51.100.7'), trust), '198.51.100.7');
  assert.equal(clientIp(req('192.0.2.1', '198.51.100.7'), trust), '198.51.100.7');
  assert.equal(clientIp(req('127.0.0.1', '198.51.100.7'), trust), '127.0.0.1', 'le loopback n\'est pas dans cette liste');
  assert.throws(() => parseTrustProxy('10.0.0.0/8, nimporte'), /TRUST_PROXY/);
  assert.throws(() => parseTrustProxy('10.0.0.0/x'), /TRUST_PROXY/);
  assert.equal(parseTrustProxy(''), null);
  assert.equal(parseTrustProxy(undefined), null);
});

test('TRUST_PROXY : désactivé par défaut dans la configuration', () => {
  const env = { APP_URL: 'https://x.fr', SECRET_KEY: 'a'.repeat(64), GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', DB_DRIVER: 'sqlite' };
  const keep = { ...process.env };
  try {
    Object.assign(process.env, env); delete process.env.TRUST_PROXY;
    assert.equal(loadConfig().trustProxy, null);
    process.env.TRUST_PROXY = 'true';
    assert.ok(loadConfig().trustProxy.trusts('127.0.0.1'));
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
  }
});

// ---------- Sur les vraies routes ----------

test('connexion : au-delà du seuil, 429 avec Retry-After ; un X-Forwarded-For forgé ne donne pas un compteur neuf', async () => {
  const s = await startApp({ rateLimit: true });
  try {
    const max = RATE_LIMITS.auth_start.ip.max;
    for (let i = 0; i < max; i++) {
      const r = await fetch(`${s.base}/auth/google`, { redirect: 'manual', headers: { 'x-forwarded-for': `203.0.113.${i + 1}` } });
      assert.equal(r.status, 303, `requête ${i + 1}`);
    }
    // L'essai suivant arrive avec une adresse « neuve » dans X-Forwarded-For : sans TRUST_PROXY, c'est le même client
    const r = await fetch(`${s.base}/auth/google`, { redirect: 'manual', headers: { 'x-forwarded-for': '198.51.100.99' } });
    assert.equal(r.status, 429);
    const wait = Number(r.headers.get('retry-after'));
    assert.ok(wait >= 1 && wait <= RATE_LIMITS.auth_start.ip.windowMs / 1000, `Retry-After = ${wait}`);
    assert.match(await r.text(), /Trop de requêtes/);
    // Les pages publiques restent libres
    assert.equal((await fetch(`${s.base}/tarifs`)).status, 200);
    const json = await fetch(`${s.base}/auth/google`, { headers: { accept: 'application/json', 'x-forwarded-for': '198.51.100.100' }, redirect: 'manual' });
    assert.equal(json.status, 429);
    const body = await json.json();
    assert.equal(body.code, 'rate_limited');
    assert.ok(body.retryAfter >= 1);
  } finally { await s.close(); }
});

test('connexion : avec TRUST_PROXY, l\'adresse lue dans X-Forwarded-For (proxy local) sépare les compteurs', async () => {
  const s = await startApp({ rateLimit: true, cfg: { trustProxy: parseTrustProxy('true') } });
  try {
    const max = RATE_LIMITS.auth_start.ip.max;
    const go = (ip) => fetch(`${s.base}/auth/google`, { redirect: 'manual', headers: { 'x-forwarded-for': ip } });
    for (let i = 0; i < max; i++) assert.equal((await go('198.51.100.1')).status, 303);
    assert.equal((await go('198.51.100.1')).status, 429, 'ce client est limité');
    assert.equal((await go('198.51.100.2')).status, 303, 'un autre client derrière le même proxy ne l\'est pas');
    // L'attaquant qui ajoute des adresses à GAUCHE reste sur le même compteur : seule l'entrée du proxy (à droite) compte
    assert.equal((await go('7.7.7.7, 198.51.100.1')).status, 429);
  } finally { await s.close(); }
});

test('retours des fournisseurs (Google, Apple) : limités par adresse', async () => {
  const s = await startApp({ rateLimit: true, cfg: { apple: { teamId: 't', keyId: 'k', clientId: 'c', privateKey: 'p' } } });
  try {
    const max = RATE_LIMITS.auth_callback.ip.max;
    for (let i = 0; i < max; i++) {
      const r = await fetch(`${s.base}/auth/google/callback?state=x&code=y`, { redirect: 'manual' });
      assert.equal(r.status, 303, 'refus de connexion ordinaire (redirection vers /login)');
    }
    assert.equal((await fetch(`${s.base}/auth/google/callback?state=x&code=y`, { redirect: 'manual' })).status, 429);
    // La règle est commune aux deux retours
    const apple = await fetch(`${s.base}/auth/apple/callback`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'state=x' });
    assert.equal(apple.status, 429);
  } finally { await s.close(); }
});

test('liaison : essais de clé limités par compte, un autre compte n\'est pas pénalisé', async () => {
  const s = await startApp({ rateLimit: true });
  try {
    const a = await s.newUser({ admin: false, link: null });
    const b = await s.newUser({ admin: false, link: null });
    const max = RATE_LIMITS.link.user.max;
    for (let i = 0; i < max; i++) {
      const r = await a.post('/link/api-key', { apiKey: 'pas-une-cle' });
      assert.equal(r.status, 400, `essai ${i + 1}`);
    }
    const blocked = await a.post('/link/api-key', { apiKey: 'pas-une-cle' });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
    for (const p of ['/link/subscription', '/link/test', '/link/unlink']) assert.equal((await a.post(p, {})).status, 429, p);
    assert.equal((await b.post('/link/api-key', { apiKey: 'pas-une-cle' })).status, 400);
  } finally { await s.close(); }
});

test('export, import, création de projet, suppression de compte, tests de connexion : tous limités', async () => {
  const s = await startApp({ rateLimit: true });
  try {
    const u = await s.newUser({ admin: true });
    const pid = Number((await s.db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'p', 'https://git.test/a/b.git', 1)").run(u.id)).lastInsertRowid);
    const hit = async (rule, call) => {
      const conf = RATE_LIMITS[rule].user;
      for (let i = 0; i < conf.max; i++) assert.notEqual((await call()).status, 429, `${rule} #${i + 1}`);
      assert.equal((await call()).status, 429, `${rule} au-delà du seuil`);
    };
    await hit('csv', () => u.get(`/api/projects/${pid}/prospects.csv`));
    await hit('conn_test', () => u.get(`/api/projects/${pid}/recap`));
    await hit('project_create', () => u.post('/api/projects', {}));
    await hit('account_delete', () => u.post('/account/delete', { confirm: 'autre@x.fr' }, { form: true }));
    await hit('mail_send', () => u.post('/api/report/send', {}));
    // L'import CSV partage la règle « csv » de l'export : déjà épuisée ci-dessus
    assert.equal((await u.post(`/api/projects/${pid}/prospects/import`, { csv: 'email\na@b.fr' })).status, 429);
  } finally { await s.close(); }
});

test('chaque règle citée par une route existe, et les points sensibles sont tous couverts', async () => {
  const s = await startApp();
  try {
    const routes = s.app.router.routes;
    const used = new Set(routes.map((r) => r.limit).filter(Boolean));
    for (const rule of used) assert.ok(RATE_LIMITS[rule], `règle ${rule} absente de src/limits.js`);
    // « admin » n'est branchée qu'avec le back-office, « api » (par compte) qu'après l'authentification d'un jeton,
    // « write » s'applique d'office à toute écriture connectée sans règle propre (voir le test suivant)
    for (const rule of Object.keys(RATE_LIMITS).filter((r) => !['admin', 'api', 'write'].includes(r))) assert.ok(used.has(rule), `règle ${rule} sans route`);
    const find = (method, path) => routes.find((r) => r.method === method && r.re.test(path));
    for (const [m, p] of [
      ['GET', '/auth/google'], ['GET', '/auth/apple'], ['GET', '/auth/google/callback'], ['POST', '/auth/apple/callback'],
      ['POST', '/link/api-key'], ['POST', '/link/subscription'], ['POST', '/link/test'], ['POST', '/link/unlink'],
      ['GET', '/api/projects/1/prospects.csv'], ['POST', '/api/projects/1/prospects/import'], ['POST', '/api/projects/1/send'],
      ['POST', '/api/report/send'], ['POST', '/api/notify/test'], ['POST', '/api/projects'], ['POST', '/account/delete'],
      ['POST', '/api/projects/1/imap'], ['GET', '/api/v1/me'], ['POST', '/api/v1/projects/1/jobs'], ['POST', '/api/projects/1/inbox/check'], ['GET', '/api/projects/1/recap'],
    ]) assert.ok(find(m, p)?.limit, `${m} ${p} sans limite`);
  } finally { await s.close(); }
});

test('écritures : toute route sans règle propre est limitée par compte, les lectures et les autres comptes restent libres', async () => {
  const s = await startApp({ rateLimit: true });
  try {
    const u = await s.newUser(), other = await s.newUser();
    const max = RATE_LIMITS.write.user.max;
    for (let i = 0; i < max; i++) assert.equal((await u.post('/api/jobs/999999/retry', {})).status, 404, `écriture ${i + 1}`);
    const r = await u.post('/api/jobs/999999/retry', {});
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) >= 1);
    assert.equal((await u.get('/api/system')).status, 200, 'les lectures ne sont pas limitées');
    assert.equal((await other.post('/api/jobs/999999/retry', {})).status, 404, 'un autre compte garde son compteur');
  } finally { await s.close(); }
});
