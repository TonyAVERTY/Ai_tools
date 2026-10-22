import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, encryptJson, decryptJson, unsubToken, verifyUnsubToken } from '../src/crypto.js';
import { getSetting, setSetting, MIGRATIONS } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { Router, esc } from '../src/http.js';
import { checkIdTokenClaims, checkOrigin } from '../src/auth.js';
import { addUser } from './helpers/users.js';

const key = randomBytes(32);

test('chiffrement aller-retour et altération détectée', () => {
  const enc = encrypt(key, 'mot de passe é');
  assert.equal(decrypt(key, enc), 'mot de passe é');
  assert.deepEqual(decryptJson(key, encryptJson(key, { a: 1 })), { a: 1 });
  const parts = enc.split(':');
  parts[3] = Buffer.from('autre').toString('base64');
  assert.throws(() => decrypt(key, parts.join(':')));
  assert.equal(encrypt(key, ''), null);
});

test('token de désinscription', () => {
  const t = unsubToken(key, 'Foo@Bar.fr');
  assert.ok(verifyUnsubToken(key, 'foo@bar.fr', t));
  assert.ok(!verifyUnsubToken(key, 'autre@bar.fr', t));
  assert.ok(!verifyUnsubToken(key, 'foo@bar.fr', 'x'));
});

test('migrations et settings', async () => {
  const db = await testDb();
  const v = await db.prepare('SELECT COUNT(*) n, MAX(version) v FROM schema_migrations').get();
  assert.deepEqual({ n: v.n, v: v.v }, { n: MIGRATIONS.length, v: MIGRATIONS.length });
  const u = await addUser(db);
  await setSetting(db, u, 'a', '1'); await setSetting(db, u, 'a', '2');
  assert.equal(await getSetting(db, u, 'a'), '2');
  assert.equal(await getSetting(db, u, 'nope', 'x'), 'x');
});

test('router avec paramètres', () => {
  const r = new Router();
  r.get('/projects/:id', () => 'ok');
  assert.deepEqual(r.match('GET', '/projects/42').params, { id: '42' });
  assert.equal(r.match('POST', '/projects/42'), null);
  assert.equal(r.match('GET', '/projects/42/x'), null);
});

test('échappement HTML', () => {
  assert.equal(esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
});

test('claims id_token : émetteur, audience, expiration, nonce, email vérifié', () => {
  const base = { iss: 'https://accounts.google.com', aud: 'cid', exp: 2e9, nonce: 'n', sub: '123', email_verified: true, email: 'Me@Gmail.com' };
  const opts = { issuers: ['https://accounts.google.com', 'accounts.google.com'], clientId: 'cid', nonce: 'n', at: 1e9 };
  assert.deepEqual(checkIdTokenClaims(base, opts), { sub: '123', email: 'me@gmail.com', name: null });
  assert.equal(checkIdTokenClaims({ ...base, aud: ['x', 'cid'] }, opts).sub, '123', 'audience en liste');
  assert.equal(checkIdTokenClaims({ ...base, email_verified: 'true' }, opts).sub, '123', 'Apple envoie "true" en chaîne');
  assert.throws(() => checkIdTokenClaims({ ...base, iss: 'https://evil.com' }, opts), /Émetteur/);
  assert.throws(() => checkIdTokenClaims({ ...base, aud: 'x' }, opts), /Audience/);
  assert.throws(() => checkIdTokenClaims({ ...base, nonce: 'z' }, opts), /Nonce/);
  assert.throws(() => checkIdTokenClaims({ ...base, nonce: undefined }, { ...opts, nonce: undefined }), /Nonce/);
  assert.throws(() => checkIdTokenClaims({ ...base, email_verified: false }, opts), /vérifié/);
  assert.throws(() => checkIdTokenClaims({ ...base, exp: 1 }, opts), /expiré/);
  assert.throws(() => checkIdTokenClaims({ ...base, sub: '' }, opts), /Identifiant/);
  assert.throws(() => checkIdTokenClaims({ ...base, email: '' }, opts), /Email manquant/);
});

test('contrôle d\'origine', () => {
  const cfg = { appUrl: 'https://ai.tony-averty.dev' };
  assert.doesNotThrow(() => checkOrigin({ method: 'GET', headers: {} }, cfg));
  assert.doesNotThrow(() => checkOrigin({ method: 'POST', headers: { origin: cfg.appUrl } }, cfg));
  assert.throws(() => checkOrigin({ method: 'POST', headers: { origin: 'https://evil.com' } }, cfg));
  assert.throws(() => checkOrigin({ method: 'POST', headers: {} }, cfg));
});
