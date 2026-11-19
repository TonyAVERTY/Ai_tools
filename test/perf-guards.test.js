import { test } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../src/db.js';
import { testDb, USING_MYSQL } from './helpers/db.js';
import { addUser } from './helpers/users.js';
import { Worker, latestJobs, aiStats, usageSummary } from '../src/services/jobs.js';
import { createJobLog } from '../src/services/joblog.js';
import { activitySnapshot } from '../src/services/activity.js';

// Garde-fous de performance : ces tests comptent des écritures et des lectures. Ils échouent si une régression remet une requête par job
// dans la boucle du worker, ou une écriture du journal entier par ligne.

const project = async (db, userId) => Number((await db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'P', ?, ?)").run(userId, `https://g.test/${Math.random()}`, now())).lastInsertRowid);
const queue = async (db, userId, projectId, type, n) => { for (let i = 0; i < n; i++) await db.prepare("INSERT INTO jobs(user_id, project_id, type, params_json, created_at) VALUES(?, ?, ?, '{}', ?)").run(userId, projectId, type, now()); };

test('journal d\'un job : les lignes rapprochées sont regroupées, flush écrit tout de suite la dernière', async () => {
  const writes = [];
  const db = { prepare: () => ({ run: async (snapshot) => { writes.push(JSON.parse(snapshot)); } }) };
  const log = createJobLog(db, 1, [], { minIntervalMs: 10_000 });
  for (let i = 1; i <= 200; i++) log.append('progress', `Rendu de la vidéo : image ${i}/200`);
  await new Promise((r) => setImmediate(r));
  assert.equal(writes.length, 1, 'la première ligne part tout de suite, les 199 suivantes attendent');
  assert.equal(writes[0].length, 1);
  await log.flush();
  assert.equal(writes.length, 2, 'une seule écriture pour tout le reste');
  assert.equal(writes[1].at(-1).text, 'Rendu de la vidéo : image 200/200');
  assert.equal(writes[1].length, 200);
  await log.flush();
  assert.equal(writes.length, 2, 'rien à écrire : aucune écriture');
});

test('journal d\'un job : sans flush, les lignes en attente partent seules après le délai', async () => {
  const writes = [];
  const db = { prepare: () => ({ run: async (snapshot) => { writes.push(JSON.parse(snapshot)); } }) };
  const log = createJobLog(db, 1, [], { minIntervalMs: 30 });
  log.append('status', 'un');
  log.append('status', 'deux');
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(writes.at(-1).map((e) => e.text), ['un', 'deux']);
});

test('journal d\'un job : une écriture en échec n\'empêche pas la suivante, et flush la signale', async () => {
  let fail = true;
  const writes = [];
  const db = { prepare: () => ({ run: async (snapshot) => { if (fail) throw new Error('base occupée'); writes.push(JSON.parse(snapshot)); } }) };
  const log = createJobLog(db, 1, [], { minIntervalMs: 0 });
  log.append('status', 'un');
  await assert.rejects(log.flush(), /base occupée/);
  fail = false;
  log.append('status', 'deux');
  await log.flush();
  assert.deepEqual(writes.at(-1).map((e) => e.text), ['un', 'deux'], 'le journal complet est écrit ensuite');
});

test('worker : budget, quota et offre sont lus une fois par compte et par passage, pas une fois par job', async () => {
  const db = await testDb();
  const a = await addUser(db), b = await addUser(db);
  const pa = await project(db, a), pb = await project(db, b);
  await queue(db, a, pa, 'tache_ia', 8);
  await queue(db, b, pb, 'tache_ia', 3);
  const calls = { budget: [], quota: [], parallel: [] };
  const w = new Worker(db, {}, {
    load: async () => 0, log: { error() {} },
    parallel: async (id) => { calls.parallel.push(id); return 1; },
    budget: async (id) => { calls.budget.push(Number(id)); return { blocked: true, reason: 'budget atteint' }; },
    quota: async (id) => { calls.quota.push(Number(id)); return { blocked: false }; },
    isAiJob: () => true, isQuotaSensitive: () => true,
  });
  assert.equal(await w.claim(), null, 'budget atteint : rien ne part');
  assert.deepEqual(calls.budget.sort(), [a, b].sort(), 'un appel par compte pour 11 jobs');
  assert.equal(calls.parallel.length, 2);
  const held = await db.prepare("SELECT COUNT(*) n FROM jobs WHERE progress_json LIKE '%budget atteint%'").get();
  assert.equal(Number(held.n), 11, 'chaque job dit pourquoi il attend');
});

test('worker : un envoi de mails ne lit ni le budget ni le quota (ils ne concernent que les jobs IA)', async () => {
  const db = await testDb();
  const u = await addUser(db);
  await queue(db, u, await project(db, u), 'send', 1);
  let read = 0;
  const w = new Worker(db, {}, {
    load: async () => 0, log: { error() {} },
    budget: async () => { read++; return { blocked: true, reason: 'x' }; }, quota: async () => { read++; return { blocked: true, reason: 'x' }; },
    isAiJob: (t) => t !== 'send', isQuotaSensitive: (t) => t !== 'send',
  });
  const job = await w.claim();
  assert.equal(job?.type, 'send', 'l\'envoi part même budget atteint');
  assert.equal(read, 0);
});

test('page projet : le journal d\'un job terminé n\'est pas relu, celui d\'un job en cours sert à estimer la fin', async () => {
  const db = await testDb();
  const u = await addUser(db);
  const p = await project(db, u);
  const big = JSON.stringify([{ id: 1, at: Date.now(), kind: 'progress', text: 'x'.repeat(5000) }]);
  await db.prepare("INSERT INTO jobs(user_id, project_id, type, status, params_json, log_json, result_json, created_at, started_at, finished_at) VALUES(?, ?, 'audit', 'done', '{}', ?, ?, ?, ?, ?)").run(u, p, big, JSON.stringify({ markdown: 'ok' }), now(), now(), now());
  await db.prepare("INSERT INTO jobs(user_id, project_id, type, status, params_json, log_json, created_at, started_at) VALUES(?, ?, 'analyze', 'running', '{}', ?, ?, ?)").run(u, p, big, now(), now());
  const read = [];
  const spy = { prepare: (sql) => { const st = db.prepare(sql); return { all: async (...args) => { const rows = await st.all(...args); if (/FROM jobs j/.test(sql)) read.push(...rows); return rows; }, get: (...args) => st.get(...args), run: (...args) => st.run(...args) }; } };
  const jobs = await latestJobs(spy, p);
  assert.equal(jobs.audit.result.markdown, 'ok');
  assert.equal(jobs.audit.status, 'done');
  assert.ok(jobs.analyze.eta, 'le job en cours garde son estimation');
  assert.equal(read.find((r) => r.type === 'audit').log_json, null);
  assert.ok(read.find((r) => r.type === 'analyze').log_json.length > 5000);
});

test('index de recherche : dernier job par projet et type, premier mail d\'un prospect', { skip: USING_MYSQL && 'plan de requête SQLite' }, async () => {
  const db = await testDb();
  const plan = async (sql) => (await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all()).map((r) => r.detail).join(' | ');
  assert.match(await plan('SELECT type, MAX(id) id FROM jobs WHERE project_id = 1 GROUP BY type'), /USING COVERING INDEX jobs_project_type/);
  assert.match(await plan("SELECT subject FROM mail_log WHERE prospect_id = 1 AND kind = 'initial' AND error IS NULL ORDER BY id LIMIT 1"), /USING INDEX mail_log_prospect/);
});

test('mesures des tâches IA : nombre, échecs, durée moyenne, tokens et coût, pour CE compte seulement et sans les envois', async () => {
  const db = await testDb();
  const u = await addUser(db), other = await addUser(db);
  const p = await project(db, u), po = await project(db, other);
  const t = now();
  const add = (userId, projectId, type, status, secs, extra = {}) => db.prepare('INSERT INTO jobs(user_id, project_id, type, status, params_json, tokens_in, tokens_out, cost_usd, created_at, started_at, finished_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(userId, projectId, type, status, '{}', extra.tin ?? 100, extra.tout ?? 50, extra.cost ?? 0.01, extra.at ?? t - 500, (extra.at ?? t - 500), (extra.at ?? t - 500) + secs);
  await add(u, p, 'analyze', 'done', 60);
  await add(u, p, 'template', 'done', 20);
  await add(u, p, 'audit', 'error', 100);
  await add(u, p, 'prospect', 'cancelled', 5);                       // annulée : ni réussite ni échec
  await add(u, p, 'send', 'done', 30);                               // envoi de mails : pas une tâche IA
  await add(u, p, 'analyze', 'done', 60, { at: t - 40 * 86400 });    // hors des 30 jours
  await add(other, po, 'analyze', 'error', 60);                      // un autre compte
  const a = await aiStats(db, u);
  assert.equal(a.jobs, 3);
  assert.equal(a.failed, 1);
  assert.ok(Math.abs(a.failureRate - 1 / 3) < 1e-9);
  assert.equal(a.avgSeconds, 60);
  assert.equal(a.tokens, 450);
  assert.equal(a.costUsd, 0.03);
  assert.equal(a.chatAnswers, 0);
  assert.deepEqual((await usageSummary(db, u)).ai, a, 'exposé avec la consommation du compte');
  const none = await aiStats(db, await addUser(db));
  assert.deepEqual(none, { jobs: 0, failed: 0, failureRate: null, avgSeconds: null, tokens: 0, costUsd: 0, chatAnswers: 0 });
});

test('relevé d\'activité (interrogé en boucle par le navigateur) : le journal d\'une tâche en échec ou en file n\'est pas relu', async () => {
  const db = await testDb();
  const u = await addUser(db);
  const p = await project(db, u);
  const big = JSON.stringify([{ id: 1, at: Date.now(), kind: 'progress', text: 'x'.repeat(8000) }]);
  await db.prepare("INSERT INTO jobs(user_id, project_id, type, status, error, params_json, log_json, created_at, started_at, finished_at) VALUES(?, ?, 'audit', 'error', 'échec', '{}', ?, ?, ?, ?)").run(u, p, big, now(), now(), now());
  await db.prepare("INSERT INTO jobs(user_id, project_id, type, status, params_json, log_json, created_at, started_at) VALUES(?, ?, 'analyze', 'running', '{}', ?, ?, ?)").run(u, p, big, now(), now());
  const read = [];
  const spy = { prepare: (sql) => { const st = db.prepare(sql); return { all: async (...args) => { const rows = await st.all(...args); if (/j\.params_json/.test(sql)) read.push(...rows); return rows; }, get: (...args) => st.get(...args), run: (...args) => st.run(...args) }; } };
  const snap = await activitySnapshot(spy, u);
  assert.deepEqual(snap.jobs.map((j) => `${j.type}:${j.status}`).sort(), ['analyze:running', 'audit:error']);
  assert.equal(snap.jobs.find((j) => j.type === 'audit').error, 'échec');
  assert.ok(snap.jobs.find((j) => j.type === 'analyze').eta, 'la tâche en cours garde son estimation');
  assert.equal(read.find((r) => r.type === 'audit').log_json, null);
  assert.ok(read.find((r) => r.type === 'analyze').log_json.length > 8000);
});
