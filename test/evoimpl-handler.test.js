import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setSetting, now } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { Worker, enqueue, latestJobs } from '../src/services/jobs.js';
import { makeHandlers } from '../src/handlers.js';
import { createProject } from '../src/projects.js';
import { encrypt } from '../src/crypto.js';
import { addUser, TEST_SECRET_KEY } from './helpers/users.js';

const MD = (title) => `### 1. ${title}\n- **Pourquoi** : utile\n- **Effort** : S\n- **Pistes techniques** : x\n`;

async function setup({ token = true, edit = false } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'aitools-evoimpl-'));
  const src = join(tmp, 'src-repo');
  execFileSync('git', ['init', '-q', '-b', 'main', src]);
  writeFileSync(join(src, 'README.md'), '# MonEspacePro\n');
  execFileSync('git', ['-C', src, 'add', '.']);
  execFileSync('git', ['-C', src, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  const db = await testDb();
  const pushes = [];
  const app = {
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }], db,
    cfg: { dataDir: tmp, claudeBin: resolve('test/fixtures/fake-claude.js'), sandbox: { enabled: false, production: false }, secretKey: TEST_SECRET_KEY, appUrl: 'https://ai.test' },
    syncRepo: async (url, dir) => { execFileSync('git', ['clone', '-q', '--depth', '1', src, dir]); return 'abc'; },
    gitWrite: { defaultBranch: async () => 'main', commitAndPush: async (dir, o) => { pushes.push({ ...o, readme: readFileSync(join(dir, 'README.md'), 'utf8'), hasNew: existsSync(join(dir, 'src/export.js')) }); return 'deadbeefcafe0000'; } },
  };
  const userId = await addUser(db);
  if (token) await setSetting(db, userId, 'github_token_enc', encrypt(TEST_SECRET_KEY, 'ghp_AbCdEfTestTokenNotReal'));
  if (edit) await setSetting(db, userId, 'ai_code_edit', '1');
  const id = await createProject(app, { userId, name: 'MonEspacePro', gitUrl: 'https://github.com/o/r.git' });
  const worker = new Worker(db, makeHandlers(app), { log: { error: () => {} } });
  // Liste d'idées terminée + idée acceptée
  const evo = async (title) => {
    const j = Number((await db.prepare("INSERT INTO jobs(user_id, project_id, type, status, result_json, created_at) VALUES(?, ?, 'evolution', 'done', ?, ?)").run(userId, id, JSON.stringify({ markdown: MD(title) }), now())).lastInsertRowid);
    await db.prepare("INSERT INTO evolution_decisions(job_id, n, user_id, project_id, status, reason, decided_by, decided_at) VALUES(?, 1, ?, ?, 'accepted', 'bonne idée', ?, ?)").run(j, userId, id, userId, now());
    return j;
  };
  const run = async (evoJob, target = 'branch') => { await enqueue(db, { userId, projectId: id, type: 'implement', params: { evo: evoJob, n: 1, target } }); await worker.tick(); return (await latestJobs(db, id)).implement; };
  return { tmp, db, app, id, userId, pushes, evo, run };
}

test('implémentation (mode texte) : les modifications sont appliquées puis commitées sur une nouvelle branche', async () => {
  const s = await setup();
  const j = await s.evo('Export CSV');
  const r = await s.run(j);
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.result.mode, 'patch');
  assert.match(r.result.branch, /^iaboss\/export-csv-\d+$/);
  assert.equal(r.result.target, 'branch');
  assert.deepEqual([...r.result.files].sort(), ['README.md', 'src/export.js']);
  assert.equal(r.result.commit, 'deadbeefcafe0000');
  assert.equal(r.result.url, `https://github.com/o/r/tree/${r.result.branch}`);
  assert.equal(s.pushes.length, 1);
  assert.equal(s.pushes[0].createBranch, true);
  assert.match(s.pushes[0].readme, /Export CSV disponible/);
  assert.match(s.pushes[0].message, /^feat: Export CSV\n\nIdée d'évolution acceptée dans iaboss, implémentée par l'IA du projet/);
  assert.ok(!JSON.stringify(r.result).includes('AbCdEfTestTokenNotReal'), 'jamais de token dans le résultat');
  // les clones jetables sont effacés
  assert.deepEqual(readdirSync(join(s.tmp, 'repos', String(s.userId))).filter((d) => /-(impl|work)-/.test(d)), []);
});

test('implémentation directement sur la branche principale : pas de nouvelle branche', async () => {
  const s = await setup();
  const r = await s.run(await s.evo('Export CSV'), 'default');
  assert.equal(r.status, 'done', r.error);
  assert.equal(r.result.branch, 'main');
  assert.equal(r.result.target, 'default');
  assert.equal(s.pushes[0].createBranch, false);
});

test('implémentation : fichier interdit, secret, réponse illisible ou idée non acceptée : rien n\'est poussé', async () => {
  const s = await setup();
  const bad = await s.run(await s.evo('IMPLBAD'));
  assert.equal(bad.status, 'error');
  assert.match(bad.error, /Modifications refusées : Fichier interdit/);
  await s.db.prepare("UPDATE jobs SET status = 'done' WHERE type = 'implement'").run();
  const secret = await s.run(await s.evo('IMPLSECRET'));
  assert.match(secret.error, /ressemble à un secret/);
  assert.ok(!secret.error.includes('ghp_Zq9X'), 'la valeur n\'apparaît pas dans l\'erreur');
  await s.db.prepare("UPDATE jobs SET status = 'done' WHERE type = 'implement'").run();
  const junk = await s.run(await s.evo('IMPLJUNK'));
  assert.match(junk.error, /illisible/);
  await s.db.prepare("UPDATE jobs SET status = 'done' WHERE type = 'implement'").run();
  const j = await s.evo('Export CSV');
  await s.db.prepare("UPDATE evolution_decisions SET status = 'refused' WHERE job_id = ?").run(j);
  const refused = await s.run(j);
  assert.match(refused.error, /Idée introuvable ou plus acceptée/);
  assert.equal(s.pushes.length, 0, 'aucun push');
});

test('implémentation sans token Git : refus clair', async () => {
  const s = await setup({ token: false });
  const r = await s.run(await s.evo('Export CSV'));
  assert.match(r.error, /Aucun token Git/);
  assert.equal(s.pushes.length, 0);
});

test('réglage « écriture directe » : le code reprend ce que l\'IA a écrit dans sa copie, et refuse s\'il n\'y a rien', async () => {
  const s = await setup({ edit: true });
  const r = await s.run(await s.evo('Export CSV'));
  // Liaison des tests = Claude : le mode direct est choisi ; la fausse IA n'écrit aucun fichier : le code refuse
  assert.equal(r.status, 'error');
  assert.match(r.error, /aucun fichier|illisible|Modifications refusées/);
  assert.equal(s.pushes.length, 0);
});
