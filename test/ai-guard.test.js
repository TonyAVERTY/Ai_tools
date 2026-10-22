import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { now, setSetting } from '../src/db.js';
import { enqueue, Worker, jobRefusal, latestJobs } from '../src/services/jobs.js';
import { AI_JOBS } from '../src/services/budget.js';
import { makeHandlers } from '../src/handlers.js';
import { AI_BLOCKED_MESSAGE } from '../src/users.js';
import { startApp } from './helpers/server.js';

// Tant que la liaison Claude (J3) n'existe pas : aucun non-admin ne lance de job IA avec la configuration du serveur.
// Le refus est vérifié à chaque couche : route, file (enqueue), worker, handler.
let s, admin, user, userProject;
const AI_ROUTES = ['analyze', 'template', 'followup_template', 'prospect', 'evolution'];

before(async () => {
  s = await startApp({ cfg: { claudeBin: resolve('test/fixtures/does-not-exist.js') } });
  admin = await s.newUser({ email: 'admin@x.fr', admin: true });
  user = await s.newUser({ email: 'simple@x.fr', admin: false });
  // Projet « prêt » du non-admin : fiche, cible validée, de quoi passer toutes les gardes métier
  userProject = Number((await s.db.prepare(`INSERT INTO projects(user_id, name, git_url, profile_json, target_json, target_validated, created_at)
    VALUES(?, 'Mon projet', 'https://git.test/u/p.git', ?, ?, 1, ?)`).run(user.id, JSON.stringify({ resume: 'x' }), JSON.stringify({ description: 'd', secteurs: ['s'] }), now())).lastInsertRowid);
  await setSetting(s.db, user.id, 'forgejo_host', 'git.test');
  await setSetting(s.db, admin.id, 'forgejo_host', 'git.test');
});
after(() => s.close());

const jobCount = async (where = '1=1', ...a) => (await s.db.prepare(`SELECT COUNT(*) n FROM jobs WHERE ${where}`).get(...a)).n;

test('les jobs IA sont exactement ceux que le garde-fou connaît', () => {
  assert.deepEqual([...AI_JOBS].sort(), ['analyze', 'evolution', 'followup_template', 'prospect', 'template']);
});

test('routes : un non-admin reçoit 403 « Liaison Claude requise » pour chaque job IA, sans rien créer', async () => {
  for (const type of AI_ROUTES) {
    const r = await user.post(`/api/projects/${userProject}/${type}`, { count: 3, level: 'rapide' });
    assert.equal(r.status, 403, type);
    assert.equal((await r.json()).error, AI_BLOCKED_MESSAGE, type);
  }
  assert.equal(await jobCount('user_id = ?', user.id), 0, 'aucun job en file');
  assert.equal(AI_BLOCKED_MESSAGE, 'Liaison Claude requise (bientôt disponible)');
});

test('routes : l\'admin lance les mêmes jobs', async () => {
  const pa = Number((await s.db.prepare(`INSERT INTO projects(user_id, name, git_url, profile_json, target_json, target_validated, created_at)
    VALUES(?, 'Projet admin', 'https://git.test/a/p.git', ?, ?, 1, ?)`).run(admin.id, JSON.stringify({ resume: 'x' }), JSON.stringify({ description: 'd', secteurs: ['s'] }), now())).lastInsertRowid);
  for (const type of AI_ROUTES) {
    const r = await admin.post(`/api/projects/${pa}/${type}`, { count: 3, level: 'rapide' });
    assert.equal(r.status, 200, type);
  }
  assert.equal(await jobCount('user_id = ?', admin.id), AI_ROUTES.length);
});

test('création de projet : permise au non-admin, sans analyse automatique', async () => {
  const r = await user.post('/api/projects', { name: 'Nouveau', gitUrl: 'https://git.test/u/nouveau.git' });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.id);
  assert.equal(body.aiBlocked, AI_BLOCKED_MESSAGE);
  assert.equal(await jobCount('project_id = ?', body.id), 0, 'pas de job analyze');
  // pour un admin, l'analyse part comme avant
  const ra = await admin.post('/api/projects', { name: 'Nouveau admin', gitUrl: 'https://git.test/a/nouveau.git' });
  const ba = await ra.json();
  assert.equal(ba.aiBlocked, undefined);
  assert.equal(await jobCount("project_id = ? AND type = 'analyze'", ba.id), 1);
});

test('file : enqueue refuse un job IA pour un non-admin, quel que soit l\'appelant', async () => {
  for (const type of AI_JOBS) {
    await assert.rejects(enqueue(s.db, { userId: user.id, projectId: userProject, type }), { status: 403, message: AI_BLOCKED_MESSAGE }, type);
  }
  // les jobs sans IA restent permis (envoi, relance), soumis à leurs plafonds
  assert.equal((await enqueue(s.db, { userId: user.id, projectId: userProject, type: 'send', params: { count: 1 } })).existing, false);
  await s.db.prepare("UPDATE jobs SET status = 'cancelled' WHERE user_id = ?").run(user.id);
  assert.equal((await enqueue(s.db, { userId: user.id, projectId: userProject, type: 'followup', params: { count: 1 } })).existing, false);
  await s.db.prepare("UPDATE jobs SET status = 'cancelled' WHERE user_id = ?").run(user.id);
});

test('CRM, import CSV et envoi : permis au non-admin', async () => {
  let r = await user.post(`/api/projects/${userProject}/prospects/import`, { csv: 'email;entreprise\nclient@x.fr;Client' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).imported, 1);
  r = await user.get(`/api/projects/${userProject}/prospects`);
  assert.equal((await r.json()).total, 1);
  const prospect = (await s.db.prepare('SELECT id FROM prospects WHERE project_id = ?').get(userProject)).id;
  assert.equal((await user.post(`/api/prospects/${prospect}/notes`, { body: 'ok' })).status, 200);
  assert.equal((await user.get(`/api/projects/${userProject}/prospects.csv`)).status, 200);
  r = await user.post(`/api/projects/${userProject}/send`, { count: 1, confirm: true });
  assert.equal(r.status, 200, 'l\'envoi n\'utilise pas Claude');
  await s.db.prepare("UPDATE jobs SET status = 'cancelled' WHERE user_id = ?").run(user.id);
});

test('worker : un job IA d\'un non-admin déjà en base n\'est jamais exécuté ; un envoi du même compte, si', async () => {
  const ran = [];
  const h = (name) => async () => { ran.push(name); return { ok: true }; };
  const w = new Worker(s.db, Object.fromEntries([...AI_JOBS, 'send'].map((t) => [t, h(t)])), { thermalMax: 999, log: { error() {} } });
  await s.db.prepare("UPDATE jobs SET status = 'cancelled' WHERE status = 'queued'").run(); // jobs des tests précédents
  // Contournement de enqueue : insertion directe (donnée ancienne, bug, accès à la base)
  for (const type of AI_JOBS) {
    await s.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, created_at) VALUES(?, ?, ?, 'queued', ?)").run(user.id, userProject, type, now());
  }
  await s.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, created_at) VALUES(?, ?, 'send', 'queued', ?)").run(user.id, userProject, now());
  while (await w.tick()) { /* vide la file */ }
  assert.deepEqual(ran, ['send']);
  const rows = await s.db.prepare("SELECT type, status, error FROM jobs WHERE user_id = ? AND status = 'error'").all(user.id);
  assert.equal(rows.length, AI_JOBS.size);
  for (const r of rows) assert.equal(r.error, AI_BLOCKED_MESSAGE);
  assert.equal(await jobRefusal(s.db, { user_id: user.id, type: 'prospect' }), AI_BLOCKED_MESSAGE);
  assert.equal(await jobRefusal(s.db, { user_id: user.id, type: 'send' }), null);
  assert.equal(await jobRefusal(s.db, { user_id: admin.id, type: 'prospect' }), null);
  assert.equal(await jobRefusal(s.db, { user_id: 999999, type: 'send' }), 'Compte supprimé');
});

test('handlers : dernier garde-fou, Claude n\'est jamais lancé pour un non-admin', async () => {
  // claudeBin inexistant : si le garde-fou laissait passer, l'erreur serait un ENOENT du processus, pas ce message
  const handlers = makeHandlers(s.app);
  const ctx = (type) => ({ job: { id: 1, user_id: user.id, project_id: userProject, type }, params: { count: 1, level: 'rapide' }, signal: new AbortController().signal, progress: async () => {}, cancelled: async () => false, usage: { costUsd: 0, tokensIn: 0, tokensOut: 0 } });
  s.app.cfg.claudeBin = resolve('test/fixtures/fake-claude.js');
  await setSetting(s.db, user.id, 'notify_email', 'u@x.fr');
  await setSetting(s.db, user.id, 'smtp_enc', null);
  await assert.rejects(handlers.prospect(ctx('prospect')), { message: AI_BLOCKED_MESSAGE });
  await assert.rejects(handlers.template(ctx('template')), { message: AI_BLOCKED_MESSAGE });
  await assert.rejects(handlers.followup_template(ctx('followup_template')), { message: AI_BLOCKED_MESSAGE });
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM prospects WHERE project_id = ? AND company <> ?').get(userProject, 'Client')).n, 0, 'rien n\'a été écrit');
});

test('compte suspendu : plus aucun job, IA ou non, ni en file ni à l\'exécution', async () => {
  const sus = await s.newUser({ email: 'sus@x.fr', admin: true });
  const p = Number((await s.db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(sus.id, 'P', 'https://git.test/s/p.git', now())).lastInsertRowid);
  await enqueue(s.db, { userId: sus.id, projectId: p, type: 'send', params: { count: 1 } });
  await s.db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(sus.id);
  await assert.rejects(enqueue(s.db, { userId: sus.id, projectId: p, type: 'analyze' }), { status: 403, message: 'Compte suspendu' });
  await assert.rejects(enqueue(s.db, { userId: sus.id, projectId: p, type: 'send' }), { status: 403, message: 'Compte suspendu' });
  const ran = [];
  const w = new Worker(s.db, { send: async () => { ran.push('send'); } }, { thermalMax: 999, log: { error() {} } });
  while (await w.tick()) { /* vide la file */ }
  assert.deepEqual(ran, [], 'le job déjà en file d\'un compte suspendu ne part pas');
  assert.equal((await latestJobs(s.db, p)).send.error, 'Compte suspendu');
});

test('interface : la bannière « liaison Claude » n\'apparaît que pour les non-admins', async () => {
  const pageUser = await (await user.get('/')).text();
  assert.match(pageUser, /Liaison Claude requise \(bientôt disponible\)/);
  const pageAdmin = await (await admin.get('/')).text();
  assert.doesNotMatch(pageAdmin, /Liaison Claude requise/);
  // la température du serveur n'est pas exposée aux non-admins
  assert.equal((await (await user.get('/api/system')).json()).temp, null);
});

test('serveur complet (worker et planificateur démarrés par createApp) : job admin traité, job non-admin refusé', async () => {
  const full = await startApp({ worker: true, cfg: { claudeBin: resolve('test/fixtures/fake-claude.js') } });
  try {
    const a = await full.newUser({ email: 'adm@x.fr', admin: true });
    const u = await full.newUser({ email: 'usr@x.fr', admin: false });
    const mk = async (owner, url) => Number((await full.db.prepare('INSERT INTO projects(user_id, name, git_url, profile_json, target_json, created_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(owner.id, 'P', url, JSON.stringify({ resume: 'x', proposition_valeur: 'y' }), JSON.stringify({ description: 'd', secteurs: ['s'] }), now())).lastInsertRowid);
    const pa = await mk(a, 'https://git.test/a.git');
    const pu = await mk(u, 'https://git.test/u.git');
    const ja = (await enqueue(full.db, { userId: a.id, projectId: pa, type: 'template' })).id;
    const ju = Number((await full.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, created_at) VALUES(?, ?, 'template', 'queued', ?)").run(u.id, pu, now())).lastInsertRowid);
    const status = async (id) => (await full.db.prepare('SELECT status, error FROM jobs WHERE id = ?').get(id));
    for (let i = 0; i < 100 && ((await status(ja)).status === 'queued' || (await status(ju)).status === 'queued'); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal((await status(ja)).status, 'done', (await status(ja)).error);
    assert.deepEqual({ ...(await status(ju)) }, { status: 'error', error: AI_BLOCKED_MESSAGE });
    assert.equal((await full.db.prepare('SELECT COUNT(*) n FROM templates WHERE project_id = ?').get(pu)).n, 0);
    assert.equal((await full.db.prepare('SELECT COUNT(*) n FROM templates WHERE project_id = ?').get(pa)).n, 1);
  } finally { await full.close(); }
});
