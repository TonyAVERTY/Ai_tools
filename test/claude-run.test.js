import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { now, getSetting, setSetting } from '../src/db.js';
import { encrypt } from '../src/crypto.js';
import { enqueue, Worker, latestJobs } from '../src/services/jobs.js';
import { quotaState, budgetState, AI_JOBS, isQuotaSensitive } from '../src/services/budget.js';
import { makeClaude, makeHandlers, claudeDiagnostic } from '../src/handlers.js';
import { extractJson } from '../src/services/claude.js';
import { buildBwrapArgs, buildChildEnv, prepareLaunch, isInside, SANDBOX_HOME } from '../src/services/sandbox.js';
import { validateGitUrl, syncRepo, gitEnv, cloneArgs, fetchArgs, GIT_HARDENING, dirSize } from '../src/services/git.js';
import { loadConfig } from '../src/config.js';
import { userRepoRoot } from '../src/users.js';
import { startApp } from './helpers/server.js';
import { makeClaudeBin } from './helpers/claude-bin.js';

// Exécution isolée : le secret vient toujours du user_id du job, environnement du processus enfant assaini,
// argv bubblewrap, clones git durcis, quota et budget par utilisateur.
// Limite connue : bwrap n'est pas exécutable sur ce poste (Windows) ; sa ligne de commande est testée, pas son effet.
let s, tmp;
const KEY_A = `sk-ant-api03-${'A'.repeat(40)}ZZ12`;
const KEY_B = `sk-ant-api03-${'B'.repeat(40)}QQ34`;
const TOK_A = `sk-ant-oat01-HOT${'a'.repeat(40)}`;
const TOK_B = `sk-ant-oat01-${'b'.repeat(40)}`;

const apiKeyLink = (key) => ({ v: 1, mode: 'api_key', valid: true, last4: key.slice(-4), secret_enc: encrypt(s.app.cfg.secretKey, key) });
const tokenLink = (tok) => ({ v: 1, mode: 'subscription_token', valid: true, secret_enc: encrypt(s.app.cfg.secretKey, tok) });
const project = async (u, extra = {}) => Number((await s.db.prepare(`INSERT INTO projects(user_id, name, git_url, profile_json, target_json, target_validated, created_at)
  VALUES(?, 'P', ?, ?, ?, 1, ?)`).run(u.id, `https://git.test/u${u.id}/p${Math.random()}.git`, JSON.stringify({ resume: 'x', proposition_valeur: 'y' }),
  JSON.stringify({ description: 'd', secteurs: ['s'] }), now())).lastInsertRowid);
const ctxOf = (job) => ({ job, params: {}, signal: new AbortController().signal, progress: async () => {}, cancelled: async () => false, usage: { costUsd: 0, tokensIn: 0, tokensOut: 0 } });

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'aitools-run-'));
  s = await startApp({ cfg: { claudeBin: resolve('test/fixtures/fake-claude.js') } });
  // Pas de vrai clone : le dossier est simplement créé (et vérifié par le bac à sable via allowedRoot)
  s.app.syncRepo = async (url, dir) => { mkdirSync(dir, { recursive: true }); return 'deadbeef'; };
});
after(async () => { await s.close(); rmSync(tmp, { recursive: true, force: true }); });

// ---------- Le secret vient du user_id du job ----------

test('un utilisateur ne lance jamais un job avec le secret d\'un autre (secret relu depuis le user_id du job)', async () => {
  const log = join(tmp, 'keys.log');
  s.app.cfg.claudeBin = makeClaudeBin(tmp, { logVars: ['ANTHROPIC_API_KEY'], logFile: log });
  const a = await s.newUser({ admin: false, link: apiKeyLink(KEY_A) });
  const b = await s.newUser({ admin: false, link: apiKeyLink(KEY_B) });
  const pa = await project(a), pb = await project(b);
  const w = new Worker(s.db, makeHandlers(s.app), { log: { error() {} } });
  await enqueue(s.db, { userId: a.id, projectId: pa, type: 'template' });
  await enqueue(s.db, { userId: b.id, projectId: pb, type: 'template' });
  while (await w.tick()) { /* vide la file */ }
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [KEY_A, KEY_A, KEY_A, KEY_B, KEY_B, KEY_B], 'chaque job (rédaction, relecture, puis correction de forme) a tourné avec la clé de SON utilisateur');
  assert.equal((await latestJobs(s.db, pa)).template.status, 'done');
  assert.equal((await latestJobs(s.db, pb)).template.status, 'done');
});

test('id de projet ou de job manipulé : le job d\'A ne touche jamais au projet ni au secret de B', async () => {
  s.app.cfg.claudeBin = '/inexistant/claude'; // si quoi que ce soit se lançait, l'erreur serait un ENOENT
  const a = await s.newUser({ admin: false, link: apiKeyLink(KEY_A) });
  const b = await s.newUser({ admin: false, link: apiKeyLink(KEY_B) });
  const pb = await project(b);
  const handlers = makeHandlers(s.app);
  for (const type of ['analyze', 'template', 'followup_template', 'prospect', 'evolution']) {
    await assert.rejects(handlers[type](ctxOf({ id: 1, user_id: a.id, project_id: pb, type })), { status: 404 }, type);
  }
  // Même chose via la file : un job inséré à la main avec le projet de B échoue sans exécution
  await s.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, created_at) VALUES(?, ?, 'template', 'queued', ?)").run(a.id, pb, now());
  const w = new Worker(s.db, makeHandlers(s.app), { log: { error() {} } });
  while (await w.tick()) { /* vide la file */ }
  const row = await s.db.prepare("SELECT status, error FROM jobs WHERE user_id = ? AND project_id = ?").get(a.id, pb);
  assert.equal(row.status, 'error');
  assert.match(row.error, /Projet introuvable/);
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM templates WHERE project_id = ?').get(pb)).n, 0);
  await assert.rejects(enqueue(s.db, { userId: a.id, projectId: pb, type: 'template' }), { status: 404 });
  // Le wrapper n'accepte pas non plus un répertoire hors du dossier de l'utilisateur
  s.app.cfg.claudeBin = resolve('test/fixtures/fake-claude.js');
  const claude = makeClaude(s.app);
  await assert.rejects(claude(a.id, { prompt: 'x', cwd: join(userRepoRoot(s.app.cfg, b.id), String(pb)) }), /hors du dossier/);
  await assert.rejects(claude(a.id, { prompt: 'x', cwd: s.app.cfg.dataDir }), /hors du dossier/);
});

// ---------- Environnement du processus enfant ----------

test('environnement enfant : liste blanche stricte, secret de l\'utilisateur concerné uniquement', () => {
  const parent = {
    PATH: '/usr/bin', LANG: 'fr_FR.UTF-8', SECRET_KEY: 'k'.repeat(64), DB_PASSWORD: 'dbpass', DB_HOST: 'h', GOOGLE_CLIENT_SECRET: 'g', APPLE_PRIVATE_KEY: 'p',
    ANTHROPIC_API_KEY: 'sk-ant-du-serveur', CLAUDE_CODE_OAUTH_TOKEN: 'jeton-du-serveur', HOME: '/home/svc', NODE_ENV: 'production', ADMIN_EMAILS: 'a@b.fr',
  };
  const sb = { enabled: true, production: true, bwrapBin: 'bwrap', roBinds: [], serverHome: '/home/svc' };
  const l = prepareLaunch({ bin: 'claude', args: ['-p', 'x'], sandbox: sb, secretEnv: { ANTHROPIC_API_KEY: KEY_A } },
    { parentEnv: parent, hasBwrap: () => true, resolveBin: () => '/usr/local/bin/claude' });
  const allowed = new Set(['PATH', 'LANG', 'HOME', 'ANTHROPIC_API_KEY', ...(process.platform === 'win32' ? ['SystemRoot', 'PATHEXT', 'TEMP', 'TMP', 'COMSPEC'] : [])]);
  for (const k of Object.keys(l.env)) assert.ok(allowed.has(k), `variable inattendue : ${k}`);
  assert.equal(l.env.ANTHROPIC_API_KEY, KEY_A, 'la clé de l\'utilisateur, pas celle du serveur');
  assert.equal(l.env.HOME, SANDBOX_HOME, 'répertoire personnel jetable du bac à sable');
  assert.equal(l.env.PATH, '/usr/bin');
  assert.ok(!JSON.stringify(l.env).match(/dbpass|SECRET_KEY|serveur|a@b\.fr/));
  // Sans secret (mode serveur) : aucune des variables d'identification, même héritées du serveur
  const none = buildChildEnv(parent, { home: '/h' });
  assert.equal(none.ANTHROPIC_API_KEY, undefined);
  assert.equal(none.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  // Un nom de variable arbitraire n'est pas accepté comme « secret »
  assert.throws(() => buildChildEnv(parent, { home: '/h', secretEnv: { SECRET_KEY: 'x' } }), /non autorisée/);
});

test('environnement enfant (processus réel) : aucun secret du serveur, la clé de l\'utilisateur seulement', async () => {
  const polluted = { SECRET_KEY: 'SERVEUR-SECRET-KEY', DB_PASSWORD: 'SERVEUR-DB', GOOGLE_CLIENT_SECRET: 'SERVEUR-GOOGLE', APPLE_PRIVATE_KEY: 'SERVEUR-APPLE',
    ANTHROPIC_API_KEY: 'SERVEUR-ANTHROPIC', CLAUDE_CODE_OAUTH_TOKEN: 'SERVEUR-OAUTH' };
  const keep = {};
  for (const k of Object.keys(polluted)) { keep[k] = process.env[k]; process.env[k] = polluted[k]; }
  s.app.cfg.claudeBin = resolve('test/fixtures/fake-claude.js');
  try {
    const a = await s.newUser({ admin: false, link: apiKeyLink(KEY_A) });
    const r = await makeClaude(s.app)(a.id, { prompt: 'ENVDUMP', maxTurns: 1, tools: [] });
    const { env } = extractJson(r.text);
    // Présente dans l'environnement du CLI, mais masquée dans ce qu'il renvoie (le masquage est lui aussi vérifié)
    assert.equal(env.ANTHROPIC_API_KEY, '***');
    for (const k of Object.keys(polluted)) if (k !== 'ANTHROPIC_API_KEY') assert.equal(env[k], undefined, k);
    assert.ok(!JSON.stringify(env).includes('SERVEUR-'));
    // HOME jetable : pas celui du serveur
    assert.notEqual(env.HOME, process.env.HOME);
    // L'abonnement : seul CLAUDE_CODE_OAUTH_TOKEN, jamais ANTHROPIC_API_KEY
    const t = await s.newUser({ admin: false, link: tokenLink(TOK_B) });
    const r2 = await makeClaude(s.app)(t.id, { prompt: 'ENVDUMP', maxTurns: 1, tools: [] });
    const env2 = extractJson(r2.text).env;
    assert.equal(env2.CLAUDE_CODE_OAUTH_TOKEN, '***');
    assert.equal(env2.ANTHROPIC_API_KEY, undefined);
  } finally { for (const k of Object.keys(polluted)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
});

test('le secret n\'apparaît ni dans les erreurs du CLI, ni dans le job en erreur', async () => {
  s.app.cfg.claudeBin = resolve('test/fixtures/fake-claude.js');
  const a = await s.newUser({ admin: false, link: apiKeyLink(KEY_A) });
  let err;
  try { await makeClaude(s.app)(a.id, { prompt: 'LEAK' }); } catch (e) { err = e; }
  assert.ok(err, 'le CLI a échoué');
  assert.match(err.message, /\*\*\*/);
  assert.ok(!err.message.includes(KEY_A));
  const p = await project(a);
  const w = new Worker(s.db, { template: async () => { await makeClaude(s.app)(a.id, { prompt: 'LEAK' }); } }, { log: { error() {} } });
  await enqueue(s.db, { userId: a.id, projectId: p, type: 'template' });
  while (await w.tick()) { /* vide la file */ }
  const row = await s.db.prepare('SELECT status, error FROM jobs WHERE project_id = ?').get(p);
  assert.equal(row.status, 'error');
  assert.ok(!row.error.includes(KEY_A));
});

// ---------- bubblewrap ----------

const pairIdx = (args, flag, ...vals) => args.findIndex((x, i) => x === flag && vals.every((v, j) => args[i + 1 + j] === v));

test('bwrap : ligne de commande — racine en lecture seule, tmpfs, un seul dossier utilisateur, espaces de noms', () => {
  const work = resolve('/srv/aitools/repos/7/12');
  const a = buildBwrapArgs({ workDir: work, command: ['/opt/claude/claude', '-p', 'x'], roBinds: ['/opt/claude'] });
  for (const f of ['--die-with-parent', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--new-session']) assert.ok(a.includes(f), f);
  assert.ok(!a.includes('--unshare-net') && !a.includes('--unshare-all'), 'le réseau est conservé');
  assert.ok(pairIdx(a, '--tmpfs', '/tmp') >= 0, '/tmp vide');
  assert.ok(pairIdx(a, '--tmpfs', SANDBOX_HOME) >= 0, 'HOME vide');
  assert.ok(pairIdx(a, '--ro-bind', '/usr', '/usr') >= 0);
  assert.ok(pairIdx(a, '--ro-bind', work, work) >= 0, 'clone de l\'utilisateur, en lecture seule');
  assert.ok(pairIdx(a, '--ro-bind', '/opt/claude', '/opt/claude') >= 0);
  assert.ok(pairIdx(a, '--chdir', work) >= 0);
  assert.deepEqual(a.slice(a.indexOf('--') + 1), ['/opt/claude/claude', '-p', 'x']);
  // Rien d'autre n'est monté : ni la racine entière, ni /home, /root, /var, ni la config Claude du serveur
  const mounts = a.flatMap((x, i) => (['--bind', '--ro-bind', '--bind-try', '--ro-bind-try'].includes(x) ? [a[i + 1]] : []));
  assert.deepEqual(mounts.sort(), ['/bin', '/etc', '/lib', '/lib64', '/opt/claude', '/run/systemd/resolve', '/sbin', '/usr', work].sort());
  assert.ok(!a.includes('--bind') && !a.includes('--bind-try'), 'aucun montage en écriture');
  assert.ok(!a.join(' ').includes('.claude'));
  assert.ok(!mounts.includes('/'));
  // Sans projet : seul le HOME vide
  const bare = buildBwrapArgs({ command: ['claude'] });
  assert.ok(pairIdx(bare, '--chdir', SANDBOX_HOME) >= 0);
  assert.throws(() => buildBwrapArgs({ workDir: 'relatif', command: ['x'] }), /absolu/);
  assert.throws(() => buildBwrapArgs({ command: [] }), /vide/);
});

test('bwrap : la configuration du CLI du serveur n\'est jamais montée, même si on la demande', () => {
  const sb = { enabled: true, production: true, bwrapBin: 'bwrap', roBinds: [], serverHome: '/home/svc' };
  const deps = { parentEnv: { PATH: '/usr/bin', HOME: '/home/svc' }, hasBwrap: () => true, resolveBin: () => '/usr/bin/claude' };
  const work = resolve('/srv/aitools/repos/1/1');
  // `serverConfig` n'existe plus : un appelant qui le passerait encore n'obtient aucun montage de /home/svc
  const l = prepareLaunch({ bin: 'claude', args: ['-p', 'x'], cwd: work, allowedRoot: resolve('/srv/aitools/repos/1'), sandbox: sb, serverConfig: true, secretEnv: { ANTHROPIC_API_KEY: KEY_A } }, deps);
  assert.ok(!l.args.join(' ').includes('.claude'));
  assert.ok(!l.args.some((x) => x === '/home/svc' || x.startsWith('/home/svc')));
  assert.equal(l.env.HOME, SANDBOX_HOME);
  // Développement (SANDBOX=off) : HOME jetable, jamais celui du serveur
  const dev = prepareLaunch({ bin: 'claude', args: ['-p', 'x'], cwd: work, allowedRoot: resolve('/srv/aitools/repos/1'), sandbox: { enabled: false, production: false, serverHome: '/home/svc' }, serverConfig: true }, deps);
  assert.notEqual(dev.env.HOME, '/home/svc');
  dev.cleanup();
});

test('bwrap : prepareLaunch — le secret n\'est jamais dans argv (visible dans ps), seulement dans l\'environnement', () => {
  const sb = { enabled: true, production: true, bwrapBin: 'bwrap', roBinds: [], serverHome: '/home/svc' };
  const l = prepareLaunch({ bin: 'claude', args: ['-p', 'bonjour'], cwd: resolve('/srv/d/repos/3/9'), allowedRoot: resolve('/srv/d/repos/3'), sandbox: sb,
    secretEnv: { CLAUDE_CODE_OAUTH_TOKEN: TOK_A } }, { parentEnv: { PATH: '/usr/bin' }, hasBwrap: () => true, resolveBin: () => '/usr/local/bin/claude-x' });
  assert.equal(l.command, 'nice');
  assert.deepEqual(l.args.slice(0, 4), ['-n', '10', 'bwrap', '--die-with-parent']);
  assert.ok(!l.args.join(' ').includes(TOK_A));
  assert.equal(l.env.CLAUDE_CODE_OAUTH_TOKEN, TOK_A);
  assert.ok(l.args.includes('/usr/local/bin/claude-x'), 'chemin réel de l\'exécutable (lien symbolique résolu)');
});

test('bwrap : répertoire hors du dossier de l\'utilisateur, bwrap absent, production sans bac à sable — exécution refusée', () => {
  const base = { bin: 'claude', args: ['-p', 'x'] };
  const ok = { enabled: true, production: true, bwrapBin: 'bwrap', roBinds: [], serverHome: '/h' };
  const deps = { parentEnv: { PATH: '/usr/bin' }, hasBwrap: () => true, resolveBin: () => '/usr/bin/claude' };
  const root = resolve('/srv/d/repos/3');
  assert.throws(() => prepareLaunch({ ...base, sandbox: ok, cwd: resolve('/srv/d/repos/4/1'), allowedRoot: root }, deps), /hors du dossier/);
  assert.throws(() => prepareLaunch({ ...base, sandbox: ok, cwd: resolve('/srv/d/repos/3/../4/1'), allowedRoot: root }, deps), /hors du dossier/);
  assert.throws(() => prepareLaunch({ ...base, sandbox: ok, cwd: resolve('/srv/d/repos/33'), allowedRoot: root }, deps), /hors du dossier/, 'préfixe de nom ≠ sous-dossier');
  assert.throws(() => prepareLaunch({ ...base, sandbox: ok }, { ...deps, hasBwrap: () => false }), /bwrap/);
  assert.throws(() => prepareLaunch({ ...base, sandbox: { ...ok, enabled: false } }, deps), /obligatoire en production/);
  assert.throws(() => prepareLaunch({ ...base, sandbox: ok }, { ...deps, resolveBin: () => null }), /introuvable/);
  assert.throws(() => prepareLaunch({ ...base }, deps), /bac à sable/);
  // Développement + bwrap activé mais absent : on refuse plutôt que d'exécuter sans isolation
  assert.throws(() => prepareLaunch({ ...base, sandbox: { ...ok, production: false } }, { ...deps, hasBwrap: () => false }), /bwrap/);
  // Développement avec SANDBOX=off : exécution directe, HOME jetable nettoyé
  const dev = prepareLaunch({ ...base, sandbox: { enabled: false, production: false, serverHome: '/h' } }, deps);
  assert.equal(dev.sandboxed, false);
  assert.notEqual(dev.env.HOME, '/h');
  dev.cleanup();
  assert.ok(isInside(root, join(root, '5')) && !isInside(root, resolve('/srv/d/repos')));
});

test('production : le wrapper refuse de lancer un job sans bwrap (même avec SANDBOX=off)', async () => {
  const a = await s.newUser({ admin: false, link: apiKeyLink(KEY_A) });
  const real = s.app.cfg.sandbox;
  try {
    s.app.cfg.sandbox = { enabled: true, production: true, bwrapBin: join(tmp, 'bwrap-inexistant'), roBinds: [], serverHome: tmp };
    await assert.rejects(makeClaude(s.app)(a.id, { prompt: 'x' }), /bwrap/);
    s.app.cfg.sandbox = { enabled: false, production: true, bwrapBin: 'bwrap', roBinds: [], serverHome: tmp };
    await assert.rejects(makeClaude(s.app)(a.id, { prompt: 'x' }), /obligatoire en production/);
  } finally { s.app.cfg.sandbox = real; }
});

test('configuration : NODE_ENV=production impose le bac à sable, SANDBOX=off seulement en développement, drapeau du mode abonnement', () => {
  const keep = { ...process.env };
  Object.assign(process.env, { SECRET_KEY: 'a'.repeat(64), APP_URL: 'https://x.test', GOOGLE_CLIENT_ID: 'i', GOOGLE_CLIENT_SECRET: 's', DB_HOST: 'h', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'n' });
  try {
    const cfg = (env) => { for (const k of ['NODE_ENV', 'SANDBOX', 'CLAUDE_CLI_MODE_ENABLED']) delete process.env[k]; Object.assign(process.env, env); return loadConfig(); };
    assert.equal(cfg({}).cliModeEnabled, true, 'activé par défaut');
    for (const v of ['false', 'FALSE', '0', 'off', 'no']) assert.equal(cfg({ CLAUDE_CLI_MODE_ENABLED: v }).cliModeEnabled, false, v);
    assert.equal(cfg({ CLAUDE_CLI_MODE_ENABLED: 'true' }).cliModeEnabled, true);
    assert.deepEqual([cfg({}).sandbox.enabled, cfg({}).sandbox.production], [true, false]);
    assert.equal(cfg({ SANDBOX: 'off' }).sandbox.enabled, false, 'développement : désactivable');
    const prod = cfg({ NODE_ENV: 'production', SANDBOX: 'off' }).sandbox;
    assert.deepEqual([prod.enabled, prod.production, prod.offIgnored], [true, true, true]);
    assert.deepEqual(cfg({ SANDBOX_RO_BINDS: '/opt/node, /opt/claude' }).sandbox.roBinds, ['/opt/node', '/opt/claude']);
  } finally { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); }
});

// ---------- Clones git ----------

test('git : https uniquement — file://, ext::, ssh, git://, http:// refusés avant tout lancement', async () => {
  const dir = join(tmp, 'clone-refuse');
  for (const url of ['file:///etc/passwd', 'ext::sh -c touch% /tmp/pwn', 'ssh://git@h.test/a/b.git', 'git://h.test/a/b.git', 'http://h.test/a/b.git', 'git@h.test:a/b.git', '/srv/local/repo', 'https://u:p@h.test/a/b.git']) {
    assert.throws(() => validateGitUrl(url), /URL Git invalide|https|identifiants/, url);
    await assert.rejects(syncRepo(url, dir, null), /Git :/, url);
  }
  assert.equal(validateGitUrl('https://git.tony-averty.dev/Tony/A.git', 'git.tony-averty.dev'), 'https://git.tony-averty.dev/Tony/A.git');
});

test('git : environnement assaini, GIT_ALLOW_PROTOCOL=https, pas de hooks ni de sous-modules, token hors argv', () => {
  const keep = process.env.SECRET_KEY;
  process.env.SECRET_KEY = 'SERVEUR-SECRET';
  try {
    const env = gitEnv('tok-forgejo');
    assert.equal(env.GIT_ALLOW_PROTOCOL, 'https');
    assert.equal(env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(env.GIT_CONFIG_VALUE_0, 'Authorization: token tok-forgejo');
    assert.equal(env.SECRET_KEY, undefined);
    assert.ok(!Object.keys(env).some((k) => /^(DB_|GOOGLE_|APPLE_)/.test(k)));
    assert.equal(gitEnv(null).GIT_CONFIG_COUNT, undefined);
  } finally { if (keep === undefined) delete process.env.SECRET_KEY; else process.env.SECRET_KEY = keep; }
  const joined = GIT_HARDENING.join(' ');
  assert.match(joined, /protocol\.allow=never/);
  assert.match(joined, /protocol\.https\.allow=always/);
  assert.match(joined, /core\.hooksPath=/);
  assert.match(joined, /submodule\.recurse=false/);
  for (const args of [cloneArgs('https://h.test/a/b.git', '/d'), fetchArgs()]) {
    assert.ok(args.includes('--no-recurse-submodules'));
    assert.ok(args.includes('--depth'));
    assert.ok(!args.join(' ').includes('tok-forgejo'));
  }
});

test('git réel : avec ce durcissement, un dépôt local (file) ne peut pas être cloné', () => {
  const src = join(tmp, 'src-repo');
  execFileSync('git', ['init', '-q', '-b', 'main', src]);
  writeFileSync(join(src, 'a.txt'), 'x');
  execFileSync('git', ['-C', src, 'add', '.']);
  execFileSync('git', ['-C', src, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'c']);
  assert.throws(() => execFileSync('git', cloneArgs(`file://${src}`, join(tmp, 'dest')), { env: gitEnv(null), stdio: 'pipe' }), (e) => /not allowed|protocol/i.test(String(e.stderr)));
  assert.throws(() => execFileSync('git', cloneArgs(src, join(tmp, 'dest2')), { env: gitEnv(null), stdio: 'pipe' }), (e) => /not allowed|protocol/i.test(String(e.stderr)));
});

test('git : taille d\'un dossier mesurée avec coupe-circuit', () => {
  const d = join(tmp, 'sz');
  mkdirSync(join(d, 'sub'), { recursive: true });
  writeFileSync(join(d, 'a'), Buffer.alloc(1000));
  writeFileSync(join(d, 'sub', 'b'), Buffer.alloc(2000));
  assert.equal(dirSize(d), 3000);
  assert.ok(dirSize(d, 500) > 500, 'dépasse la limite : mesure interrompue');
});

// ---------- Quota, budget, notifications par utilisateur ----------

test('quota : chaque utilisateur voit le sien, celui du CLI de A n\'apparaît jamais chez B', async () => {
  s.app.cfg.claudeBin = resolve('test/fixtures/fake-claude.js');
  const a = await s.newUser({ admin: false, link: tokenLink(TOK_A) }); // jeton « HOT » : le faux CLI remonte 90 % sur la session
  const b = await s.newUser({ admin: false, link: tokenLink(TOK_B) }); // 33 %
  const pa = await project(a), pb = await project(b);
  const w = new Worker(s.db, makeHandlers(s.app), {
    log: { error() {} }, quota: (uid) => quotaState(s.db, uid), isQuotaSensitive, isAiJob: (t) => AI_JOBS.has(t), budget: (uid) => budgetState(s.db, uid),
  });
  await enqueue(s.db, { userId: a.id, projectId: pa, type: 'template' });
  await enqueue(s.db, { userId: b.id, projectId: pb, type: 'template' });
  while (await w.tick()) { /* vide la file */ }

  const rl = async (u) => (await (await u.get('/api/system')).json()).claudeRateLimit;
  assert.equal((await rl(a)).fiveHour.utilization, 0.9);
  assert.equal((await rl(b)).fiveHour.utilization, 0.33);
  assert.equal((await quotaState(s.db, a.id)).blocked, true);
  assert.equal((await quotaState(s.db, b.id)).blocked, false);

  // A est serré : son analyse attend ; celle de B part, et le template de A (non sensible) aussi
  await s.db.prepare("UPDATE jobs SET status = 'cancelled' WHERE status = 'queued'").run();
  const done = [];
  const w2 = new Worker(s.db, { analyze: async (ctx) => { done.push(ctx.job.user_id); return {}; } }, {
    log: { error() {} }, quota: (uid) => quotaState(s.db, uid), isQuotaSensitive, isAiJob: (t) => AI_JOBS.has(t),
  });
  await enqueue(s.db, { userId: a.id, projectId: pa, type: 'analyze' });
  await enqueue(s.db, { userId: b.id, projectId: pb, type: 'analyze' });
  while (await w2.tick()) { /* vide la file */ }
  assert.deepEqual(done, [b.id], 'seul le job de B a tourné');
  assert.equal((await s.db.prepare("SELECT status FROM jobs WHERE user_id = ? AND type = 'analyze'").get(a.id)).status, 'queued');
  assert.match(JSON.parse((await s.db.prepare("SELECT progress_json FROM jobs WHERE user_id = ? AND type = 'analyze'").get(a.id)).progress_json).message, /En attente/);
  await w2.idle();
});

test('budget et usage IA : par utilisateur', async () => {
  const a = await s.newUser({ admin: false, link: apiKeyLink(KEY_A) });
  const b = await s.newUser({ admin: false, link: apiKeyLink(KEY_B) });
  await setSetting(s.db, a.id, 'budget_day_usd', '1');
  await s.db.prepare("INSERT INTO jobs(user_id, type, status, created_at, finished_at, cost_usd) VALUES(?, 'analyze', 'done', ?, ?, 2.5)").run(a.id, now(), now());
  assert.equal((await budgetState(s.db, a.id)).blocked, true);
  assert.equal((await budgetState(s.db, b.id)).blocked, false);
  assert.equal((await (await b.get('/api/system')).json()).usage.day.cost, 0);
});

test('mode clé API : pas de barre de quota d\'abonnement, rien n\'est enregistré', async () => {
  s.app.cfg.claudeBin = resolve('test/fixtures/fake-claude.js');
  const a = await s.newUser({ admin: false, link: apiKeyLink(KEY_A) });
  const r = await makeClaude(s.app)(a.id, { prompt: 'bonjour', maxTurns: 1, tools: [] });
  assert.ok(r.rateLimit, 'le faux CLI remonte bien un quota');
  assert.equal(await getSetting(s.db, a.id, 'claude_rate_limit_json'), null, 'non enregistré en mode clé API');
  // Même une valeur résiduelle n'est pas exposée
  await setSetting(s.db, a.id, 'claude_rate_limit_json', JSON.stringify({ fiveHour: { utilization: 0.99 } }));
  const sys = await (await a.get('/api/system')).json();
  assert.equal(sys.claudeRateLimit, null);
  assert.equal(sys.linkMode, 'api_key');
});

test('alertes de quota : envoyées au webhook de l\'utilisateur concerné seulement', async () => {
  s.app.cfg.claudeBin = resolve('test/fixtures/fake-claude.js');
  const sent = [];
  s.app.fetch = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 204 }; };
  const a = await s.newUser({ admin: false, link: tokenLink(TOK_A) });
  const b = await s.newUser({ admin: false, link: tokenLink(TOK_A) });
  const hookA = 'https://discord.com/api/webhooks/123456789012345678/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const hookB = 'https://discord.com/api/webhooks/123456789012345678/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  await setSetting(s.db, a.id, 'discord_webhook_enc', encrypt(s.app.cfg.secretKey, hookA));
  await setSetting(s.db, b.id, 'discord_webhook_enc', encrypt(s.app.cfg.secretKey, hookB));
  await makeClaude(s.app)(a.id, { prompt: 'bonjour', maxTurns: 1, tools: [] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, hookA);
  assert.equal(await getSetting(s.db, b.id, 'claude_quota_notified_json'), null, 'B n\'a rien reçu ni mémorisé');
  delete s.app.fetch;
});

test('diagnostic d\'un échec Claude : forme du secret et contenu du dépôt, jamais la valeur', () => {
  const dir = mkdtempSync(join(tmpdir(), 'diag-'));
  writeFileSync(join(dir, 'CLAUDE.md'), 'x');
  mkdirSync(join(dir, '.claude'));
  const token = `sk-ant-oat01-${'T'.repeat(40)}`;
  const line = claudeDiagnostic({
    userId: 7, cred: { mode: 'subscription_token', secretEnv: { CLAUDE_CODE_OAUTH_TOKEN: token } },
    cfg: { sandbox: { enabled: true, production: true } }, cwd: dir, r: { subtype: 'success' },
  });
  assert.match(line, /user=7 mode=subscription_token secret=CLAUDE_CODE_OAUTH_TOKEN\(len=53,propre\)/);
  assert.match(line, /bac_a_sable=oui\(prod\)/);
  assert.match(line, /fichiers_claude_du_depot=(\.claude,CLAUDE\.md|CLAUDE\.md,\.claude)/);
  assert.ok(!line.includes(token) && !line.includes('TTTTTT'), 'aucune valeur secrète dans la ligne');
  const dirty = claudeDiagnostic({ userId: 7, cred: { mode: 'subscription_token', secretEnv: { CLAUDE_CODE_OAUTH_TOKEN: `${token}\u001b(B` } }, cfg: { sandbox: {} }, cwd: null, r: { subtype: 'success' } });
  assert.match(dirty, /CARACTERES_PARASITES/);
  assert.match(claudeDiagnostic({ userId: 1, cred: { mode: 'server', secretEnv: {} }, cfg: {}, cwd: null, r: {} }), /secret=AUCUN/);
  rmSync(dir, { recursive: true, force: true });
});
