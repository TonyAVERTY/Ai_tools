import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { runClaude, extractJson, rateLimitWindows } from '../src/services/claude.js';
import { waitCool } from '../src/services/thermal.js';
import { now } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { addUser } from './helpers/users.js';
import { enqueue, Worker, latestJobs, cancelJob, addUsage, usageSummary } from '../src/services/jobs.js';

const bin = resolve('test/fixtures/fake-claude.js');
const sandbox = { enabled: false, production: false };

test('runClaude parse le flux et la conso', async () => {
  const seen = [];
  const r = await runClaude({ bin, sandbox, prompt: 'hello', model: 'haiku', maxTurns: 3, tools: ['Read', 'Grep'], onText: (t) => seen.push(t) });
  assert.equal(r.ok, true);
  assert.equal(r.costUsd, 0.0123);
  assert.equal(r.tokensIn, 150);
  assert.equal(r.tokensOut, 20);
  const j = extractJson(r.text);
  assert.ok(j.args.includes('--max-turns') && j.args.includes('3'));
  assert.ok(j.args.includes('Read,Grep'));
  assert.ok(j.args.join(' ').includes('Bash,Edit,Write'));
  assert.equal(seen.length, 1);
  assert.deepEqual(r.rateLimit.unifiedWindows.five_hour, { utilization: 0.33, resetsAt: 1_700_000_000 });
});

test('runClaude remonte une erreur si le process meurt', async () => {
  await assert.rejects(runClaude({ bin, sandbox, prompt: 'CRASH' }), /sans résultat/);
});

test('rateLimitWindows normalise la session (5h) et la semaine, quel que soit le format reçu', () => {
  assert.deepEqual(rateLimitWindows({ unifiedWindows: {
    five_hour: { utilization: 0.1, resetsAt: 111 },
    seven_day: { utilization: 0.2, resetsAt: 222 },
  } }), { fiveHour: { utilization: 0.1, resetsAt: 111 }, sevenDay: { utilization: 0.2, resetsAt: 222 } });
  // Une seule fenêtre présente : l'autre reste null plutôt que de tout rejeter
  assert.deepEqual(rateLimitWindows({ unifiedWindows: { five_hour: { utilization: 0.4 } } }),
    { fiveHour: { utilization: 0.4, resetsAt: null }, sevenDay: null });
  assert.equal(rateLimitWindows(null), null);
  assert.equal(rateLimitWindows({}), null);
  assert.equal(rateLimitWindows({ unifiedWindows: { five_hour: { utilization: 'beaucoup' } } }), null, 'valeur non numérique ignorée');
});

test('extractJson gère texte, fences et accolades dans les chaînes', () => {
  assert.deepEqual(extractJson('Voilà : {"a":"x}y","b":[1,{"c":2}]} fin'), { a: 'x}y', b: [1, { c: 2 }] });
  assert.deepEqual(extractJson('```json\n[1,2]\n```'), [1, 2]);
  assert.throws(() => extractJson('rien'), /Aucun JSON/);
});

test('waitCool attend la redescente avec hystérésis', async () => {
  const temps = [80, 78, 72, 69];
  let waits = 0;
  await waitCool(75, { read: () => temps.shift(), sleep: async () => {}, onWait: () => waits++ });
  assert.equal(waits, 3);
  await waitCool(75, { read: () => null });
});

test('worker : exécution, dédoublonnage, erreurs, annulation, conso', async () => {
  const db = await testDb();
  const u = await addUser(db);
  await db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'p','u',?)").run(u, now());
  const a = await enqueue(db, { userId: u, projectId: 1, type: 'ok', params: { x: 2 } });
  assert.equal((await enqueue(db, { userId: u, projectId: 1, type: 'ok' })).existing, true);
  const handlers = {
    ok: async (ctx) => { ctx.progress({ found: 1 }); addUsage(ctx, { costUsd: 0.5, tokensIn: 10, tokensOut: 5 }); return { double: ctx.params.x * 2 }; },
    boom: async () => { throw new Error('raté'); },
  };
  const w = new Worker(db, handlers, { thermalMax: 999, log: { error() {} } });
  assert.equal(await w.tick(), true);
  await enqueue(db, { userId: u, projectId: 1, type: 'boom' });
  await w.tick();
  const c = await enqueue(db, { userId: u, projectId: 1, type: 'ok' });
  await cancelJob(db, u, c.id);
  assert.equal(await w.tick(), false);
  const jobs = await latestJobs(db, 1);
  assert.equal(a.id, 1);
  assert.equal(jobs.boom.status, 'error');
  assert.equal(jobs.boom.error, 'raté');
  assert.equal(jobs.ok.status, 'cancelled');
  const first = await db.prepare('SELECT * FROM jobs WHERE id = 1').get();
  assert.equal(first.status, 'done');
  assert.deepEqual(JSON.parse(first.result_json), { double: 4 });
  assert.equal((await usageSummary(db, u)).month.cost, 0.5);
});
