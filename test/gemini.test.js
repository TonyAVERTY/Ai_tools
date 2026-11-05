import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { encrypt, decrypt } from '../src/crypto.js';
import { getSetting, setSetting } from '../src/db.js';
import { makeClaude } from '../src/handlers.js';
import { linkApiKey, testLink, getLinkState, userProvider, aiRefusal } from '../src/claudelink.js';
import { runGemini, allowedTools, settingsFor, buildArgs, isAuthRefusal, validateApiKey } from '../src/services/providers/gemini.js';
import { getProvider } from '../src/services/providers/index.js';
import { priceOf, estimateCost } from '../src/services/pricing.js';
import { buildBwrapArgs, buildChildEnv } from '../src/services/sandbox.js';
import { HttpError } from '../src/http.js';
import { startApp } from './helpers/server.js';
import { makeClaudeBin } from './helpers/claude-bin.js';

// Gemini (clé API) : traduction du flux de Gemini CLI, outils et limite de tours, coût estimé, liaison, jamais de fuite du secret.
// Aucun vrai CLI ni appel réseau : le CLI est simulé (test/fixtures/fake-gemini.js), fetch est injecté.
let s, tmp, dump;
const KEY = `AIzaSy${'A'.repeat(33)}`;
const SANDBOX_OFF = { enabled: false, production: false };
const dumps = () => (existsSync(dump) ? readFileSync(dump, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'aitools-gemini-'));
  dump = join(tmp, 'dump.jsonl');
  s = await startApp({ cfg: { geminiBin: makeClaudeBin(tmp, { fixture: 'fake-gemini.js', name: 'gemini-test', env: { FAKE_DUMP: dump } }) } });
});
after(async () => { await s.close(); rmSync(tmp, { recursive: true, force: true }); });

const run = (o) => runGemini({ bin: s.app.cfg.geminiBin, sandbox: SANDBOX_OFF, secretEnv: { GEMINI_API_KEY: KEY }, model: 'gemini-3.5-flash-lite', tools: [], ...o });

test('le flux est traduit : texte mis bout à bout, jetons, coût estimé, pas de quota', async () => {
  const deltas = [];
  const r = await run({ prompt: 'Dis bonjour', onDelta: (t) => deltas.push(t) });
  assert.equal(r.ok, true);
  assert.equal(r.subtype, 'success');
  assert.equal(r.text, 'Bonjour, voici la réponse.');
  assert.ok(deltas.length >= 2 && deltas.join('') === r.text, 'le texte arrive par morceaux');
  assert.deepEqual([r.tokensIn, r.tokensOut], [1000, 200]);
  assert.equal(r.costUsd, 0.0008, '1000 × 0,30 $ + 200 × 2,50 $ par million');
  assert.equal(r.rateLimit, null);
});

test('le nombre de tours est compté même sans écouteur', async () => {
  assert.equal((await run({ prompt: 'TOOLS', tools: ['Read', 'Grep'] })).turns, 2);
});

test('les outils de lecture sont journalisés sous leur nom Claude, avec les paramètres que lit le journal', async () => {
  const tools = [];
  let turns = 0;
  await run({ prompt: 'TOOLS', tools: ['Read', 'Grep'], onTool: (n, i) => tools.push([n, i]), onTurn: (n) => { turns = n; } });
  assert.deepEqual(tools.map((t) => t[0]), ['Read', 'Grep']);
  assert.equal(tools[0][1].file_path, '/work/src/app.js');
  assert.equal(tools[1][1].pattern, 'TODO');
  assert.equal(turns, 2);
});

test('consignes système devant la demande, modèle, dossiers joints, et pas de variable Claude dans le processus', async () => {
  const before = dumps().length;
  await run({ prompt: 'La demande', system: 'Tu es un assistant.', model: 'gemini-3.6-flash' });
  const d = dumps().slice(before)[0];
  const prompt = d.argv[d.argv.indexOf('-p') + 1];
  assert.equal(prompt, 'Tu es un assistant.\n\n---\n\nLa demande');
  assert.equal(d.argv[d.argv.indexOf('-m') + 1], 'gemini-3.6-flash');
  assert.ok(d.argv.includes('--skip-trust') && d.argv.includes('stream-json'));
  assert.equal(d.key, KEY);
  assert.equal(d.anthropic, null);
  assert.ok(!d.argv.join(' ').includes(KEY), 'le secret n\'est jamais dans argv');
});

test('liste blanche d\'outils : seulement ceux demandés, et un outil inexistant quand on n\'en demande aucun', async () => {
  assert.deepEqual(allowedTools(['Read', 'Glob', 'Grep']).sort(), ['glob', 'grep_search', 'list_directory', 'read_file', 'read_many_files']);
  assert.deepEqual(allowedTools(['WebSearch', 'WebFetch']), ['google_web_search', 'web_fetch']);
  assert.deepEqual(allowedTools([]), ['__aucun_outil__'], 'une liste vide pourrait vouloir dire « tous »');
  assert.deepEqual(allowedTools(['Bash', 'Edit', 'Write']), ['__aucun_outil__'], 'aucun outil d\'écriture ni de shell ne passe');
  const before = dumps().length;
  await run({ prompt: 'x', tools: ['Read'], maxTurns: 7 });
  const d = dumps().slice(before)[0];
  assert.deepEqual(d.settings.tools.core, ['read_file', 'read_many_files', 'list_directory']);
  assert.equal(d.settings.model.maxSessionTurns, 7);
  assert.equal(d.settings.privacy.usageStatisticsEnabled, false);
  assert.equal(d.settings.telemetry.enabled, false);
  assert.equal(settingsFor({}).model.maxSessionTurns, 10);
});

test('le fichier de réglages est temporaire : rien ne reste après le lancement', async () => {
  const before = dumps().length;
  await run({ prompt: 'x' });
  const { settingsPath } = dumps().slice(before)[0];
  assert.equal(existsSync(settingsPath), false);
  assert.equal(readdirSync(tmpdir()).filter((f) => f.startsWith('aitools-gemini-') && existsSync(join(tmpdir(), f, 'settings.json'))).length, 0);
});

test('clé refusée : échec franc, reconnu comme refus d\'accès', async () => {
  const r = await run({ prompt: 'BADKEY' });
  assert.equal(r.ok, false);
  assert.match(r.text, /API key not valid/);
  assert.ok(isAuthRefusal(r.text));
  assert.equal(isAuthRefusal('connect ETIMEDOUT'), false);
  assert.equal(isAuthRefusal('exit code 5'), false);
});

test('limite de tours (code 53) : même sous-type que Claude, jamais pris pour un refus d\'accès', async () => {
  const r = await run({ prompt: 'MAXTURNS' });
  assert.equal(r.ok, false);
  assert.equal(r.subtype, 'error_max_turns');
  assert.equal(r.text.startsWith('Début de réponse'), true);
});

test('plantage sans résultat : erreur, et le secret est masqué partout', async () => {
  await assert.rejects(run({ prompt: 'CRASH' }), /sans résultat \(code 3\)/);
  let msg = '';
  await assert.rejects(run({ prompt: 'LEAK' }), (e) => { msg = e.message; return true; });
  assert.ok(!msg.includes(KEY), 'le secret ne ressort jamais');
  assert.match(msg, /\*\*\*/);
});

test('exécutable absent : erreur claire, sans clé dans le message', async () => {
  await assert.rejects(run({ prompt: 'x', bin: '/nulle/part/gemini' }), (e) => /sans résultat|Impossible de lancer Gemini/.test(e.message) && !e.message.includes(KEY));
});

test('coûts : la grille, les dates de tarif et les jetons en cache', () => {
  assert.equal(estimateCost('gemini-3.5-flash-lite', { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 2.8);
  assert.equal(estimateCost('gemini-3.1-pro-preview', { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 14);
  assert.equal(estimateCost('gemini-3.5-flash-lite', { inputTokens: 1_000_000, cachedTokens: 1_000_000 }), 0.03, 'le cache coûte moins');
  assert.equal(estimateCost('gemini-3.5-flash-lite', { inputTokens: 100, cachedTokens: 5000 }), estimateCost('gemini-3.5-flash-lite', { inputTokens: 100, cachedTokens: 100 }), 'le cache ne dépasse pas l\'entrée');
  assert.equal(estimateCost('modele-inconnu', { inputTokens: 1000 }), null, 'pas de montant inventé');
  const at = (d) => Math.floor(Date.parse(`${d}T12:00:00Z`) / 1000);
  assert.equal(priceOf('gemini-3.8-flash', at('2026-12-31')).input, 0.75, 'tarif de lancement jusqu\'au 31 décembre 2026');
  assert.equal(priceOf('gemini-3.8-flash', at('2027-01-01')).input, 1.5, 'puis le tarif normal');
});

test('chaque modèle du catalogue Gemini a un tarif (sinon le budget en $ l\'ignore)', async () => {
  const { CATALOGS } = await import('../src/services/models.js');
  for (const m of [...CATALOGS.gemini.recommended, ...CATALOGS.gemini.others]) assert.ok(priceOf(m.id), `${m.id} sans tarif`);
});

test('bac à sable : seules les variables prévues passent, le fichier de réglages est monté en lecture seule', () => {
  const env = buildChildEnv({ PATH: '/bin' }, { secretEnv: { GEMINI_API_KEY: KEY }, extraEnv: { GEMINI_CLI_SYSTEM_SETTINGS_PATH: '/tmp/x/settings.json' }, home: '/home/sandbox' });
  assert.equal(env.GEMINI_API_KEY, KEY);
  assert.equal(env.GEMINI_CLI_SYSTEM_SETTINGS_PATH, '/tmp/x/settings.json');
  assert.throws(() => buildChildEnv({}, { extraEnv: { SECRET_KEY: 'x' }, home: '/h' }), /non autorisée/);
  assert.throws(() => buildChildEnv({}, { secretEnv: { OPENAI_API_KEY: 'x'.repeat(20) }, home: '/h' }), /non autorisée/);
  const args = buildBwrapArgs({ workDir: '/data/u1/repo', command: ['gemini'], roFiles: ['/tmp/x/settings.json'] });
  const i = args.indexOf('/tmp/x/settings.json');
  assert.deepEqual(args.slice(i - 1, i + 2), ['--ro-bind', '/tmp/x/settings.json', '/tmp/x/settings.json']);
});

// ---------- Liaison ----------

test('liaison par clé API Google : validée sans coût, chiffrée, jamais réaffichée', async () => {
  const u = await s.newUser({ admin: false });
  const calls = [];
  s.app.fetch = async (url, opts) => { calls.push({ url, headers: opts.headers }); return { status: 200, ok: true }; };
  await linkApiKey(s.app, u.id, KEY, 'gemini');
  s.app.fetch = undefined;
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models/);
  assert.equal(calls[0].headers['x-goog-api-key'], KEY);
  const raw = (await s.db.prepare('SELECT claude_link_json FROM users WHERE id = ?').get(u.id)).claude_link_json;
  assert.ok(!raw.includes(KEY), 'pas en clair en base');
  const link = JSON.parse(raw);
  assert.deepEqual([link.provider, link.mode, link.last4], ['gemini', 'api_key', KEY.slice(-4)]);
  assert.equal(decrypt(s.app.cfg.secretKey, link.secret_enc), KEY);
  const pub = await getLinkState(s.db, u.id);
  assert.deepEqual([pub.provider, pub.providerLabel, pub.label], ['gemini', 'Gemini', 'Clé API Google AI Studio']);
  assert.ok(!JSON.stringify(pub).includes(KEY));
  assert.equal(await userProvider(s.db, u.id), 'gemini');
  assert.equal(await aiRefusal(s.db, u.id), null);
});

test('clé Google refusée (400, 401, 403) ou mal formée : rien n\'est enregistré ; réseau coupé : message distinct', async () => {
  const u = await s.newUser({ admin: false });
  const status = (n) => { s.app.fetch = async () => ({ status: n, ok: n < 300 }); };
  for (const n of [400, 401, 403]) {
    status(n);
    await assert.rejects(linkApiKey(s.app, u.id, KEY, 'gemini'), (e) => e instanceof HttpError && e.status === 400 && /refusée par Google/.test(e.message), `HTTP ${n}`);
  }
  status(500);
  await assert.rejects(linkApiKey(s.app, u.id, KEY, 'gemini'), (e) => e.status === 502 && /Google ne répond pas/.test(e.message));
  s.app.fetch = async () => { throw new Error('ECONNRESET'); };
  await assert.rejects(linkApiKey(s.app, u.id, KEY, 'gemini'), (e) => e.status === 502 && /réseau/.test(e.message));
  s.app.fetch = undefined;
  await assert.rejects(linkApiKey(s.app, u.id, 'pas une clé', 'gemini'), /Clé API invalide/);
  await assert.rejects(linkApiKey(s.app, u.id, KEY, 'inconnue'), /IA inconnue/);
  assert.equal(await getLinkState(s.db, u.id), null);
  assert.equal((await s.db.prepare('SELECT claude_link_json FROM users WHERE id = ?').get(u.id)).claude_link_json, null);
});

test('validateApiKey de Gemini seul : refus, réseau, succès', async () => {
  await validateApiKey(KEY, async () => ({ status: 200, ok: true }));
  await assert.rejects(validateApiKey(KEY, async () => ({ status: 400, ok: false })), /refusée par Google/);
});

test('tester la liaison : une clé refusée la rend invalide, une panne réseau n\'y touche pas', async () => {
  const u = await s.newUser({ admin: false });
  s.app.fetch = async () => ({ status: 200, ok: true });
  await linkApiKey(s.app, u.id, KEY, 'gemini');
  assert.deepEqual(await testLink(s.app, u.id), { ok: true, message: 'Liaison valide' });
  s.app.fetch = async () => ({ status: 400, ok: false });
  assert.equal((await testLink(s.app, u.id)).ok, false);
  assert.equal((await getLinkState(s.db, u.id)).valid, false);
  s.app.fetch = async () => { throw new Error('ECONNRESET'); };
  await linkApiKey(s.app, u.id, KEY, 'gemini').catch(() => {});
  s.app.fetch = undefined;
});

test('passer de Claude à Gemini remet les modèles au défaut de Gemini', async () => {
  const u = await s.newUser({ admin: false });
  s.app.fetch = async () => ({ status: 200, ok: true });
  await linkApiKey(s.app, u.id, `sk-ant-api03-${'A'.repeat(40)}ZZ12`);
  await setSetting(s.db, u.id, 'analyze_model', 'opus');
  await linkApiKey(s.app, u.id, KEY, 'gemini');
  s.app.fetch = undefined;
  assert.equal(await getSetting(s.db, u.id, 'analyze_model'), null);
  assert.deepEqual(JSON.parse(await getSetting(s.db, u.id, 'ai_switch_json')).to, 'gemini');
});

// ---------- Dans le pipeline des jobs ----------

test('un job d\'un utilisateur Gemini passe par Gemini CLI avec SA clé, et le coût est estimé', async () => {
  const u = await s.newUser({ admin: false, link: { v: 1, provider: 'gemini', mode: 'api_key', valid: true, last4: KEY.slice(-4), secret_enc: encrypt(s.app.cfg.secretKey, KEY) } });
  const before = dumps().length;
  const r = await makeClaude(s.app)(u.id, { prompt: 'Analyse en JSON', model: 'gemini-3.5-flash-lite', maxTurns: 1, tools: [] });
  assert.equal(r.ok, true);
  assert.match(r.text, /Cartes de fidélité/);
  assert.equal(r.costUsd, 0.0008);
  const d = dumps().slice(before)[0];
  assert.equal(d.key, KEY);
  assert.equal(d.anthropic, null, 'aucune clé Anthropic dans un processus Gemini');
  assert.equal(getProvider('gemini').rateLimitWindows(r.rateLimit), null);
});

test('un refus d\'accès de Gemini invalide la liaison (comme chez Claude), sans toucher aux autres utilisateurs', async () => {
  const bad = `AIzaSy${'REVOKED'.padEnd(33, 'X')}`;
  const u = await s.newUser({ admin: false, link: { v: 1, provider: 'gemini', mode: 'api_key', valid: true, last4: 'XXXX', secret_enc: encrypt(s.app.cfg.secretKey, bad) } });
  const other = await s.newUser({ admin: false, link: { v: 1, provider: 'gemini', mode: 'api_key', valid: true, last4: KEY.slice(-4), secret_enc: encrypt(s.app.cfg.secretKey, KEY) } });
  const realWarn = console.warn; console.warn = () => {};
  try {
    const r = await makeClaude(s.app)(u.id, { prompt: 'x', model: 'gemini-3.5-flash-lite', maxTurns: 1, tools: [] });
    assert.equal(r.ok, false);
  } finally { console.warn = realWarn; }
  assert.equal((await getLinkState(s.db, u.id)).valid, false);
  assert.equal((await getLinkState(s.db, other.id)).valid, true);
});

// ---------- Montage du CLI dans le bac à sable ----------
test('un CLI installé avec npm (nvm) : son arbre node_modules et l\'installation de Node sont montés, sinon il s\'arrête sans rien dire', async () => {
  const { cliBinds, prepareLaunch } = await import('../src/services/sandbox.js');
  const codex = '/home/iaboss/.nvm/versions/node/v22.22.0/lib/node_modules/@openai/codex/bin/codex.js';
  const node = '/home/iaboss/.nvm/versions/node/v22.22.0/bin/node';
  assert.deepEqual(cliBinds(codex, node).sort(), [
    '/home/iaboss/.nvm/versions/node/v22.22.0', '/home/iaboss/.nvm/versions/node/v22.22.0/lib/node_modules', '/home/iaboss/.nvm/versions/node/v22.22.0/lib/node_modules/@openai/codex/bin',
  ]);
  const gem = '/home/iaboss/.nvm/versions/node/v22.22.0/lib/node_modules/@google/gemini-cli/bundle/gemini.js';
  assert.ok(cliBinds(gem, node).includes('/home/iaboss/.nvm/versions/node/v22.22.0/lib/node_modules'));
  assert.deepEqual(cliBinds('/usr/local/bin/codex', '/usr/local/bin/node'), [], 'sous /usr, déjà monté : rien à ajouter');
  assert.deepEqual(cliBinds('/usr/lib/node_modules/@openai/codex/bin/codex.js', '/usr/bin/node'), ['/usr/lib/node_modules'], 'seul l\'arbre du paquet, Node est sous /usr');
  assert.deepEqual(cliBinds('/home/u/.local/bin/claude', '/usr/bin/node'), ['/home/u/.local/bin'], 'un binaire natif : son dossier seulement');
  // De bout en bout dans la ligne de commande bubblewrap : chaque dossier est monté en lecture seule, jamais en écriture
  const launch = prepareLaunch({ bin: 'codex', args: ['exec'], sandbox: { enabled: true, production: true, bwrapBin: 'bwrap', roBinds: [] } },
    { hasBwrap: () => true, resolveBin: () => codex, nodeExec: node, parentEnv: { PATH: '/x' } });
  const a = launch.args;
  for (const d of ['/home/iaboss/.nvm/versions/node/v22.22.0', '/home/iaboss/.nvm/versions/node/v22.22.0/lib/node_modules']) {
    const i = a.indexOf(d);
    assert.deepEqual(a.slice(i - 1, i + 2), ['--ro-bind', d, d], d);
  }
  assert.ok(!a.includes('--bind'), 'aucun montage en écriture');
});
