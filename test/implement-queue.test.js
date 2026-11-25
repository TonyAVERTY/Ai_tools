// Les implémentations d'idées acceptées s'enchaînent : une seule à la fois par projet, les suivantes attendent leur tour (au lieu d'être refusées).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { now } from '../src/db.js';
import { encrypt } from '../src/crypto.js';
import { Worker, enqueue, latestJobs } from '../src/services/jobs.js';

let s, u, pid, pid2;
before(async () => {
  s = await startApp();
  const link = { v: 1, provider: 'claude', mode: 'api_key', valid: true, last4: 'WXYZ', linked_at: 1000, secret_enc: encrypt(s.app.cfg.secretKey, `sk-ant-${'A'.repeat(40)}`) };
  u = await s.newUser({ admin: false, link });
  const mk = async (name) => Number((await s.db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(u.id, name, `https://git.test/u${u.id}/${name}.git`, now())).lastInsertRowid);
  pid = await mk('p1'); pid2 = await mk('p2');
});
after(() => s.close());

const add = (projectId, n) => enqueue(s.db, { userId: u.id, projectId, type: 'implement', params: { evo: 1, n, target: 'branch' } }, { cliModeEnabled: true });
const statuses = async (projectId) => (await s.db.prepare("SELECT id, status FROM jobs WHERE project_id = ? AND type = 'implement' ORDER BY id").all(projectId)).map((r) => r.status);

test('enqueue : une autre idée s\'empile, la même idée n\'est pas dupliquée', async () => {
  const a = await add(pid, 1);
  const b = await add(pid, 2);
  assert.equal(a.existing, false);
  assert.equal(b.existing, false, 'une autre idée attend son tour');
  assert.notEqual(a.id, b.id);
  const again = await add(pid, 1);
  assert.equal(again.existing, true, 'la même idée est déjà dans la file');
  assert.equal(again.id, a.id);
});

test('worker : même avec une offre qui permet plusieurs jobs, deux implémentations d\'un projet ne tournent jamais ensemble', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const started = [];
  const handlers = { implement: async (ctx) => { started.push(ctx.job.id); await gate; return { ok: true }; } };
  const worker = new Worker(s.db, handlers, { log: { error() {} }, parallel: async () => 5, cliModeEnabled: true });
  const first = worker.tick();           // réserve la 1re et attend la porte
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(await statuses(pid), ['running', 'queued']);
  // Un autre passage ne doit PAS lancer la 2e du même projet, et la dit en attente
  assert.equal(await worker.claim(), null, 'la suivante attend');
  const waiting = await s.db.prepare("SELECT progress_json FROM jobs WHERE project_id = ? AND type = 'implement' AND status = 'queued'").get(pid);
  assert.match(JSON.parse(waiting.progress_json).message, /une autre implémentation de ce projet est en cours/);
  // Un autre projet du même compte n'est pas bloqué
  await add(pid2, 1);
  const other = await worker.claim();
  assert.equal(other?.project_id, pid2, 'un autre projet passe');
  worker.running.set(other.id, { job: other, ctrl: new AbortController() });
  // La zone des tâches montre celle qui tourne, pas la dernière demandée
  assert.equal((await latestJobs(s.db, pid)).implement.status, 'running');
  release();
  await first;
  worker.running.delete(other.id);
  await s.db.prepare("UPDATE jobs SET status = 'done' WHERE id = ?").run(other.id);
  // La première finie, la suivante peut partir
  const next = await worker.claim();
  assert.equal(next?.project_id, pid, 'la 2e idée du projet démarre après la 1re');
  assert.equal(started.length, 1);
});

test('continuer : « Réessayer » une implémentation la reprend ; le contenu gardé ne part pas à l\'écran ; la reprise reste dans son projet', async () => {
  const { retryJob } = await import('../src/services/jobs.js');
  const { loadResume } = await import('../src/handlers.js');
  const failed = Number((await s.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, error, params_json, result_json, created_at) VALUES(?, ?, 'implement', 'error', 'délai dépassé', ?, ?, ?)")
    .run(u.id, pid2, JSON.stringify({ evo: 9, n: 3, target: 'branch' }), JSON.stringify({ partial: { files: [{ path: 'src/a.js', content: 'SECRET-CONTENU-DE-FICHIER' }] } }), now())).lastInsertRowid);
  await s.db.prepare("UPDATE jobs SET status = 'done' WHERE project_id = ? AND type = 'implement' AND status IN ('running','queued')").run(pid2);
  const view = (await latestJobs(s.db, pid2)).implement;
  assert.deepEqual(view.result, { partial: { files: ['src/a.js'] } }, 'seuls les chemins sortent');
  assert.ok(!JSON.stringify(view).includes('SECRET-CONTENU'));
  const r = await retryJob(s.db, u.id, failed, { cliModeEnabled: true });
  assert.equal(r.existing, false);
  assert.equal(JSON.parse((await s.db.prepare('SELECT params_json FROM jobs WHERE id = ?').get(r.id)).params_json).resume, failed);
  assert.deepEqual(await loadResume(s.db, pid2, failed), { files: [{ path: 'src/a.js', content: 'SECRET-CONTENU-DE-FICHIER' }], reason: 'délai dépassé' });
  assert.equal(await loadResume(s.db, pid, failed), null, 'jamais la reprise d\'un autre projet');
  assert.equal(await loadResume(s.db, pid2, 999999), null);
});
