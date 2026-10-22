import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { now, getSetting, setSetting } from '../src/db.js';
import { decrypt } from '../src/crypto.js';
import { enqueue, Worker, jobRefusal } from '../src/services/jobs.js';
import { AI_JOBS } from '../src/services/budget.js';
import { makeClaude } from '../src/handlers.js';
import {
  LINK_REQUIRED_MESSAGE, CONSENT_VERSION, CONSENT_CHECKBOX, aiRefusal, validateApiKey, getLinkState,
} from '../src/claudelink.js';
import { HttpError } from '../src/http.js';
import { startApp } from './helpers/server.js';
import { makeClaudeBin } from './helpers/claude-bin.js';

// Liaison Claude : clé API, jeton d'abonnement avec consentement, mode serveur, onboarding bloquant, déliaison.
// Aucun appel réseau ni CLI réel : fetch injecté, CLI simulé par les fixtures.
let s, binDir;
const KEY_A = `sk-ant-api03-${'A'.repeat(40)}ZZ12`;
const KEY_B = `sk-ant-api03-${'B'.repeat(40)}QQ34`;
const TOKEN = `sk-ant-oat01-${'T'.repeat(48)}`;
const AI_ROUTES = ['analyze', 'template', 'followup_template', 'prospect', 'evolution'];
const logs = [];
const realConsole = { log: console.log, warn: console.warn, error: console.error };

// Réponses de « api.anthropic.com » : 200 par défaut, modifiable par test
let apiStatus = 200, apiThrows = false;
const apiCalls = [];

before(async () => {
  binDir = mkdtempSync(join(tmpdir(), 'aitools-bin-'));
  s = await startApp({ cfg: { claudeBin: makeClaudeBin(binDir) } });
  s.app.fetch = async (url, opts) => {
    apiCalls.push({ url, headers: opts?.headers });
    if (apiThrows) throw new Error('ECONNRESET');
    return { status: apiStatus, ok: apiStatus >= 200 && apiStatus < 300 };
  };
  for (const k of Object.keys(realConsole)) console[k] = (...a) => { logs.push(a.map(String).join(' ')); };
});
after(async () => {
  Object.assign(console, realConsole);
  await s.close();
  rmSync(binDir, { recursive: true, force: true });
});

const orow = (o, id) => o.db.prepare('SELECT claude_link_json FROM users WHERE id = ?').get(id);
const row = (id) => s.db.prepare('SELECT claude_link_json FROM users WHERE id = ?').get(id);
const dump = async () => JSON.stringify([
  await s.db.prepare('SELECT * FROM users').all(), await s.db.prepare('SELECT * FROM user_settings').all(),
  await s.db.prepare('SELECT * FROM jobs').all(), await s.db.prepare('SELECT * FROM sessions').all(),
]);
const project = async (u) => Number((await s.db.prepare(`INSERT INTO projects(user_id, name, git_url, profile_json, target_json, target_validated, created_at)
  VALUES(?, 'P', ?, ?, ?, 1, ?)`).run(u.id, `https://git.test/u${u.id}/p.git`, JSON.stringify({ resume: 'x' }), JSON.stringify({ description: 'd', secteurs: ['s'] }), now())).lastInsertRowid);

test('clé API : validée sans coût (GET /v1/models), chiffrée, jamais réaffichée', async () => {
  const u = await s.newUser({ admin: false });
  apiCalls.length = 0; apiStatus = 200;
  const r = await u.post('/link/api-key', { apiKey: KEY_A });
  assert.equal(r.status, 200);
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].url, 'https://api.anthropic.com/v1/models');
  assert.equal(apiCalls[0].headers['x-api-key'], KEY_A);
  assert.equal(apiCalls[0].headers['anthropic-version'], '2023-06-01');

  const stored = (await row(u.id)).claude_link_json;
  assert.ok(!stored.includes(KEY_A), 'pas en clair en base');
  const link = JSON.parse(stored);
  assert.equal(link.mode, 'api_key');
  assert.equal(link.last4, 'ZZ12');
  assert.equal(decrypt(s.app.cfg.secretKey, link.secret_enc), KEY_A, 'chiffré avec SECRET_KEY, relisible');
  assert.ok(!(await dump()).includes(KEY_A));

  for (const path of ['/link', '/account', '/api/system']) {
    const body = await (await u.get(path, { headers: { accept: 'text/html' } })).text();
    assert.ok(!body.includes(KEY_A), `${path} ne renvoie jamais la clé`);
    assert.ok(!body.includes('A'.repeat(20)), `${path} ne renvoie pas de morceau de la clé`);
  }
  const account = await (await u.get('/account', { headers: { accept: 'text/html' } })).text();
  assert.match(account, /sk-ant-…ZZ12/);
  assert.ok(!logs.some((l) => l.includes(KEY_A)), 'aucune trace de la clé dans les journaux');
});

test('clé API : refus 401/403 et erreur réseau distincts, rien n\'est stocké', async () => {
  const u = await s.newUser({ admin: false });
  apiStatus = 401;
  let r = await u.post('/link/api-key', { apiKey: KEY_B });
  assert.equal(r.status, 400);
  const refused = (await r.json()).error;
  assert.match(refused, /refusée/);
  apiStatus = 403;
  assert.equal((await u.post('/link/api-key', { apiKey: KEY_B })).status, 400);
  apiStatus = 200; apiThrows = true;
  r = await u.post('/link/api-key', { apiKey: KEY_B });
  apiThrows = false;
  assert.equal(r.status, 502);
  const network = (await r.json()).error;
  assert.match(network, /réseau/);
  assert.notEqual(network, refused);
  assert.ok(!JSON.stringify(network).includes(KEY_B));
  apiStatus = 500;
  assert.equal((await u.post('/link/api-key', { apiKey: KEY_B })).status, 502);
  apiStatus = 200;
  assert.equal((await row(u.id)).claude_link_json, null, 'aucune liaison enregistrée');
  assert.equal((await u.post('/link/api-key', { apiKey: 'pas-une-cle' })).status, 400);
  assert.equal((await u.post('/link/api-key', {})).status, 400);
  assert.ok(!logs.some((l) => l.includes(KEY_B)));
});

test('validateApiKey : fetch injectable, 401/403 refusé, réseau distinct', async () => {
  await assert.rejects(validateApiKey(KEY_A, async () => ({ status: 401, ok: false })), { status: 400 });
  await assert.rejects(validateApiKey(KEY_A, async () => ({ status: 403, ok: false })), { status: 400 });
  await assert.rejects(validateApiKey(KEY_A, async () => { throw new Error('boom'); }), { status: 502 });
  await validateApiKey(KEY_A, async () => ({ status: 200, ok: true }));
});

test('mode abonnement : sans la case, 400 et rien n\'est stocké ni validé', async () => {
  const u = await s.newUser({ admin: false });
  let validated = 0;
  s.app.validateToken = async () => { validated++; };
  try {
    for (const body of [{ token: TOKEN }, { token: TOKEN, accept: '' }, { token: TOKEN, accept: 'off' }, { token: TOKEN, accept: false }]) {
      const r = await u.post('/link/subscription', body);
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, new RegExp(CONSENT_CHECKBOX));
    }
    assert.equal(validated, 0, 'le jeton n\'est même pas vérifié sans consentement');
    assert.equal((await row(u.id)).claude_link_json, null);
    assert.equal(await getSetting(s.db, u.id, 'claude_cli_consent_json'), null);
    assert.ok(!(await dump()).includes(TOKEN));
  } finally { delete s.app.validateToken; }
});

test('mode abonnement : case cochée, consentement horodaté avec la version du texte, jeton chiffré', async () => {
  const u = await s.newUser({ admin: false });
  s.app.validateToken = async () => {};
  const before = now();
  try {
    const r = await u.post('/link/subscription', { token: TOKEN, accept: true });
    assert.equal(r.status, 200);
  } finally { delete s.app.validateToken; }
  const stored = (await row(u.id)).claude_link_json;
  assert.ok(!stored.includes(TOKEN));
  const link = JSON.parse(stored);
  assert.equal(link.mode, 'subscription_token');
  assert.ok(link.consent.at >= before && link.consent.at <= now());
  assert.equal(link.consent.version, CONSENT_VERSION);
  assert.equal(decrypt(s.app.cfg.secretKey, link.secret_enc), TOKEN);
  assert.ok(!(await dump()).includes(TOKEN));
  const account = await (await u.get('/account', { headers: { accept: 'text/html' } })).text();
  assert.ok(!account.includes(TOKEN));
  assert.match(account, new RegExp(CONSENT_VERSION.replace(/\./g, '\\.')));
  assert.doesNotMatch(account, /sk-ant-…/, 'pas de 4 derniers caractères pour un jeton');
  assert.ok(!logs.some((l) => l.includes(TOKEN)));
});

test('mode abonnement via le CLI simulé : jeton révoqué refusé, jeton valide accepté, jamais dans les erreurs', async () => {
  const u = await s.newUser({ admin: false });
  const revoked = `${TOKEN}REVOKED`;
  const r = await u.post('/link/subscription', { token: revoked, accept: true });
  assert.equal(r.status, 400);
  assert.ok(!JSON.stringify(await r.json()).includes(revoked));
  assert.equal((await row(u.id)).claude_link_json, null);
  assert.equal((await u.post('/link/subscription', { token: TOKEN, accept: 'on' })).status, 200);
  assert.equal((await getLinkState(s.db, u.id)).mode, 'subscription_token');
  // une clé API collée dans le champ jeton est signalée
  assert.equal((await u.post('/link/subscription', { token: KEY_A, accept: true })).status, 400);
});

test('formulaire HTML : l\'erreur revient sur /link, la page affiche la fenêtre d\'avertissement avec la case', async () => {
  const u = await s.newUser({ admin: false });
  const r = await u.post('/link/subscription', { token: TOKEN }, { form: true });
  assert.equal(r.status, 400, 'ce client demande du JSON');
  const form = await fetch(`${s.base}/link/subscription`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: u.cookie, origin: 'https://ai.tony-averty.dev', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: TOKEN }).toString(),
  });
  assert.equal(form.status, 303);
  assert.match(decodeURIComponent(form.headers.get('location')), /^\/link\?e=.*cocher/);
  const page = (await (await u.get('/link', { headers: { accept: 'text/html' } })).text()).replace(/&#39;/g, "'");
  assert.match(page, /<dialog[^>]*id="consent-dialog"/);
  assert.match(page, /contrevenir aux conditions d'utilisation d'Anthropic/);
  assert.match(page, /suspension/);
  assert.match(page, /ne peut en être tenu responsable/);
  assert.match(page, /<input type="checkbox" name="accept" data-consent required>/);
  assert.match(page, /data-consent-submit disabled/);
  assert.match(page, /claude setup-token/, 'la saisie manuelle du jeton reste proposée en secours');
  assert.match(page, /data-claude-login/, 'et la connexion guidée en premier');
});

test('drapeau CLAUDE_CLI_MODE_ENABLED=false : mode abonnement masqué et refusé côté serveur', async () => {
  const off = await startApp({ cfg: { claudeBin: 'inexistant', cliModeEnabled: false } });
  try {
    const u = await off.newUser({ admin: false });
    let validated = 0;
    off.app.validateToken = async () => { validated++; };
    const r = await u.post('/link/subscription', { token: TOKEN, accept: true });
    assert.equal(r.status, 403);
    assert.equal(validated, 0);
    assert.equal((await off.db.prepare('SELECT claude_link_json FROM users WHERE id = ?').get(u.id)).claude_link_json, null);
    const page = await (await u.get('/link', { headers: { accept: 'text/html' } })).text();
    assert.doesNotMatch(page, /consent-dialog|setup-token|abonnement/);
    assert.match(page, /Clé API Anthropic/);
    // une liaison abonnement déjà en base ne permet plus de lancer de job
    const linked = await off.newUser({ admin: false, link: { v: 1, mode: 'subscription_token', valid: true, secret_enc: 'x' } });
    assert.match(await aiRefusal(off.db, linked.id, { cliModeEnabled: false }), /désactivé/);
    assert.equal(await aiRefusal(off.db, linked.id, { cliModeEnabled: true }), null);
  } finally { await off.close(); }
});

test('mode « Claude du serveur » : réservé aux admins (liaison et exécution)', async () => {
  const user = await s.newUser({ admin: false });
  assert.equal((await user.post('/link/server', {})).status, 403);
  assert.equal((await row(user.id)).claude_link_json, null);
  assert.ok(!(await (await user.get('/link', { headers: { accept: 'text/html' } })).text()).includes('/link/server'));
  const admin = await s.newUser({ admin: true, link: null });
  assert.match(await (await admin.get('/link', { headers: { accept: 'text/html' } })).text(), /action="\/link\/server"/);
  assert.equal((await admin.post('/link/server', {})).status, 200);
  assert.equal((await getLinkState(s.db, admin.id)).mode, 'server');
  assert.equal(await aiRefusal(s.db, admin.id), null);
  // un admin rétrogradé (ADMIN_EMAILS) perd le mode serveur
  await s.db.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').run(admin.id);
  assert.match(await aiRefusal(s.db, admin.id), /réservé aux administrateurs/);
  await s.db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(admin.id);
});

test('onboarding bloquant : sans liaison, tout est refusé côté serveur sauf liaison, compte, déconnexion', async () => {
  const u = await s.newUser({ admin: false });
  const html = { headers: { accept: 'text/html' } };
  let r = await u.get('/', html);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/link');
  assert.equal((await u.get('/settings', html)).headers.get('location'), '/link');

  const p = await project(u);
  const blocked = [
    ['get', '/api/system'], ['get', `/api/projects/${p}/status`], ['get', `/api/projects/${p}/prospects`],
    ['get', `/api/projects/${p}/prospects.csv`], ['get', `/api/projects/${p}/recap`], ['get', `/api/projects/${p}/history`],
    ['post', '/api/projects', { name: 'x', gitUrl: 'https://git.test/u/x.git' }],
    ['post', `/api/projects/${p}/send`, { count: 1, confirm: true }],
    ['post', `/api/projects/${p}/target`, {}], ['post', `/api/projects/${p}/delete`, {}],
    ['post', `/api/projects/${p}/prospects/import`, { csv: 'a' }], ['post', '/api/report/send', {}],
    ['post', '/api/notify/test', {}], ['post', '/settings', {}], ['post', '/api/jobs/1/cancel', {}],
    ...AI_ROUTES.map((t) => ['post', `/api/projects/${p}/${t}`, {}]),
  ];
  for (const [method, path, body] of blocked) {
    r = method === 'get' ? await u.get(path) : await u.post(path, body ?? {});
    assert.equal(r.status, 403, `${method} ${path}`);
    const j = await r.json();
    assert.equal(j.code, 'link_required');
    assert.equal(j.error, LINK_REQUIRED_MESSAGE);
  }
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM jobs WHERE user_id = ?').get(u.id)).n, 0);

  // Ce qui reste accessible
  for (const path of ['/link', '/account']) assert.equal((await u.get(path, html)).status, 200, path);
  assert.equal((await u.post('/logout', {})).status, 303);
  assert.equal((await s.client(u.cookie).get('/link', html)).status, 303, 'la session est détruite par la déconnexion');
});

test('onboarding : une fois relié, l\'application est accessible', async () => {
  const u = await s.newUser({ admin: false });
  const html = { headers: { accept: 'text/html' } };
  assert.equal((await u.get('/', html)).status, 303);
  await u.post('/link/api-key', { apiKey: KEY_A });
  assert.equal((await u.get('/', html)).status, 200);
  assert.equal((await u.get('/api/system')).status, 200);
});

test('garde « compte relié » à chaque couche : route, enqueue, worker, wrapper', async () => {
  const linked = await s.newUser({ admin: false });
  await linked.post('/link/api-key', { apiKey: KEY_A });
  const bare = await s.newUser({ admin: false });
  const pBare = await project(bare);
  const pLinked = await project(linked);
  // enqueue
  for (const type of AI_JOBS) {
    await assert.rejects(enqueue(s.db, { userId: bare.id, projectId: pBare, type }), { status: 403, message: LINK_REQUIRED_MESSAGE }, type);
  }
  assert.equal((await enqueue(s.db, { userId: bare.id, projectId: pBare, type: 'send', params: { count: 1 } })).existing, false, 'un envoi n\'utilise pas Claude');
  await s.db.prepare("UPDATE jobs SET status = 'cancelled' WHERE user_id = ?").run(bare.id);
  assert.equal((await enqueue(s.db, { userId: linked.id, projectId: pLinked, type: 'analyze' })).existing, false);
  await s.db.prepare("UPDATE jobs SET status = 'cancelled' WHERE user_id = ?").run(linked.id);

  // worker : un job IA déjà en base d'un compte non relié ne s'exécute pas
  const ran = [];
  const w = new Worker(s.db, Object.fromEntries([...AI_JOBS, 'send'].map((t) => [t, async () => { ran.push(t); return {}; }])), { log: { error() {} } });
  for (const type of [...AI_JOBS, 'send']) await s.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, created_at) VALUES(?, ?, ?, 'queued', ?)").run(bare.id, pBare, type, now());
  while (await w.tick()) { /* vide la file */ }
  assert.deepEqual(ran, ['send']);
  assert.equal(await jobRefusal(s.db, { user_id: bare.id, type: 'analyze' }), LINK_REQUIRED_MESSAGE);
  assert.equal(await jobRefusal(s.db, { user_id: bare.id, type: 'send' }), null);

  // wrapper d'exécution : dernier garde-fou, avant tout lancement de processus
  const claude = makeClaude({ ...s.app, cfg: { ...s.app.cfg, claudeBin: '/inexistant/claude' } });
  await assert.rejects(claude(bare.id, { prompt: 'x' }), { status: 403, message: LINK_REQUIRED_MESSAGE });
  await assert.rejects(claude(999999, { prompt: 'x' }), { status: 403, message: 'Compte supprimé' });
});

test('liaison invalide ou compte suspendu : aucun job IA', async () => {
  const u = await s.newUser({ admin: false });
  await u.post('/link/api-key', { apiKey: KEY_A });
  assert.equal(await aiRefusal(s.db, u.id), null);
  await s.db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(u.id);
  assert.equal(await aiRefusal(s.db, u.id), 'Compte suspendu');
});

test('Mon compte : Tester — succès, refus (liaison invalidée, onboarding de retour), réseau (liaison inchangée)', async () => {
  const u = await s.newUser({ admin: false });
  await u.post('/link/api-key', { apiKey: KEY_A });
  apiStatus = 200;
  let j = await (await u.post('/link/test', {})).json();
  assert.deepEqual({ ok: j.ok }, { ok: true });
  const t1 = (await getLinkState(s.db, u.id)).lastTestAt;
  assert.ok(t1);

  apiThrows = true;
  j = await (await u.post('/link/test', {})).json();
  apiThrows = false;
  assert.equal(j.ok, false);
  assert.match(j.message, /réseau/);
  assert.equal((await getLinkState(s.db, u.id)).valid, true, 'une panne réseau n\'invalide pas la liaison');

  apiStatus = 401;
  j = await (await u.post('/link/test', {})).json();
  apiStatus = 200;
  assert.equal(j.ok, false);
  const state = await getLinkState(s.db, u.id);
  assert.equal(state.valid, false);
  assert.equal((await u.get('/', { headers: { accept: 'text/html' } })).headers.get('location'), '/link', 'liaison invalide : retour à l\'onboarding');
  const account = await (await u.get('/account', { headers: { accept: 'text/html' } })).text();
  assert.match(account, /À revalider/);
  // Re-relier avec une clé valide rétablit l'accès
  assert.equal((await u.post('/link/api-key', { apiKey: KEY_B })).status, 200);
  assert.equal((await getLinkState(s.db, u.id)).last4, 'QQ34');
  assert.equal(await aiRefusal(s.db, u.id), null);
});

test('Mon compte : état de la liaison, boutons Tester, Changer de mode, Délier', async () => {
  const u = await s.newUser({ admin: false });
  await u.post('/link/api-key', { apiKey: KEY_A });
  const page = await (await u.get('/account', { headers: { accept: 'text/html' } })).text();
  assert.match(page, /Clé API Anthropic/);
  assert.match(page, /Valide/);
  assert.match(page, /action="\/link\/test"/);
  assert.match(page, /href="\/link\?change=1"/);
  assert.match(page, /action="\/link\/unlink"/);
  // changer de mode : la page de liaison reste accessible et le nouvel accès remplace l'ancien
  s.app.validateToken = async () => {};
  try { assert.equal((await u.post('/link/subscription', { token: TOKEN, accept: true })).status, 200); } finally { delete s.app.validateToken; }
  const link = JSON.parse((await row(u.id)).claude_link_json);
  assert.equal(link.mode, 'subscription_token');
  assert.equal(link.last4, undefined, 'plus de trace de la clé API');
  assert.ok(!(await dump()).includes(KEY_A));
});

test('délier : secret effacé, jobs IA en file annulés, autres jobs et autres comptes intacts, onboarding de retour', async () => {
  const a = await s.newUser({ admin: false });
  const b = await s.newUser({ admin: false });
  await a.post('/link/api-key', { apiKey: KEY_A });
  await b.post('/link/api-key', { apiKey: KEY_B });
  const pa = await project(a), pb = await project(b);
  await enqueue(s.db, { userId: a.id, projectId: pa, type: 'analyze' });
  await enqueue(s.db, { userId: a.id, projectId: pa, type: 'prospect' });
  await enqueue(s.db, { userId: a.id, projectId: pa, type: 'send', params: { count: 1 } });
  await enqueue(s.db, { userId: b.id, projectId: pb, type: 'analyze' });
  await setSetting(s.db, a.id, 'claude_rate_limit_json', JSON.stringify({ fiveHour: { utilization: 0.9 } }));

  const r = await a.post('/link/unlink', {});
  assert.equal(r.status, 200);
  assert.equal((await r.json()).cancelled, 2);
  assert.equal((await row(a.id)).claude_link_json, null);
  assert.ok(!(await dump()).includes(KEY_A), 'le secret chiffré est supprimé');
  const status = async (u, type) => (await s.db.prepare('SELECT status FROM jobs WHERE user_id = ? AND type = ?').get(u.id, type)).status;
  assert.equal(await status(a, 'analyze'), 'cancelled');
  assert.equal(await status(a, 'prospect'), 'cancelled');
  assert.equal(await status(a, 'send'), 'queued', 'un envoi n\'utilise pas Claude');
  assert.equal(await status(b, 'analyze'), 'queued', 'les jobs d\'un autre compte ne bougent pas');
  assert.equal((await getLinkState(s.db, b.id)).mode, 'api_key');
  assert.equal(await getSetting(s.db, a.id, 'claude_rate_limit_json'), null, 'le quota de l\'ancien accès ne subsiste pas');
  assert.equal((await a.get('/', { headers: { accept: 'text/html' } })).headers.get('location'), '/link');
  assert.equal(await aiRefusal(s.db, a.id), LINK_REQUIRED_MESSAGE);
  // Mon compte reste accessible et propose de relier
  assert.match(await (await a.get('/account', { headers: { accept: 'text/html' } })).text(), /Relier Claude/);
});

test('délier un job IA en cours : il est interrompu', async () => {
  const u = await s.newUser({ admin: false });
  await u.post('/link/api-key', { apiKey: KEY_A });
  const p = await project(u);
  let aborted = false;
  await s.db.prepare("UPDATE jobs SET status = 'cancelled' WHERE status = 'queued'").run(); // jobs des tests précédents
  const w = new Worker(s.db, {
    analyze: (ctx) => new Promise((resolve) => { ctx.signal.addEventListener('abort', () => { aborted = true; resolve({}); }); }),
  }, { log: { error() {} }, isAiJob: (t) => AI_JOBS.has(t) });
  s.app.worker = w;
  try {
    await enqueue(s.db, { userId: u.id, projectId: p, type: 'analyze' });
    const tick = w.tick();
    for (let i = 0; i < 50 && !w.running.size; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal((await u.post('/link/unlink', {})).status, 200);
    await tick;
    assert.equal(aborted, true);
    assert.equal((await s.db.prepare('SELECT status FROM jobs WHERE user_id = ?').get(u.id)).status, 'cancelled');
  } finally { delete s.app.worker; await w.stop(); }
});

test('suppression du compte : liaison et trace de consentement effacées', async () => {
  const u = await s.newUser({ admin: false });
  s.app.validateToken = async () => {};
  try { await u.post('/link/subscription', { token: TOKEN, accept: true }); } finally { delete s.app.validateToken; }
  assert.ok(await getSetting(s.db, u.id, 'claude_cli_consent_json'));
  const r = await u.post('/account/delete', { confirm: u.email });
  assert.equal(r.status, 303);
  assert.equal(await row(u.id), undefined);
  assert.equal(await getSetting(s.db, u.id, 'claude_cli_consent_json'), null);
});

test('rien d\'un secret dans les journaux du serveur sur toute la durée de ces tests', () => {
  for (const secret of [KEY_A, KEY_B, TOKEN]) assert.ok(!logs.some((l) => l.includes(secret)), secret.slice(0, 12));
});

test('la température du serveur n\'est pas exposée aux comptes non admin', async () => {
  const u = await s.newUser({ admin: false });
  await u.post('/link/api-key', { apiKey: KEY_A });
  assert.equal((await (await u.get('/api/system')).json()).temp, null);
});

test('serveur complet (worker démarré par createApp) : job d\'un compte relié traité, job d\'un compte non relié refusé', async () => {
  const full = await startApp({ worker: true, cfg: { claudeBin: makeClaudeBin(binDir, { name: 'claude-full' }) } });
  try {
    const mk = async (owner, url) => Number((await full.db.prepare('INSERT INTO projects(user_id, name, git_url, profile_json, target_json, created_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(owner.id, 'P', url, JSON.stringify({ resume: 'x', proposition_valeur: 'y' }), JSON.stringify({ description: 'd', secteurs: ['s'] }), now())).lastInsertRowid);
    const linked = await full.newUser({ admin: true });
    const bare = await full.newUser({ admin: false });
    const pl = await mk(linked, 'https://git.test/a.git');
    const pb = await mk(bare, 'https://git.test/u.git');
    const jl = (await enqueue(full.db, { userId: linked.id, projectId: pl, type: 'template' })).id;
    const jb = Number((await full.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, created_at) VALUES(?, ?, 'template', 'queued', ?)").run(bare.id, pb, now())).lastInsertRowid);
    const status = async (id) => full.db.prepare('SELECT status, error FROM jobs WHERE id = ?').get(id);
    for (let i = 0; i < 100 && (['queued', 'running'].includes((await status(jl)).status) || ['queued', 'running'].includes((await status(jb)).status)); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal((await status(jl)).status, 'done', (await status(jl)).error);
    assert.deepEqual({ ...(await status(jb)) }, { status: 'error', error: LINK_REQUIRED_MESSAGE });
    assert.equal((await full.db.prepare('SELECT COUNT(*) n FROM templates WHERE project_id = ?').get(pb)).n, 0);
  } finally { await full.close(); }
});

// ---------- Connexion guidée (le serveur lance `claude setup-token`) ----------

const hasScript = spawnSync('script', ['--version']).status === 0;
const loginApp = async (mode = '') => {
  const dir = mkdtempSync(join(tmpdir(), 'aitools-login-bin-'));
  const o = await startApp({ cfg: { claudeBin: makeClaudeBin(dir, { fixture: 'fake-setup-token.js', env: mode ? { FAKE_MODE: mode } : {} }) } });
  o.app.validateToken = async (t) => { o.validated = [...(o.validated || []), t]; if (o.rejectToken) throw new HttpError(400, 'Jeton refusé par Claude (test)'); };
  return { o, dir };
};
const lt = { skip: !hasScript && 'la commande script (util-linux) est absente' };

test('connexion guidée : sans la case cochée, aucun CLI n\'est lancé', lt, async () => {
  const { o, dir } = await loginApp();
  try {
    const u = await o.newUser({ admin: false, link: null });
    const r = await u.post('/link/claude/login', {});
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /cocher/);
    assert.equal(o.app.claudeLogins?.sessions.size ?? 0, 0);
    const page = await (await u.get('/link?start=claude', { headers: { accept: 'text/html' } })).text();
    assert.match(page, /<dialog[^>]*data-autoopen/);
    assert.match(page, /data-claude-login/);
  } finally { await o.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('connexion guidée : lien renvoyé, puis le code donne le jeton, rangé chiffré avec le consentement', lt, async () => {
  const { o, dir } = await loginApp();
  try {
    const u = await o.newUser({ admin: false, link: null });
    const start = await u.post('/link/claude/login', { accept: true });
    assert.equal(start.status, 200);
    const { id, url } = await start.json();
    assert.match(url, /^https:\/\/claude\.com\/cai\/oauth\/authorize\?code=true&state=abc$/);
    assert.equal(await getLinkState(o.db, u.id), null, 'rien n\'est relié avant le code');

    const bad = await u.post('/link/claude/login/code', { id: 'inconnu', code: 'GOOD-code-1234' });
    assert.equal(bad.status, 404);
    const short = await u.post('/link/claude/login/code', { id, code: 'x' });
    assert.equal(short.status, 400);
    const other = await o.newUser({ admin: false, link: null });
    assert.equal((await other.post('/link/claude/login/code', { id, code: 'GOOD-code-1234' })).status, 404, 'la connexion d\'un autre compte reste inaccessible');

    const done = await u.post('/link/claude/login/code', { id, code: 'GOOD-code-1234#state' });
    assert.equal(done.status, 200);
    const link = JSON.parse((await orow(o, u.id)).claude_link_json);
    assert.equal(link.mode, 'subscription_token');
    assert.equal(link.via, 'login');
    assert.equal(decrypt(o.app.cfg.secretKey, link.secret_enc), `sk-ant-oat01-${'L'.repeat(60)}`);
    assert.equal(link.consent.version, CONSENT_VERSION);
    assert.ok(!JSON.stringify(await getLinkState(o.db, u.id)).includes('sk-ant-oat'), 'le jeton ne sort jamais');
    assert.equal(o.app.claudeLogins.sessions.size, 0, 'session et dossier jetable nettoyés');
    assert.deepEqual(o.validated, [`sk-ant-oat01-${'L'.repeat(60)}`], 'le jeton est vérifié avant d\'être rangé');
  } finally { await o.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('connexion guidée : mauvais code, annulation, pas de lien, lien hors Anthropic', lt, async () => {
  const { o, dir } = await loginApp();
  const none = await loginApp('NOLINK');
  const evil = await loginApp('EVIL');
  try {
    const u = await o.newUser({ admin: false, link: null });
    let { id } = await (await u.post('/link/claude/login', { accept: true })).json();
    const refused = await u.post('/link/claude/login/code', { id, code: 'WRONG-code-1234' });
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /pas validé ce code \(status code 400\)/);
    assert.equal((await orow(o, u.id)).claude_link_json, null);

    // Annuler tue le CLI ; relancer remplace la connexion précédente de ce compte
    ({ id } = await (await u.post('/link/claude/login', { accept: true })).json());
    await u.post('/link/claude/login/cancel', { id });
    assert.equal(o.app.claudeLogins.sessions.size, 0);
    await u.post('/link/claude/login', { accept: true });
    await u.post('/link/claude/login', { accept: true });
    assert.equal(o.app.claudeLogins.sessions.size, 1, 'une seule connexion par utilisateur');

    const n = await none.o.newUser({ admin: false, link: null });
    const r1 = await n.post('/link/claude/login', { accept: true });
    assert.equal(r1.status, 502);
    assert.match((await r1.json()).error, /pas donné de lien/);
    const e = await evil.o.newUser({ admin: false, link: null });
    assert.equal((await e.post('/link/claude/login', { accept: true })).status, 502, 'un lien hors Anthropic n\'est jamais montré');
  } finally {
    for (const x of [{ o, dir }, none, evil]) { await x.o.close(); rmSync(x.dir, { recursive: true, force: true }); }
  }
});

test('connexion guidée : mode abonnement désactivé = refus, sans CLI', lt, async () => {
  const off = await startApp({ cfg: { cliModeEnabled: false } });
  try {
    const u = await off.newUser({ admin: false, link: null });
    assert.equal((await u.post('/link/claude/login', { accept: true })).status, 403);
  } finally { await off.close(); }
});

test('extraction du jeton : lu sur l\'écran rendu (cases sautées, retours à la ligne), jamais incomplet, jamais le texte voisin', async () => {
  const { extractToken, isRefused } = await import('../src/claudelogin.js');
  const { screenText } = await import('../src/termscreen.js');
  const tok = `sk-ant-oat01-${'a1B2-_'.repeat(15)}`;
  const e = String.fromCharCode(27);
  assert.equal(extractToken(`token: ${tok}\r\n\r\nStore this token securely.`), tok);
  // Écran mis à jour par morceaux : un caractère faux est corrigé après coup, le flux brut seul serait faux
  const wrong = `${tok.slice(0, 20)}X${tok.slice(21)}`;
  assert.equal(extractToken(`Your token: ${wrong}\r${e}[${'Your token: '.length + 20}C${tok[20]}\r\n\r\nStore${e}[7Gthis token`), tok, 'lu sur l\'écran final');
  // Case déjà affichée, sautée par le curseur : « Requ[curseur]st » reste « Request »
  assert.equal(screenText(`Request\rRequ${e}[1Cst`)[0], 'Request');
  assert.equal(extractToken(`t: sk-ant-\r\n${tok.slice(7, 40)}\r\n${tok.slice(40)}\r\n\r\nStore this`), tok, 'jeton sur plusieurs lignes d\'écran');
  assert.equal(extractToken(`token: ${tok.slice(0, 30)}`), null, 'jeton encore en cours d\'affichage : on attend');
  assert.equal(extractToken(`token: ${tok}`), null, 'sans phrase de fin on attend aussi…');
  assert.equal(extractToken(`token: ${tok}`, true), tok, '…sauf si le CLI est terminé');
  assert.equal(extractToken('rien ici'), null);
  assert.equal(extractToken('sk-ant-oat01-court Store'), null, 'trop court pour être un jeton');
  // Fin de redessin du vrai CLI : « ESC ( B » (jeu de caractères) arrive curseur au bout de la dernière ligne écrite.
  // Il ne doit rien afficher, sinon un « B » s'ajoute au jeton et le rend invalide.
  assert.equal(extractToken(`t:\r\n${tok}${e}(B\x0f\r\n\r\nStore this`), tok, 'pas de B parasite après le jeton');
  assert.equal(screenText(`abc${e}(Bdef${e})0${e}*Bxyz`)[0], 'abcdefxyz');
  // Le refus se lit lui aussi sur l'écran
  assert.equal(isRefused(`OAuth error: Request failed with status code 400\r\nPress Enter to retry.`), true);
  assert.equal(isRefused('Paste code here if prompted >'), false);
});

test('connexion guidée : un jeton refusé à la vérification n\'est jamais rangé', lt, async () => {
  const { o, dir } = await loginApp();
  try {
    o.rejectToken = true;
    const u = await o.newUser({ admin: false, link: null });
    const { id } = await (await u.post('/link/claude/login', { accept: true })).json();
    const r = await u.post('/link/claude/login/code', { id, code: 'GOOD-code-1234' });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /Jeton refusé/);
    assert.equal((await orow(o, u.id)).claude_link_json, null);
  } finally { await o.close(); rmSync(dir, { recursive: true, force: true }); }
});
