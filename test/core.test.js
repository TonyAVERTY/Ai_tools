import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, encryptJson, decryptJson, unsubToken, verifyUnsubToken } from '../src/crypto.js';
import { openDb, getSetting, setSetting, MIGRATIONS } from '../src/db.js';
import { Router, esc } from '../src/http.js';
import { checkIdTokenClaims, checkOrigin } from '../src/auth.js';

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

test('migrations et settings', () => {
  const db = openDb(':memory:');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
  setSetting(db, 'a', '1'); setSetting(db, 'a', '2');
  assert.equal(getSetting(db, 'a'), '2');
  assert.equal(getSetting(db, 'nope', 'x'), 'x');
});

test('migration 2 : les modèles existants deviennent des modèles "initial"', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  // Base en version 1 avec un modèle déjà validé
  let raw = new DatabaseSync(join(dir, 'aitools.sqlite'));
  raw.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY);
    CREATE TABLE mail_templates (project_id INTEGER PRIMARY KEY, subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', updated_at INTEGER NOT NULL);
    INSERT INTO projects VALUES (1); INSERT INTO mail_templates VALUES (1, 'Objet', 'Corps', 'validated', 123);
    PRAGMA user_version = 1;`);
  raw.close();
  // On rejoue seulement la migration 2 (les autres tables v1 sont absentes de ce mini-schéma)
  raw = new DatabaseSync(join(dir, 'aitools.sqlite'));
  const { MIGRATIONS } = await import('../src/db.js');
  raw.exec(MIGRATIONS[1]);
  const t = raw.prepare('SELECT * FROM templates').get();
  assert.equal(t.kind, 'initial');
  assert.equal(t.subject, 'Objet');
  assert.equal(t.status, 'validated');
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'mail_templates'").get().n, 0);
  raw.close();
  rmSync(dir, { recursive: true, force: true });
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

test('claims id_token Google', () => {
  const base = { iss: 'https://accounts.google.com', aud: 'cid', exp: 2e9, nonce: 'n', email_verified: true, email: 'Me@Gmail.com' };
  const opts = { clientId: 'cid', nonce: 'n', allowedEmails: ['me@gmail.com'], at: 1e9 };
  assert.equal(checkIdTokenClaims(base, opts), 'me@gmail.com');
  assert.throws(() => checkIdTokenClaims({ ...base, email: 'pirate@gmail.com' }, opts), /non autorisé/);
  assert.throws(() => checkIdTokenClaims({ ...base, aud: 'x' }, opts), /Audience/);
  assert.throws(() => checkIdTokenClaims({ ...base, nonce: 'z' }, opts), /Nonce/);
  assert.throws(() => checkIdTokenClaims({ ...base, email_verified: false }, opts), /vérifié/);
  assert.throws(() => checkIdTokenClaims({ ...base, exp: 1 }, opts), /expiré/);
});

test('contrôle d\'origine', () => {
  const cfg = { appUrl: 'https://ai.tony-averty.dev' };
  assert.doesNotThrow(() => checkOrigin({ method: 'GET', headers: {} }, cfg));
  assert.doesNotThrow(() => checkOrigin({ method: 'POST', headers: { origin: cfg.appUrl } }, cfg));
  assert.throws(() => checkOrigin({ method: 'POST', headers: { origin: 'https://evil.com' } }, cfg));
  assert.throws(() => checkOrigin({ method: 'POST', headers: {} }, cfg));
});
