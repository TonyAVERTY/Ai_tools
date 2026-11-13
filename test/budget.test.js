import { test } from 'node:test';
import assert from 'node:assert/strict';
import { now, setSetting } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { addUser } from './helpers/users.js';
import { budgetState, AI_JOBS, quotaState, isQuotaSensitive, quotaAlerts } from '../src/services/budget.js';
import { Worker, enqueue, latestJobs } from '../src/services/jobs.js';

async function setup() {
  const db = await testDb();
  const u = await addUser(db, { link: { v: 1, mode: 'api_key', valid: true } }); // plafonds en $ : propres aux clés API
  await db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'p', 'u', ?)").run(u, now());
  const spend = (usd, finishedAgo, user = u) => db.prepare("INSERT INTO jobs(user_id, project_id, type, status, cost_usd, created_at, finished_at) VALUES(?, 1, 'prospect', 'done', ?, ?, ?)")
    .run(user, usd, now() - finishedAgo - 60, now() - finishedAgo);
  return { db, spend, u };
}

test('budget : pas de limite par défaut, puis plafonds 24 h et 30 j glissants', async () => {
  const s = await setup();
  await s.spend(1.5, 3600);          // il y a 1 h
  await s.spend(10, 5 * 86400);      // il y a 5 jours
  await s.spend(99, 40 * 86400);     // hors fenêtre
  let b = await budgetState(s.db, s.u);
  assert.equal(b.blocked, false);
  assert.equal(b.day.used, 1.5);
  assert.equal(b.month.used, 11.5);

  await setSetting(s.db, s.u, 'budget_day_usd', '2');
  assert.equal((await budgetState(s.db, s.u)).blocked, false);
  await setSetting(s.db, s.u, 'budget_day_usd', '1.5');
  b = await budgetState(s.db, s.u);
  assert.equal(b.blocked, true);
  assert.equal(b.reason, 'budget IA des dernières 24 h atteint (1.50 $ / 1.50 $)');

  await setSetting(s.db, s.u, 'budget_day_usd', '');
  await setSetting(s.db, s.u, 'budget_month_usd', '10');
  assert.match((await budgetState(s.db, s.u)).reason, /30 derniers jours atteint \(11\.50 \$ \/ 10\.00 \$\)/);
  assert.equal((await budgetState(s.db, s.u, { at: now() + 30 * 86400 })).blocked, false, 'la fenêtre glisse');
});

test('les envois et relances ne consomment pas d\'IA', () => {
  for (const t of ['send', 'followup']) assert.equal(AI_JOBS.has(t), false);
  for (const t of ['analyze', 'prospect', 'template', 'followup_template', 'evolution']) assert.equal(AI_JOBS.has(t), true);
});

test('budget atteint : les jobs IA attendent (pas perdus), les envois passent, une seule notif', async () => {
  const s = await setup();
  await s.spend(5, 600);
  await setSetting(s.db, s.u, 'budget_day_usd', '3');
  const ran = [];
  const alerts = [];
  const h = (name) => async () => { ran.push(name); };
  const w = new Worker(s.db, { prospect: h('prospect'), evolution: h('evolution'), send: h('send') }, {
    log: { error() {} },
    budget: (u) => budgetState(s.db, u), isAiJob: (t) => AI_JOBS.has(t), onBudget: (r) => alerts.push(r),
  });
  await enqueue(s.db, { userId: s.u, projectId: 1, type: 'prospect' });
  await enqueue(s.db, { userId: s.u, projectId: 1, type: 'send' });
  await enqueue(s.db, { userId: s.u, projectId: 1, type: 'evolution' });

  assert.equal(await w.tick(), true);
  assert.deepEqual(ran, ['send'], 'l\'envoi passe devant les jobs IA bloqués');
  assert.equal(await w.tick(), false);
  assert.equal(await w.tick(), false);
  assert.equal(alerts.length, 1, 'une seule notif, pas une toutes les 3 s');
  const jobs = await latestJobs(s.db, 1);
  assert.equal(jobs.prospect.status, 'queued');
  assert.match(jobs.prospect.progress.message, /^En attente : budget IA des dernières 24 h atteint/);

  await setSetting(s.db, s.u, 'budget_day_usd', '20'); // ou la fenêtre de 24 h qui glisse
  await w.tick(); await w.tick();
  assert.deepEqual(ran, ['send', 'prospect', 'evolution'], 'les jobs repartent tout seuls, dans l\'ordre');

  await setSetting(s.db, s.u, 'budget_day_usd', '1');
  await enqueue(s.db, { userId: s.u, projectId: 1, type: 'prospect' });
  await w.tick();
  assert.equal(alerts.length, 2, 'nouvelle notif pour un nouveau blocage');
});

test('analyse et évolutions sont "non urgents", pas la prospection ni l\'envoi', () => {
  for (const t of ['analyze', 'evolution']) assert.equal(isQuotaSensitive(t), true);
  for (const t of ['prospect', 'template', 'followup_template', 'send', 'followup']) assert.equal(isQuotaSensitive(t), false);
});

test('quotaState : pas mesuré, en dessous du seuil, puis bloqué à 85 %', async () => {
  const s = await setup();
  assert.deepEqual(await quotaState(s.db, s.u), { blocked: false, reason: null });
  await setSetting(s.db, s.u, 'claude_rate_limit_json', JSON.stringify({ fiveHour: { utilization: 0.5 }, sevenDay: { utilization: 0.6 } }));
  assert.equal((await quotaState(s.db, s.u)).blocked, false);
  await setSetting(s.db, s.u, 'claude_rate_limit_json', JSON.stringify({ fiveHour: { utilization: 0.9 }, sevenDay: { utilization: 0.6 } }));
  let q = await quotaState(s.db, s.u);
  assert.equal(q.blocked, true);
  assert.equal(q.reason, 'quota de la session Claude (5 h) à 90 %');
  await setSetting(s.db, s.u, 'claude_rate_limit_json', JSON.stringify({ fiveHour: { utilization: 0.1 }, sevenDay: { utilization: 0.99 } }));
  q = await quotaState(s.db, s.u);
  assert.equal(q.reason, 'quota de la semaine Claude à 99 %');
  await setSetting(s.db, s.u, 'claude_rate_limit_json', 'pas du json');
  assert.deepEqual(await quotaState(s.db, s.u), { blocked: false, reason: null }, 'jamais planter sur une valeur corrompue');
});

test('quota serré : analyse/évolution attendent, la prospection et l\'envoi continuent', async () => {
  const s = await setup();
  await setSetting(s.db, s.u, 'claude_rate_limit_json', JSON.stringify({ fiveHour: { utilization: 0.9 } }));
  const ran = [];
  const alerts = [];
  const h = (name) => async () => { ran.push(name); };
  const w = new Worker(s.db, { prospect: h('prospect'), evolution: h('evolution'), analyze: h('analyze') }, {
    log: { error() {} },
    quota: (u) => quotaState(s.db, u), isQuotaSensitive, onQuotaHold: (r) => alerts.push(r),
  });
  await enqueue(s.db, { userId: s.u, projectId: 1, type: 'evolution' });
  await enqueue(s.db, { userId: s.u, projectId: 1, type: 'analyze' });
  await enqueue(s.db, { userId: s.u, projectId: 1, type: 'prospect' });

  assert.equal(await w.tick(), true);
  assert.deepEqual(ran, ['prospect'], 'la prospection passe devant les jobs reportés');
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /quota de la session Claude \(5 h\) à 90 %/);
  const jobs = await latestJobs(s.db, 1);
  assert.match(jobs.evolution.progress.message, /^En attente : quota de la session/);

  await setSetting(s.db, s.u, 'claude_rate_limit_json', JSON.stringify({ fiveHour: { utilization: 0.1 } }));
  await w.tick(); await w.tick();
  assert.deepEqual(ran, ['prospect', 'evolution', 'analyze'], 'repartent tout seuls une fois le quota libéré');
});

test('quotaAlerts : un palier (80 %, 95 %) une seule fois, re-sonne si la fenêtre a tourné', async () => {
  const s = await setup();
  let a = await quotaAlerts(s.db, s.u, { fiveHour: { utilization: 0.5, resetsAt: 100 } });
  assert.deepEqual(a, []);
  a = await quotaAlerts(s.db, s.u, { fiveHour: { utilization: 0.82, resetsAt: 100 } });
  assert.deepEqual(a, [{ label: 'session Claude (5 h)', level: 80, utilization: 0.82 }]);
  // toujours au-dessus de 80 %, même fenêtre : pas de redite
  a = await quotaAlerts(s.db, s.u, { fiveHour: { utilization: 0.88, resetsAt: 100 } });
  assert.deepEqual(a, []);
  // passe 95 % : nouveau palier
  a = await quotaAlerts(s.db, s.u, { fiveHour: { utilization: 0.97, resetsAt: 100 } });
  assert.deepEqual(a, [{ label: 'session Claude (5 h)', level: 95, utilization: 0.97 }]);
  // la fenêtre a tourné (nouveau resetsAt) : 80 % re-sonne
  a = await quotaAlerts(s.db, s.u, { fiveHour: { utilization: 0.81, resetsAt: 200 } });
  assert.deepEqual(a, [{ label: 'session Claude (5 h)', level: 80, utilization: 0.81 }]);
  // saut direct à 95 % : un seul palier notifié, pas 80 puis 95
  a = await quotaAlerts(s.db, s.u, { sevenDay: { utilization: 0.97, resetsAt: 300 } });
  assert.deepEqual(a, [{ label: 'semaine Claude', level: 95, utilization: 0.97 }]);
});

test('quotaState : une mesure dont la fenêtre a été remise à zéro depuis ne bloque plus rien', async () => {
  const s = await setup();
  await setSetting(s.db, s.u, 'claude_rate_limit_json', JSON.stringify({ fiveHour: { utilization: 0.95, resetsAt: now() - 60 }, sevenDay: { utilization: 0.1 } }));
  assert.equal((await quotaState(s.db, s.u)).blocked, false);
  await setSetting(s.db, s.u, 'claude_rate_limit_json', JSON.stringify({ fiveHour: { utilization: 0.95, resetsAt: now() + 600 }, sevenDay: { utilization: 0.1 } }));
  assert.equal((await quotaState(s.db, s.u)).blocked, true);
});

test('budget : avec un abonnement, un ancien plafond en $ ne bloque jamais', async () => {
  const s = await setup();
  const sub = await addUser(s.db); // liaison par jeton d'abonnement (défaut des tests)
  await setSetting(s.db, sub, 'budget_day_usd', '1');
  await s.spend(5, 600, sub);
  const b = await budgetState(s.db, sub);
  assert.equal(b.blocked, false);
  assert.equal(b.day.limit, null);
  assert.equal(b.day.used, 5, 'la dépense reste mesurée');
  await setSetting(s.db, s.u, 'budget_day_usd', '1');
  await s.spend(5, 600);
  assert.equal((await budgetState(s.db, s.u)).blocked, true, 'clé API : le plafond s\'applique');
});

test('quotaState : le seuil de pause se règle (85 % par défaut, valeur hors bornes ignorée)', async () => {
  const s = await setup();
  await setSetting(s.db, s.u, 'claude_rate_limit_json', JSON.stringify({ fiveHour: { utilization: 0.7 }, sevenDay: { utilization: 0.1 } }));
  assert.equal((await quotaState(s.db, s.u)).blocked, false);
  await setSetting(s.db, s.u, 'quota_pause_percent', '60');
  assert.equal((await quotaState(s.db, s.u)).blocked, true);
  await setSetting(s.db, s.u, 'quota_pause_percent', '95');
  assert.equal((await quotaState(s.db, s.u)).blocked, false);
  await setSetting(s.db, s.u, 'quota_pause_percent', '10');
  assert.equal((await quotaState(s.db, s.u)).blocked, false, 'hors bornes : retour à 85 %');
});
