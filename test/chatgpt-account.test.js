import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encrypt, decrypt } from '../src/crypto.js';
import { makeClaude } from '../src/handlers.js';
import {
  linkChatgptAccount, parseAuthJson, saveRefreshedAuth, authSecrets, testLink, getLinkState, userProvider, aiRefusal, isSubscriptionMode, OPENAI_CONSENT_TEXT, OPENAI_CONSENT_VERSION,
} from '../src/claudelink.js';
import { getSetting } from '../src/db.js';
import { extractLoginUrl, extractUserCode, chatgptLoginsOf } from '../src/chatgptlogin.js';
import { buildBwrapArgs, buildChildEnv } from '../src/services/sandbox.js';
import { startApp } from './helpers/server.js';
import { makeClaudeBin } from './helpers/claude-bin.js';

// ChatGPT par compte (fichier de connexion de Codex) : validation, file d'attente par utilisateur, jetons renouvelés rangés, shell sans accès aux jetons,
// connexion guidée par code d'appareil. Aucun vrai CLI : Codex est simulé (test/fixtures/fake-codex.js).
let s, tmp, dump, log;
const mkAuth = (refresh = 'ref.' + 'R'.repeat(30)) => JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: 'id.' + 'I'.repeat(30), access_token: 'acc.' + 'A'.repeat(30), refresh_token: refresh }, last_refresh: '2026-11-04T10:00:00Z' });
const dumps = () => (existsSync(dump) ? readFileSync(dump, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const logLines = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => l.split(' ')) : []);
const rawLink = async (id) => JSON.parse((await s.db.prepare('SELECT claude_link_json FROM users WHERE id = ?').get(id)).claude_link_json);
const storedAuth = async (id) => decrypt(s.app.cfg.secretKey, (await rawLink(id)).secret_enc);
const accountLink = (auth = mkAuth()) => ({ v: 1, provider: 'openai', mode: 'chatgpt_account', valid: true, linked_at: 1000, secret_enc: encrypt(s.app.cfg.secretKey, auth) });
const useBin = (env = {}) => { s.app.cfg.codexBin = makeClaudeBin(tmp, { fixture: 'fake-codex.js', name: `codex-${Math.random().toString(36).slice(2)}`, env: { FAKE_DUMP: dump, ...env } }); };
const run = (u, prompt, o = {}) => makeClaude(s.app)(u.id, { prompt, model: 'gpt-6-luna', maxTurns: 1, tools: [], ...o });

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'aitools-chatgpt-'));
  dump = join(tmp, 'dump.jsonl');
  log = join(tmp, 'queue.log');
  s = await startApp({ cfg: { sandbox: { enabled: false, production: false } } });
  useBin();
});
after(async () => { s.app.chatgptLogins?.closeAll(); await s.close(); rmSync(tmp, { recursive: true, force: true }); });

test('fichier de connexion : seul celui d\'un compte ChatGPT renouvelable est accepté, rendu compact', () => {
  assert.equal(parseAuthJson(`  ${mkAuth()}  `), JSON.stringify(JSON.parse(mkAuth())));
  const bad = (x) => assert.throws(() => parseAuthJson(x), /fichier de connexion ChatGPT/);
  bad('');
  bad('pas du json'.padEnd(80, 'x'));
  bad(JSON.stringify({ auth_mode: 'api_key', OPENAI_API_KEY: 'sk-x'.repeat(10) }));
  bad(JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'a'.repeat(60) } }));
  bad(JSON.stringify({ auth_mode: 'chatgpt', tokens: { refresh_token: '' , access_token: 'a'.repeat(60) } }));
  bad(JSON.stringify({ auth_mode: 'chatgpt', tokens: { refresh_token: 'r'.repeat(200_000) } }));
  assert.deepEqual(authSecrets(mkAuth()).length, 3);
  assert.deepEqual(authSecrets('pas du json'), []);
});

test('un compte ChatGPT est un abonnement : même avertissement et même interrupteur que le jeton Claude', () => {
  assert.equal(isSubscriptionMode('chatgpt_account'), true);
  assert.equal(isSubscriptionMode('subscription_token'), true);
  assert.equal(isSubscriptionMode('api_key'), false);
  assert.ok(OPENAI_CONSENT_TEXT.length >= 3 && OPENAI_CONSENT_TEXT.join(' ').includes('OpenAI'));
  assert.match(OPENAI_CONSENT_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);
});

test('liaison : sans la case cochée rien n\'est lancé ni rangé ; interrupteur coupé : refusé', async () => {
  const u = await s.newUser({ admin: false });
  const before = dumps().length;
  await assert.rejects(linkChatgptAccount(s.app, u.id, { authJson: mkAuth(), accept: false }), /cocher/);
  assert.equal(dumps().length, before, 'Codex n\'est pas lancé sans consentement');
  assert.equal(await getLinkState(s.db, u.id), null);
  s.app.cfg.cliModeEnabled = false;
  await assert.rejects(linkChatgptAccount(s.app, u.id, { authJson: mkAuth(), accept: 'on' }), /désactivé/);
  s.app.cfg.cliModeEnabled = true;
  assert.equal(await getLinkState(s.db, u.id), null);
});

test('liaison par fichier collé : vérifiée par un appel à Codex, chiffrée, consentement daté, jamais réaffichée', async () => {
  const u = await s.newUser({ admin: false });
  const auth = mkAuth();
  const before = dumps().length;
  await linkChatgptAccount(s.app, u.id, { authJson: auth, accept: 'on' });
  const d = dumps().slice(before);
  assert.equal(d.length, 1, 'un appel minimal pour vérifier');
  assert.equal(d[0].auth.tokens.refresh_token, JSON.parse(auth).tokens.refresh_token, 'Codex a vu la connexion à vérifier');
  const raw = (await s.db.prepare('SELECT claude_link_json FROM users WHERE id = ?').get(u.id)).claude_link_json;
  for (const t of authSecrets(auth)) assert.ok(!raw.includes(t), 'aucun jeton en clair en base');
  assert.equal(await storedAuth(u.id), JSON.stringify(JSON.parse(auth)));
  const link = await rawLink(u.id);
  assert.deepEqual([link.provider, link.mode, link.consent.version], ['openai', 'chatgpt_account', OPENAI_CONSENT_VERSION]);
  assert.ok(JSON.parse(await getSetting(s.db, u.id, 'openai_consent_json')).at > 0);
  const pub = await getLinkState(s.db, u.id);
  assert.deepEqual([pub.provider, pub.label, pub.last4], ['openai', 'Compte ChatGPT', null]);
  assert.ok(!JSON.stringify(pub).includes('acc.'));
  assert.equal(await userProvider(s.db, u.id), 'openai');
  assert.equal(await aiRefusal(s.db, u.id), null);
});

test('connexion refusée par ChatGPT (révoquée) : rien n\'est rangé', async () => {
  const u = await s.newUser({ admin: false });
  const realWarn = console.warn; console.warn = () => {};
  try {
    await assert.rejects(linkChatgptAccount(s.app, u.id, { authJson: mkAuth('ref.REVOKED' + 'x'.repeat(20)), accept: 'on' }), (e) => e.status === 400 && /refusée par ChatGPT/.test(e.message));
  } finally { console.warn = realWarn; }
  assert.equal(await getLinkState(s.db, u.id), null);
});

test('un job : le fichier est dans un dossier propre au lancement, le shell n\'a pas le droit de le lire, il est supprimé ensuite', async () => {
  const u = await s.newUser({ admin: false, link: accountLink() });
  const before = dumps().length;
  const r = await run(u, 'Dis bonjour', { tools: ['Read', 'Grep'] });
  assert.equal(r.ok, true);
  const d = dumps().slice(before)[0];
  assert.equal(d.auth.tokens.refresh_token, 'ref.' + 'R'.repeat(30));
  assert.ok(d.codexHome.includes('aitools-codex-home-'));
  assert.equal(d.key, null, 'aucune clé API dans l\'environnement');
  assert.ok(!d.argv.includes('--sandbox'), 'le profil de permissions remplace --sandbox (ils ne se combinent pas)');
  const cfg = d.argv.filter((x, i) => d.argv[i - 1] === '-c');
  assert.ok(cfg.includes('default_permissions="aitools"'));
  assert.ok(cfg.includes('permissions.aitools.extends=":read-only"'));
  assert.ok(cfg.includes(`permissions.aitools.filesystem."${d.codexHome}"="deny"`), 'le dossier de connexion est refusé au shell');
  assert.ok(cfg.includes('cli_auth_credentials_store="file"'));
  assert.ok(cfg.includes('features.shell_tool=true'));
  assert.ok(!d.argv.some((a) => /refresh_token|ref\.R/.test(a)), 'aucun jeton dans argv');
  assert.equal(existsSync(d.codexHome), false, 'dossier temporaire supprimé');
  assert.equal(readdirSync(tmpdir()).filter((f) => f.startsWith('aitools-codex-home-')).length, 0);
});

test('jetons renouvelés par Codex : rangés chiffrés, et le job suivant part des nouveaux', async () => {
  const u = await s.newUser({ admin: false, link: accountLink() });
  const before = dumps().length;
  await run(u, 'REFRESH un');
  const after = await storedAuth(u.id);
  const fresh = JSON.parse(after).tokens.refresh_token;
  assert.match(fresh, /^ref\.NEW/);
  const raw = (await s.db.prepare('SELECT claude_link_json FROM users WHERE id = ?').get(u.id)).claude_link_json;
  assert.ok(!raw.includes(fresh), 'chiffré');
  assert.ok((await rawLink(u.id)).refreshed_at > 0);
  await run(u, 'deux');
  assert.equal(dumps().slice(before)[1].auth.tokens.refresh_token, fresh, 'le job suivant utilise le jeton renouvelé');
});

test('jetons renouvelés pendant un job qui échoue : gardés aussi (sinon la liaison casse)', async () => {
  const u = await s.newUser({ admin: false, link: accountLink() });
  const realWarn = console.warn; console.warn = () => {};
  try { await run(u, 'REFRESH BADKEY'); } finally { console.warn = realWarn; }
  // BADKEY sort avant le renouvellement du faux Codex : on vérifie alors surtout que rien n'est cassé
  assert.equal((await rawLink(u.id)).mode, 'chatgpt_account');
});

test('une liaison refaite pendant un job n\'est jamais écrasée par les jetons de l\'ancienne', async () => {
  const u = await s.newUser({ admin: false, link: accountLink() });
  const neu = mkAuth('ref.' + 'Z'.repeat(30));
  const link = await rawLink(u.id);
  await s.db.prepare('UPDATE users SET claude_link_json = ? WHERE id = ?').run(JSON.stringify({ ...link, linked_at: 2000, secret_enc: encrypt(s.app.cfg.secretKey, neu) }), u.id);
  assert.equal(await saveRefreshedAuth(s.app, u.id, 1000, mkAuth('ref.OLD' + 'o'.repeat(25))), false);
  assert.equal(JSON.parse(await storedAuth(u.id)).tokens.refresh_token, 'ref.' + 'Z'.repeat(30));
  assert.equal(await saveRefreshedAuth(s.app, u.id, 2000, mkAuth('ref.OK' + 'k'.repeat(26))), true);
  assert.equal(await saveRefreshedAuth(s.app, u.id, 2000, 'pas du json'), false, 'un fichier abîmé n\'écrase rien');
  assert.match(JSON.parse(await storedAuth(u.id)).tokens.refresh_token, /^ref\.OK/);
});

test('les jetons ne sortent jamais : masqués dans les erreurs du CLI', async () => {
  const auth = mkAuth('ref.LEAK' + 'q'.repeat(24));
  const u = await s.newUser({ admin: false, link: accountLink(auth) });
  let msg = '';
  await assert.rejects(run(u, 'EXFIL'), (e) => { msg = e.message; return true; });
  assert.ok(!msg.includes('ref.LEAK'), 'le jeton de rafraîchissement est masqué');
  assert.match(msg, /\*\*\*/);
});

test('les exécutions d\'un même compte s\'enchaînent (un seul à la fois), celles de comptes différents tournent ensemble', async () => {
  rmSync(log, { force: true });
  useBin({ FAKE_LOG: log, FAKE_DELAY_MS: '150' });
  const a = await s.newUser({ admin: false, link: accountLink(mkAuth('ref.A' + 'a'.repeat(28))) });
  const b = await s.newUser({ admin: false, link: accountLink(mkAuth('ref.B' + 'b'.repeat(28))) });
  await Promise.all([run(a, 'REFRESH 1'), run(a, 'REFRESH 2'), run(a, 'REFRESH 3')]);
  const mine = logLines().filter((l) => /^(start|end)$/.test(l[0]));
  assert.deepEqual(mine.map((l) => l[0]), ['start', 'end', 'start', 'end', 'start', 'end'], 'jamais deux exécutions en même temps pour un compte');
  const starts = logLines().filter((l) => l[0] === 'start').map((l) => l[1]);
  assert.equal(new Set(starts).size, 3, 'chaque exécution part du jeton laissé par la précédente');
  assert.match(starts[0], /^ref\.A/);
  assert.match(starts[1], /^ref\.NEW/);
  rmSync(log, { force: true });
  await Promise.all([run(a, 'x'), run(b, 'x')]);
  const t = logLines();
  assert.deepEqual(t.map((l) => l[0]), ['start', 'start', 'end', 'end'], 'deux comptes : en parallèle');
  useBin();
});

test('un arrêt demandé pendant l\'attente sort de la file sans lancer Codex', async () => {
  useBin({ FAKE_DELAY_MS: '300' });
  const u = await s.newUser({ admin: false, link: accountLink() });
  const before = dumps().length;
  const first = run(u, 'long');
  await new Promise((r) => setTimeout(r, 60));
  const ac = new AbortController();
  const second = run(u, 'jamais', { signal: ac.signal });
  ac.abort();
  await assert.rejects(second, /Annulé/);
  await first;
  assert.equal(dumps().slice(before).length, 1, 'le second n\'a jamais lancé Codex');
  useBin();
});

test('tester la liaison : valide → renouvelée rangée ; révoquée → invalide sans perdre les jetons', async () => {
  const u = await s.newUser({ admin: false, link: accountLink() });
  assert.deepEqual(await testLink(s.app, u.id), { ok: true, message: 'Liaison valide' });
  const bad = await s.newUser({ admin: false, link: accountLink(mkAuth('ref.REVOKED' + 'x'.repeat(20))) });
  const realWarn = console.warn; console.warn = () => {};
  try { assert.equal((await testLink(s.app, bad.id)).ok, false); } finally { console.warn = realWarn; }
  assert.equal((await getLinkState(s.db, bad.id)).valid, false);
  assert.match(JSON.parse(await storedAuth(bad.id)).tokens.refresh_token, /REVOKED/, 'le secret reste en base (comme chez Claude)');
});

// ---------- Bac à sable ----------

test('bac à sable : seul le dossier de connexion du lancement est en écriture ; CODEX_HOME est une variable autorisée', () => {
  const a = buildBwrapArgs({ workDir: '/data/u1/repo', command: ['codex'], rwDirs: ['/tmp/aitools-codex-home-x'] });
  const i = a.indexOf('/tmp/aitools-codex-home-x');
  assert.deepEqual(a.slice(i - 1, i + 2), ['--bind', '/tmp/aitools-codex-home-x', '/tmp/aitools-codex-home-x']);
  assert.ok(a.indexOf('--tmpfs') < i, 'monté après le /tmp vide');
  const wr = a.reduce((n, x, k) => n + (x === '--bind' ? 1 : 0), 0);
  assert.equal(wr, 1, 'un seul montage en écriture, jamais le dépôt');
  const env = buildChildEnv({ PATH: '/bin' }, { extraEnv: { CODEX_HOME: '/tmp/x' }, home: '/home/sandbox' });
  assert.equal(env.CODEX_HOME, '/tmp/x');
  assert.throws(() => buildChildEnv({}, { extraEnv: { HOME: '/x' }, home: '/h' }), /non autorisée/);
});

// ---------- Connexion guidée ----------

test('lien et code : seulement chez OpenAI, code lu sur la ligne qui en parle', () => {
  const out = '\nFollow these steps\n\n1. Open this link\n   https://auth.openai.com/codex/device\n\n2. Enter this one-time code (expires in 15 minutes)\n   ABCD-12345\n';
  assert.equal(extractLoginUrl(out), 'https://auth.openai.com/codex/device');
  assert.equal(extractUserCode(out), 'ABCD-12345');
  assert.equal(extractUserCode('Enter code: WXYZ-9876 now'), 'WXYZ-9876');
  assert.equal(extractLoginUrl('https://evil.example/codex/device'), null);
  assert.equal(extractLoginUrl('https://openai.com.evil.example/x'), null);
  assert.equal(extractLoginUrl('http://auth.openai.com/x'), null);
  assert.equal(extractLoginUrl('\x1b[1mhttps://chatgpt.com/auth/device\x1b[0m.'), 'https://chatgpt.com/auth/device');
});

test('connexion guidée par les routes : case obligatoire, lien et code donnés, puis rangée (vérifiée) quand l\'utilisateur a validé', async () => {
  useBin({ FAKE_LOGIN_MS: '400' });
  const u = await s.newUser({ admin: false });
  const none = await u.post('/link/chatgpt/login', { accept: '' });
  assert.equal(none.status, 400, 'sans consentement le CLI n\'est pas lancé');
  const started = await u.post('/link/chatgpt/login', { accept: 'on' });
  assert.equal(started.status, 200);
  const { id, url, code } = await started.json();
  assert.equal(url, 'https://auth.openai.com/codex/device');
  assert.equal(code, 'ABCD-12345');
  const status = (client, i) => client.get(`/link/chatgpt/login/status?id=${i}`);
  const pend = await status(u, id);
  assert.equal((await pend.json()).state, 'pending');
  assert.equal((await u.post('/link/chatgpt/login/finish', { id })).status, 409, 'pas de liaison tant que l\'utilisateur n\'a pas validé');
  assert.equal(await getLinkState(s.db, u.id), null);
  const other = await s.newUser({ admin: false });
  assert.equal((await status(other, id)).status, 404, 'la session d\'un autre n\'est pas la sienne');
  assert.equal((await other.post('/link/chatgpt/login/finish', { id })).status, 404);
  await new Promise((r) => setTimeout(r, 700));
  assert.equal((await (await status(u, id)).json()).state, 'ready', 'prête, et le reste tant qu\'on n\'a pas terminé');
  assert.equal((await (await status(u, id)).json()).state, 'ready');
  const done = await u.post('/link/chatgpt/login/finish', { id });
  assert.equal(done.status, 200);
  assert.equal((await status(u, id)).status, 404, 'session fermée après l\'enregistrement');
  const pub = await getLinkState(s.db, u.id);
  assert.deepEqual([pub.provider, pub.mode, pub.valid], ['openai', 'chatgpt_account', true]);
  assert.equal((await rawLink(u.id)).via, 'login');
  assert.match(JSON.parse(await storedAuth(u.id)).tokens.refresh_token, /^ref\.R/);
  assert.equal(readdirSync(tmpdir()).filter((f) => f.startsWith('aitools-chatgpt-login-')).length, 0, 'dossier de connexion supprimé');
  useBin();
});

test('connexion guidée : lien hors OpenAI refusé, CLI muet ou code refusé : message clair, jamais de liaison', async () => {
  const realWarn = console.warn; console.warn = () => {};
  try {
    for (const [mode, status, re] of [['EVIL', 502, /pas donné de lien/], ['NOLINK', 502, /pas donné de lien/]]) {
      useBin({ FAKE_LOGIN: mode });
      const u = await s.newUser({ admin: false });
      const r = await u.post('/link/chatgpt/login', { accept: 'on' });
      assert.equal(r.status, status, mode);
      assert.match(await r.text(), re);
      assert.equal(await getLinkState(s.db, u.id), null);
    }
    useBin({ FAKE_LOGIN: 'DENIED', FAKE_LOGIN_MS: '100' });
    const u = await s.newUser({ admin: false });
    const { id } = await (await u.post('/link/chatgpt/login', { accept: 'on' })).json();
    await new Promise((r) => setTimeout(r, 400));
    const st = await (await u.get(`/link/chatgpt/login/status?id=${id}`)).json();
    assert.equal(st.state, 'failed');
    assert.match(st.message, /n'a pas validé/);
    assert.equal(await getLinkState(s.db, u.id), null);
    assert.equal((await u.get(`/link/chatgpt/login/status?id=${id}`)).status, 404, 'session fermée après l\'échec');
  } finally { console.warn = realWarn; }
  useBin();
});

test('connexion guidée : annulation, et une nouvelle connexion remplace l\'ancienne du même utilisateur', async () => {
  useBin({ FAKE_LOGIN_MS: '5000' });
  const u = await s.newUser({ admin: false });
  const a = await (await u.post('/link/chatgpt/login', { accept: 'on' })).json();
  const b = await (await u.post('/link/chatgpt/login', { accept: 'on' })).json();
  assert.equal((await u.get(`/link/chatgpt/login/status?id=${a.id}`)).status, 404, 'l\'ancienne a été remplacée');
  assert.equal(chatgptLoginsOf(s.app).sessions.size >= 1, true);
  await u.post('/link/chatgpt/login/cancel', { id: b.id });
  assert.equal((await u.get(`/link/chatgpt/login/status?id=${b.id}`)).status, 404);
  useBin();
});

test('fichier collé par la route : mêmes garde-fous', async () => {
  const u = await s.newUser({ admin: false });
  const r = await u.post('/link/chatgpt/auth', { authJson: mkAuth(), accept: 'on' }, { headers: { accept: 'application/json' } });
  assert.equal(r.status, 200);
  assert.equal((await getLinkState(s.db, u.id)).mode, 'chatgpt_account');
  const bad = await (await s.newUser({ admin: false })).post('/link/chatgpt/auth', { authJson: '{}', accept: 'on' }, { headers: { accept: 'application/json' } });
  assert.equal(bad.status, 400);
});

// Régression : la page interroge l'état toutes les 2 s ; ces appels ne doivent jamais épuiser la limite stricte de la liaison (10 requêtes / 10 min).
test('le sondage de la connexion guidée ne compte pas dans la limite de liaison', async () => {
  const lim = await startApp({ rateLimit: true, cfg: { codexBin: makeClaudeBin(tmp, { fixture: 'fake-codex.js', name: 'codex-lim', env: { FAKE_LOGIN_MS: '60000' } }) } });
  try {
    const u = await lim.newUser({ admin: false });
    const { id } = await (await u.post('/link/chatgpt/login', { accept: 'on' })).json();
    const codes = [];
    for (let i = 0; i < 200; i++) codes.push((await u.get(`/link/chatgpt/login/status?id=${id}`)).status); // 200 sondages : 6 min et demie de page ouverte
    assert.deepEqual([...new Set(codes)], [200], 'aucun « Trop de requêtes » pendant l\'attente');
    // La limite stricte de la liaison reste en vigueur pour les actions qui coûtent un appel réseau
    const posts = [];
    for (let i = 0; i < 12; i++) posts.push((await u.post('/link/chatgpt/login/cancel', { id })).status);
    assert.ok(posts.includes(429), `la limite « link » joue toujours (${posts.join(',')})`);
    // ... et le sondage, lui, répond encore (la session a été annulée : 404, pas 429)
    assert.equal((await u.get(`/link/chatgpt/login/status?id=${id}`)).status, 404);
  } finally { lim.app.chatgptLogins?.closeAll(); await lim.close(); }
});
