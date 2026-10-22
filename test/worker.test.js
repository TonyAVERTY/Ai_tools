import { test } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { addUser } from './helpers/users.js';
import { Worker, enqueue, latestJobs } from '../src/services/jobs.js';

async function setup() {
  const db = await testDb();
  const u = await addUser(db);
  await db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'p', 'u', ?)").run(u, now());
  db.userId = u;
  return db;
}

test('start puis stop : la boucle s\'arrête, le job en cours est annulé et attendu', async () => {
  const db = await setup();
  let started;
  const running = new Promise((r) => { started = r; });
  const w = new Worker(db, {
    prospect: (ctx) => new Promise((_, reject) => {
      started();
      ctx.signal.addEventListener('abort', () => reject(new Error('Annulé')), { once: true });
    }),
  }, { pollMs: 10, log: { error() {} } });
  await enqueue(db, { userId: db.userId, projectId: 1, type: 'prospect' });
  await w.start();
  await running;
  await w.stop();
  assert.equal(w.running.size, 0);
  const job = (await latestJobs(db, 1)).prospect;
  assert.equal(job.status, 'error');
  assert.match(job.error, /Annulé/);
});

test('stop attend les notifications en vol, et un callback qui échoue est journalisé', async () => {
  const db = await setup();
  const seen = [];
  const errors = [];
  const w = new Worker(db, { prospect: async () => ({ ok: true }), evolution: async () => { throw new Error('boum'); } }, {
    pollMs: 10, log: { error: (...a) => errors.push(a.join(' ')) },
    onFinish: async (job, r) => {
      await new Promise((res) => setTimeout(res, 30));
      seen.push(`${job.type}:${r.status}`);
      if (job.type === 'evolution') throw new Error('notification cassée');
    },
  });
  await enqueue(db, { userId: db.userId, projectId: 1, type: 'prospect' });
  await enqueue(db, { userId: db.userId, projectId: 1, type: 'evolution' });
  await w.tick(); await w.tick();
  assert.deepEqual(seen, [], 'les notifications ne bloquent pas la file');
  await w.stop();
  assert.deepEqual(seen.sort(), ['evolution:error', 'prospect:done']);
  assert.ok(errors.some((e) => /notification cassée/.test(e)));
});

test('un job "running" laissé par un crash est marqué en erreur au démarrage', async () => {
  const db = await setup();
  await db.prepare("INSERT INTO jobs(user_id, project_id, type, status, created_at) VALUES(?, 1, 'analyze', 'running', ?)").run(db.userId, now());
  const w = new Worker(db, {}, { pollMs: 10, log: { error() {} } });
  await w.start();
  await w.stop();
  const job = (await latestJobs(db, 1)).analyze;
  assert.equal(job.status, 'error');
  assert.equal(job.error, 'Interrompu (redémarrage)');
});
