// Multi jobs : un compte gratuit fait tourner un job à la fois, les offres payantes plusieurs, et plus l'offre est chère plus il y en a.
// Toujours bornés par la capacité du serveur (maxJobs), et jamais deux envois de mails en même temps pour un même compte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { addUser } from './helpers/users.js';
import { startApp } from './helpers/server.js';
import { Worker, enqueue } from '../src/services/jobs.js';
import { makeSync } from '../src/handlers.js';
import { PLAN_LIMITS, PLAN_PRICES } from '../src/limits.js';
import { limitsFor } from '../src/services/plans.js';
import { roleTaskById } from '../src/services/roles.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = { error() {} };
async function world(n = 2) {
  const db = await testDb();
  const users = [];
  for (let i = 0; i < n; i++) {
    const id = await addUser(db);
    const p = Number((await db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'p', ?, ?)").run(id, `https://git.test/${id}.git`, now())).lastInsertRowid);
    const p2 = Number((await db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'p2', ?, ?)").run(id, `https://git.test/${id}b.git`, now())).lastInsertRowid);
    users.push({ id, p, p2 });
  }
  return { db, users };
}
const q = (db, u, type, project = u.p) => enqueue(db, { userId: u.id, projectId: project, type }).then((r) => r.id);
async function until(fn, ms = 5000) {
  const t0 = Date.now();
  while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error('délai dépassé'); await sleep(10); }
}
const idle = async (db) => (await db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')").get()).n === 0;
// Gabarit : mesure le nombre de jobs simultanés (total et par compte)
function probe() {
  const st = { cur: 0, max: 0, per: new Map(), perMax: new Map(), log: [] };
  st.handler = async (ctx) => {
    const u = ctx.job.user_id;
    st.cur++; st.max = Math.max(st.max, st.cur);
    st.per.set(u, (st.per.get(u) || 0) + 1); st.perMax.set(u, Math.max(st.perMax.get(u) || 0, st.per.get(u)));
    st.log.push(`+${ctx.job.type}`);
    await sleep(60);
    st.cur--; st.per.set(u, st.per.get(u) - 1);
    st.log.push(`-${ctx.job.type}`);
    return {};
  };
  return st;
}

test('offres : le multi jobs est réservé aux offres payantes et grandit avec l\'offre', () => {
  assert.equal(PLAN_LIMITS.free.parallelJobs, 1, 'gratuit : un job à la fois');
  const paid = Object.keys(PLAN_PRICES);
  let prev = PLAN_LIMITS.free.parallelJobs;
  for (const k of paid) {
    assert.ok(PLAN_LIMITS[k].parallelJobs > prev, `${k} : plus de jobs simultanés que l'offre précédente`);
    prev = PLAN_LIMITS[k].parallelJobs;
  }
  assert.equal(PLAN_LIMITS.intensive.parallelJobs, Math.max(...paid.map((k) => PLAN_LIMITS[k].parallelJobs)), 'l\'offre la plus chère en permet le plus');
  assert.ok(PLAN_LIMITS.starter.parallelJobs >= 2, 'dès la première offre payante, le multi jobs existe');
  assert.equal(limitsFor({ plan: 'free' }).parallelJobs, 1);
  assert.equal(limitsFor({ plan: 'business' }).parallelJobs, PLAN_LIMITS.business.parallelJobs);
});

test('un compte avec 3 jobs simultanés en fait tourner 3, un compte à 1 un seul, sans dépasser le serveur', async () => {
  const { db, users } = await world(2);
  const [rich, free] = users;
  const st = probe();
  const w = new Worker(db, { prospect: st.handler, evolution: st.handler, audit: st.handler, template: st.handler }, {
    maxJobs: 4, pollMs: 10, log, parallel: async (id) => (id === rich.id ? 3 : 1),
  });
  for (const t of ['prospect', 'evolution', 'audit', 'template']) await q(db, rich, t);
  await q(db, free, 'prospect'); await q(db, free, 'evolution');
  await w.start();
  await until(() => idle(db));
  await w.stop();
  assert.equal(st.perMax.get(rich.id), 3, 'le compte multi jobs en fait tourner 3 ensemble');
  assert.equal(st.perMax.get(free.id), 1, 'le compte à 1 n\'en fait tourner qu\'un');
  assert.ok(st.max <= 4, `jamais plus que la capacité du serveur (${st.max})`);
  assert.equal(st.log.filter((x) => x[0] === '+').length, 6, 'tous les jobs ont tourné');
});

test('sans réglage d\'offre, un seul job à la fois (comportement d\'origine) ; une valeur absurde retombe sur 1', async () => {
  const { db, users } = await world(1);
  const [u] = users;
  for (const parallel of [undefined, async () => 0, async () => NaN, async () => { throw new Error('boum'); }]) {
    const st = probe();
    const w = new Worker(db, { prospect: st.handler, evolution: st.handler }, { maxJobs: 4, pollMs: 10, log, parallel });
    await q(db, u, 'prospect'); await q(db, u, 'evolution');
    await w.start();
    await until(() => idle(db));
    await w.stop();
    assert.equal(st.perMax.get(u.id), 1);
  }
});

test('plafond global : il n\'existe plus par défaut ; l\'option maxJobs (tests) le fixe seulement si on la donne', async () => {
  const { db, users } = await world(1);
  const [u] = users;
  const st = probe();
  const w = new Worker(db, { prospect: st.handler, evolution: st.handler, audit: st.handler, template: st.handler }, { maxJobs: 2, pollMs: 10, log, parallel: async () => 6 });
  for (const t of ['prospect', 'evolution', 'audit', 'template']) await q(db, u, t);
  await w.start();
  await until(() => idle(db));
  await w.stop();
  assert.equal(st.max, 2);
});

test('envois de mails : jamais deux en même temps pour un compte, même avec le multi jobs', async () => {
  const { db, users } = await world(1);
  const [u] = users;
  const st = probe();
  const w = new Worker(db, { send: st.handler, followup: st.handler, evolution: st.handler }, { maxJobs: 4, pollMs: 10, log, parallel: async () => 4 });
  await q(db, u, 'send'); await q(db, u, 'followup', u.p2); await q(db, u, 'evolution');
  await w.start();
  await until(() => idle(db));
  await w.stop();
  // l'ordre d'événements montre que « send » et « followup » ne se chevauchent pas
  let mailsRunning = 0, maxMails = 0;
  for (const e of st.log) {
    if (!/send|followup/.test(e)) continue;
    mailsRunning += e[0] === '+' ? 1 : -1; maxMails = Math.max(maxMails, mailsRunning);
  }
  assert.equal(maxMails, 1, `un seul envoi de mails à la fois (${st.log.join(' ')})`);
  assert.equal(st.log.filter((x) => x[0] === '+').length, 3, 'les trois jobs ont tourné');
});

test('réservation en base : le plafond de l\'offre est respecté, pas seulement la mémoire', async () => {
  const { db, users } = await world(1);
  const [u] = users;
  const ids = [];
  for (const t of ['prospect', 'evolution', 'audit']) ids.push(await q(db, u, t));
  const row = (id) => db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  const w = new Worker(db, {}, { log });
  assert.equal(await w.reserve(await row(ids[0]), 2), true);
  assert.equal(await w.reserve(await row(ids[1]), 2), true, 'deuxième emplacement');
  assert.equal(await w.reserve(await row(ids[2]), 2), false, 'plafond de 2 atteint');
  assert.equal((await row(ids[2])).status, 'queued');
  assert.equal(await w.reserve(await row(ids[2]), 3), true, 'avec une offre à 3, le troisième passe');
  const other = await q(db, users[0], 'template');
  assert.equal(await new Worker(db, {}, { log }).reserve(await row(other)), false, 'sans plafond précisé : 1, donc refusé');
});

test('synchronisation Git : deux jobs du même dépôt ne se chevauchent pas, deux dépôts différents si', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser();
    s.app.resolveHost = async () => [{ address: '93.184.216.34', family: 4 }];
    let cur = 0, max = 0;
    const calls = [];
    s.app.syncRepo = async (url, dir) => { calls.push(dir); cur++; max = Math.max(max, cur); await sleep(60); cur--; return 'abc'; };
    const sync = makeSync(s.app);
    await Promise.all([sync(u.id, 'https://github.com/u/a.git', '/tmp/x/a'), sync(u.id, 'https://github.com/u/a.git', '/tmp/x/a'), sync(u.id, 'https://github.com/u/a.git', '/tmp/x/a')]);
    assert.equal(max, 1, 'même dépôt : l\'un après l\'autre');
    assert.equal(calls.length, 3);
    max = 0;
    await Promise.all([sync(u.id, 'https://github.com/u/a.git', '/tmp/x/a'), sync(u.id, 'https://github.com/u/b.git', '/tmp/x/b')]);
    assert.equal(max, 2, 'dépôts différents : en parallèle');
    // une synchronisation en échec ne bloque pas la suivante
    let first = true;
    s.app.syncRepo = async () => { if (first) { first = false; throw new Error('réseau'); } return 'ok'; };
    const [a, b] = await Promise.allSettled([sync(u.id, 'https://github.com/u/c.git', '/tmp/x/c'), sync(u.id, 'https://github.com/u/c.git', '/tmp/x/c')]);
    // Lequel des deux atteint syncRepo en premier dépend de la vitesse de la base (SQLite : toujours le premier, MySQL : au gré des requêtes)
    assert.deepEqual([a.status, b.status].sort(), ['fulfilled', 'rejected'], 'l\'échec de l\'un ne bloque pas l\'autre');
  } finally { await s.close(); }
});

test('un job qui attend dit pourquoi : un seul job à la fois en gratuit, avec le renvoi vers les offres payantes', async () => {
  const { db, users } = await world(1);
  const [u] = users;
  const a = await q(db, u, 'prospect');
  const b = await q(db, u, 'evolution');
  let cap = 1;
  const w = new Worker(db, {}, { log, parallel: async () => cap });
  assert.equal((await w.claim()).id, a);
  assert.equal(await w.claim(), null, 'le second attend');
  const msg = JSON.parse((await db.prepare('SELECT progress_json FROM jobs WHERE id = ?').get(b)).progress_json).message;
  assert.match(msg, /^En attente : un job est déjà en cours \(ton offre en fait tourner un seul à la fois/);
  assert.match(msg, /offres payantes en font tourner plusieurs/);
  // Passage à une offre à 2 jobs simultanés : le second emplacement sert le suivant, le troisième attend et donne le nombre
  cap = 2;
  const c = await q(db, u, 'audit');
  assert.equal((await w.claim()).id, b, 'le second emplacement sert le suivant');
  assert.equal(await w.claim(), null);
  assert.match(JSON.parse((await db.prepare('SELECT progress_json FROM jobs WHERE id = ?').get(c)).progress_json).message, /2 jobs sont déjà en cours \(ton offre en permet 2 à la fois\)/);
});

test('de bout en bout : le vrai serveur lit l\'offre du compte (gratuit = 1 job à la fois, payant = plusieurs)', async () => {
  const { join } = await import('node:path');
  const { makeClaudeBin } = await import('./helpers/claude-bin.js');
  const { testTokenLink } = await import('./helpers/users.js');
  const s = await startApp({ worker: true });
  try {
    const logFile = join(s.tmp, 'multi.log');
    s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'fake-claude.js', env: { FAKE_DELAY_MS: '700', FAKE_LOG: logFile } });
    const mk = async (plan) => {
      const u = await s.newUser({ admin: false, link: testTokenLink() });
      await s.db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, u.id);
      const pid = await addProjectRow(u.id);
      return { u, pid };
    };
    const addProjectRow = async (uid) => Number((await s.db.prepare("INSERT INTO projects(user_id, name, git_url, created_at, profile_json) VALUES(?, 'p', ?, ?, ?)").run(uid, `https://git.test/${uid}.git`, now(), JSON.stringify({ resume: 'r', proposition_valeur: 'v', arguments: ['a'], ton: 't' }))).lastInsertRowid);
    const paid = await mk('business');
    const free = await mk('free');
    // Trois tâches de poste (pas de dépôt à cloner) pour chacun
    // (les postes sont réservés à l'offre Croissance : le compte gratuit met ses tâches en file directement)
    for (const t of ['faq', 'okr', 'budget']) assert.equal((await paid.u.post(`/api/projects/${paid.pid}/poste/${t}`, {})).status, 200);
    for (const t of ['faq', 'okr', 'budget']) await enqueue(s.db, { userId: free.u.id, projectId: free.pid, type: roleTaskById(t).job, params: { notes: '' } });
    const running = async (who) => Number((await s.db.prepare("SELECT COUNT(*) n FROM jobs WHERE user_id = ? AND status = 'running'").get(who.u.id)).n);
    let maxPaid = 0, maxFree = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      maxPaid = Math.max(maxPaid, await running(paid)); maxFree = Math.max(maxFree, await running(free));
      const left = Number((await s.db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')").get()).n);
      if (!left) break;
      await sleep(40);
    }
    assert.equal(maxFree, 1, 'compte gratuit : un seul job à la fois');
    assert.ok(maxPaid >= 2, `compte Business : plusieurs jobs en même temps (${maxPaid})`);
    assert.ok(maxPaid <= PLAN_LIMITS.business.parallelJobs);
  } finally { await s.close(); }
});

test('la limite par compte est celle de son offre : avec le garde-fou par défaut (12), un compte Intensif en fait bien tourner 6', async () => {
  const { db, users } = await world(1);
  const [u] = users;
  const st = probe();
  const types = ['prospect', 'evolution', 'audit', 'template', 'followup_template', 'analyze'];
  const handlers = Object.fromEntries(types.map((t) => [t, st.handler]));
  const w = new Worker(db, handlers, { maxJobs: 12, pollMs: 10, log, parallel: async () => PLAN_LIMITS.intensive.parallelJobs });
  for (const t of types) await q(db, u, t);
  for (const t of types.slice(0, 2)) await q(db, u, t, u.p2); // 8 jobs au total
  await w.start();
  await until(() => idle(db));
  await w.stop();
  assert.equal(st.perMax.get(u.id), 6, `6 jobs simultanés pour ce compte (${st.perMax.get(u.id)})`);
  assert.equal(st.log.filter((x) => x[0] === '+').length, 8, 'les 8 jobs ont tourné');
});

test('aucune limite globale : 10 comptes à 1 job chacun tournent tous en même temps, sans réglage de plafond', async () => {
  const { db, users } = await world(10);
  const st = probe();
  // Chaque job attend que les 10 soient démarrés : le test vérifie l'absence de plafond, pas la vitesse de la base (sur MySQL, démarrer
  // le dixième job prend plus que les 60 ms que dure un job, et le premier avait déjà fini)
  let started = 0;
  const handler = async (ctx) => {
    started++;
    for (const t0 = Date.now(); started < users.length && Date.now() - t0 < 5000;) await sleep(10);
    return st.handler(ctx);
  };
  const w = new Worker(db, { prospect: handler }, { pollMs: 10, log, parallel: async () => 1 });
  assert.equal(w.maxJobs, Infinity);
  for (const u of users) await q(db, u, 'prospect');
  await w.start();
  await until(() => idle(db));
  await w.stop();
  assert.equal(st.max, 10, `les 10 jobs tournent ensemble (${st.max})`);
});
