// Relance automatique des tâches IA arrêtées par une limite (Réglages → Garde-fous).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { setSetting, now } from '../src/db.js';
import { encrypt } from '../src/crypto.js';
import { Worker } from '../src/services/jobs.js';
import { retryReason, retryAt, scheduleAutoRetry, AUTO_RETRY } from '../src/services/autoretry.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

test('retryReason : limite ou tâche non terminée = relançable ; liaison ou configuration = non', () => {
  for (const m of ["You've hit your limit · resets 3pm", 'Ton quota Claude est atteint pour le moment : réessaie plus tard', 'API Error: 429 overloaded', "Claude s'est arrêté sans résultat (code null).", 'Interrompu (redémarrage)']) assert.ok(retryReason(m), m);
  for (const m of ['Jeton refusé par Claude (invalide ou expiré)', 'Compte suspendu', 'Budget IA atteint : 5 $', 'Le JSON est incomplet pour le prospect', 'Projet introuvable']) assert.equal(retryReason(m), null, m);
});

test('retryAt : après la remise à zéro du quota saturé, sinon une attente qui s\'allonge', () => {
  const rl = JSON.stringify({ fiveHour: { utilization: 1, resetsAt: 5000 }, sevenDay: { utilization: 0.4, resetsAt: 90000 } });
  assert.equal(retryAt(rl, 'quota', 0, 1000), 5000 + AUTO_RETRY.resetMargin, 'seule la fenêtre saturée compte');
  assert.equal(retryAt(rl, 'quota', 0, 6000), 6000 + AUTO_RETRY.delays[0], 'fenêtre déjà remise à zéro : attente par défaut');
  assert.equal(retryAt('', 'unfinished', 1, 100), 100 + AUTO_RETRY.delays[1]);
  assert.equal(retryAt('', 'unfinished', 9, 100), 100 + AUTO_RETRY.delays.at(-1));
});

test('worker : option cochée, une tâche IA arrêtée par la limite repart en nouvelle tâche ; option coupée, jamais', async () => {
  const link = { v: 1, provider: 'claude', mode: 'api_key', valid: true, last4: 'WXYZ', linked_at: 1000, secret_enc: encrypt(s.app.cfg.secretKey, `sk-ant-${'A'.repeat(40)}`) };
  const u = await s.newUser({ admin: false, link });
  const pid = Number((await s.db.prepare(`INSERT INTO projects(user_id, name, git_url, profile_json, target_json, target_validated, created_at) VALUES(?, 'P', ?, ?, ?, 1, ?)`)
    .run(u.id, `https://git.test/u${u.id}/p.git`, JSON.stringify({ resume: 'x' }), JSON.stringify({ description: 'd', secteurs: ['s'] }), now())).lastInsertRowid);
  const rl = { fiveHour: { utilization: 1, resetsAt: now() + 7200 }, sevenDay: null };
  await setSetting(s.db, u.id, 'claude_rate_limit_json', JSON.stringify({ at: now(), ...rl }));
  const handlers = { analyze: async () => { throw new Error("You've hit your limit"); }, evolution: async () => { throw new Error('Jeton refusé par Claude'); } };
  const worker = () => new Worker(s.db, handlers, { log: { error() {} }, autoRetry: (job, m) => scheduleAutoRetry(s.db, job, m) });
  const run = async (type, params = {}) => {
    const id = Number((await s.db.prepare("INSERT INTO jobs(user_id, project_id, type, params_json, status, created_at) VALUES(?,?,?,?, 'running', ?)").run(u.id, pid, type, JSON.stringify(params), now())).lastInsertRowid);
    await worker().runJob(await s.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id));
    return id;
  };
  const queued = async (type) => s.db.prepare("SELECT * FROM jobs WHERE user_id = ? AND type = ? AND status = 'queued' ORDER BY id DESC").get(u.id, type);

  await run('analyze');
  assert.equal(await queued('analyze'), undefined, 'option coupée par défaut : rien ne repart');

  await setSetting(s.db, u.id, 'auto_retry', '1');
  await run('evolution');
  assert.equal(await queued('evolution'), undefined, 'erreur de liaison : pas de relance');

  const first = await run('analyze');
  const q = await queued('analyze');
  assert.ok(q, 'relance programmée');
  assert.equal(JSON.parse(q.params_json).autoRetry, 1);
  assert.ok(Number(q.run_after) >= now() + 7200, 'pas avant la remise à zéro du quota');
  assert.equal((await s.db.prepare('SELECT status FROM jobs WHERE id = ?').get(first)).status, 'error', 'la tâche en échec reste en erreur');

  // une tâche déjà relancée 3 fois ne repart plus
  await s.db.prepare("DELETE FROM jobs WHERE status = 'queued' AND user_id = ?").run(u.id);
  await run('analyze', { autoRetry: AUTO_RETRY.max });
  assert.equal(await queued('analyze'), undefined);
});
