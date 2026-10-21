import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, now, setSetting } from '../src/db.js';
import { budgetState, AI_JOBS, quotaState, isQuotaSensitive, quotaAlerts } from '../src/services/budget.js';
import { Worker, enqueue, latestJobs } from '../src/services/jobs.js';

function setup() {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO projects(name, git_url, created_at) VALUES('p', 'u', ?)").run(now());
  const spend = (usd, finishedAgo) => db.prepare("INSERT INTO jobs(project_id, type, status, cost_usd, created_at, finished_at) VALUES(1, 'prospect', 'done', ?, ?, ?)")
    .run(usd, now() - finishedAgo - 60, now() - finishedAgo);
  return { db, spend };
}

test('budget : pas de limite par défaut, puis plafonds 24 h et 30 j glissants', () => {
  const s = setup();
  s.spend(1.5, 3600);          // il y a 1 h
  s.spend(10, 5 * 86400);      // il y a 5 jours
  s.spend(99, 40 * 86400);     // hors fenêtre
  let b = budgetState(s.db);
  assert.equal(b.blocked, false);
  assert.equal(b.day.used, 1.5);
  assert.equal(b.month.used, 11.5);

  setSetting(s.db, 'budget_day_usd', '2');
  assert.equal(budgetState(s.db).blocked, false);
  setSetting(s.db, 'budget_day_usd', '1.5');
  b = budgetState(s.db);
  assert.equal(b.blocked, true);
  assert.equal(b.reason, 'budget IA des dernières 24 h atteint (1.50 $ / 1.50 $)');

  setSetting(s.db, 'budget_day_usd', '');
  setSetting(s.db, 'budget_month_usd', '10');
  assert.match(budgetState(s.db).reason, /30 derniers jours atteint \(11\.50 \$ \/ 10\.00 \$\)/);
  assert.equal(budgetState(s.db, { at: now() + 30 * 86400 }).blocked, false, 'la fenêtre glisse');
});

test('les envois et relances ne consomment pas d\'IA', () => {
  for (const t of ['send', 'followup']) assert.equal(AI_JOBS.has(t), false);
  for (const t of ['analyze', 'prospect', 'template', 'followup_template', 'evolution']) assert.equal(AI_JOBS.has(t), true);
});

test('budget atteint : les jobs IA attendent (pas perdus), les envois passent, une seule notif', async () => {
  const s = setup();
  s.spend(5, 600);
  setSetting(s.db, 'budget_day_usd', '3');
  const ran = [];
  const alerts = [];
  const h = (name) => async () => { ran.push(name); };
  const w = new Worker(s.db, { prospect: h('prospect'), evolution: h('evolution'), send: h('send') }, {
    thermalMax: 999, log: { error() {} },
    budget: () => budgetState(s.db), isAiJob: (t) => AI_JOBS.has(t), onBudget: (r) => alerts.push(r),
  });
  enqueue(s.db, { projectId: 1, type: 'prospect' });
  enqueue(s.db, { projectId: 1, type: 'send' });
  enqueue(s.db, { projectId: 1, type: 'evolution' });

  assert.equal(await w.tick(), true);
  assert.deepEqual(ran, ['send'], 'l\'envoi passe devant les jobs IA bloqués');
  assert.equal(await w.tick(), false);
  assert.equal(await w.tick(), false);
  assert.equal(alerts.length, 1, 'une seule notif, pas une toutes les 3 s');
  const jobs = latestJobs(s.db, 1);
  assert.equal(jobs.prospect.status, 'queued');
  assert.match(jobs.prospect.progress.message, /^En attente : budget IA des dernières 24 h atteint/);

  setSetting(s.db, 'budget_day_usd', '20'); // ou la fenêtre de 24 h qui glisse
  await w.tick(); await w.tick();
  assert.deepEqual(ran, ['send', 'prospect', 'evolution'], 'les jobs repartent tout seuls, dans l\'ordre');

  setSetting(s.db, 'budget_day_usd', '1');
  enqueue(s.db, { projectId: 1, type: 'prospect' });
  await w.tick();
  assert.equal(alerts.length, 2, 'nouvelle notif pour un nouveau blocage');
});

test('analyse et évolutions sont "non urgents", pas la prospection ni l\'envoi', () => {
  for (const t of ['analyze', 'evolution']) assert.equal(isQuotaSensitive(t), true);
  for (const t of ['prospect', 'template', 'followup_template', 'send', 'followup']) assert.equal(isQuotaSensitive(t), false);
});

test('quotaState : pas mesuré, en dessous du seuil, puis bloqué à 85 %', () => {
  const s = setup();
  assert.deepEqual(quotaState(s.db), { blocked: false, reason: null });
  setSetting(s.db, 'claude_rate_limit_json', JSON.stringify({ fiveHour: { utilization: 0.5 }, sevenDay: { utilization: 0.6 } }));
  assert.equal(quotaState(s.db).blocked, false);
  setSetting(s.db, 'claude_rate_limit_json', JSON.stringify({ fiveHour: { utilization: 0.9 }, sevenDay: { utilization: 0.6 } }));
  let q = quotaState(s.db);
  assert.equal(q.blocked, true);
  assert.equal(q.reason, 'quota de la session Claude (5 h) à 90 %');
  setSetting(s.db, 'claude_rate_limit_json', JSON.stringify({ fiveHour: { utilization: 0.1 }, sevenDay: { utilization: 0.99 } }));
  q = quotaState(s.db);
  assert.equal(q.reason, 'quota de la semaine Claude à 99 %');
  setSetting(s.db, 'claude_rate_limit_json', 'pas du json');
  assert.deepEqual(quotaState(s.db), { blocked: false, reason: null }, 'jamais planter sur une valeur corrompue');
});

test('quota serré : analyse/évolution attendent, la prospection et l\'envoi continuent', async () => {
  const s = setup();
  setSetting(s.db, 'claude_rate_limit_json', JSON.stringify({ fiveHour: { utilization: 0.9 } }));
  const ran = [];
  const alerts = [];
  const h = (name) => async () => { ran.push(name); };
  const w = new Worker(s.db, { prospect: h('prospect'), evolution: h('evolution'), analyze: h('analyze') }, {
    thermalMax: 999, log: { error() {} },
    quota: () => quotaState(s.db), isQuotaSensitive, onQuotaHold: (r) => alerts.push(r),
  });
  enqueue(s.db, { projectId: 1, type: 'evolution' });
  enqueue(s.db, { projectId: 1, type: 'analyze' });
  enqueue(s.db, { projectId: 1, type: 'prospect' });

  assert.equal(await w.tick(), true);
  assert.deepEqual(ran, ['prospect'], 'la prospection passe devant les jobs reportés');
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /quota de la session Claude \(5 h\) à 90 %/);
  const jobs = latestJobs(s.db, 1);
  assert.match(jobs.evolution.progress.message, /^En attente : quota de la session/);

  setSetting(s.db, 'claude_rate_limit_json', JSON.stringify({ fiveHour: { utilization: 0.1 } }));
  await w.tick(); await w.tick();
  assert.deepEqual(ran, ['prospect', 'evolution', 'analyze'], 'repartent tout seuls une fois le quota libéré');
});

test('quotaAlerts : un palier (80 %, 95 %) une seule fois, re-sonne si la fenêtre a tourné', () => {
  const s = setup();
  let a = quotaAlerts(s.db, { fiveHour: { utilization: 0.5, resetsAt: 100 } });
  assert.deepEqual(a, []);
  a = quotaAlerts(s.db, { fiveHour: { utilization: 0.82, resetsAt: 100 } });
  assert.deepEqual(a, [{ label: 'session Claude (5 h)', level: 80, utilization: 0.82 }]);
  // toujours au-dessus de 80 %, même fenêtre : pas de redite
  a = quotaAlerts(s.db, { fiveHour: { utilization: 0.88, resetsAt: 100 } });
  assert.deepEqual(a, []);
  // passe 95 % : nouveau palier
  a = quotaAlerts(s.db, { fiveHour: { utilization: 0.97, resetsAt: 100 } });
  assert.deepEqual(a, [{ label: 'session Claude (5 h)', level: 95, utilization: 0.97 }]);
  // la fenêtre a tourné (nouveau resetsAt) : 80 % re-sonne
  a = quotaAlerts(s.db, { fiveHour: { utilization: 0.81, resetsAt: 200 } });
  assert.deepEqual(a, [{ label: 'session Claude (5 h)', level: 80, utilization: 0.81 }]);
  // saut direct à 95 % : un seul palier notifié, pas 80 puis 95
  a = quotaAlerts(s.db, { sevenDay: { utilization: 0.97, resetsAt: 300 } });
  assert.deepEqual(a, [{ label: 'semaine Claude', level: 95, utilization: 0.97 }]);
});
