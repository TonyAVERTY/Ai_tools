import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../src/db.js';
import { startApp } from './helpers/server.js';

const MD = '### 1. Mode sombre\n- **Effort** : S (rapide)\n- **Pourquoi** : confort\n\n### 2. Export PDF\n- **Effort** : M\n- **Pourquoi** : clients\n';
let s, A, B, M, pa, job;
const url = (n, j = job) => `/api/projects/${pa}/evolution/${j}/${n}/decision`;

before(async () => {
  s = await startApp();
  A = await s.newUser({ email: 'evo-a@x.fr' });
  B = await s.newUser({ email: 'evo-b@x.fr' });
  const t = now();
  pa = Number((await s.db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(A.id, 'P', 'https://git.test/a.git', t)).lastInsertRowid);
  job = Number((await s.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, result_json, created_at) VALUES(?, ?, 'evolution', 'done', ?, ?)").run(A.id, pa, JSON.stringify({ markdown: MD }), t)).lastInsertRowid);
});
after(() => s.close());

test('accepter, refuser avec justification, remettre en attente', async () => {
  let r = await A.post(url(1), { status: 'accepted', reason: 'Bonne idée' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.match(j.html, /Acceptée<\/strong> : Bonne idée/);
  assert.equal((await A.post(url(2), { status: 'refused', reason: '' })).status, 400, 'un refus sans justification est refusé');
  assert.equal((await A.post(url(2), { status: 'refused', reason: 'x'.repeat(501) })).status, 400);
  assert.equal((await A.post(url(2), { status: 'refused', reason: 'Trop cher <b>' })).status, 200);
  const st = await (await A.get(`/api/projects/${pa}/status`)).json();
  const html = st.jobs.evolution.result.html;
  assert.match(html, /Refusée<\/strong> : Trop cher &lt;b&gt;/, 'justification échappée');
  assert.equal((await A.post(url(1), { status: 'pending' })).status, 200);
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM evolution_decisions').get()).n, 1);
});

test('entrées invalides, idée ou liste inconnue : refus', async () => {
  assert.equal((await A.post(url(1), { status: 'maybe' })).status, 400);
  assert.equal((await A.post(url(9), { status: 'accepted' })).status, 404);
  assert.equal((await A.post(url(1, 999999), { status: 'accepted' })).status, 404);
});

test('un autre compte ou sans compte ou sans origine : refus, rien n’est écrit', async () => {
  assert.equal((await B.post(url(1), { status: 'accepted' })).status, 404);
  assert.equal((await s.anon.post(url(1), { status: 'accepted' })).status, 401);
  assert.equal((await A.post(url(1), { status: 'accepted' }, { origin: null })).status, 403);
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM evolution_decisions WHERE n = 1').get()).n, 0);
});

test('les décisions partent avec le projet et sont exportées', async () => {
  await A.post(url(1), { status: 'accepted', reason: 'oui' });
  const { exportAccount } = await import('../src/services/dataexport.js');
  assert.equal((await exportAccount(s.db, A.id)).data.evolution_decisions.length, 2);
  assert.equal((await exportAccount(s.db, B.id)).data.evolution_decisions.length, 0);
  await s.db.prepare('DELETE FROM projects WHERE id = ?').run(pa);
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM evolution_decisions').get()).n, 0);
});
