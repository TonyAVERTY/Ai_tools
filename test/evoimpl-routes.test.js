import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { now, setSetting } from '../src/db.js';
import { encrypt } from '../src/crypto.js';
import { startApp } from './helpers/server.js';
import { TEST_SECRET_KEY } from './helpers/users.js';

const MD = '### 1. Export CSV\n- **Pourquoi** : utile\n- **Effort** : S\n\n### 2. Mode sombre\n- **Pourquoi** : confort\n- **Effort** : M\n';
let s, A, B, pa, job;
const url = (n, what, j = job) => `/api/projects/${pa}/evolution/${j}/${n}/${what}`;

before(async () => {
  s = await startApp();
  A = await s.newUser({ email: 'impl-a@x.fr' });
  B = await s.newUser({ email: 'impl-b@x.fr' });
  const t = now();
  pa = Number((await s.db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(A.id, 'P', 'https://github.com/o/r.git', t)).lastInsertRowid);
  job = Number((await s.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, result_json, created_at) VALUES(?, ?, 'evolution', 'done', ?, ?)").run(A.id, pa, JSON.stringify({ markdown: MD }), t)).lastInsertRowid);
});
after(() => s.close());

test('implémenter : refus sans compte, pour un autre compte, sans origine, sans idée acceptée, sans token', async () => {
  assert.equal((await s.anon.post(url(1, 'implement'), { target: 'branch' })).status, 401);
  assert.equal((await B.post(url(1, 'implement'), { target: 'branch' })).status, 404);
  assert.equal((await B.get(url(1, 'decision'))).status, 404);
  assert.equal((await A.post(url(1, 'implement'), { target: 'branch' }, { origin: null })).status, 403);
  assert.equal((await A.post(url(9, 'implement'), { target: 'branch' })).status, 404);
  const notAccepted = await A.post(url(1, 'implement'), { target: 'branch' });
  assert.equal(notAccepted.status, 400);
  assert.match((await notAccepted.json()).error, /Accepte d'abord/);
  await A.post(url(1, 'decision'), { status: 'accepted', reason: 'ok' });
  const noToken = await A.post(url(1, 'implement'), { target: 'branch' });
  assert.equal(noToken.status, 400);
  const body = await noToken.json();
  assert.match(body.error, /Aucun token Git/);
  assert.deepEqual(body.fix, { label: 'Ouvrir les Réglages', href: '/settings#git' }, 'le serveur dit où régler le problème');
  assert.equal((await s.db.prepare("SELECT COUNT(*) n FROM jobs WHERE type = 'implement'").get()).n, 0, 'aucun job lancé');
});

test('implémenter : branche principale exige une confirmation ; un seul job à la fois ; bloc mis à jour', async () => {
  await setSetting(s.db, A.id, 'github_token_enc', encrypt(TEST_SECRET_KEY, 'ghp_AbCdEfTestTokenNotReal'));
  const noConfirm = await A.post(url(1, 'implement'), { target: 'default' });
  assert.equal(noConfirm.status, 400);
  assert.match((await noConfirm.json()).error, /Confirmation requise/);
  const ok = await A.post(url(1, 'implement'), { target: 'branch' });
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.match(j.html, /data-evo-running/);
  const row = await s.db.prepare("SELECT params_json FROM jobs WHERE type = 'implement'").get();
  assert.deepEqual(JSON.parse(row.params_json), { evo: job, n: 1, target: 'branch' });
  const again = await A.post(url(1, 'implement'), { target: 'branch' });
  assert.equal(again.status, 409);
  const block = await (await A.get(url(1, 'decision'))).json();
  assert.match(block.html, /Implémentation en (cours|attente)/);
  assert.doesNotMatch(block.html, /AbCdEf/, 'jamais de token dans la page');
});

test('un membre simple de l\'équipe peut décider mais pas implémenter', async () => {
  const M = await s.newUser({ email: 'impl-m@x.fr' });
  const t = now();
  const team = Number((await s.db.prepare('INSERT INTO teams(owner_id, name, created_at) VALUES(?, ?, ?)').run(A.id, 'T', t)).lastInsertRowid);
  await s.db.prepare('INSERT INTO team_members(team_id, user_id, role, created_at) VALUES(?, ?, ?, ?)').run(team, M.id, 'member', t);
  await s.db.prepare('UPDATE projects SET team_id = ? WHERE id = ?').run(team, pa);
  assert.equal((await M.post(url(2, 'decision'), { status: 'accepted', reason: '' })).status, 200);
  const r = await M.post(url(2, 'implement'), { target: 'branch' });
  assert.equal(r.status, 403);
  const block = await (await M.get(url(2, 'decision'))).json();
  assert.doesNotMatch(block.html, /data-evo-impl-open/, 'pas de bouton pour un membre');
});
