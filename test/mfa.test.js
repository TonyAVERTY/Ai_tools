import { test } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../src/db.js';
import { hashSid, decrypt } from '../src/crypto.js';
import { codeAt, verifyTotp, newSecret, newRecoveryCodes, consumeRecovery, unbase32, base32 } from '../src/totp.js';
import { startApp } from './helpers/server.js';

// A2F : algorithme TOTP (vecteur RFC 6238), activation depuis Mon compte, session « en attente » à la connexion, codes de secours, limite d'essais.

const form = { form: true };
const where = (r) => decodeURIComponent(r.headers.get('location') || '');
const step = () => Math.floor(Date.now() / 1000 / 30);

test('TOTP : vecteur de la RFC 6238, tolérance d\'un pas, un code ne sert qu\'une fois', () => {
  const secret = base32(Buffer.from('12345678901234567890'));
  assert.equal(codeAt(secret, Math.floor(59 / 30)), '287082'); // RFC 6238, T = 59 s (les 6 derniers chiffres de 94287082)
  assert.equal(verifyTotp(secret, '287082', { at: 59 }), 1);
  assert.equal(verifyTotp(secret, '287 082', { at: 59 + 30 }), 1); // un pas plus tard, espaces tolérés
  assert.equal(verifyTotp(secret, '287082', { at: 59 + 90 }), null); // trop ancien
  assert.equal(verifyTotp(secret, '287082', { at: 59, lastStep: 1 }), null); // déjà utilisé
  assert.equal(verifyTotp(secret, 'abcdef', { at: 59 }), null);
  assert.deepEqual(unbase32(newSecret()).length, 20);
});

test('codes de secours : dix codes, usage unique, insensibles à la casse et aux tirets', () => {
  const { codes, hashes } = newRecoveryCodes();
  assert.equal(codes.length, 10);
  const left = consumeRecovery(hashes, codes[3].toUpperCase().replace('-', ' '));
  assert.equal(left.length, 9);
  assert.equal(consumeRecovery(left, codes[3]), null);
  assert.equal(consumeRecovery(hashes, 'nope'), null);
});

async function enable(s, u) {
  assert.equal((await u.post('/account/2fa/start', {}, form)).status, 303);
  const row = await s.db.prepare('SELECT totp_secret_enc FROM users WHERE id = ?').get(u.id);
  const secret = decrypt(s.app.cfg.secretKey, row.totp_secret_enc);
  const r = await u.post('/account/2fa/enable', { code: codeAt(secret, step()) }, form);
  assert.equal(r.status, 200);
  const codes = (await r.text()).match(/[0-9a-f]{5}-[0-9a-f]{5}/g);
  return { secret, codes };
}

test('activation : mauvais code refusé, bon code active et montre dix codes une seule fois ; le secret est chiffré', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: false });
    await u.post('/account/2fa/start', {}, form);
    const bad = await u.post('/account/2fa/enable', { code: '000000' }, form);
    assert.equal(bad.status, 303);
    assert.match(where(bad), /Code incorrect/);
    assert.equal((await s.db.prepare('SELECT totp_enabled e FROM users WHERE id = ?').get(u.id)).e, 0);
    const { secret, codes } = await enable(s, u);
    assert.equal(codes.length, 10);
    const row = await s.db.prepare('SELECT totp_secret_enc, totp_recovery, totp_enabled FROM users WHERE id = ?').get(u.id);
    assert.equal(row.totp_enabled, 1);
    assert.ok(!row.totp_secret_enc.includes(secret));
    assert.ok(!row.totp_recovery.includes(codes[0]));
    const page = await (await u.get('/account', { headers: { accept: 'text/html' } })).text();
    assert.match(page, /Activée/);
    assert.ok(!page.includes(secret) && !page.includes(codes[0]));
  } finally { await s.close(); }
});

// Session « en attente » : ce que crée finishLogin pour un compte protégé
async function pendingCookie(s, userId) {
  const sid = `pending-${userId}-${Math.random().toString(36).slice(2)}`;
  await s.db.prepare('INSERT INTO sessions(id, user_id, created_at, expires_at, mfa_pending) VALUES(?, ?, ?, ?, 1)').run(hashSid(sid), userId, now(), now() + 600);
  return `sid=${sid}`;
}

test('connexion : la session en attente ne donne accès à rien tant que le code n\'est pas saisi', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: false });
    const { secret } = await enable(s, u);
    const c = s.client(await pendingCookie(s, u.id));
    assert.equal((await c.get('/account', { headers: { accept: 'text/html' } })).status, 303); // traité comme non connecté
    assert.equal((await c.get('/api/v1/projects')).status, 401);
    assert.equal((await c.get('/login/2fa', { headers: { accept: 'text/html' } })).status, 200);
    const bad = await c.post('/login/2fa', { code: '123456' }, form);
    assert.match(where(bad), /\/login\/2fa\?e=/);
    // Le code qui a servi à activer l'A2F ne vaut plus (un code ne sert qu'une fois) : on attend le pas suivant en simulant l'horloge du serveur
    await s.db.prepare('UPDATE users SET totp_last_step = 0 WHERE id = ?').run(u.id);
    const ok = await c.post('/login/2fa', { code: codeAt(secret, step()) }, form);
    assert.equal(ok.headers.get('location'), '/');
    assert.equal((await c.get('/account', { headers: { accept: 'text/html' } })).status, 200);
    // Le même code ne passe pas deux fois
    const again = s.client(await pendingCookie(s, u.id));
    assert.match(where(await again.post('/login/2fa', { code: codeAt(secret, step()) }, form)), /\/login\/2fa\?e=/);
  } finally { await s.close(); }
});

test('connexion : un code de secours passe une fois, cinq erreurs ferment la session en attente', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: false });
    const { codes } = await enable(s, u);
    const c = s.client(await pendingCookie(s, u.id));
    assert.equal((await c.post('/login/2fa', { code: codes[0] }, form)).headers.get('location'), '/');
    const reuse = s.client(await pendingCookie(s, u.id));
    assert.match(where(await reuse.post('/login/2fa', { code: codes[0] }, form)), /\/login\/2fa\?e=/);
    const brute = s.client(await pendingCookie(s, u.id));
    let last;
    for (let i = 0; i < 5; i++) last = await brute.post('/login/2fa', { code: '000000' }, form);
    assert.match(where(last), /^\/login\?e=.*Trop de codes/);
    assert.equal((await brute.get('/login/2fa', { headers: { accept: 'text/html' } })).headers.get('location'), '/login');
  } finally { await s.close(); }
});

test('désactivation et renouvellement demandent un code ; sans A2F, la connexion reste directe', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: false });
    const { secret, codes } = await enable(s, u);
    assert.match(where(await u.post('/account/2fa/disable', { code: '000000' }, form)), /Code incorrect/);
    assert.equal((await s.db.prepare('SELECT totp_enabled e FROM users WHERE id = ?').get(u.id)).e, 1);
    const regen = await u.post('/account/2fa/recovery', { code: codes[0] }, form);
    const fresh = (await regen.text()).match(/[0-9a-f]{5}-[0-9a-f]{5}/g);
    assert.equal(fresh.length, 10);
    assert.ok(!fresh.includes(codes[1])); // les anciens codes ne marchent plus
    assert.match(where(await u.post('/account/2fa/disable', { code: codes[1] }, form)), /Code incorrect/);
    assert.equal((await u.post('/account/2fa/disable', { code: fresh[0] }, form)).status, 303);
    const row = await s.db.prepare('SELECT totp_enabled e, totp_secret_enc s, totp_recovery r FROM users WHERE id = ?').get(u.id);
    assert.deepEqual([row.e, row.s, row.r], [0, null, null]);
    assert.ok(secret);
  } finally { await s.close(); }
});
