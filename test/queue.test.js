import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { now } from '../src/db.js';
import { encrypt } from '../src/crypto.js';
import { testDb } from './helpers/db.js';
import { addUser } from './helpers/users.js';
import { startApp } from './helpers/server.js';
import { makeClaudeBin } from './helpers/claude-bin.js';
import { Worker, enqueue } from '../src/services/jobs.js';
import { makeHandlers } from '../src/handlers.js';
import { loadConfig } from '../src/config.js';

// File de jobs équitable et simultanée : plafond global, un job à la fois par utilisateur, tourniquet,
// réservation atomique, pause de charge, arrêt propre. Les jobs « prospect » et « evolution » des tests sont de simples
// fonctions instrumentées ; le dernier test lance le vrai circuit avec le CLI simulé.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = { error() {} };

async function world(n = 3) {
  const db = await testDb();
  const users = [];
  for (let i = 0; i < n; i++) {
    const id = await addUser(db);
    const p = Number((await db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'p', ?, ?)").run(id, `https://git.test/${id}.git`, now())).lastInsertRowid);
    users.push({ id, p });
  }
  return { db, users };
}
const q = (db, u, type) => enqueue(db, { userId: u.id, projectId: u.p, type }).then((r) => r.id);
async function until(fn, ms = 5000) {
  const t0 = Date.now();
  while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error('délai dépassé'); await sleep(10); }
}

test('plafond global : jamais plus de maxJobs en parallèle, jamais deux jobs du même utilisateur', async () => {
  const { db, users } = await world(3);
  let cur = 0, max = 0;
  const perUser = new Map(); let perUserMax = 0;
  const starts = [];
  const handler = async (ctx) => {
    cur++; max = Math.max(max, cur);
    const n = (perUser.get(ctx.job.user_id) || 0) + 1; perUser.set(ctx.job.user_id, n); perUserMax = Math.max(perUserMax, n);
    starts.push(ctx.job.user_id);
    await sleep(40);
    cur--; perUser.set(ctx.job.user_id, n - 1);
    return {};
  };
  for (const u of users) { await q(db, u, 'prospect'); await q(db, u, 'evolution'); }
  const w = new Worker(db, { prospect: handler, evolution: handler }, { maxJobs: 2, pollMs: 10, log });
  await w.start();
  await until(async () => (await db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')").get()).n === 0);
  await w.stop();
  assert.equal(max, 2, 'deux jobs en parallèle, pas plus');
  assert.equal(perUserMax, 1, 'jamais deux jobs du même utilisateur en même temps');
  assert.equal(starts.length, 6);
  // Tourniquet : le 3e utilisateur démarre avant que le 1er ne reçoive son 2e job
  const [a, b, c] = users.map((u) => u.id);
  assert.deepEqual(starts.slice(0, 3), [a, b, c]);
  assert.deepEqual(starts.slice(3), [a, b, c]);
});

test('un seul utilisateur avec beaucoup de jobs ne prend qu\'un emplacement, les autres passent', async () => {
  const { db, users } = await world(2);
  const order = [];
  const w = new Worker(db, {
    prospect: async (ctx) => { order.push(`${ctx.job.user_id}:${ctx.job.type}`); await sleep(60); return {}; },
    evolution: async (ctx) => { order.push(`${ctx.job.user_id}:${ctx.job.type}`); await sleep(60); return {}; },
    template: async (ctx) => { order.push(`${ctx.job.user_id}:${ctx.job.type}`); await sleep(60); return {}; },
  }, { maxJobs: 4, pollMs: 10, log });
  const [a, b] = users;
  await q(db, a, 'prospect'); await q(db, a, 'evolution'); await q(db, a, 'template');
  await q(db, b, 'prospect');
  await w.start();
  await until(async () => (await db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')").get()).n === 0);
  await w.stop();
  assert.equal(order[0], `${a.id}:prospect`);
  assert.equal(order[1], `${b.id}:prospect`, 'B part tout de suite, malgré la file de A et 4 emplacements libres');
  assert.deepEqual(order.filter((x) => x.startsWith(`${a.id}:`)), [`${a.id}:prospect`, `${a.id}:evolution`, `${a.id}:template`], 'ordre propre à l\'utilisateur conservé');
});

test('réservation atomique : deux workers sur la même base, un job n\'est réservé qu\'une fois', async () => {
  const { db, users } = await world(1);
  const [u] = users;
  const id = await q(db, u, 'prospect');
  const w1 = new Worker(db, {}, { log }), w2 = new Worker(db, {}, { log });
  const [j1, j2] = await Promise.all([w1.claim(), w2.claim()]);
  assert.equal([j1, j2].filter(Boolean).length, 1, 'un seul worker obtient le job');
  assert.equal((await db.prepare('SELECT status FROM jobs WHERE id = ?').get(id)).status, 'running');
  // Le second job du même utilisateur ne peut pas être réservé tant que le premier tourne (garde en base, pas seulement en mémoire)
  const id2 = await q(db, u, 'evolution');
  const intruder = (await db.prepare('SELECT * FROM jobs WHERE id = ?').get(id2));
  assert.equal(await new Worker(db, {}, { log }).reserve(intruder), false);
  assert.equal((await db.prepare('SELECT status FROM jobs WHERE id = ?').get(id2)).status, 'queued');
  // Et un job déjà réservé ne l'est pas deux fois
  assert.equal(await new Worker(db, {}, { log }).reserve({ id, user_id: 999 }), false);
});

test('claim() appelé en rafale : le plafond et l\'unicité par utilisateur tiennent', async () => {
  const { db, users } = await world(5);
  for (const u of users) { await q(db, u, 'prospect'); await q(db, u, 'evolution'); }
  const w = new Worker(db, {}, { maxJobs: 3, log });
  const got = (await Promise.all(Array.from({ length: 12 }, () => w.claim()))).filter(Boolean);
  assert.equal(got.length, 3);
  assert.equal(new Set(got.map((j) => j.user_id)).size, 3, 'trois utilisateurs différents');
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM jobs WHERE status = 'running'").get()).n, 3);
});

test('jobs programmés : ni avant l\'heure, ni dans le désordre ; l\'ordre par id est conservé après', async () => {
  const { db, users } = await world(2);
  const [a, b] = users;
  let clock = 1000;
  const night = 5000;
  const ids = {};
  ids.a = (await enqueue(db, { userId: a.id, projectId: a.p, type: 'prospect', runAfter: night })).id;
  ids.b = (await enqueue(db, { userId: b.id, projectId: b.p, type: 'prospect', runAfter: night })).id;
  ids.a2 = (await enqueue(db, { userId: a.id, projectId: a.p, type: 'evolution' })).id;
  const w = new Worker(db, {}, { maxJobs: 4, clock: () => clock, log });
  const first = await w.claim();
  assert.equal(first.id, ids.a2, 'seul le job sans heure est dû');
  assert.equal(await w.claim(), null, 'le job de nuit d\'A attend, et A est déjà occupé');
  clock = night;
  const second = await w.claim();
  assert.equal(second.id, ids.b, 'B (jamais servi) avant A');
  await db.prepare("UPDATE jobs SET status = 'done' WHERE id = ?").run(ids.a2);
  w.busyUsers.delete(a.id);
  assert.equal((await w.claim()).id, ids.a);
});

test('pause de charge : les nouveaux jobs attendent (message clair), reprise avec hystérésis, jobs en cours épargnés', async () => {
  const { db, users } = await world(2);
  const [a, b] = users;
  let ratio = 0.95;
  const notified = [];
  const w = new Worker(db, {}, { maxJobs: 4, loadMax: 0.9, load: () => ratio, log, onLoad: (r, uid) => notified.push(uid) });
  const ja = await q(db, a, 'prospect');
  assert.equal(await w.claim(), null);
  const prog = JSON.parse((await db.prepare('SELECT progress_json FROM jobs WHERE id = ?').get(ja)).progress_json);
  assert.match(prog.message, /charge du serveur élevée \(95 %\)/);
  assert.equal((await db.prepare('SELECT status FROM jobs WHERE id = ?').get(ja)).status, 'queued');
  await w.claim(); await w.idle();
  assert.deepEqual(notified, [a.id], 'une seule notification par pause');
  ratio = 0.85; // sous 0,9 mais pas sous 0,8 : on reste en pause
  assert.equal(await w.claim(), null);
  ratio = 0.79;
  assert.equal((await w.claim()).id, ja);
  // Charge de nouveau élevée : le job de B attend, celui de A (en cours) n'est pas touché
  ratio = 0.99;
  await q(db, b, 'prospect');
  assert.equal(await w.claim(), null);
  assert.equal((await db.prepare('SELECT status FROM jobs WHERE id = ?').get(ja)).status, 'running');
});

test('arrêt propre : tous les jobs en cours sont interrompus ET attendus', async () => {
  const { db, users } = await world(3);
  let started = 0;
  const finished = [];
  const handler = (ctx) => new Promise((_, reject) => {
    started++;
    ctx.signal.addEventListener('abort', () => setTimeout(() => { finished.push(ctx.job.id); reject(new Error('Annulé')); }, 30), { once: true });
  });
  for (const u of users) await q(db, u, 'prospect');
  const w = new Worker(db, { prospect: handler }, { maxJobs: 3, pollMs: 10, log });
  await w.start();
  await until(() => started === 3);
  await w.stop();
  assert.equal(finished.length, 3, 'les trois jobs ont fini avant le retour de stop()');
  assert.equal(w.running.size, 0);
  assert.equal(w.busyUsers.size, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM jobs WHERE status = 'error'").get()).n, 3);
  assert.equal(await w.claim(), null, 'plus rien ne démarre après l\'arrêt');
});

test('suppression d\'un compte et déliaison n\'interrompent que les jobs de ce compte', async () => {
  const { db, users } = await world(2);
  const aborted = [];
  const handler = (ctx) => new Promise((resolve) => {
    ctx.signal.addEventListener('abort', () => { aborted.push(ctx.job.user_id); resolve({}); }, { once: true });
    setTimeout(resolve, 300);
  });
  for (const u of users) await q(db, u, 'prospect');
  const w = new Worker(db, { prospect: handler }, { maxJobs: 2, pollMs: 10, log, isAiJob: () => true });
  await w.start();
  await until(() => w.running.size === 2);
  w.abortUser(users[0].id);
  w.abortUserAi(users[1].id);
  await until(() => aborted.length === 2);
  assert.deepEqual(aborted.sort(), users.map((u) => u.id).sort());
  await w.stop();
});

test('configuration : MAX_AI_JOBS (12 par défaut, garde-fou global) et LOAD_MAX validés', () => {
  const base = { APP_URL: 'https://x.fr', SECRET_KEY: 'a'.repeat(64), GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', DB_DRIVER: 'sqlite' };
  const keep = { ...process.env };
  const withEnv = (extra, fn) => {
    delete process.env.MAX_AI_JOBS; delete process.env.LOAD_MAX;
    Object.assign(process.env, base, extra);
    try { return fn(); } finally {
      for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
      Object.assign(process.env, keep);
    }
  };
  assert.equal(withEnv({}, () => loadConfig().maxAiJobs), 12);
  assert.equal(withEnv({}, () => loadConfig().loadMax), 0.9);
  assert.equal(withEnv({ MAX_AI_JOBS: '2', LOAD_MAX: '1.2' }, () => loadConfig().maxAiJobs), 2);
  assert.throws(() => withEnv({ MAX_AI_JOBS: '0' }, loadConfig), /MAX_AI_JOBS/);
  assert.throws(() => withEnv({ MAX_AI_JOBS: 'beaucoup' }, loadConfig), /MAX_AI_JOBS/);
  assert.throws(() => withEnv({ LOAD_MAX: '0' }, loadConfig), /LOAD_MAX/);
});

test('avec le CLI simulé : deux utilisateurs tournent en parallèle, jamais deux processus pour le même utilisateur', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'aitools-q-'));
  const trace = join(tmp, 'trace.log');
  const s = await startApp({ cfg: { claudeBin: makeClaudeBin(tmp, { env: { FAKE_LOG: trace.split('\\').join('/'), FAKE_DELAY_MS: '350' } }) } });
  try {
    const key = (c) => `sk-ant-api03-${'x'.repeat(30)}${c.repeat(4)}`;
    const mk = async (c) => {
      const u = await s.newUser({ admin: false, link: { v: 1, mode: 'api_key', valid: true, last4: c, secret_enc: encrypt(s.app.cfg.secretKey, key(c)) } });
      const p = Number((await s.db.prepare('INSERT INTO projects(user_id, name, git_url, profile_json, target_json, target_validated, created_at) VALUES(?, ?, ?, ?, ?, 1, ?)')
        .run(u.id, 'P', `https://git.test/${c}.git`, JSON.stringify({ resume: 'x', proposition_valeur: 'y' }), JSON.stringify({ description: 'd', secteurs: ['s'] }), now())).lastInsertRowid);
      return { ...u, p };
    };
    const [A, B, C] = [await mk('A'), await mk('B'), await mk('C')];
    for (const u of [A, B, C]) { await enqueue(s.db, { userId: u.id, projectId: u.p, type: 'template' }); await enqueue(s.db, { userId: u.id, projectId: u.p, type: 'followup_template' }); }
    mkdirSync(join(tmp, 'x'), { recursive: true });
    const w = new Worker(s.db, makeHandlers(s.app), { maxJobs: 2, pollMs: 20, log });
    await w.start();
    await until(async () => (await s.db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')").get()).n === 0, 20000);
    await w.stop();
    const bad = await s.db.prepare("SELECT error FROM jobs WHERE status = 'error'").all(); assert.deepEqual(bad, []);
    assert.equal((await s.db.prepare("SELECT COUNT(*) n FROM jobs WHERE status = 'done'").get()).n, 6);

    const events = readFileSync(trace, 'utf8').trim().split('\n').map((l) => { const [what, who, t] = l.split(' '); return { what, who, t: Number(t) }; }).sort((x, y) => x.t - y.t);
    let open = 0, maxOpen = 0; const live = new Set(); let sameUser = false;
    for (const e of events) {
      if (e.what === 'start') { if (live.has(e.who)) sameUser = true; live.add(e.who); open++; maxOpen = Math.max(maxOpen, open); }
      else { live.delete(e.who); open--; }
    }
    assert.equal(maxOpen, 2, 'deux processus simultanés (maxJobs = 2), pas trois');
    assert.equal(sameUser, false, 'jamais deux processus du même utilisateur');
    assert.equal(events.filter((e) => e.what === 'start').length, 6);
    // L'ordre d'équité est vérifié de façon déterministe plus haut : l'horodatage de démarrage des processus dépend de leur lancement
  } finally { await s.close(); rmSync(tmp, { recursive: true, force: true }); }
});
