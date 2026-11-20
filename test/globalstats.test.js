import { test } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../src/db.js';
import { globalStats, percentile } from '../src/services/globalstats.js';
import { startApp } from './helpers/server.js';

// Statistiques globales (administrateurs) : totaux de l'application, périodes, 404 pour les autres, aucune donnée de compte dans la page.

test('percentile : rang le plus proche, null si vide', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
  assert.equal(percentile([1, 2, 3, 4], 95), 4);
});

test('les totaux comptent requêtes IA, mails, réponses, erreurs et modèles sur la période', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: false });
    const t = now();
    const p = (await s.db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'P', 'u', ?)").run(u.id, t)).lastInsertRowid;
    const job = (status, model, started, finished, created = t - 60) => s.db.prepare('INSERT INTO jobs(user_id, project_id, type, status, model, cost_usd, tokens_in, tokens_out, created_at, started_at, finished_at) VALUES(?, ?, ?, ?, ?, ?, 10, 5, ?, ?, ?)')
      .run(u.id, p, 'analyze', status, model, 0.5, created, started, finished);
    await job('done', 'claude-sonnet-5-5', t - 50, t - 40);   // 10 s
    await job('done', 'claude-sonnet-5-5', t - 50, t - 20);   // 30 s
    await job('error', null, t - 50, t - 45);
    await job('done', 'claude-sonnet-5-5', t - 9 * 86400, t - 9 * 86400 + 5, t - 9 * 86400); // hors période de 7 jours
    await s.db.prepare("INSERT INTO mail_log(project_id, email, sent_at, error) VALUES(?, 'a@x.fr', ?, NULL)").run(p, t - 30);
    await s.db.prepare("INSERT INTO mail_log(project_id, email, sent_at, error) VALUES(?, 'b@x.fr', ?, 'refusé')").run(p, t - 30);
    await s.db.prepare("INSERT INTO replies(project_id, from_email, intent, received_at) VALUES(?, 'a@x.fr', 'other', ?)").run(p, t - 10);
    const st = await globalStats(s.db, '7j', t);
    assert.equal(st.ai.jobs, 3);
    assert.equal(st.ai.errors, 1);
    assert.equal(st.mails.sent, 1);
    assert.equal(st.mails.errors, 1);
    assert.equal(st.replies.total, 1);
    assert.equal(st.replies.rate, 1);
    assert.equal(st.response.count, 2);
    assert.equal(st.response.avg, 20);
    assert.equal(st.errorsByType[0].type, 'analyze');
    assert.equal(st.models.find((m) => m.model === 'claude-sonnet-5-5').requests, 2);
    assert.equal(st.models.find((m) => m.model === 'inconnu').requests, 1);
    assert.equal((await globalStats(s.db, '30j', t)).ai.jobs, 4);
    assert.equal((await globalStats(s.db, 'nimporte', t)).period, '7j');
  } finally { await s.close(); }
});

test('la page est réservée aux administrateurs et ne montre aucune adresse de compte', async () => {
  const s = await startApp();
  try {
    const user = await s.newUser({ admin: false });
    const admin = await s.newUser({ admin: true });
    assert.equal((await s.anon.get('/admin/stats')).status, 404);
    assert.equal((await user.get('/admin/stats')).status, 404);
    const r = await admin.get('/admin/stats', { headers: { accept: 'text/html' } });
    assert.equal(r.status, 200);
    const page = await r.text();
    assert.match(page, /Statistiques globales/);
    assert.ok(!page.includes(user.email));
  } finally { await s.close(); }
});
