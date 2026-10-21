import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { runClaude, extractJson } from '../src/services/claude.js';
import { waitCool } from '../src/services/thermal.js';
import { openDb, now } from '../src/db.js';
import { enqueue, Worker, latestJobs, cancelJob, addUsage, usageSummary } from '../src/services/jobs.js';

const bin = resolve('test/fixtures/fake-claude.js');

test('runClaude parse le flux et la conso', async () => {
  const seen = [];
  const r = await runClaude({ bin, prompt: 'hello', model: 'haiku', maxTurns: 3, tools: ['Read', 'Grep'], onText: (t) => seen.push(t) });
  assert.equal(r.ok, true);
  assert.equal(r.costUsd, 0.0123);
  assert.equal(r.tokensIn, 150);
  assert.equal(r.tokensOut, 20);
  const j = extractJson(r.text);
  assert.ok(j.args.includes('--max-turns') && j.args.includes('3'));
  assert.ok(j.args.includes('Read,Grep'));
  assert.ok(j.args.join(' ').includes('Bash,Edit,Write'));
  assert.equal(seen.length, 1);
});

test('runClaude remonte une erreur si le process meurt', async () => {
  await assert.rejects(runClaude({ bin, prompt: 'CRASH' }), /sans résultat/);
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
  const db = openDb(':memory:');
  db.prepare("INSERT INTO projects(name, git_url, created_at) VALUES('p','u',?)").run(now());
  const a = enqueue(db, { projectId: 1, type: 'ok', params: { x: 2 } });
  assert.equal(enqueue(db, { projectId: 1, type: 'ok' }).existing, true);
  const handlers = {
    ok: async (ctx) => { ctx.progress({ found: 1 }); addUsage(ctx, { costUsd: 0.5, tokensIn: 10, tokensOut: 5 }); return { double: ctx.params.x * 2 }; },
    boom: async () => { throw new Error('raté'); },
  };
  const w = new Worker(db, handlers, { thermalMax: 999, log: { error() {} } });
  assert.equal(await w.tick(), true);
  enqueue(db, { projectId: 1, type: 'boom' });
  await w.tick();
  const c = enqueue(db, { projectId: 1, type: 'ok' });
  cancelJob(db, c.id);
  assert.equal(await w.tick(), false);
  const jobs = latestJobs(db, 1);
  assert.equal(a.id, 1);
  assert.equal(jobs.boom.status, 'error');
  assert.equal(jobs.boom.error, 'raté');
  assert.equal(jobs.ok.status, 'cancelled');
  const first = db.prepare('SELECT * FROM jobs WHERE id = 1').get();
  assert.equal(first.status, 'done');
  assert.deepEqual(JSON.parse(first.result_json), { double: 4 });
  assert.equal(usageSummary(db).month.cost, 0.5);
});
