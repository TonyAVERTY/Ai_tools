import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encrypt } from '../src/crypto.js';
import { makeClaude } from '../src/handlers.js';
import { linkApiKey, getLinkState, userProvider, aiRefusal } from '../src/claudelink.js';
import { runCodex, buildArgs, toolConfig, isAuthRefusal, validateApiKey, openaiProvider } from '../src/services/providers/openai.js';
import { estimateCost, priceOf } from '../src/services/pricing.js';
import { CATALOGS } from '../src/services/models.js';
import { SECRET_ENV_NAMES } from '../src/services/sandbox.js';
import { HttpError } from '../src/http.js';
import { startApp } from './helpers/server.js';
import { makeClaudeBin } from './helpers/claude-bin.js';

// ChatGPT (clé API OpenAI) par Codex CLI : traduction du flux, garde-fous (shell, réseau, AGENTS.md), coût estimé, liaison, jamais de fuite du secret.
// Aucun vrai CLI ni appel réseau : le CLI est simulé (test/fixtures/fake-codex.js), fetch est injecté.
let s, tmp, dump;
const KEY = `sk-proj-${'A'.repeat(40)}`;
const SANDBOX_OFF = { enabled: false, production: false };
const dumps = () => (existsSync(dump) ? readFileSync(dump, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'aitools-codex-'));
  dump = join(tmp, 'dump.jsonl');
  s = await startApp({ cfg: { codexBin: makeClaudeBin(tmp, { fixture: 'fake-codex.js', name: 'codex-test', env: { FAKE_DUMP: dump } }) } });
});
after(async () => { await s.close(); rmSync(tmp, { recursive: true, force: true }); });

const run = (o) => runCodex({ bin: s.app.cfg.codexBin, sandbox: SANDBOX_OFF, secretEnv: { CODEX_API_KEY: KEY }, model: 'gpt-6-luna', tools: [], ...o });
const link = (key = KEY) => ({ v: 1, provider: 'openai', mode: 'api_key', valid: true, last4: key.slice(-4), secret_enc: encrypt(s.app.cfg.secretKey, key) });

test('le flux est traduit : réponse finale = dernier message, jetons, coût estimé, pas de quota', async () => {
  const r = await run({ prompt: 'Dis bonjour' });
  assert.equal(r.ok, true);
  assert.equal(r.subtype, 'success');
  assert.equal(r.text, 'Bonjour, voici la réponse.', 'le message intermédiaire « Je regarde. » n\'est pas la réponse');
  assert.deepEqual([r.tokensIn, r.tokensOut], [1000, 200]);
  assert.equal(r.costUsd, 0.0002, '1000 × 0,10 $ + 200 × 0,50 $ par million');
  assert.equal(r.rateLimit, null);
});

test('le texte est transmis une fois, d\'un bloc (Codex n\'écrit pas au fil de l\'eau)', async () => {
  const deltas = [], texts = [];
  await run({ prompt: 'x', onDelta: (t) => deltas.push(t), onText: (t) => texts.push(t) });
  assert.deepEqual(deltas, ['Bonjour, voici la réponse.']);
  assert.deepEqual(texts, ['Bonjour, voici la réponse.']);
});

test('les actions sont journalisées comme avec Claude : commande = recherche dans le code, recherche web = WebSearch', async () => {
  const tools = [], activity = [];
  let turns = 0;
  await run({ prompt: 'ACTIONS', tools: ['Read'], maxTurns: 10, onTool: (n, i) => tools.push([n, i]), onTurn: (n) => { turns = n; }, onActivity: (t) => activity.push(t) });
  assert.deepEqual(tools.map((t) => t[0]), ['Grep', 'WebSearch', 'Grep']);
  assert.equal(tools[1][1].query, 'boulangeries rennes');
  assert.equal(turns, 3);
  assert.equal(activity.length, 1);
});

test('limite d\'actions : Codex est arrêté au-delà de maxTurns, même sous-type que Claude', async () => {
  const r = await run({ prompt: 'TOOMANY', tools: ['Read'], maxTurns: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.subtype, 'error_max_turns');
  assert.ok(r.turns >= 6 && r.turns < 50, `arrêté en route (${r.turns} actions)`);
});

test('garde-fous du CLI : lecture seule, aucun réglage utilisateur ni AGENTS.md du dépôt, rien ne sort, secret hors du shell', async () => {
  const a = buildArgs({ prompt: 'La demande', system: 'Tu es un assistant.', model: 'gpt-6.1-sol', tools: ['Read', 'Glob', 'Grep'] });
  assert.equal(a[0], 'exec');
  for (const f of ['--json', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules']) assert.ok(a.includes(f), f);
  assert.equal(a[a.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(a[a.indexOf('--model') + 1], 'gpt-6.1-sol');
  for (const bad of ['--yolo', '--dangerously-bypass-approvals-and-sandbox', 'danger-full-access', 'workspace-write']) assert.ok(!a.includes(bad), `${bad} ne doit jamais être passé`);
  const cfg = a.filter((x, i) => a[i - 1] === '-c');
  assert.ok(cfg.includes('project_doc_max_bytes=0'), 'AGENTS.md du dépôt jamais lu');
  assert.ok(cfg.includes('shell_environment_policy.ignore_default_excludes=false'));
  assert.ok(cfg.includes('shell_environment_policy.inherit="core"'));
  assert.ok(cfg.includes('analytics.enabled=false') && cfg.includes('history.persistence="none"'));
  assert.equal(a.at(-1), 'Tu es un assistant.\n\n---\n\nLa demande', 'consignes système devant la demande');
});

test('outils : le shell n\'existe que pour lire le dépôt ; texte seul et web n\'en ont pas', () => {
  assert.deepEqual(toolConfig(['Read', 'Glob', 'Grep']), { shell: true, web: 'disabled' });
  assert.deepEqual(toolConfig([]), { shell: false, web: 'disabled' }, 'rédaction et conversation : aucun shell');
  assert.deepEqual(toolConfig(['WebSearch', 'WebFetch']), { shell: false, web: 'live' });
  assert.deepEqual(toolConfig(['Bash', 'Edit', 'Write']), { shell: false, web: 'disabled' }, 'un outil d\'écriture ou de shell demandé ne l\'active pas');
  const flag = (tools) => buildArgs({ prompt: 'x', tools }).find((x) => x.startsWith('features.shell_tool='));
  assert.equal(flag([]), 'features.shell_tool=false');
  assert.equal(flag(['Grep']), 'features.shell_tool=true');
  assert.equal(buildArgs({ prompt: 'x', tools: ['WebSearch'] }).find((x) => x.startsWith('web_search=')), 'web_search="live"');
});

test('le secret : variable CODEX_API_KEY seulement, jamais dans argv, aucune clé d\'un autre fournisseur', async () => {
  const before = dumps().length;
  await run({ prompt: 'x' });
  const d = dumps().slice(before)[0];
  assert.equal(d.key, KEY);
  assert.deepEqual([d.openai, d.anthropic, d.gemini], [null, null, null]);
  assert.ok(!d.argv.join(' ').includes(KEY), 'le secret n\'est jamais dans argv');
  assert.ok(SECRET_ENV_NAMES.has('CODEX_API_KEY'));
});

test('clé refusée : échec franc, reconnu comme refus d\'accès ; quota ou réseau, non', async () => {
  const r = await run({ prompt: 'BADKEY' });
  assert.equal(r.ok, false);
  assert.match(r.text, /invalid_api_key/);
  assert.ok(isAuthRefusal(r.text));
  assert.equal(isAuthRefusal('You exceeded your current quota (insufficient_quota)'), false, 'un quota épuisé n\'invalide pas la liaison');
  assert.equal(isAuthRefusal('connect ETIMEDOUT'), false);
});

test('plantage sans résultat : erreur, et le secret est masqué partout', async () => {
  await assert.rejects(run({ prompt: 'CRASH' }), /sans résultat \(code 3\)/);
  let msg = '';
  await assert.rejects(run({ prompt: 'LEAK' }), (e) => { msg = e.message; return true; });
  assert.ok(!msg.includes(KEY));
  assert.match(msg, /\*\*\*/);
});

test('coûts : la grille OpenAI, et chaque modèle du catalogue a un tarif', () => {
  assert.equal(estimateCost('gpt-6.1-sol', { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 12);
  assert.equal(estimateCost('gpt-6-astra', { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 60);
  assert.equal(estimateCost('gpt-6.1-terra', { inputTokens: 1_000_000, cachedTokens: 1_000_000 }), 0.05, 'le cache coûte moins');
  for (const m of [...CATALOGS.openai.recommended, ...CATALOGS.openai.others]) assert.ok(priceOf(m.id), `${m.id} sans tarif`);
});

// ---------- Liaison ----------

test('liaison par clé API OpenAI : validée sans coût (liste des modèles), chiffrée, jamais réaffichée', async () => {
  const u = await s.newUser({ admin: false });
  const calls = [];
  s.app.fetch = async (url, opts) => { calls.push({ url, headers: opts.headers }); return { status: 200, ok: true }; };
  await linkApiKey(s.app, u.id, KEY, 'openai');
  s.app.fetch = undefined;
  assert.deepEqual([calls.length, calls[0].url, calls[0].headers.Authorization], [1, 'https://api.openai.com/v1/models', `Bearer ${KEY}`]);
  const raw = (await s.db.prepare('SELECT claude_link_json FROM users WHERE id = ?').get(u.id)).claude_link_json;
  assert.ok(!raw.includes(KEY), 'pas en clair en base');
  const pub = await getLinkState(s.db, u.id);
  assert.deepEqual([pub.provider, pub.providerLabel, pub.label, pub.last4], ['openai', 'ChatGPT', 'Clé API OpenAI', KEY.slice(-4)]);
  assert.ok(!JSON.stringify(pub).includes(KEY));
  assert.equal(await userProvider(s.db, u.id), 'openai');
  assert.equal(await aiRefusal(s.db, u.id), null);
});

test('clé OpenAI refusée (401, 403) ou mal formée : rien n\'est enregistré ; réseau coupé : message distinct', async () => {
  const u = await s.newUser({ admin: false });
  for (const n of [401, 403]) {
    s.app.fetch = async () => ({ status: n, ok: false });
    await assert.rejects(linkApiKey(s.app, u.id, KEY, 'openai'), (e) => e instanceof HttpError && e.status === 400 && /refusée par OpenAI/.test(e.message), `HTTP ${n}`);
  }
  s.app.fetch = async () => ({ status: 500, ok: false });
  await assert.rejects(linkApiKey(s.app, u.id, KEY, 'openai'), (e) => e.status === 502 && /OpenAI ne répond pas/.test(e.message));
  s.app.fetch = async () => { throw new Error('ECONNRESET'); };
  await assert.rejects(linkApiKey(s.app, u.id, KEY, 'openai'), (e) => e.status === 502 && /réseau/.test(e.message));
  s.app.fetch = undefined;
  await assert.rejects(linkApiKey(s.app, u.id, 'pas une clé', 'openai'), /Clé API invalide/);
  await assert.rejects(linkApiKey(s.app, u.id, `sk-ant-api03-${'A'.repeat(40)}`, 'openai').catch((e) => { throw e; }), (e) => e.status === 400 || e.status === 502, 'une clé Anthropic n\'est pas acceptée comme clé OpenAI sans vérification');
  assert.equal(await getLinkState(s.db, u.id), null);
});

test('validateApiKey d\'OpenAI seul', async () => {
  await validateApiKey(KEY, async () => ({ status: 200, ok: true }));
  await assert.rejects(validateApiKey(KEY, async () => ({ status: 401, ok: false })), /refusée par OpenAI/);
});

// ---------- Dans le pipeline des jobs ----------

test('un job d\'un utilisateur ChatGPT passe par Codex avec SA clé, et le coût est estimé', async () => {
  const u = await s.newUser({ admin: false, link: link() });
  const before = dumps().length;
  const r = await makeClaude(s.app)(u.id, { prompt: 'Analyse en JSON', model: 'gpt-6-luna', maxTurns: 1, tools: [] });
  assert.equal(r.ok, true);
  assert.match(r.text, /Cartes de fidélité/);
  assert.equal(r.costUsd, 0.0002);
  const d = dumps().slice(before)[0];
  assert.equal(d.key, KEY);
  assert.deepEqual([d.anthropic, d.gemini], [null, null]);
});

test('un refus d\'accès d\'OpenAI invalide la liaison, sans toucher aux autres utilisateurs', async () => {
  const bad = `sk-proj-REVOKED${'X'.repeat(30)}`;
  const u = await s.newUser({ admin: false, link: link(bad) });
  const other = await s.newUser({ admin: false, link: link() });
  const realWarn = console.warn; console.warn = () => {};
  try {
    const r = await makeClaude(s.app)(u.id, { prompt: 'x', model: 'gpt-6-luna', maxTurns: 1, tools: [] });
    assert.equal(r.ok, false);
  } finally { console.warn = realWarn; }
  assert.equal((await getLinkState(s.db, u.id)).valid, false);
  assert.equal((await getLinkState(s.db, other.id)).valid, true);
});

test('le fournisseur expose la forme commune', () => {
  for (const k of ['id', 'label', 'company', 'modes', 'apiKey', 'bin', 'run', 'rateLimitWindows', 'isAuthRefusal']) assert.ok(openaiProvider[k] !== undefined, k);
  assert.equal(openaiProvider.bin({ codexBin: '/x/codex' }), '/x/codex');
});
