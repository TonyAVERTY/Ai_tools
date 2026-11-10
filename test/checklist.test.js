// Liste de mise en route : calcul pur, route dédiée, présence dans /status, cloisonnement entre comptes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { addProject, testTokenLink } from './helpers/users.js';
import { buildChecklist } from '../src/checklist.js';
import { saveTemplate } from '../src/projects.js';
import { now } from '../src/db.js';
import { projectsHtml } from './helpers/pages.js';

let s, off;
const user = (srv) => srv.newUser({ admin: false, link: testTokenLink() });
before(async () => {
  s = await startApp({ cfg: { linkedin: { clientId: 'c', clientSecret: 's', redirectUri: 'https://ai.tony-averty.dev/linkedin/callback' } } });
  off = await startApp();
});
after(async () => { await s.close(); await off.close(); });

const none = { canConfigure: true, linkedinAvailable: true };
const keys = (c) => c.steps.map((x) => x.key);

test('calcul : un projet vide a tout à faire, l\'ordre conseillé est respecté', () => {
  const c = buildChecklist(none);
  assert.deepEqual(keys(c), ['analyze', 'target', 'prospects', 'smtp', 'template', 'send', 'imap', 'followup', 'evolution', 'linkedin', 'post']);
  assert.equal(c.done, 0);
  assert.equal(c.steps.length, 11);
  assert.equal(c.total, 6, 'seules les étapes obligatoires comptent');
  assert.equal(c.ready, false);
  assert.equal(c.complete, false);
});

test('calcul : la mise en route est terminée dès que l\'obligatoire est fait ; le facultatif ne compte pas et n\'a pas à être fait', () => {
  const core = { ...none, hasProfile: true, targetValidated: true, prospects: 3, hasSmtp: true, templateValidated: true, mailsSent: true };
  const ready = buildChecklist(core);
  assert.equal(ready.ready, true);
  assert.equal(ready.complete, true, 'les étapes facultatives ne laissent pas la liste « inachevée »');
  assert.equal(ready.done, 6);
  assert.equal(ready.total, 6, '6 sur 6, pas « 6 sur 11 »');
  assert.equal(ready.steps.filter((x) => x.optional && !x.done).length, 5, 'elles restent proposées');
  const all = buildChecklist({ ...core, hasImap: true, followupEnabled: true, evolutionDone: true, linkedinConnected: true, linkedinPosted: true });
  assert.equal(all.complete, true);
  assert.equal(all.done, all.total);
  // un seul oubli du cœur : pas prêt
  assert.equal(buildChecklist({ ...core, templateValidated: false }).ready, false);
});

test('calcul : un membre d\'équipe ne voit pas les réglages qu\'il ne peut pas faire, LinkedIn absent sans clés', () => {
  const member = keys(buildChecklist({ canConfigure: false, linkedinAvailable: true }));
  assert.ok(!member.includes('smtp') && !member.includes('imap'));
  const noLi = keys(buildChecklist({ canConfigure: true, linkedinAvailable: false }));
  assert.ok(!noLi.includes('linkedin') && !noLi.includes('post'));
});

test('calcul : chaque étape pointe une section existante de la page (acc) ou un sélecteur de repli', () => {
  for (const st of buildChecklist(none).steps) assert.ok(st.acc || st.sel, `étape ${st.key} sans cible`);
});

test('route : l\'état suit le projet, étape par étape', async () => {
  const u = await user(s);
  const pid = await addProject(s.db, u.id);
  const get = async () => (await u.get(`/api/projects/${pid}/checklist`)).json();
  const step = (c, k) => c.steps.find((x) => x.key === k).done;

  let c = await get();
  assert.equal(c.done, 0);
  assert.equal(c.ready, false);

  await s.db.prepare('UPDATE projects SET profile_json = ?, target_validated = 1 WHERE id = ?').run(JSON.stringify({ resume: 'x' }), pid);
  await s.db.prepare('INSERT INTO prospects(project_id, company, email, created_at) VALUES(?, ?, ?, ?)').run(pid, 'Acme', 'a@acme.fr', now());
  c = await get();
  assert.ok(step(c, 'analyze') && step(c, 'target') && step(c, 'prospects'));
  assert.ok(!step(c, 'smtp') && !step(c, 'template') && !step(c, 'send'));

  await s.db.prepare('UPDATE projects SET smtp_enc = ? WHERE id = ?').run('chiffré', pid);
  await saveTemplate(s.db, pid, 'initial', { subject: 'Bonjour', body: 'Texte', status: 'validated' });
  c = await get();
  assert.ok(step(c, 'smtp') && step(c, 'template'));
  assert.equal(c.ready, false, 'aucun mail envoyé : pas encore prêt');

  // un envoi en échec ne compte pas
  await s.db.prepare('INSERT INTO mail_log(project_id, email, sent_at, error, kind) VALUES(?, ?, ?, ?, ?)').run(pid, 'a@acme.fr', now(), 'refusé', 'initial');
  assert.equal(step(await get(), 'send'), false);
  await s.db.prepare('INSERT INTO mail_log(project_id, email, sent_at, error, kind) VALUES(?, ?, ?, NULL, ?)').run(pid, 'a@acme.fr', now(), 'initial');
  c = await get();
  assert.ok(step(c, 'send'));
  assert.equal(c.ready, true);
  assert.equal(c.complete, true, 'terminée : le facultatif ne compte pas');

  // LinkedIn : relié, puis premier post publié
  assert.equal(step(c, 'linkedin'), false);
  await s.db.prepare('INSERT INTO linkedin_accounts(project_id, member_urn, name, token_enc, expires_at, connected_by, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)').run(pid, 'urn:li:person:x', 'T', 'enc', now() + 3600, u.id, now());
  c = await get();
  assert.ok(step(c, 'linkedin'));
  assert.equal(step(c, 'post'), false);
  await s.db.prepare("INSERT INTO linkedin_posts(project_id, body, status, created_at) VALUES(?, ?, 'draft', ?)").run(pid, 'brouillon', now());
  assert.equal(step(await get(), 'post'), false, 'un brouillon n\'est pas un post publié');
  await s.db.prepare("INSERT INTO linkedin_posts(project_id, body, status, created_at, published_at) VALUES(?, ?, 'published', ?, ?)").run(pid, 'publié', now(), now());
  assert.ok(step(await get(), 'post'));
  // jeton expiré : le compte ne compte plus comme relié
  await s.db.prepare('UPDATE linkedin_accounts SET expires_at = ? WHERE project_id = ?').run(now() - 10, pid);
  assert.equal(step(await get(), 'linkedin'), false);
});

test('/status embarque la liste (le front la rafraîchit avec le reste)', async () => {
  const u = await user(s);
  const pid = await addProject(s.db, u.id);
  const st = await (await u.get(`/api/projects/${pid}/status`)).json();
  assert.equal(st.checklist.steps.length, 11);
  assert.equal(st.checklist.steps[0].key, 'analyze');
});

test('cloisonnement : le projet d\'un autre compte reste introuvable, sans session c\'est refusé', async () => {
  const a = await user(s);
  const b = await user(s);
  const pid = await addProject(s.db, a.id);
  assert.equal((await b.get(`/api/projects/${pid}/checklist`)).status, 404);
  assert.equal((await s.anon.get(`/api/projects/${pid}/checklist`)).status, 401);
});

test('sans clés LinkedIn : la liste n\'en parle pas', async () => {
  const u = await user(off);
  const pid = await addProject(off.db, u.id);
  const c = await (await u.get(`/api/projects/${pid}/checklist`)).json();
  assert.equal(c.steps.length, 9);
  assert.ok(!c.steps.some((x) => x.key === 'linkedin'));
});

test('page : la mise en route est la première carte de la vue d\'ensemble (étape en cours en Safran, lignes qui mènent au bon onglet), sans panneau flottant ni style en ligne', async () => {
  const u = await user(s);
  const id = await addProject(s.db, u.id, { name: 'Mon projet' });
  const html = await (await u.get(`/p/${id}`, { headers: { accept: 'text/html' } })).text();
  assert.match(html, /<section class="sheet" aria-labelledby="mr-h"><div class="sheet-h"><h2 id="mr-h">Mise en route<\/h2>/);
  assert.match(html, /<ol class="pj-steps">/);
  assert.match(html, /<li class="cur">/, 'la première étape à faire est mise en avant');
  // chaque ligne ouvre l'onglet qui porte la section (adresse + ancre), pas une section d'accordéon
  assert.match(html, /href="\/p\/\d+\/prospection#acc-target"/);
  assert.match(html, /href="\/p\/\d+\/reglages#acc-config"/);
  // le badge « config » masqué reste un vrai bouton pour public/app.js
  assert.match(html, /<button type="button" class="pcfg badge" data-cfg[^>]*>/);
  assert.doesNotMatch(html, /id="todo"|class="todo"|data-todo-restore|Afficher la mise en route/);
  assert.doesNotMatch(html, /style="/);
  const empty = await user(s);
  assert.doesNotMatch(await (await empty.get('/projets', { headers: { accept: 'text/html' } })).text(), /pj-steps/, 'pas de projet : pas de liste');
});
