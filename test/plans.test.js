import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setSetting, now } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { addUser, TEST_SECRET_KEY } from './helpers/users.js';
import { Worker, enqueue, cancelJob } from '../src/services/jobs.js';
import { makeHandlers } from '../src/handlers.js';
import { createProject, saveSecretConfig } from '../src/projects.js';
import { getUser } from '../src/users.js';
import { PLAN_LIMITS } from '../src/limits.js';
import { monthBounds, usageOf, quotaFor, assertRoom, recordUsage, planOf, usageView } from '../src/services/plans.js';
import { encrypt } from '../src/crypto.js';
import { importProspects } from '../src/services/csv.js';
import { startApp } from './helpers/server.js';

// Plafonds du plan gratuit appliqués côté serveur : à la limite exacte, sans compteur qui dérive, sans perte de données.

const LINK = { v: 1, mode: 'api_key', valid: true };
const free = (db, extra = {}) => addUser(db, { admin: false, link: LINK, ...extra });

async function world() {
  const db = await testDb();
  const sent = [];
  const app = { resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    db, cfg: { dataDir: '/tmp/x', appUrl: 'https://ai.test', secretKey: TEST_SECRET_KEY, sandbox: { enabled: false } },
    createTransport: () => ({ verify: async () => true, sendMail: async (m) => { sent.push(m); }, close() {} }),
    resolveMx: async () => [{ exchange: 'mx.test', priority: 10 }], // pas de DNS réel
  };
  return { db, app, sent };
}
const proj = async (w, userId, n = 1) => Number((await w.db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(userId, `p${n}`, `https://git.test/u${userId}/r${n}.git`, now())).lastInsertRowid);

test('les limites viennent d\'un seul module et reprennent le cadrage', () => {
  assert.deepEqual(PLAN_LIMITS.free, { projects: 1, prospects: 50, mails: 100, aiJobs: 6, seats: 1 });
});

test('mois calendaire à l\'heure de Paris, changement d\'heure compris', () => {
  const iso = (t) => new Date(t * 1000).toISOString();
  // 31 oct. 2026 23:30 UTC = 1er nov. 00:30 à Paris (heure d'hiver depuis le 25 oct.) : c'est déjà novembre
  let b = monthBounds(Date.parse('2026-10-31T23:30:00Z') / 1000);
  assert.equal(iso(b.start), '2026-10-31T23:00:00.000Z');
  assert.equal(iso(b.end), '2026-11-30T23:00:00.000Z');
  // 31 oct. 22:30 UTC = 23:30 à Paris : encore octobre (heure d'été jusqu'au 25 oct. : décalage +1 h seulement après)
  b = monthBounds(Date.parse('2026-10-31T22:30:00Z') / 1000);
  assert.equal(iso(b.start), '2026-09-30T22:00:00.000Z');
  assert.equal(iso(b.end), '2026-10-31T23:00:00.000Z');
  b = monthBounds(Date.parse('2026-12-15T12:00:00Z') / 1000);
  assert.equal(iso(b.end), '2026-12-31T23:00:00.000Z');
});

test('plan : un administrateur n\'a pas de limite, un plan inconnu retombe sur gratuit', async () => {
  const w = await world();
  const a = await getUser(w.db, await addUser(w.db, { admin: true }));
  const f = await getUser(w.db, await free(w.db));
  assert.equal(planOf(a), 'admin');
  assert.equal(planOf(f), 'free');
  assert.equal(planOf({ ...f, plan: 'invente' }), 'free');
  assert.equal(planOf({ ...f, plan: 'admin' }), 'admin', 'plan « admin » explicite');
  assert.equal((await quotaFor(w.db, a, 'mails')).unlimited, true);
  await assert.doesNotReject(assertRoom(w.db, a, 'projects', 1000));
});

test('projets : le 2e est refusé (403 plan_limit, lien /tarifs), un admin crée sans limite, créations simultanées bornées', async () => {
  const w = await world();
  const u = await free(w.db);
  await createProject(w.app, { userId: u, name: 'A', gitUrl: 'https://git.test/a/a.git' });
  await assert.rejects(createProject(w.app, { userId: u, name: 'B', gitUrl: 'https://git.test/a/b.git' }), (e) => {
    assert.equal(e.status, 403);
    assert.equal(e.code, 'plan_limit');
    assert.equal(e.data.upgradeUrl, '/tarifs');
    assert.match(e.message, /plafond du plan gratuit/);
    assert.match(e.message, /Rien n'est supprimé ni perdu/);
    assert.match(e.message, /\/tarifs/);
    return true;
  });
  assert.equal((await w.db.prepare('SELECT COUNT(*) n FROM projects WHERE user_id = ?').get(u)).n, 1, 'aucun projet supprimé');
  const admin = await addUser(w.db, { admin: true });
  for (let i = 0; i < 3; i++) await createProject(w.app, { userId: admin, name: `P${i}`, gitUrl: `https://git.test/z/${i}.git` });
  const u2 = await free(w.db);
  const res = await Promise.allSettled([1, 2, 3, 4].map((i) => createProject(w.app, { userId: u2, name: `C${i}`, gitUrl: `https://git.test/c/${i}.git` })));
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1, 'une seule création passe malgré la simultanéité');
});

test('jobs IA : 6 par mois, le 7e est refusé ; annulé sans démarrer = rendu ; projet supprimé = toujours compté', async () => {
  const w = await world();
  const u = await free(w.db);
  const p = await proj(w, u);
  const types = ['analyze', 'prospect', 'template', 'followup_template', 'evolution'];
  const ids = [];
  for (const type of types) ids.push((await enqueue(w.db, { userId: u, projectId: p, type })).id);
  assert.equal((await usageOf(w.db, u)).aiJobs, 5);
  await recordUsage(w.db, u, 'ai_job'); // un sixième job (ailleurs) : le plafond est atteint
  assert.equal((await usageOf(w.db, u)).aiJobs, PLAN_LIMITS.free.aiJobs);
  await assert.rejects(enqueue(w.db, { userId: u, projectId: p, type: 'analyze' }).then(() => enqueue(w.db, { userId: u, projectId: null, type: 'analyze' })), { status: 403, code: 'plan_limit' });
  // Le même job déjà en file n'est pas recompté (dédoublonnage)
  assert.equal((await enqueue(w.db, { userId: u, projectId: p, type: 'template' })).existing, true);
  // Annulé avant de démarrer : rendu
  await cancelJob(w.db, u, ids[0]);
  assert.equal((await usageOf(w.db, u)).aiJobs, 5);
  await enqueue(w.db, { userId: u, projectId: p, type: 'analyze' });
  await assert.rejects(enqueue(w.db, { userId: u, projectId: null, type: 'template' }), { code: 'plan_limit' }, 'à la limite exacte');
  // Supprimer le projet efface ses jobs, pas la consommation du mois
  await w.db.prepare('DELETE FROM projects WHERE id = ?').run(p);
  assert.equal((await w.db.prepare('SELECT COUNT(*) n FROM jobs WHERE user_id = ?').get(u)).n, 0);
  assert.ok((await usageOf(w.db, u)).aiJobs >= 5, 'pas de contournement par suppression du projet (le job annulé, disparu avec le projet, compte par prudence)');
  const p2 = await proj(w, u, 2);
  await assert.rejects(enqueue(w.db, { userId: u, projectId: p2, type: 'evolution' }), { code: 'plan_limit' });
  // Le mois suivant, tout repart de zéro
  const next = monthBounds().end + 3600;
  assert.equal((await usageOf(w.db, u, { at: next })).aiJobs, 0);
  // Les jobs sans IA (envoi) ne consomment pas de job IA
  const admin = await addUser(w.db, { admin: true });
  for (let i = 0; i < 8; i++) await recordUsage(w.db, admin, 'ai_job', { ref: null });
  await assert.doesNotReject(assertRoom(w.db, await getUser(w.db, admin), 'aiJobs'));
});

test('jobs IA : le plafond d\'un compte ne touche pas un autre compte', async () => {
  const w = await world();
  const a = await free(w.db), b = await free(w.db);
  const pa = await proj(w, a), pb = await proj(w, b);
  for (const type of ['analyze', 'prospect', 'template', 'followup_template', 'evolution']) await enqueue(w.db, { userId: a, projectId: pa, type });
  await assert.doesNotReject(enqueue(w.db, { userId: b, projectId: pb, type: 'analyze' }));
});

test('mails : 100 par mois, le 101e refusé à la limite exacte ; un lot est tronqué à ce qui reste, sans perte', async () => {
  const w = await world();
  const u = await free(w.db);
  const user = await getUser(w.db, u);
  for (let i = 0; i < 99; i++) await recordUsage(w.db, u, 'mail');
  assert.equal((await quotaFor(w.db, user, 'mails')).remaining, 1);
  await assert.doesNotReject(assertRoom(w.db, user, 'mails', 1));
  await assert.rejects(assertRoom(w.db, user, 'mails', 2), (e) => /Il te reste 1 mail ce mois-ci sur 100/.test(e.message));
  await recordUsage(w.db, u, 'mail');
  await assert.rejects(assertRoom(w.db, user, 'mails', 1), (e) => e.code === 'plan_limit' && /100 mails ce mois-ci sur 100/.test(e.message));

  // Lot réel : 98 déjà envoyés, 5 demandés → 2 partent, 3 prospects restent à contacter, le suivant est refusé
  const w2 = await world();
  const v = await free(w2.db);
  await setSetting(w2.db, v, 'send_delay_min', '0'); await setSetting(w2.db, v, 'send_delay_max', '0');
  const p = await proj(w2, v);
  await saveSecretConfig(w2.app, p, 'smtp_enc', { host: 'smtp.test', port: 587, user: 'u', pass: 'p', fromEmail: 'a@b.fr' }, 'pass');
  await w2.db.prepare("INSERT INTO templates(project_id, kind, subject, body, status, updated_at) VALUES(?, 'initial', 's', 'b {{entreprise}}', 'validated', ?)").run(p, now());
  for (let i = 0; i < 5; i++) await w2.db.prepare("INSERT INTO prospects(project_id, company, email, created_at) VALUES(?, ?, ?, ?)").run(p, `E${i}`, `e${i}@x${i}.fr`, now());
  for (let i = 0; i < 98; i++) await recordUsage(w2.db, v, 'mail');
  const worker = new Worker(w2.db, makeHandlers(w2.app), { log: { error() {} } });
  const { id } = await enqueue(w2.db, { userId: v, projectId: p, type: 'send', params: { count: 5 } });
  await worker.tick();
  const job = await w2.db.prepare('SELECT status, result_json FROM jobs WHERE id = ?').get(id);
  assert.equal(job.status, 'done');
  assert.equal(JSON.parse(job.result_json).sent, 2);
  assert.equal(w2.sent.length, 2);
  assert.equal((await w2.db.prepare("SELECT COUNT(*) n FROM prospects WHERE project_id = ? AND status = 'new'").get(p)).n, 3, 'rien de perdu');
  await assert.rejects(enqueue(w2.db, { userId: v, projectId: p, type: 'send', params: { count: 1 } }), { code: 'plan_limit' });
  await assert.rejects(enqueue(w2.db, { userId: v, projectId: p, type: 'followup', params: { count: 1 } }), { code: 'plan_limit' });
});

test('prospects : 50 au total, l\'import est refusé en entier (rien importé) au-delà, accepté à la limite exacte', async () => {
  const w = await world();
  const u = await free(w.db);
  const user = await getUser(w.db, u);
  const p = await proj(w, u);
  const csv = (from, n) => 'email,entreprise\n' + Array.from({ length: n }, (_, i) => `c${from + i}@dom${from + i}.fr,E${from + i}`).join('\n');
  const q = () => quotaFor(w.db, user, 'prospects');
  const imp = async (text) => {
    const quota = await q();
    return importProspects(w.db, p, text, { limit: quota.remaining, limitError: new Error(`plafond : il reste ${quota.remaining}`) });
  };
  assert.equal((await imp(csv(0, 49))).imported, 49);
  await assert.rejects(imp(csv(100, 2)), /il reste 1/);
  assert.equal((await q()).used, 49, 'l\'import refusé n\'a rien écrit (tout ou rien)');
  assert.equal((await imp(csv(200, 1))).imported, 1, '50e prospect : accepté');
  await assert.rejects(imp(csv(300, 1)), /il reste 0/);
  assert.equal((await q()).used, 50);
});

test('prospection : les prospects trouvés au-delà du plafond ne sont pas enregistrés, le job signale le plafond', async () => {
  const w = await world();
  const u = await free(w.db, { link: { v: 1, mode: 'api_key', valid: true, secret_enc: encrypt(w.app.cfg.secretKey, 'sk-ant-' + 'a'.repeat(30)) } });
  const p = await proj(w, u);
  await w.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?').run(JSON.stringify({ resume: 'r', proposition_valeur: 'v' }), JSON.stringify({ description: 'd', secteurs: ['s'] }), p);
  for (let i = 0; i < 49; i++) await w.db.prepare('INSERT INTO prospects(project_id, company, email, created_at) VALUES(?, ?, ?, ?)').run(p, `E${i}`, `e${i}@d${i}.fr`, now());
  const { resolve } = await import('node:path');
  w.app.cfg.claudeBin = resolve('test/fixtures/fake-claude.js');
  const worker = new Worker(w.db, makeHandlers(w.app), { log: { error() {} } });
  const { id } = await enqueue(w.db, { userId: u, projectId: p, type: 'prospect', params: { count: 3 } });
  await worker.tick();
  const job = await w.db.prepare('SELECT status, error, result_json FROM jobs WHERE id = ?').get(id);
  assert.equal(job.status, 'done', job.error);
  const r = JSON.parse(job.result_json);
  assert.equal(r.found, 1);
  assert.equal(r.capped, true);
  assert.equal((await w.db.prepare('SELECT COUNT(*) n FROM prospects WHERE project_id = ?').get(p)).n, 50);
});

test('HTTP : refus explicite avec code plan_limit et lien /tarifs ; le projet est créé même si l\'analyse est refusée', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: false, link: LINK });
    await s.db.prepare("INSERT INTO user_settings(user_id, `key`, value) VALUES(?, 'forgejo_host', 'git.test')").run(u.id);
    for (let i = 0; i < PLAN_LIMITS.free.aiJobs; i++) await recordUsage(s.db, u.id, 'ai_job');
    const ok = await u.post('/api/projects', { name: 'Un', gitUrl: 'https://git.test/a/un.git' });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.ok(body.id);
    assert.match(body.notice, /plafond du plan gratuit/, 'le projet existe, seule l\'analyse attend');
    const second = await u.post('/api/projects', { name: 'Deux', gitUrl: 'https://git.test/a/deux.git' });
    assert.equal(second.status, 403);
    const e = await second.json();
    assert.equal(e.code, 'plan_limit');
    assert.equal(e.upgradeUrl, '/tarifs');
    assert.match(e.error, /\/tarifs/);
    const analyze = await u.post(`/api/projects/${body.id}/analyze`, {});
    assert.equal(analyze.status, 403);
    assert.equal((await analyze.json()).code, 'plan_limit');
  } finally { await s.close(); }
});

test('Mon compte et tableau de bord : barres d\'usage du mois, plafond atteint signalé ; admin sans barre de plafond', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: false, link: LINK });
    const pid = await proj({ db: s.db }, u.id);
    for (let i = 0; i < 100; i++) await recordUsage(s.db, u.id, 'mail');
    for (const page of ['/account', '/']) {
      const h = await (await u.get(page, { headers: { accept: 'text/html' } })).text();
      assert.match(h, /Usage du mois/, page);
      assert.match(h, /plan gratuit/, page);
      assert.match(h, /Mails ce mois-ci<\/span><span class="g-v">100 \/ 100/, page);
      assert.match(h, /<div class="bar usage full"[^>]*><span class="w-100">/, page);
      assert.match(h, /<span class="w-100">/);
      assert.match(h, /Plafond atteint : .*mails ce mois-ci/, page);
      assert.match(h, /Projets<\/span><span class="g-v">1 \/ 1/, page);
      assert.doesNotMatch(h, /style="/, 'pas de style en ligne (CSP)');
    }
    assert.ok(pid);
    const a = await s.newUser({ admin: true });
    const h = await (await a.get('/account', { headers: { accept: 'text/html' } })).text();
    assert.match(h, /plan administrateur/);
    assert.doesNotMatch(h, /class="bar usage/);
    const view = await usageView(s.db, await getUser(s.db, u.id));
    assert.deepEqual(view.items.map((i) => i.limit), [1, 50, 100, 6]);
  } finally { await s.close(); }
});

test('Tarifs : plus de « pas encore appliqués », chiffres identiques à la configuration', async () => {
  const s = await startApp();
  try {
    const h = await (await s.anon.get('/tarifs', { headers: { accept: 'text/html' } })).text();
    assert.doesNotMatch(h, /pas encore appliqu/);
    assert.match(h, /appliqués par le serveur/);
    for (const n of Object.values(PLAN_LIMITS.free)) assert.ok(h.includes(`<b>${n}</b>`), String(n));
  } finally { await s.close(); }
});
