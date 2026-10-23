import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { now, setSetting } from '../src/db.js';
import { encrypt } from '../src/crypto.js';
import { saveSecretConfig, getProject, listProjects, sentSince } from '../src/projects.js';
import { enqueue, cancelJob, latestJobs, usageSummary } from '../src/services/jobs.js';
import { budgetState } from '../src/services/budget.js';
import { weeklyStats } from '../src/services/report.js';
import { exportProspects, importProspects } from '../src/services/csv.js';
import { parseFilters } from '../src/services/crm.js';
import { Scheduler } from '../src/services/scheduler.js';
import { startApp } from './helpers/server.js';
import { unsubToken } from '../src/crypto.js';

// Deux comptes (tous deux admins : l'isolation ne doit rien au rôle). A possède des données de chaque type,
// B essaie de tout lire et tout modifier : 404 partout, et les données de A restent intactes.
let s, A, B, ids;

before(async () => {
  s = await startApp();
  A = await s.newUser({ email: 'a@x.fr' });
  B = await s.newUser({ email: 'b@x.fr' });
  const { db, app } = s;
  const t = now();
  const pa = Number((await db.prepare('INSERT INTO projects(user_id, name, git_url, profile_json, target_json, target_validated, created_at) VALUES(?, ?, ?, ?, ?, 1, ?)')
    .run(A.id, 'Projet Secret A', 'https://git.test/a/secret.git', JSON.stringify({ resume: 'x' }), JSON.stringify({ description: 'd', secteurs: ['s'] }), t)).lastInsertRowid);
  await saveSecretConfig(app, pa, 'smtp_enc', { host: 'smtp.secret-a.fr', user: 'u', pass: 'pw-secret-a', fromEmail: 'a@secret-a.fr' }, 'pass');
  await saveSecretConfig(app, pa, 'imap_enc', { host: 'imap.secret-a.fr' }, 'pass');
  await saveSecretConfig(app, pa, 'db_enc', { type: 'mysql', host: 'db.secret-a.fr', sql_users: 'SELECT 1' }, 'password');
  const prospect = Number((await db.prepare("INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, 'Alpha SARL', 'alpha@secret-a.fr', 'sent', ?, ?)").run(pa, t, t)).lastInsertRowid);
  const note = Number((await db.prepare("INSERT INTO prospect_notes(prospect_id, body, created_at) VALUES(?, 'note confidentielle A', ?)").run(prospect, t)).lastInsertRowid);
  await db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, subject) VALUES(?, ?, 'alpha@secret-a.fr', ?, 'initial', 'Objet confidentiel A')").run(pa, prospect, t);
  await db.prepare("INSERT INTO templates(project_id, kind, subject, body, status, updated_at) VALUES(?, 'initial', 'Objet A', 'Corps A', 'validated', ?)").run(pa, t);
  await db.prepare('INSERT INTO metrics_daily(project_id, day, users, clients, revenue) VALUES(?, ?, 42, 7, 999)').run(pa, '2026-10-21');
  const job = Number((await db.prepare("INSERT INTO jobs(user_id, project_id, type, status, cost_usd, created_at) VALUES(?, ?, 'send', 'queued', 3.5, ?)").run(A.id, pa, t)).lastInsertRowid);
  await setSetting(db, A.id, 'notify_email', 'a-notify@secret-a.fr');
  await setSetting(db, A.id, 'forgejo_host', 'git.secret-a.fr');
  await setSetting(db, A.id, 'discord_webhook_enc', encrypt(app.cfg.secretKey, 'https://discord.com/api/webhooks/123456789012345678/secretsecretsecretsecret'));
  await db.prepare("INSERT INTO blacklist(email, reason, created_at) VALUES('refus@secret-a.fr', 'refused', ?)").run(t);
  ids = { pa, prospect, note, job };
});
after(() => s.close());

const REFUS = (r) => assert.ok([403, 404].includes(r.status), `statut ${r.status} au lieu de 403/404`);

test('IDOR : B ne peut lire ni modifier aucune ressource de A (404 partout)', async () => {
  const { pa, prospect, note, job } = ids;
  const routes = [
    ['GET', `/api/projects/${pa}/status`],
    ['GET', `/api/projects/${pa}/recap`],
    ['GET', `/api/projects/${pa}/history`],
    ['GET', `/api/projects/${pa}/prospects`],
    ['GET', `/api/projects/${pa}/prospects.csv`],
    ['POST', `/api/projects/${pa}/prospects/import`, { csv: 'email;entreprise\nx@y.fr;X' }],
    ['POST', `/api/projects/${pa}/target`, { description: 'pirate', secteurs: 'x' }],
    ['POST', `/api/projects/${pa}/followup`, { enabled: true, days: 3 }],
    ['POST', `/api/projects/${pa}/smtp`, { host: 'evil.example', user: 'u', pass: 'p', fromEmail: 'e@e.fr' }],
    ['POST', `/api/projects/${pa}/imap`, { host: 'evil.example' }],
    ['POST', `/api/projects/${pa}/inbox/check`, {}],
    ['POST', `/api/projects/${pa}/db`, { type: 'mysql', host: 'evil.example', sql_users: 'SELECT 1' }],
    ['POST', `/api/projects/${pa}/template/save`, { kind: 'initial', subject: 'pirate', body: 'pirate' }],
    ['POST', `/api/projects/${pa}/analyze`, {}],
    ['POST', `/api/projects/${pa}/template`, {}],
    ['POST', `/api/projects/${pa}/followup_template`, {}],
    ['POST', `/api/projects/${pa}/prospect`, { count: 5 }],
    ['POST', `/api/projects/${pa}/evolution`, { count: 5 }],
    ['POST', `/api/projects/${pa}/send`, { count: 5, confirm: true }],
    ['POST', `/api/projects/${pa}/delete`, {}],
    ['GET', `/api/prospects/${prospect}`],
    ['POST', `/api/prospects/${prospect}/status`, { status: 'client' }],
    ['POST', `/api/prospects/${prospect}/notes`, { body: 'pirate' }],
    ['POST', `/api/prospects/${prospect}/notes/${note}/delete`, {}],
    ['POST', `/api/prospects/${prospect}/next`, { action: 'pirate', day: '2026-11-03' }],
    ['POST', `/api/jobs/${job}/cancel`, {}],
  ];
  for (const [method, path, body] of routes) {
    const r = method === 'GET' ? await B.get(path) : await B.post(path, body);
    REFUS(r);
    const text = await r.text();
    assert.ok(!/secret-a|Projet Secret|confidentiel|pw-secret/i.test(text), `${method} ${path} ne divulgue rien`);
  }

  // Rien n'a bougé chez A
  const { db } = s;
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects WHERE id = ?').get(pa)).n, 1);
  assert.equal((await db.prepare('SELECT status FROM prospects WHERE id = ?').get(prospect)).status, 'sent');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM prospect_notes WHERE id = ?').get(note)).n, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM prospect_notes').get()).n, 1);
  assert.equal((await db.prepare('SELECT status FROM jobs WHERE id = ?').get(job)).status, 'queued');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM jobs').get()).n, 1, 'aucun job créé');
  const p = await db.prepare('SELECT * FROM projects WHERE id = ?').get(pa);
  assert.equal(p.followup_enabled, 0);
  assert.equal(JSON.parse(p.target_json).description, 'd');
  assert.ok(p.smtp_enc && !p.smtp_enc.includes('evil'));
  assert.equal((await db.prepare('SELECT subject FROM templates WHERE project_id = ?').get(pa)).subject, 'Objet A');
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM prospects WHERE company = 'X'").get()).n, 0, 'rien importé');
});

test('A accède bien à ses propres ressources (contre-épreuve)', async () => {
  const { pa, prospect } = ids;
  assert.equal((await A.get(`/api/projects/${pa}/status`)).status, 200);
  assert.equal((await A.get(`/api/projects/${pa}/prospects`)).status, 200);
  assert.equal((await A.get(`/api/prospects/${prospect}`)).status, 200);
  const csv = await A.get(`/api/projects/${pa}/prospects.csv`);
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /alpha@secret-a\.fr/);
});

test('listes et pages de B : aucune donnée de A (tableau de bord, réglages, système)', async () => {
  const dash = await (await B.get('/')).text();
  assert.doesNotMatch(dash, /Projet Secret|secret-a/i);
  assert.match(dash, /Aucun projet/);

  const settings = await (await B.get('/settings')).text();
  assert.doesNotMatch(settings, /secret-a|a-notify|smtp\.secret/i);
  assert.doesNotMatch(settings, /\d+ de tes prospects/, 'la liste d\'opposition commune ne montre aucun décompte');

  const sys = await (await B.get('/api/system')).json();
  assert.equal(sys.queue, 0);
  assert.deepEqual(sys.jobs, []);
  assert.equal(sys.usage.month.cost, 0);
  assert.equal(sys.budget.month.used, 0);

  const sysA = await (await A.get('/api/system')).json();
  assert.equal(sysA.queue, 1);
  assert.equal(sysA.usage.month.cost, 3.5);
  assert.equal(sysA.jobs[0].project, 'Projet Secret A');

  const dashA = await (await A.get('/')).text();
  assert.match(dashA, /Projet Secret A/);
});

test('exports et imports CSV : jamais les prospects d\'un autre compte', async () => {
  const pb = Number((await s.db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(B.id, 'Projet B', 'https://git.test/b/b.git', now())).lastInsertRowid);
  await s.db.prepare("INSERT INTO prospects(project_id, company, email, created_at) VALUES(?, 'Beta SAS', 'beta@b.fr', ?)").run(pb, now());
  const csv = await (await B.get(`/api/projects/${pb}/prospects.csv`)).text();
  assert.match(csv, /beta@b\.fr/);
  assert.doesNotMatch(csv, /alpha|secret-a/i);
  const list = await (await B.get(`/api/projects/${pb}/prospects`)).json();
  assert.deepEqual(list.rows.map((x) => x.email), ['beta@b.fr']);

  // Importer chez B la même adresse que A : c'est un nouveau prospect de B, sans aucun signe de l'existence de celui de A
  const r = await B.post(`/api/projects/${pb}/prospects/import`, { csv: 'email;entreprise\nalpha@secret-a.fr;Alpha chez B' });
  assert.deepEqual(await r.json(), { total: 1, imported: 1, skipped: 0, invalid: [] });
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM prospects WHERE email = ?').get('alpha@secret-a.fr')).n, 2);
  const detail = await (await B.get(`/api/prospects/${(await s.db.prepare("SELECT id FROM prospects WHERE project_id = ? AND email = 'alpha@secret-a.fr'").get(pb)).id}`)).json();
  assert.deepEqual(detail.mails, [], 'pas les mails envoyés par A');
  assert.deepEqual(detail.notes, [], 'pas les notes de A');

  // Au niveau service : l'export est borné au projet passé
  const direct = await exportProspects(s.db, pb, parseFilters(new URLSearchParams()));
  assert.doesNotMatch(direct, /Alpha SARL/);
  const res = await importProspects(s.db, pb, 'email\nbeta@b.fr');
  assert.equal(res.skipped, 1);
});

test('liste d\'opposition commune : elle bloque, mais ne révèle ni motif ni origine d\'un autre compte', async () => {
  // L'adresse refusée par A bloque aussi B (RGPD), et c'est tout ce que B apprend
  const pb = (await s.db.prepare("SELECT id FROM projects WHERE user_id = ?").get(B.id)).id;
  const r = await B.post(`/api/projects/${pb}/prospects/import`, { csv: 'email;entreprise\nrefus@secret-a.fr;Refus' });
  assert.deepEqual(await r.json(), { total: 1, imported: 0, skipped: 1, invalid: [] });

  // Un prospect de B dont l'adresse est sur la liste à cause de A : motif générique
  const id = Number((await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, 'Doublon', 'gamma@secret-a.fr', 'new', ?)").run(pb, now())).lastInsertRowid);
  await s.db.prepare("INSERT INTO blacklist(email, reason, created_at) VALUES('gamma@secret-a.fr', 'bounce', ?)").run(now());
  let d = await (await B.get(`/api/prospects/${id}`)).json();
  assert.equal(d.optOut, null, 'B ne découvre pas qu\'une adresse est sur la liste à cause d\'un autre compte');
  // Quand le prospect de B porte lui-même le statut « refus », le motif reste générique (« bounce » vient d'un autre compte)
  await s.db.prepare("UPDATE prospects SET status = 'refused' WHERE id = ?").run(id);
  d = await (await B.get(`/api/prospects/${id}`)).json();
  assert.deepEqual(d.optOut, { reason: 'refused' });
  const settings = await (await B.get('/settings')).text();
  assert.doesNotMatch(settings, /refus@secret-a/);
  assert.doesNotMatch(settings, /\d+ de tes prospects ont demandé/, 'aucun décompte : la liste n\'est pas consultable');

  // Désinscription publique : n'expose ni projet ni compte
  const email = 'alpha@secret-a.fr';
  const tok = unsubToken(s.app.cfg.secretKey, email);
  const page = await (await s.anon.get(`/u/${encodeURIComponent(email)}/${tok}`)).text();
  assert.doesNotMatch(page, /Projet Secret|Alpha SARL|a@x\.fr/);
  const done = await (await s.anon.post(`/u/${encodeURIComponent(email)}/${tok}`, {}, { origin: null })).text();
  assert.doesNotMatch(done, /Projet Secret|Alpha SARL|a@x\.fr/);
});

test('un même dépôt peut être un projet pour deux comptes (unicité par utilisateur)', async () => {
  await setSetting(s.db, A.id, 'forgejo_host', 'git.test');
  await setSetting(s.db, B.id, 'forgejo_host', 'git.test');
  const url = 'https://git.test/shared/repo.git';
  assert.equal((await A.post('/api/projects', { name: 'Partagé', gitUrl: url })).status, 200);
  assert.equal((await B.post('/api/projects', { name: 'Partagé', gitUrl: url })).status, 200);
  assert.equal((await A.post('/api/projects', { name: 'Doublon', gitUrl: url })).status, 409, 'doublon refusé chez le même compte');
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM projects WHERE git_url = ?').get(url)).n, 2);
});

test('couche service : getProject, enqueue, cancelJob, budget, usage, rapport, envois sont bornés à l\'utilisateur', async () => {
  const { pa, job } = ids;
  const { app, db } = s;
  await assert.rejects(getProject(app, pa, { userId: B.id }), { status: 404 });
  await assert.rejects(getProject(app, pa), /userId requis/, 'impossible d\'oublier l\'utilisateur');
  assert.equal((await getProject(app, pa, { userId: A.id })).name, 'Projet Secret A');
  assert.ok(!(await listProjects(app, B.id)).some((p) => p.id === pa));

  await assert.rejects(enqueue(db, { userId: B.id, projectId: pa, type: 'send' }), { status: 404 });
  await assert.rejects(cancelJob(db, B.id, job), { status: 404 });
  assert.equal((await db.prepare('SELECT status FROM jobs WHERE id = ?').get(job)).status, 'queued');

  assert.equal((await budgetState(db, B.id)).month.used, 0);
  assert.equal((await budgetState(db, A.id)).month.used, 3.5);
  assert.equal((await usageSummary(db, B.id)).month.cost, 0);

  const wb = await weeklyStats(db, B.id);
  assert.ok(!wb.projects.some((p) => p.name === 'Projet Secret A'));
  assert.equal(wb.totals.cost, 0);

  assert.equal(await sentSince(db, 0, A.id), 1);
  assert.equal(await sentSince(db, 0, B.id), 0, 'plafond d\'envoi calculé par utilisateur');
  assert.equal(await sentSince(db, 0, B.id, pa), 0, 'même avec un projet qui n\'est pas le sien');

  const jobs = await latestJobs(db, pa);
  assert.equal(jobs.send.status, 'queued');
});

test('réglages : chaque compte a les siens', async () => {
  const r = await B.post('/settings', { notify_email: 'b-notify@x.fr', git_type_0: 'forgejo', git_host_0: 'git.b.fr', git_token_0: 'tok-de-b', global_daily_cap: '5', send_delay_min: '5', send_delay_max: '6' }, { form: true });
  assert.equal(r.status, 303);
  const val = (u, k) => s.db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND `key` = ?').get(u, k).then((x) => x?.value);
  assert.equal(await val(B.id, 'notify_email'), 'b-notify@x.fr');
  assert.equal(await val(A.id, 'notify_email'), 'a-notify@secret-a.fr', 'les réglages de A sont intacts');
  assert.equal(await val(A.id, 'forgejo_host'), 'git.test', 'le serveur Git de A est intact');
  assert.equal(await val(A.id, 'git_servers_json'), undefined, 'et B n\'a rien écrit chez A');
  const servers = JSON.parse(await val(B.id, 'git_servers_json'));
  assert.deepEqual(servers.map((x) => x.host), ['git.b.fr']);
  assert.ok(!JSON.stringify(servers).includes('tok-de-b'), 'le token de B est chiffré');
});

test('tâches de fond : le planificateur ne traite que les comptes actifs, projet par projet avec son propriétaire', async () => {
  const { app, db } = s;
  const pb = (await db.prepare('SELECT id FROM projects WHERE user_id = ? LIMIT 1').get(B.id)).id;
  await db.prepare('UPDATE projects SET followup_enabled = 1 WHERE id = ?').run(pb);
  await db.prepare("INSERT INTO templates(project_id, kind, subject, body, status, updated_at) VALUES(?, 'followup', '', 'x', 'validated', ?)").run(pb, now());
  await saveSecretConfig(app, pb, 'smtp_enc', { host: 'h', user: 'u', pass: 'p', fromEmail: 'b@b.fr' }, 'pass');
  await saveSecretConfig(app, pb, 'imap_enc', { host: 'i' }, 'pass');
  await db.prepare('UPDATE projects SET inbox_json = ? WHERE id = ?').run(JSON.stringify({ lastOk: now(), lastError: null }), pb);
  await db.prepare("INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, 'Due', 'due@b.fr', 'sent', ?, ?)").run(pb, now() - 20 * 86400, now() - 20 * 86400);
  const sched = new Scheduler({ ...app, isBusinessHours: () => true }, { log: { error() {} } });
  const wed = new Date('2026-10-21T10:00:00+02:00');
  await db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(B.id);
  assert.equal((await sched.queueFollowups({ date: wed })).length, 0, 'compte suspendu : rien en file');
  await db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(B.id);
  const queued = await sched.queueFollowups({ date: wed });
  assert.equal(queued.length, 1);
  const j = await db.prepare('SELECT user_id, project_id FROM jobs WHERE id = ?').get(queued[0].id);
  assert.deepEqual({ u: Number(j.user_id), p: Number(j.project_id) }, { u: B.id, p: pb }, 'le job appartient au propriétaire du projet');
});
