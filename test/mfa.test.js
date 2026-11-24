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
    const fresh = ok.headers.getSetCookie().find((x) => x.startsWith('sid='));
    assert.equal((await s.client(fresh.split(';')[0]).get('/account', { headers: { accept: 'text/html' } })).status, 200);
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

test('appareil de confiance : le cookie dispense du code 30 jours, seule son empreinte est en base, on peut l\'oublier', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: false });
    const { secret } = await enable(s, u);
    await s.db.prepare('UPDATE users SET totp_last_step = 0 WHERE id = ?').run(u.id);
    const c = s.client(await pendingCookie(s, u.id));
    const ok = await c.post('/login/2fa', { code: codeAt(secret, step()), trust: 'on' }, form);
    const setCookie = ok.headers.getSetCookie().find((x) => x.startsWith('mfa_td='));
    assert.ok(/HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /Max-Age=2592000/.test(setCookie));
    const token = decodeURIComponent(setCookie.split(';')[0].split('=')[1]);
    const row = await s.db.prepare('SELECT token_hash FROM trusted_devices WHERE user_id = ?').get(u.id);
    assert.equal(row.token_hash, hashSid(token));
    assert.notEqual(row.token_hash, token);
    // Nouvelle connexion sur le même navigateur : la page 2FA ouvre la session sans code
    const again = s.client(`${await pendingCookie(s, u.id)}; mfa_td=${token}`);
    assert.equal((await again.get('/login/2fa', { headers: { accept: 'text/html' } })).headers.get('location'), '/');
    // Un autre navigateur (sans le cookie), ou le cookie d'un autre compte, ne passe pas
    const other = await s.newUser({ admin: false });
    const stranger = s.client(`${await pendingCookie(s, u.id)}; mfa_td=inconnu`);
    assert.equal((await stranger.get('/login/2fa', { headers: { accept: 'text/html' } })).status, 200);
    await s.db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(other.id);
    const wrongUser = s.client(`${await pendingCookie(s, other.id)}; mfa_td=${token}`);
    assert.equal((await wrongUser.get('/login/2fa', { headers: { accept: 'text/html' } })).status, 200);
    // Oublier les appareils
    assert.equal((await u.post('/account/2fa/forget', {}, form)).status, 303);
    assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM trusted_devices').get()).n, 0);
    const forgotten = s.client(`${await pendingCookie(s, u.id)}; mfa_td=${token}`);
    assert.equal((await forgotten.get('/login/2fa', { headers: { accept: 'text/html' } })).status, 200);
  } finally { await s.close(); }
});

import { coarseIp, securityLog } from '../src/securitylog.js';

test('plafond par compte : après 10 codes essayés en 15 minutes, même un bon code est refusé', async () => {
  const s = await startApp({ rateLimit: true });
  try {
    const u = await s.newUser({ admin: false });
    await enable(s, u);
    let last;
    for (let i = 0; i < 10; i++) last = await u.post('/account/2fa/disable', { code: '000000' }, form);
    assert.match(where(last), /Code incorrect/);
    const blocked = await u.post('/account/2fa/disable', { code: '000000' }, form);
    assert.match(where(blocked), /Trop de codes essayés/);
    assert.equal((await s.db.prepare('SELECT totp_enabled e FROM users WHERE id = ?').get(u.id)).e, 1, 'l\'A2F reste activée');
    // La connexion est bloquée de la même façon pour ce compte, d'où qu'arrive la session en attente
    const c = s.client(await pendingCookie(s, u.id));
    assert.match(where(await c.post('/login/2fa', { code: '123456' }, form)), /^\/login\?e=.*Trop de codes/);
  } finally { await s.close(); }
});

test('un code de ton application valide la connexion avec un NOUVEL identifiant de session', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: false });
    const { secret } = await enable(s, u);
    await s.db.prepare('UPDATE users SET totp_last_step = 0 WHERE id = ?').run(u.id);
    const pendingSid = (await pendingCookie(s, u.id));
    const c = s.client(pendingSid);
    const ok = await c.post('/login/2fa', { code: codeAt(secret, step()) }, form);
    const fresh = ok.headers.getSetCookie().find((x) => x.startsWith('sid='));
    assert.ok(fresh, 'un nouveau cookie de session est posé');
    const newSid = decodeURIComponent(fresh.split(';')[0].split('=')[1]);
    assert.notEqual(`sid=${newSid}`, pendingSid, 'identifiant différent de celui de la session en attente');
    assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM sessions WHERE id = ?').get(hashSid(pendingSid.slice(4)))).n, 0, 'l\'ancienne session n\'existe plus');
    assert.equal((await s.client(`sid=${newSid}`).get('/account', { headers: { accept: 'text/html' } })).status, 200);
    assert.equal((await s.client(pendingSid).get('/account', { headers: { accept: 'text/html' } })).status, 303, 'l\'ancien identifiant n\'ouvre plus rien');
  } finally { await s.close(); }
});

test('le back-office exige l\'A2F de l\'administrateur (ADMIN_REQUIRE_MFA)', async () => {
  const s = await startApp({ cfg: { requireAdminMfa: true } });
  try {
    const admin = await s.newUser({ admin: true });
    const r = await admin.get('/admin', { headers: { accept: 'text/html' } });
    assert.equal(r.status, 303);
    assert.match(where(r), /^\/account\?e=.*A2F.*#securite$/);
    assert.equal((await admin.get('/admin/stats')).status, 403, 'JSON : 403 mfa_required');
    assert.equal((await admin.post('/admin/users/999/suspend', {}, form)).status, 403);
    await enable(s, admin);
    assert.equal((await admin.get('/admin', { headers: { accept: 'text/html' } })).status, 200);
    // Un compte ordinaire voit toujours un 404 (rien n'est révélé)
    const user = await s.newUser({ admin: false });
    assert.equal((await user.get('/admin', { headers: { accept: 'text/html' } })).status, 404);
  } finally { await s.close(); }
});

test('journal de sécurité : événements JSON, jamais le code, le secret ni l\'adresse complète', async () => {
  const lines = [];
  securityLog('mfa_failed', { userId: 7, ip: '203.0.113.42' }, (l) => lines.push(l));
  securityLog('mfa_locked', { userId: 7, ip: '2001:db8:85a3:8d3:1319:8a2e:370:7348', detail: 'x'.repeat(500) }, (l) => lines.push(l));
  const [a, b] = lines.map(JSON.parse);
  assert.deepEqual([a.type, a.event, a.userId, a.ip], ['security', 'mfa_failed', 7, '203.0.113.0']);
  assert.equal(b.ip, '2001:db8:85a3::');
  assert.equal(b.detail.length, 120);
  assert.equal(coarseIp('pas une ip'), '');
  // Le routeur A2F journalise sans fuite : on capture la sortie d'une vraie tentative ratée
  const s = await startApp();
  const seen = [];
  const orig = console.log; console.log = (...a) => { seen.push(a.join(' ')); };
  try {
    const u = await s.newUser({ admin: false });
    const { secret, codes } = await enable(s, u);
    await u.post('/account/2fa/disable', { code: '654321' }, form);
    console.log = orig;
    const security = seen.filter((x) => x.includes('"type":"security"'));
    assert.ok(security.some((x) => x.includes('"event":"mfa_enabled"')) && security.some((x) => x.includes('"event":"mfa_failed"')));
    for (const x of security) { assert.ok(!x.includes(secret) && !x.includes(codes[0]) && !x.includes('654321') && !x.includes(u.email)); }
  } finally { console.log = orig; await s.close(); }
});

test('champ de code : 6 chiffres = 6 caractères au plus, secours = 11 ; la page rendue dans l\'autre mode existe sans JavaScript', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: false });
    await enable(s, u);
    const c = s.client(await pendingCookie(s, u.id));
    const std = await (await c.get('/login/2fa', { headers: { accept: 'text/html' } })).text();
    assert.match(std, /name="code" data-code-input data-mode="totp" inputmode="numeric" maxlength="6" pattern="\[0-9\]\{6\}"/);
    assert.match(std, /href="\/login\/2fa\?mode=secours"[^>]*data-code-toggle/);
    const sec = await (await c.get('/login/2fa?mode=secours', { headers: { accept: 'text/html' } })).text();
    assert.match(sec, /data-mode="secours" inputmode="text" maxlength="11"/);
    assert.match(sec, /name="mode" value="secours"/);
    const card = await (await u.get('/account', { headers: { accept: 'text/html' } })).text();
    assert.match(card, /id="securite"[\s\S]*maxlength="6"/);
    const cardSec = await (await u.get('/account?mode=secours', { headers: { accept: 'text/html' } })).text();
    assert.match(cardSec, /id="securite"[\s\S]*maxlength="11"/);
  } finally { await s.close(); }
});

test('serveur : un code de plus de 32 caractères est refusé sans calcul et compte comme un essai raté ; un code de secours exige exactement 10 caractères utiles', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: false });
    const { secret, codes } = await enable(s, u);
    await s.db.prepare('UPDATE users SET totp_last_step = 0 WHERE id = ?').run(u.id);
    const c = s.client(await pendingCookie(s, u.id));
    const valid = codeAt(secret, step());
    // Un bon code noyé dans une longue chaîne n'est pas un bon code
    assert.match(where(await c.post('/login/2fa', { code: `${valid}${'0'.repeat(40)}` }, form)), /\/login\/2fa\?e=/);
    assert.match(where(await c.post('/login/2fa', { code: `${codes[0]}${'a'.repeat(30)}` }, form)), /\/login\/2fa\?e=/);
    assert.match(where(await c.post('/login/2fa', { code: `${codes[0]}0` }, form)), /\/login\/2fa\?e=/, '11 caractères utiles : refusé');
    assert.equal((await c.post('/login/2fa', { code: valid }, form)).headers.get('location'), '/', 'le bon code, lui, passe toujours');
    // le mode se conserve après une erreur
    const c2 = s.client(await pendingCookie(s, u.id));
    assert.match(where(await c2.post('/login/2fa', { code: 'zzzzz-zzzzz', mode: 'secours' }, form)), /mode=secours/);
  } finally { await s.close(); }
});
