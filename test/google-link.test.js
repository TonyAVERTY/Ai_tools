import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encrypt, decrypt } from '../src/crypto.js';
import { getLinkState, testLink, unlink, setGoogleAccountEnabled, GOOGLE_CONSENT_VERSION, GOOGLE_CONSENT_TEXT, aiRefusal } from '../src/claudelink.js';
import { extractLoginUrl, CODE_WINDOW_S } from '../src/googlelogin.js';
import { getSetting } from '../src/db.js';
import { startApp } from './helpers/server.js';
import { makeClaudeBin } from './helpers/claude-bin.js';

// Liaison par compte Google (abonnement Google AI, Antigravity CLI) : page de liaison, consentement, connexion guidée (lien de Google, code recopié),
// fichier collé, vérification par un appel minimal, isolation entre comptes. Aucun vrai agy : simulé (test/fixtures/fake-agy.js).
let s, tmp, dump;
const html = async (u, p) => (await (await u.get(p, { headers: { accept: 'text/html' } })).text()).replace(/&#39;/g, "'");
const rawLink = async (id) => JSON.parse((await s.db.prepare('SELECT claude_link_json FROM users WHERE id = ?').get(id)).claude_link_json);
const storedAuth = async (id) => decrypt(s.app.cfg.secretKey, (await rawLink(id)).secret_enc);
const TOKEN = JSON.stringify({ access_token: 'ya29.' + 'P'.repeat(40), refresh_token: '1//' + 'P'.repeat(40) });
const useBin = (env = {}) => { s.app.cfg.agyBin = makeClaudeBin(tmp, { fixture: 'fake-agy.js', name: `agy-${Math.random().toString(36).slice(2)}`, env: { FAKE_DUMP: dump, ...env } }); };

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'aitools-glink-'));
  dump = join(tmp, 'dump.jsonl');
  s = await startApp({ cfg: { googleAccountEnabled: true, sandbox: { enabled: false, production: false } } });
  s.app.cfg.geminiBin = process.execPath; // un exécutable qui existe : la carte Gemini reste proposée (clé API) quand le mode Google est désactivé
  useBin();
});
after(async () => { setGoogleAccountEnabled(false); s.app.googleLogins?.closeAll(); await s.close(); rmSync(tmp, { recursive: true, force: true }); });

test('page de liaison : l\'option « compte Google » n\'existe que si l\'administrateur l\'a activée, avec le consentement sur la règle de Google', async () => {
  const u = await s.newUser({ admin: false });
  const on = await html(u, '/link?ia=gemini');
  assert.match(on, /Avec ton abonnement Google AI \(Plus, Pro, Ultra\)/);
  assert.match(on, /Se connecter avec Google/);
  assert.match(on, /Clé API ou compte Google/);
  for (const t of GOOGLE_CONSENT_TEXT) assert.ok(on.includes(t.replace(/'/g, "'")), 'le texte complet du consentement est affiché');
  assert.match(on, /n'est pas clairement autorisé par Google/);
  assert.match(on, /id="google-dialog"/);
  setGoogleAccountEnabled(false);
  try {
    const off = await html(u, '/link?ia=gemini');
    assert.doesNotMatch(off, /Se connecter avec Google|google-dialog|abonnement Google AI/);
    assert.match(off, /Gemini se connecte uniquement avec une clé API/);
    assert.equal((await u.post('/link/google/login', { accept: 'on' })).status, 403, 'désactivé : le CLI n\'est pas lancé');
    assert.equal((await u.post('/link/google/auth', { authFile: TOKEN, accept: 'on' }, { headers: { accept: 'application/json' } })).status, 403);
  } finally { setGoogleAccountEnabled(true); }
});

test('lien de connexion : seulement chez Google et en entier (jamais coupé)', () => {
  const full = 'https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=1.apps.googleusercontent.com&response_type=code&scope=openid&state=s';
  assert.equal(extractLoginUrl(`Authentication required. Please visit the URL to log in:\n  ${full}\n\nWaiting…`), full);
  assert.equal(extractLoginUrl('https://evil.example/o/oauth2/auth?response_type=code'), null);
  assert.equal(extractLoginUrl('https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=1'), null, 'un lien sans response_type est un lien coupé : refusé');
  assert.equal(extractLoginUrl('rien'), null);
  assert.ok(CODE_WINDOW_S < 60, 'marge sous les 60 secondes du CLI');
});

test('connexion guidée : case obligatoire, lien de Google donné, code refusé puis accepté, connexion vérifiée et rangée chiffrée', async () => {
  const u = await s.newUser({ admin: false });
  assert.equal((await u.post('/link/google/login', { accept: '' })).status, 400, 'sans consentement le CLI n\'est pas lancé');
  assert.equal(existsSync(dump), false);
  const started = await u.post('/link/google/login', { accept: 'on' });
  assert.equal(started.status, 200);
  const { id, url, expiresIn } = await started.json();
  assert.match(url, /^https:\/\/accounts\.google\.com\/o\/oauth2\/auth\?.*response_type=code/);
  assert.equal(expiresIn, CODE_WINDOW_S);
  assert.equal(await getLinkState(s.db, u.id), null, 'rien n\'est lié avant le code');
  const other = await s.newUser({ admin: false });
  assert.equal((await other.post('/link/google/login/code', { id, code: 'GOODCODE1234' })).status, 404, 'la session d\'un autre n\'est pas la sienne');
  // code au format impossible : refusé sans rien envoyer au CLI
  assert.equal((await u.post('/link/google/login/code', { id, code: 'a b\nc' })).status, 400);
  // code refusé par Google : la session se ferme, on recommence avec un nouveau lien
  const bad = await u.post('/link/google/login/code', { id, code: 'WRONGCODE1234' });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /refusé le code/);
  assert.equal((await u.post('/link/google/login/code', { id, code: 'GOODCODE1234' })).status, 404, 'session fermée');
  assert.equal(await getLinkState(s.db, u.id), null);
  const again = await (await u.post('/link/google/login', { accept: 'on' })).json();
  const done = await u.post('/link/google/login/code', { id: again.id, code: 'GOODCODE1234' });
  assert.equal(done.status, 200);
  const pub = await getLinkState(s.db, u.id);
  assert.deepEqual([pub.provider, pub.mode, pub.label, pub.valid, pub.last4], ['gemini', 'google_account', 'Compte Google', true, null]);
  const link = await rawLink(u.id);
  assert.deepEqual([link.via, link.consent.version], ['login', GOOGLE_CONSENT_VERSION]);
  assert.ok(JSON.parse(await getSetting(s.db, u.id, 'google_consent_json')).at > 0);
  const raw = (await s.db.prepare('SELECT claude_link_json FROM users WHERE id = ?').get(u.id)).claude_link_json;
  assert.ok(!raw.includes('ya29.') && !raw.includes('1//L'), 'aucun jeton en clair en base');
  assert.match(await storedAuth(u.id), /"access_token":"ya29\.L{40}"/);
  assert.ok(!JSON.stringify(pub).includes('ya29.'), 'rien de secret dans l\'état public');
  assert.equal(await aiRefusal(s.db, u.id), null);
  // le dossier de connexion jetable n'a rien laissé
  assert.equal(s.app.googleLogins.sessions.size, 0);
});

test('le CLI de connexion reçoit les règles qui refusent tous les outils (même demande minimale que la vérification)', async () => {
  const u = await s.newUser({ admin: false });
  const before = existsSync(dump) ? readFileSync(dump, 'utf8').trim().split('\n').length : 0;
  const { id } = await (await u.post('/link/google/login', { accept: 'on' })).json();
  await u.post('/link/google/login/cancel', { id });
  const d = readFileSync(dump, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).slice(before)[0];
  assert.ok(d.deny.includes('run_command(*)') && d.deny.includes('write_to_file(*)') && d.deny.includes('browser_subagent(*)'));
  assert.ok(d.argv.includes('Réponds uniquement : ok'));
  assert.ok(!d.env.some((k) => /KEY|SECRET|TOKEN/i.test(k)), 'environnement assaini');
});

test('fichier collé : consentement obligatoire, vérifié par un appel minimal, rangé chiffré', async () => {
  const u = await s.newUser({ admin: false });
  const json = { headers: { accept: 'application/json' } };
  assert.equal((await u.post('/link/google/auth', { authFile: TOKEN, accept: '' }, json)).status, 400);
  assert.equal(await getLinkState(s.db, u.id), null);
  assert.equal((await u.post('/link/google/auth', { authFile: 'court', accept: 'on' }, json)).status, 400, 'fichier trop court : refusé');
  assert.equal((await u.post('/link/google/auth', { authFile: TOKEN, accept: 'on' }, json)).status, 200);
  assert.equal((await rawLink(u.id)).via, 'paste');
  assert.equal(await storedAuth(u.id), TOKEN);
  // formulaire de la page : l'erreur revient sur la page de liaison, avec les options de Gemini ouvertes
  const v = await s.newUser({ admin: false });
  const r = await v.post('/link/google/auth', { authFile: TOKEN, accept: '' }, { headers: { accept: 'text/html' } });
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location'), /^\/link\?ia=gemini&e=/);
});

test('connexion révoquée à la vérification : refus net (400), rien n\'est rangé', async () => {
  const u = await s.newUser({ admin: false });
  const r = await u.post('/link/google/auth', { authFile: TOKEN.replace('ya29.', 'EXPIRED'), accept: 'on' }, { headers: { accept: 'application/json' } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /refusée par Google/);
  assert.equal(await getLinkState(s.db, u.id), null);
});

test('« Tester » et « Délier » : le test passe par agy sous le verrou du compte, délier efface le secret', async () => {
  const u = await s.newUser({ admin: false });
  await u.post('/link/google/auth', { authFile: TOKEN, accept: 'on' }, { headers: { accept: 'application/json' } });
  assert.deepEqual(await testLink(s.app, u.id), { ok: true, message: 'Liaison valide' });
  setGoogleAccountEnabled(false);
  try { assert.equal((await testLink(s.app, u.id)).ok, false); } finally { setGoogleAccountEnabled(true); }
  await unlink(s.app, u.id);
  const row = await rawLink(u.id).catch(() => null);
  assert.ok(!row || !row.secret_enc, 'secret effacé');
});

test('anonyme : aucune des routes Google n\'est ouverte', async () => {
  for (const p of ['/link/google/login', '/link/google/login/code', '/link/google/login/cancel', '/link/google/auth']) {
    const r = await s.anon.post(p, {});
    assert.ok([401, 303, 403].includes(r.status), `${p} : ${r.status}`);
  }
  void encrypt;
});
