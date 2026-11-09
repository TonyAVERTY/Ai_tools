// Lot « CRM et IA » : Kanban, régénération d'accroche, audit du projet (routes, accès, isolation).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../src/db.js';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import { projectsHtml } from './helpers/pages.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

const addProspect = async (pid, company, email, status = 'new', extra = {}) => Number((await s.db.prepare(
  'INSERT INTO prospects(project_id, company, email, status, score, city, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)').run(pid, company, email, status, extra.score ?? 5, extra.city ?? null, now())).lastInsertRowid);

test('Kanban : une colonne par statut, totaux, filtres appliqués, 25 fiches par colonne, isolation', async () => {
  const u = await s.newUser(), v = await s.newUser();
  const pid = await addProject(s.db, u.id, { gitUrl: 'https://github.com/u/k.git' });
  for (let i = 0; i < 30; i++) await addProspect(pid, `Neuf ${i}`, `n${i}@a.fr`, 'new', { city: i < 3 ? 'Rennes' : 'Nantes' });
  await addProspect(pid, 'Contacté', 'c@a.fr', 'sent');
  await addProspect(pid, 'Répondu', 'r@a.fr', 'replied');
  await addProspect(pid, 'Invalide', 'i@a.fr', 'invalid');
  const r = await (await u.get(`/api/projects/${pid}/kanban`)).json();
  const col = Object.fromEntries(r.columns.map((c) => [c.status, c]));
  assert.deepEqual(r.columns.map((c) => c.status), ['new', 'sent', 'replied', 'client', 'refused', 'bounced', 'invalid']);
  assert.equal(col.new.total, 30);
  assert.equal(col.new.rows.length, 25, 'colonne bornée');
  assert.equal(col.sent.rows[0].company, 'Contacté');
  assert.equal(col.invalid.total, 1);
  const q = await (await u.get(`/api/projects/${pid}/kanban?q=Neuf%201&status=sent`)).json();
  assert.equal(q.columns.find((c) => c.status === 'new').total, 11, 'le filtre texte s\'applique, le filtre statut est ignoré');
  assert.equal(q.columns.find((c) => c.status === 'sent').total, 0);
  assert.equal((await v.get(`/api/projects/${pid}/kanban`)).status, 404, 'projet d\'un autre compte');
});

test('régénérer l\'accroche : mise en file, une seule à la fois, accès et isolation', async () => {
  const u = await s.newUser(), v = await s.newUser();
  const pid = await addProject(s.db, u.id, { gitUrl: 'https://github.com/u/h.git' });
  const x = await addProspect(pid, 'Atelier', 'a@atelier.fr');
  assert.equal((await v.post(`/api/prospects/${x}/hook`, {})).status, 404, 'un autre compte ne lance rien');
  assert.equal((await s.anon.post(`/api/prospects/${x}/hook`, {})).status, 401);
  const first = await (await u.post(`/api/prospects/${x}/hook`, {})).json();
  assert.ok(first.id && !first.existing);
  assert.equal((await (await u.post(`/api/prospects/${x}/hook`, {})).json()).existing, true, 'déjà en file');
  const job = await s.db.prepare("SELECT type, params_json, user_id FROM jobs WHERE id = ?").get(first.id);
  assert.deepEqual([job.type, job.params_json, Number(job.user_id)], ['hook', JSON.stringify({ prospectId: x }), u.id]);
  const d = await (await u.get(`/api/prospects/${x}`)).json();
  assert.equal(d.hookJob.status, 'queued');
  assert.equal((await (await v.get(`/api/prospects/${x}`)).status), 404);
});

test('audit : réservé aux administrateurs du projet, jamais à un simple membre ; niveau borné', async () => {
  const owner = await s.newUser(), member = await s.newUser(), admin = await s.newUser(), stranger = await s.newUser();
  const pid = await addProject(s.db, owner.id, { gitUrl: 'https://github.com/u/a.git' });
  const team = Number((await s.db.prepare("INSERT INTO teams(owner_id, name, created_at) VALUES(?, 'T', ?)").run(owner.id, now())).lastInsertRowid);
  await s.db.prepare("INSERT INTO team_members(team_id, user_id, role, created_at) VALUES(?, ?, 'member', ?)").run(team, member.id, now());
  await s.db.prepare("INSERT INTO team_members(team_id, user_id, role, created_at) VALUES(?, ?, 'admin', ?)").run(team, admin.id, now());
  await s.db.prepare('UPDATE projects SET team_id = ? WHERE id = ?').run(team, pid);
  assert.equal((await member.post(`/api/projects/${pid}/code-review`, { level: 'rapide' })).status, 403);
  assert.equal((await stranger.post(`/api/projects/${pid}/code-review`, { level: 'rapide' })).status, 404);
  const ok = await admin.post(`/api/projects/${pid}/code-review`, { level: 'ultra' });
  assert.equal(ok.status, 200);
  const job = await s.db.prepare("SELECT params_json FROM jobs WHERE project_id = ? AND type = 'audit'").get(pid);
  assert.equal(JSON.parse(job.params_json).level, 'rapide', 'niveau inconnu : rapide');
  const html = await projectsHtml(owner);
  assert.match(html, /data-job="audit"/);
});
