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

test('réglage désactivé : accepter pose la question ; le choix retenu (oui / non) s\'applique ensuite sans question', async () => {
  const r = await accept(A, 1);
  assert.equal(r.next, 'ask');
  assert.match(r.html, /Acceptée/);
  assert.doesNotMatch(r.html, /data-evo-impl-open|Implémenter</, 'plus de bouton « Implémenter »');
  assert.equal((await implJobs()).length, 0, 'aucune écriture sans accord');
  // Choix retenu : propre à cette personne, validé côté serveur
  assert.equal((await s.anon.post('/api/evolution/implement-choice', { choice: 'no' })).status, 401);
  assert.equal((await A.post('/api/evolution/implement-choice', { choice: 'no' }, { origin: null })).status, 403);
  assert.equal((await A.post('/api/evolution/implement-choice', { choice: 'peut-être' })).status, 400);
  assert.equal((await A.post('/api/evolution/implement-choice', { choice: 'no' })).status, 200);
  assert.equal(await getSetting(s.db, A.id, 'evo_impl_choice'), 'no');
  assert.equal(await getSetting(s.db, B.id, 'evo_impl_choice'), null, 'pas celui d\'un autre compte');
  const none = await accept(A, 2);
  assert.equal(none.next, null, 'retenu « non » : plus de question, rien de lancé');
  assert.equal((await implJobs()).length, 0);
  // Retenu « oui » : l'implémentation démarre à chaque acceptation (ici sans token : l'idée reste acceptée, avec un lien vers les Réglages)
  await A.post('/api/evolution/implement-choice', { choice: 'yes' });
  const yes = await accept(A, 3);
  assert.match(yes.warn, /Aucun token Git/);
  assert.deepEqual(yes.fix, { label: 'Ouvrir les Réglages', href: '/settings#git' });
  assert.match(yes.html, /Acceptée/);
  // Remise en route de la question
  await A.post('/api/evolution/implement-choice', { choice: 'ask' });
  await A.post(url(3, 'decision'), { status: 'pending' });
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
  const busy = await accept(A, 4); // implémentation en cours : pas de relance
  assert.equal(busy.next, null);
  assert.equal((await implJobs()).length, 1);
  await A.post(url(2, 'decision'), { status: 'pending' });
  const second = await accept(A, 2);
  assert.equal(second.next, 'queued', 'une autre idée attend son tour au lieu d\'être refusée');
  assert.equal(second.warn, null);
  assert.match(second.html, /Acceptée/);
  assert.match(second.html, /Implémentation en attente/);
  assert.equal((await implJobs()).length, 2, 'les implémentations s\'empilent dans la file');
  await s.db.prepare("UPDATE jobs SET status = 'done' WHERE type = 'implement'").run();
  await setSetting(s.db, A.id, 'github_token_enc', '');
  await A.post(url(3, 'decision'), { status: 'pending' });
  const noToken = await accept(A, 3);
  assert.match(noToken.warn, /Aucun token Git/);
  assert.equal((await implJobs()).length, 2, 'rien de plus lancé');
  // Après un échec, un nouveau clic sur « Accepter » relance ; après une réussite, non
  await setSetting(s.db, A.id, 'github_token_enc', encrypt(TEST_SECRET_KEY, 'ghp_AbCdEfTestTokenNotReal'));
  await s.db.prepare("UPDATE jobs SET status = 'error', error = 'Git : le token n''a pas le droit d''écrire' WHERE type = 'implement'").run();
  const failedBlock = await (await A.get(url(4, 'decision'))).json();
  assert.match(failedBlock.html, /Implémentation en échec/);
  assert.match(failedBlock.html, /<a class="evo-fix" href="\/settings#git">Ouvrir les Réglages<\/a>/, 'un lien (pas un bouton) vers les Réglages');
  const retry = await accept(A, 4);
  assert.equal(retry.next, 'started');
  assert.equal((await implJobs()).length, 3, 'relancée');
  await s.db.prepare("UPDATE jobs SET status = 'done', result_json = ? WHERE type = 'implement'").run(JSON.stringify({ branch: 'iaboss/x-1', target: 'branch', commit: 'abcdef123456', files: ['a.js'], summary: '' }));
  assert.equal((await accept(A, 4)).next, null);
  assert.equal((await implJobs()).length, 3, 'pas de relance après une réussite');
  // Terminée : l'idée quitte la liste et un récapitulatif (échappé) dit que la fonctionnalité est bien implémentée
  await s.db.prepare("UPDATE jobs SET result_json = ? WHERE type = 'implement'").run(JSON.stringify({ branch: 'iaboss/<b>x-1', target: 'branch', commit: 'abcdef123456', files: ['a.js'], summary: 'Ajouté.', url: 'https://github.com/o/r/tree/iaboss/x-1' }));
  const list = (await (await A.get(`/api/projects/${pa}/status`)).json()).jobs.evolution.result.html;
  assert.doesNotMatch(list, /data-n="4"/, 'l\'idée implémentée quitte la liste');
  assert.match(list, /<div class="evo-recaps">[\s\S]*La fonctionnalité « Export PDF » est bien implémentée/);
  assert.match(list, /iaboss\/&lt;b&gt;x-1/, 'branche échappée');
  assert.doesNotMatch(list, /<b>x-1/);
  const live = await (await A.get(url(4, 'decision'))).json();
  assert.equal(live.done, true);
  assert.match(live.recap, /Export PDF/);
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
