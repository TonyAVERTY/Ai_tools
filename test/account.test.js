import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { now, setSetting } from '../src/db.js';
import { repoDir } from '../src/projects.js';
import { deleteUser } from '../src/users.js';
import { startApp } from './helpers/server.js';

let s, A, B;
const clone = {};

// Toutes les tables qui portent des données d'un utilisateur, et comment les compter pour lui
const OWN_PROJECTS = 'SELECT id FROM projects WHERE user_id = ?';
const COUNTS = {
  users: 'SELECT COUNT(*) n FROM users WHERE id = ?',
  sessions: 'SELECT COUNT(*) n FROM sessions WHERE user_id = ?',
  user_settings: 'SELECT COUNT(*) n FROM user_settings WHERE user_id = ?',
  projects: 'SELECT COUNT(*) n FROM projects WHERE user_id = ?',
  jobs: 'SELECT COUNT(*) n FROM jobs WHERE user_id = ?',
  templates: `SELECT COUNT(*) n FROM templates WHERE project_id IN (${OWN_PROJECTS})`,
  prospects: `SELECT COUNT(*) n FROM prospects WHERE project_id IN (${OWN_PROJECTS})`,
  prospect_notes: `SELECT COUNT(*) n FROM prospect_notes WHERE prospect_id IN (SELECT id FROM prospects WHERE project_id IN (${OWN_PROJECTS}))`,
  mail_log: `SELECT COUNT(*) n FROM mail_log WHERE project_id IN (${OWN_PROJECTS})`,
  metrics_daily: `SELECT COUNT(*) n FROM metrics_daily WHERE project_id IN (${OWN_PROJECTS})`,
};
const counts = async (uid) => {
  const out = {};
  for (const [t, sql] of Object.entries(COUNTS)) out[t] = (await s.db.prepare(sql).get(uid)).n;
  return out;
};

async function seed(u, tag) {
  const t = now();
  const p = Number((await s.db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(u.id, `Projet ${tag}`, `https://git.test/${tag}/p.git`, t)).lastInsertRowid);
  const pr = Number((await s.db.prepare('INSERT INTO prospects(project_id, company, email, created_at) VALUES(?, ?, ?, ?)').run(p, `Ent ${tag}`, `c@${tag}.fr`, t)).lastInsertRowid);
  await s.db.prepare("INSERT INTO prospect_notes(prospect_id, body, created_at) VALUES(?, 'n', ?)").run(pr, t);
  await s.db.prepare("INSERT INTO templates(project_id, kind, subject, body, updated_at) VALUES(?, 'initial', 's', 'b', ?)").run(p, t);
  await s.db.prepare('INSERT INTO mail_log(project_id, prospect_id, email, sent_at) VALUES(?, ?, ?, ?)').run(p, pr, `c@${tag}.fr`, t);
  await s.db.prepare("INSERT INTO metrics_daily(project_id, day, users) VALUES(?, '2026-10-21', 1)").run(p);
  await s.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, created_at) VALUES(?, ?, 'send', 'done', ?)").run(u.id, p, t);
  await s.db.prepare("INSERT INTO jobs(user_id, type, status, created_at) VALUES(?, 'send', 'done', ?)").run(u.id, t); // job sans projet
  await setSetting(s.db, u.id, 'notify_email', `${tag}@x.fr`);
  const dir = repoDir(s.app.cfg, u.id, p);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'README.md'), tag);
  clone[tag] = dir;
}

before(async () => {
  s = await startApp();
  A = await s.newUser({ email: 'a@x.fr' });
  B = await s.newUser({ email: 'b@x.fr' });
  await seed(A, 'a');
  await seed(B, 'b');
  await s.db.prepare("INSERT INTO blacklist(email, reason, created_at) VALUES('c@a.fr', 'refused', ?)").run(now());
});
after(() => s.close());

test('« Mon compte » : email et fournisseur, formulaire de suppression', async () => {
  const page = await (await A.get('/account')).text();
  assert.match(page, /a@x\.fr/);
  assert.match(page, /Google/);
  assert.match(page, /action="\/account\/delete"/);
  assert.doesNotMatch(page, /b@x\.fr/);
  assert.equal((await s.anon.get('/account')).status, 303, 'connexion requise');
});

test('suppression : refusée si l\'email saisi ne correspond pas, ou sans origine valide', async () => {
  const before = await counts(A.id);
  let r = await A.post('/account/delete', { confirm: 'autre@x.fr' }, { form: true });
  assert.equal(r.status, 303);
  assert.match(decodeURIComponent(r.headers.get('location')), /^\/account\?e=.*ne correspond pas/);
  r = await A.post('/account/delete', { confirm: '' }, { form: true });
  assert.match(decodeURIComponent(r.headers.get('location')), /ne correspond pas/);
  r = await A.post('/account/delete', { confirm: 'a@x.fr' }, { form: true, origin: 'https://evil.com' });
  assert.equal(r.status, 403, 'anti-CSRF');
  r = await s.anon.post('/account/delete', { confirm: 'a@x.fr' }, { form: true });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/login');
  assert.deepEqual(await counts(A.id), before, 'rien n\'a été supprimé');
  assert.ok(existsSync(clone.a));
});

test('suppression : efface toutes les données de l\'utilisateur, détruit la session, laisse les autres comptes intacts', async () => {
  const mine = await counts(A.id);
  assert.ok(Object.values(mine).every((n) => n >= 1), `données de départ : ${JSON.stringify(mine)}`);
  const theirs = await counts(B.id);

  const r = await A.post('/account/delete', { confirm: ' A@X.fr ' }, { form: true });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/login?bye=1');
  assert.match(r.headers.getSetCookie().find((c) => c.startsWith('sid=')), /Max-Age=0/, 'cookie de session effacé');

  const after = await counts(A.id);
  for (const [t, n] of Object.entries(after)) assert.equal(n, 0, `${t} doit être vide`);
  assert.equal(existsSync(clone.a), false, 'clones git supprimés');
  assert.deepEqual(await counts(B.id), theirs, 'les données de B sont intactes');
  assert.ok(existsSync(clone.b));
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM blacklist').get()).n, 1, 'la liste d\'opposition est conservée');

  // La session d'avant ne marche plus, la page de connexion confirme
  assert.equal((await A.get('/api/system')).status, 401);
  const login = await (await s.anon.get('/login?bye=1')).text();
  assert.match(login, /supprimés/);
  assert.equal((await A.post('/account/delete', { confirm: 'a@x.fr' }, { form: true })).status, 303);
  assert.equal((await s.db.prepare("SELECT COUNT(*) n FROM users WHERE email = 'a@x.fr'").get()).n, 0);
});

test('suppression : un job en cours pour le compte est interrompu avant l\'effacement', async () => {
  const U = await s.newUser({ email: 'run@x.fr' });
  await seed(U, 'run');
  const aborted = [];
  s.app.worker = { abortUser: (id) => aborted.push(id) };
  const r = await U.post('/account/delete', { confirm: 'run@x.fr' }, { form: true });
  assert.equal(r.headers.get('location'), '/login?bye=1');
  assert.deepEqual(aborted, [U.id]);
  delete s.app.worker;
});

test('deleteUser (service) : compte inconnu → 404, et le nouvel inscrit du même email repart de zéro', async () => {
  await assert.rejects(deleteUser(s.app, 999999), { status: 404 });
  const N = await s.newUser({ email: 'a@x.fr', firstLogin: true }); // même email que le compte supprimé ; firstLogin : aucun réglage préposé par l'aide de test
  const c = await counts(N.id);
  assert.equal(c.users, 1);
  for (const t of Object.keys(c).filter((k) => !['users', 'sessions'].includes(k))) assert.equal(c[t], 0, `${t} : aucune donnée de l'ancien compte`);
});
