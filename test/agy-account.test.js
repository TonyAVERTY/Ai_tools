import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encrypt, decrypt } from '../src/crypto.js';
import { makeClaude } from '../src/handlers.js';
import { aiRefusal, getLinkState, GOOGLE_DISABLED_MESSAGE, setGoogleAccountEnabled, isSubscriptionMode } from '../src/claudelink.js';
import { buildArgs, settingsFor, denyRules, allowedTools, agyModel, isAuthRefusal, tokenSecrets, ALL_TOOLS } from '../src/services/providers/agy.js';
import { getProvider } from '../src/services/providers/index.js';
import { prepareLaunch } from '../src/services/sandbox.js';
import { startApp } from './helpers/server.js';
import { makeClaudeBin } from './helpers/claude-bin.js';

// Compte Google (Antigravity CLI) : arguments et règles « deny », dossier maison propre au lancement, fichier de connexion renouvelé rangé,
// connexion expirée = accès refusé, rien de secret ne sort, mode désactivé tant que l'administrateur ne l'active pas. Aucun vrai agy : il est
// simulé (test/fixtures/fake-agy.js, au format observé sur agy 1.5.2). Le vrai agy se vérifie avec scripts/agy-check.mjs.
let s, tmp, dump, log;
const TOKEN = JSON.stringify({ access_token: 'ya29.' + 'A'.repeat(40), refresh_token: '1//' + 'R'.repeat(40), token_type: 'Bearer', expiry: '2026-11-06T20:00:00Z' });
const dumps = () => (existsSync(dump) ? readFileSync(dump, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const rawLink = async (id) => JSON.parse((await s.db.prepare('SELECT claude_link_json FROM users WHERE id = ?').get(id)).claude_link_json);
const storedAuth = async (id) => decrypt(s.app.cfg.secretKey, (await rawLink(id)).secret_enc);
const accountLink = (auth = TOKEN) => ({ v: 1, provider: 'gemini', mode: 'google_account', valid: true, linked_at: 1000, secret_enc: encrypt(s.app.cfg.secretKey, auth) });
const useBin = (env = {}) => { s.app.cfg.agyBin = makeClaudeBin(tmp, { fixture: 'fake-agy.js', name: `agy-${Math.random().toString(36).slice(2)}`, env: { FAKE_DUMP: dump, ...env } }); };
const run = (u, prompt, o = {}) => makeClaude(s.app)(u.id, { prompt, model: 'gemini-3.6-flash', maxTurns: 5, tools: [], ...o });

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'aitools-agy-'));
  dump = join(tmp, 'dump.jsonl');
  log = join(tmp, 'queue.log');
  s = await startApp({ cfg: { googleAccountEnabled: true, sandbox: { enabled: false, production: false } } });
  useBin();
});
after(async () => { setGoogleAccountEnabled(false); await s.close(); rmSync(tmp, { recursive: true, force: true }); });

test('arguments : consignes devant la demande, modèle du catalogue → niveau d\'agy, réglages passés pour ce lancement seulement', () => {
  const a = buildArgs({ prompt: 'Demande', system: 'Consignes', model: 'gemini-3.6-flash', tools: [] });
  assert.equal(a[a.indexOf('-p') + 1], 'Consignes\n\n---\n\nDemande');
  assert.ok(a.includes('stream-json') && a.includes('--disable-slash-commands'));
  assert.equal(a[a.indexOf('--model') + 1], 'gemini-3.8-flash-medium');
  assert.deepEqual(['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.8-flash-low', 'inconnu'].map(agyModel), ['gemini-3.8-flash-low', 'gemini-3.8-flash-high', 'gemini-3.8-flash-low', null]);
  assert.ok(!buildArgs({ prompt: 'x', model: 'inconnu' }).includes('--model'), 'modèle inconnu : celui par défaut d\'agy');
  assert.ok(!a.includes('--dangerously-skip-permissions'), 'jamais d\'approbation automatique de tous les outils');
  assert.ok(!a.includes('--mode'), 'le mode plan répond par un plan, pas par le texte demandé');
  assert.deepEqual(JSON.parse(a[a.indexOf('--settings') + 1]), settingsFor({ tools: [] }));
});

test('règles deny : tout outil non accordé est refusé (commande, écriture, navigateur, messages…), seuls les outils demandés restent', () => {
  const none = denyRules([]);
  for (const t of ['run_command', 'write_to_file', 'replace_file_content', 'browser_subagent', 'open_browser_url', 'send_message', 'call_mcp_tool', 'search_web', 'read_url_content', 'view_file', 'grep_search']) {
    assert.ok(none.includes(`${t}(*)`), `${t} refusé sans outil demandé`);
  }
  assert.ok(!none.some((r) => r.startsWith('finish(')), '« finish » termine le tour : jamais refusé');
  assert.ok(none.includes('command(*)') && none.includes('write_file(*)'), 'et les catégories d\'actions de la documentation d\'agy');
  const read = denyRules(['Read', 'Grep', 'WebSearch']);
  for (const t of ['view_file', 'list_dir', 'find_by_name', 'grep_search', 'search_web']) assert.ok(!read.includes(`${t}(*)`), `${t} accordé`);
  for (const t of ['run_command', 'write_to_file', 'replace_file_content', 'read_url_content', 'browser_subagent']) assert.ok(read.includes(`${t}(*)`), `${t} toujours refusé`);
  assert.deepEqual(allowedTools(['Read', 'Glob']), ['finish', 'view_file', 'list_dir', 'find_by_name', 'grep_search']);
  // Aucun outil d'écriture ni de commande n'est jamais accordable, quelle que soit la demande
  const all = denyRules(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Write', 'Edit', 'Bash']);
  for (const t of ['run_command', 'write_to_file', 'replace_file_content', 'multi_replace_file_content', 'sed_file', 'send_command_input', 'notebook_edit', 'send_message']) assert.ok(all.includes(`${t}(*)`), `${t} jamais accordé`);
  assert.ok(ALL_TOOLS.length >= 55);
});

test('un job : réponse, tokens (réflexion comprise), journal d\'activité en noms Claude ; HOME propre au lancement avec le fichier, supprimé ensuite', async () => {
  const u = await s.newUser({ admin: false, link: accountLink() });
  const before = dumps().length;
  const tools = [], turns = [];
  const r = await run(u, 'Dis bonjour ACTIONS', { tools: ['Read', 'Grep', 'WebSearch'], onTool: (n) => tools.push(n), onTurn: (n) => turns.push(n) });
  assert.equal(r.ok, true);
  assert.match(r.text, /Bonjour/);
  assert.equal(r.tokensIn, 6873);
  assert.equal(r.tokensOut, 111 + 99, 'tokens de sortie + de réflexion');
  assert.equal(r.rateLimit, null);
  assert.deepEqual(tools, ['Read', 'Grep', 'WebSearch']);
  assert.deepEqual(turns, [1, 2, 3]);
  const d = dumps().slice(before)[0];
  assert.equal(d.token, TOKEN, 'agy a vu le fichier de connexion de CET utilisateur');
  assert.ok(d.home.startsWith(join(s.app.cfg.dataDir, 'run', 'agy-home-')), d.home);
  assert.ok(!existsSync(d.home), 'dossier supprimé après le lancement');
  assert.ok(!d.env.some((k) => /KEY|SECRET|TOKEN/i.test(k)), 'aucune variable secrète dans l\'environnement d\'agy');
  assert.ok(d.deny.includes('run_command(*)') && d.deny.includes('write_to_file(*)'));
  assert.equal(readdirSync(join(s.app.cfg.dataDir, 'run')).filter((f) => f.startsWith('agy-home-')).length, 0);
});

test('une écriture de fichier demandée à l\'IA est refusée par les règles transmises à agy', async () => {
  const u = await s.newUser({ admin: false, link: accountLink() });
  const cwd = mkdtempSync(join(tmp, 'work-'));
  const r = await run(u, 'Crée un fichier WRITEFILE', { cwd, allowedRoot: cwd });
  assert.equal(r.ok, true);
  assert.match(r.text, /Permission denied/);
  assert.ok(!existsSync(join(cwd, 'a.txt')), 'aucun fichier écrit');
});

test('fichier renouvelé par agy : le nouveau est rangé chiffré, sans jamais rien en clair en base', async () => {
  const u = await s.newUser({ admin: false, link: accountLink() });
  const r = await run(u, 'Dis bonjour REFRESH');
  assert.equal(r.ok, true);
  const stored = await storedAuth(u.id);
  assert.notEqual(stored, TOKEN);
  assert.match(stored, /NEWN{30}/);
  assert.ok((await rawLink(u.id)).refreshed_at > 0);
  const raw = (await s.db.prepare('SELECT claude_link_json FROM users WHERE id = ?').get(u.id)).claude_link_json;
  assert.ok(!raw.includes('ya29.') && !raw.includes('NNNN'), 'jetons jamais en clair en base');
});

test('connexion expirée : accès refusé tout de suite (pas 60 s d\'attente), la liaison devient invalide', async () => {
  const u = await s.newUser({ admin: false, link: accountLink(TOKEN.replace('ya29.', 'EXPIRED')) });
  const started = Date.now();
  await assert.rejects(run(u, 'Dis bonjour'), /Authentication required/);
  assert.ok(Date.now() - started < 10_000, 'le lien de connexion n\'est pas attendu');
  assert.equal((await getLinkState(s.db, u.id)).valid, false);
});

test('aucun jeton ne sort, même quand agy les écrit dans ses erreurs', async () => {
  const u = await s.newUser({ admin: false, link: accountLink() });
  const realWarn = console.warn; console.warn = () => {};
  try {
    await assert.rejects(run(u, 'Dis bonjour LEAK'), (e) => !e.message.includes('ya29.') && !e.message.includes('1//R') && /\*\*\*/.test(e.message));
  } finally { console.warn = realWarn; }
});

test('trop d\'actions : arrêt, même sens que la limite de tours de Claude', async () => {
  const u = await s.newUser({ admin: false, link: accountLink() });
  const r = await run(u, 'TOOMANY', { maxTurns: 3 });
  assert.equal(r.ok, false);
  assert.equal(r.subtype, 'error_max_turns');
});

test('résultat en erreur : ok faux, le texte dit pourquoi', async () => {
  const u = await s.newUser({ admin: false, link: accountLink() });
  const realWarn = console.warn; console.warn = () => {};
  try {
    const r = await run(u, 'BADSTATUS');
    assert.equal(r.ok, false);
    assert.equal(r.subtype, 'error');
  } finally { console.warn = realWarn; }
});

test('les exécutions d\'un même compte passent l\'une après l\'autre', async () => {
  useBin({ FAKE_LOG: log, FAKE_DELAY_MS: '150' });
  try {
    const u = await s.newUser({ admin: false, link: accountLink() });
    await Promise.all([run(u, 'un'), run(u, 'deux'), run(u, 'trois')]);
    const lines = readFileSync(log, 'utf8').trim().split('\n').map((l) => l.split(' ')[0]);
    assert.deepEqual(lines, ['start', 'end', 'start', 'end', 'start', 'end']);
  } finally { useBin(); }
});

test('mode désactivé par l\'administrateur : refus net, rien n\'est lancé ; réactivé, ça repart', async () => {
  const u = await s.newUser({ admin: false, link: accountLink() });
  assert.equal(await aiRefusal(s.db, u.id), null);
  setGoogleAccountEnabled(false);
  try {
    assert.equal(await aiRefusal(s.db, u.id), GOOGLE_DISABLED_MESSAGE);
    const before = dumps().length;
    await assert.rejects(run(u, 'Dis bonjour'), /désactivée/);
    assert.equal(dumps().length, before, 'agy n\'a pas été lancé');
  } finally { setGoogleAccountEnabled(true); }
  assert.equal(await aiRefusal(s.db, u.id), null);
});

test('fournisseur : le compte Google est un abonnement, avec son moteur et son exécutable ; une clé API reste sur Gemini CLI', () => {
  const p = getProvider('gemini');
  assert.deepEqual([p.modes.google_account.file, p.modes.google_account.subscription], [true, true]);
  assert.equal(p.bin({ agyBin: '/x/agy', geminiBin: '/x/gemini' }, 'google_account'), '/x/agy');
  assert.equal(p.bin({ agyBin: '/x/agy', geminiBin: '/x/gemini' }, 'api_key'), '/x/gemini');
  assert.equal(isSubscriptionMode('google_account'), true);
  assert.equal(p.isAuthRefusal('Authentication required : connexion expirée'), true);
  assert.equal(p.isAuthRefusal('API key not valid'), true);
  assert.equal(isAuthRefusal('Connection reset'), false);
});

test('jetons à masquer : le fichier entier et chaque texte long d\'un fichier JSON', () => {
  const t = tokenSecrets(TOKEN);
  assert.ok(t.includes(TOKEN));
  assert.ok(t.some((x) => x.startsWith('ya29.')) && t.some((x) => x.startsWith('1//')));
  assert.ok(!t.includes('Bearer'), 'les valeurs courtes ne sont pas des secrets');
  assert.deepEqual(tokenSecrets(''), []);
});

test('bac à sable : le dossier maison jetable est le HOME du CLI et le seul dossier en écriture, jamais celui du serveur', () => {
  const sb = { enabled: true, production: true, bwrapBin: 'bwrap' };
  const deps = { parentEnv: { PATH: '/usr/bin', HOME: '/home/service' }, hasBwrap: () => true, resolveBin: () => '/home/iaboss/.local/bin/agy' };
  const l = prepareLaunch({ bin: 'agy', args: ['-p', 'x'], cwd: '/data/u1/repo', allowedRoot: '/data/u1', sandbox: sb, homeDir: '/data/run/agy-home-1', rwDirs: ['/data/run/agy-home-1'] }, deps);
  assert.equal(l.env.HOME, '/data/run/agy-home-1');
  const i = l.args.indexOf('/data/run/agy-home-1');
  assert.deepEqual(l.args.slice(i - 1, i + 2), ['--bind', '/data/run/agy-home-1', '/data/run/agy-home-1']);
  assert.ok(!JSON.stringify(l.env).includes('/home/service'), 'le HOME du serveur n\'est pas transmis');
  const plain = prepareLaunch({ bin: 'agy', args: [], cwd: tmp, sandbox: { enabled: false, production: false }, homeDir: join(tmp, 'h') }, { parentEnv: { PATH: '/usr/bin' } });
  assert.equal(plain.env.HOME, join(tmp, 'h'));
  plain.cleanup();
});
