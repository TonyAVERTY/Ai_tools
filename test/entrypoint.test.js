// Démarrage du serveur : lancé directement, par un lien, ou sous pm2 (argv[1] est alors celui de pm2, pas le fichier).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isEntryPoint } from '../src/entrypoint.js';

const SERVER = fileURLToPath(new URL('../src/server.js', import.meta.url));
const url = pathToFileURL(SERVER).href;

test('programme lancé : chemin direct, lien symbolique, pm2 ; sinon non', () => {
  assert.equal(isEntryPoint(url, ['node', SERVER], {}), true, 'node src/server.js');
  assert.equal(isEntryPoint(url, ['node', '/usr/lib/pm2/ProcessContainerFork.js'], { pm_exec_path: SERVER }), true, 'sous pm2 (fork)');
  assert.equal(isEntryPoint(url, ['node', '/usr/lib/pm2/ProcessContainerFork.js'], {}), false, 'chargé par un autre programme');
  assert.equal(isEntryPoint(url, ['node', '/autre/fichier.js'], { pm_exec_path: '/autre/fichier.js' }), false, 'pm2 qui lance un autre script');
  assert.equal(isEntryPoint(url, ['node'], {}), false, 'aucun argument');
  const dir = mkdtempSync(join(tmpdir(), 'ep-'));
  try {
    symlinkSync(SERVER, join(dir, 'lien.js'));
    assert.equal(isEntryPoint(url, ['node', join(dir, 'lien.js')], {}), true, 'lien symbolique vers le serveur');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Preuve de bout en bout : le serveur écoute quand un conteneur le charge avec pm_exec_path, et reste muet sans cette variable
function run(env) {
  const port = 41000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '-e', `import(${JSON.stringify(url)})`], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME || tmpdir(), APP_URL: `http://127.0.0.1:${port}`, PORT: String(port), HOST: '127.0.0.1', SECRET_KEY: 'ab'.repeat(32), GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', DB_DRIVER: 'sqlite', SANDBOX: 'off', DATA_DIR: mkdtempSync(join(tmpdir(), 'ep-data-')), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return { child, port, output: () => out };
}

test('sous un conteneur (pm_exec_path) le serveur démarre et répond', async () => {
  const r = run({ pm_exec_path: SERVER });
  try {
    const deadline = Date.now() + 20_000;
    while (!/iaboss sur http/.test(r.output()) && Date.now() < deadline) await new Promise((ok) => setTimeout(ok, 200));
    assert.match(r.output(), /iaboss sur http:\/\/127\.0\.0\.1:\d+/, r.output());
    const res = await fetch(`http://127.0.0.1:${r.port}/`, { redirect: 'manual' });
    assert.ok(res.status < 500, `HTTP ${res.status}`);
  } finally { r.child.kill('SIGKILL'); }
});

test('chargé comme simple module (sans pm2) le serveur ne démarre pas tout seul', async () => {
  const r = run({});
  try {
    await new Promise((ok) => setTimeout(ok, 2500));
    assert.doesNotMatch(r.output(), /iaboss sur http/);
  } finally { r.child.kill('SIGKILL'); }
});
