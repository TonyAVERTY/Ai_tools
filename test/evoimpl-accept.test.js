import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { now, setSetting, getSetting } from '../src/db.js';
import { encrypt } from '../src/crypto.js';
import { startApp } from './helpers/server.js';
import { TEST_SECRET_KEY } from './helpers/users.js';

const MD = ['Alerte de quota', 'Export CSV', 'Mode sombre', 'Export PDF'].map((t, i) => `### ${i + 1}. ${t}\n- **Pourquoi** : utile\n- **Effort** : S\n`).join('\n');
let s, A, B, pa, job;
const url = (n, what) => `/api/projects/${pa}/evolution/${job}/${n}/${what}`;
const implJobs = () => s.db.prepare("SELECT params_json, status FROM jobs WHERE type = 'implement' ORDER BY id").all();
const accept = async (u, n) => (await u.post(url(n, 'decision'), { status: 'accepted', reason: '' })).json();

before(async () => {
  s = await startApp();
  A = await s.newUser({ email: 'acc-a@x.fr' });
  B = await s.newUser({ email: 'acc-b@x.fr' });
  const t = now();
  pa = Number((await s.db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(A.id, 'P', 'https://github.com/o/r.git', t)).lastInsertRowid);
  job = Number((await s.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, result_json, created_at) VALUES(?, ?, 'evolution', 'done', ?, ?)").run(A.id, pa, JSON.stringify({ markdown: MD }), t)).lastInsertRowid);
});
after(() => s.close());

test('réglage désactivé : accepter pose la question, « Ne plus afficher » la coupe, rien n\'est lancé sans réponse « oui »', async () => {
  const r = await accept(A, 1);
  assert.equal(r.next, 'ask');
  assert.match(r.html, /Acceptée/);
  assert.equal((await implJobs()).length, 0, 'aucune écriture sans accord');
  // ré-accepter ne repose pas la question
  assert.equal((await accept(A, 1)).next, null);
  // « Ne plus afficher ce message » : préférence de cette personne seulement
  assert.equal((await s.anon.post('/api/evolution/implement-hint', { hide: true })).status, 401);
  assert.equal((await A.post('/api/evolution/implement-hint', { hide: true }, { origin: null })).status, 403);
  assert.equal((await A.post('/api/evolution/implement-hint', { hide: true })).status, 200);
  assert.equal(await getSetting(s.db, A.id, 'evo_impl_hint'), '1');
  assert.equal(await getSetting(s.db, B.id, 'evo_impl_hint'), null, 'pas celle d\'un autre compte');
  assert.equal((await accept(A, 2)).next, null, 'plus de question');
  // elle se remet en route
  await A.post('/api/evolution/implement-hint', { hide: false });
  assert.equal((await accept(A, 3)).next, 'ask');
  assert.equal((await implJobs()).length, 0);
});

test('réglage activé avec un token : accepter lance l\'implémentation sur une NOUVELLE branche', async () => {
  await setSetting(s.db, A.id, 'ai_code_edit', '1');
  await setSetting(s.db, A.id, 'github_token_enc', encrypt(TEST_SECRET_KEY, 'ghp_AbCdEfTestTokenNotReal'));
  const r = await accept(A, 4);
  assert.equal(r.next, 'started');
  assert.equal(r.warn, null);
  assert.match(r.html, /data-evo-running/);
  const jobs = await implJobs();
  assert.equal(jobs.length, 1);
  assert.deepEqual(JSON.parse(jobs[0].params_json), { evo: job, n: 4, target: 'branch' });
});

test('réglage activé : une implémentation déjà en cours ou l\'absence de token sont signalées, l\'idée reste acceptée', async () => {
  const busy = await accept(A, 1).catch(() => null); // déjà acceptée : pas de relance
  assert.equal(busy.next, null);
  await A.post(url(2, 'decision'), { status: 'pending' });
  const second = await accept(A, 2);
  assert.match(second.warn, /déjà en cours/);
  assert.match(second.html, /Acceptée/);
  assert.equal((await implJobs()).length, 1, 'une seule à la fois');
  await s.db.prepare("UPDATE jobs SET status = 'done' WHERE type = 'implement'").run();
  await setSetting(s.db, A.id, 'github_token_enc', '');
  await A.post(url(3, 'decision'), { status: 'pending' });
  const noToken = await accept(A, 3);
  assert.match(noToken.warn, /Aucun token Git/);
  assert.equal((await implJobs()).length, 1, 'rien de plus lancé');
});

test('un simple membre accepte sans question ni implémentation, même réglage activé', async () => {
  const M = await s.newUser({ email: 'acc-m@x.fr' });
  const t = now();
  const team = Number((await s.db.prepare('INSERT INTO teams(owner_id, name, created_at) VALUES(?, ?, ?)').run(A.id, 'T', t)).lastInsertRowid);
  await s.db.prepare('INSERT INTO team_members(team_id, user_id, role, created_at) VALUES(?, ?, ?, ?)').run(team, M.id, 'member', t);
  await s.db.prepare('UPDATE projects SET team_id = ? WHERE id = ?').run(team, pa);
  const before = (await implJobs()).length;
  await A.post(url(2, 'decision'), { status: 'pending' });
  const r = await accept(M, 2);
  assert.equal(r.next, null);
  assert.equal(r.warn, null);
  assert.equal((await implJobs()).length, before);
});
