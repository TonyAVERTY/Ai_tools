import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { now } from '../src/db.js';
import { encrypt } from '../src/crypto.js';
import { maskEmail, logAudit, purgeAudit, recentAudit } from '../src/admin.js';
import { getSession } from '../src/auth.js';
import { ADMIN_PAGE_SIZE } from '../src/limits.js';
import { Worker, enqueue } from '../src/services/jobs.js';
import { startApp } from './helpers/server.js';

// Back-office : réservé aux administrateurs (404 pour les autres), actions journalisées, garde-fous sur les administrateurs,
// aucune donnée métier.

const html = { headers: { accept: 'text/html' } };
const ADMIN_ROUTES = [
  ['GET', '/admin'], ['GET', '/admin?page=2&q=x'], ['POST', '/admin/users/1/suspend'], ['POST', '/admin/users/1/reactivate'],
  ['POST', '/admin/users/1/plan'], ['POST', '/admin/users/1/delete'], ['POST', '/admin/users/1/resume-send'],
];
const form = (u, path, body = {}, o = {}) => u.post(path, body, { form: true, ...o });
const where = (r) => decodeURIComponent(r.headers.get('location') || '');

test('non-admin, visiteur et administrateur : 404 sauf pour l\'administrateur, pour toutes les routes', async () => {
  const s = await startApp();
  try {
    const user = await s.newUser({ admin: false });
    const admin = await s.newUser({ admin: true });
    for (const [method, path] of ADMIN_ROUTES) {
      for (const [who, c] of [['visiteur', s.anon], ['utilisateur', user]]) {
        const r = method === 'GET' ? await c.get(path, html) : await form(c, path);
        assert.equal(r.status, 404, `${who} ${method} ${path}`);
        const j = method === 'GET' ? await c.get(path) : await c.post(path, {});
        assert.equal(j.status, 404, `${who} ${method} ${path} (JSON)`);
        assert.equal(r.headers.get('location'), null, 'aucune redirection vers la connexion (rien n\'est révélé)');
      }
    }
    // Aucune trace de la page dans la réponse 404, et l'administrateur la voit
    const denied = await (await user.get('/admin', html)).text();
    assert.doesNotMatch(denied, /Administration|Journal d'audit/);
    assert.equal((await admin.get('/admin', html)).status, 200);
    // Un utilisateur sans liaison Claude mais admin y accède aussi (pas de redirection vers /link)
    const bare = await s.newUser({ admin: true, link: null });
    assert.equal((await bare.get('/admin', html)).status, 200);
    // Le lien « Administration » n'est visible que des administrateurs
    assert.match(await (await admin.get('/account', html)).text(), /href="\/admin"/);
    assert.doesNotMatch(await (await user.get('/account', html)).text(), /href="\/admin"/);
    // Jamais indexé ni exploré
    assert.match(await (await s.anon.get('/robots.txt')).text(), /Disallow: \/admin\n/);
  } finally { await s.close(); }
});

test('administration : une origine étrangère est refusée (anti-CSRF) et le débit est limité', async () => {
  const s = await startApp({ rateLimit: true });
  try {
    const admin = await s.newUser({ admin: true });
    const target = await s.newUser({ admin: false });
    const r = await form(admin, `/admin/users/${target.id}/suspend`, {}, { origin: 'https://evil.example' });
    assert.equal(r.status, 403);
    assert.equal((await s.db.prepare('SELECT status FROM users WHERE id = ?').get(target.id)).status, 'active');
    for (let i = 0; i < 120; i++) await admin.get('/admin', html);
    assert.equal((await admin.get('/admin', html)).status, 429);
  } finally { await s.close(); }
});

test('liste des comptes : identité, plan, statut, dates, mode de liaison et usage ; jamais un secret ni une donnée métier', async () => {
  const s = await startApp();
  try {
    const admin = await s.newUser({ admin: true, email: 'tony@x.fr' });
    const SECRET = 'sk-ant-api03-SECRETSECRETSECRETSECRET1234';
    const link = { v: 1, mode: 'api_key', valid: true, last4: '1234', secret_enc: encrypt(s.app.cfg.secretKey, SECRET) };
    const bob = await s.newUser({ admin: false, email: 'bob@exemple.fr', link });
    await s.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(1_800_000_000, bob.id);
    const pid = Number((await s.db.prepare("INSERT INTO projects(user_id, name, git_url, profile_json, created_at) VALUES(?, 'ProjetConfidentiel', 'https://git.test/b/secret.git', ?, ?)").run(bob.id, JSON.stringify({ resume: 'RESUMEPRIVE' }), now())).lastInsertRowid);
    await s.db.prepare("INSERT INTO prospects(project_id, company, email, hook, created_at) VALUES(?, 'EntreprisePrivee', 'client@prive.fr', 'ACCROCHEPRIVEE', ?)").run(pid, now());
    const prospect = (await s.db.prepare('SELECT id FROM prospects WHERE project_id = ?').get(pid)).id;
    await s.db.prepare("INSERT INTO prospect_notes(prospect_id, body, created_at) VALUES(?, 'NOTEPRIVEE', ?)").run(prospect, now());
    await s.db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, subject) VALUES(?, ?, 'client@prive.fr', ?, 'OBJETPRIVE')").run(pid, prospect, now());
    await s.db.prepare("INSERT INTO user_settings(user_id, `key`, value) VALUES(?, 'smtp_enc', 'SMTPCHIFFRE')").run(bob.id);

    const page = await (await admin.get('/admin', html)).text();
    for (const f of ['bob@exemple.fr', 'tony@x.fr', 'Google', 'gratuit', 'actif', 'Clé API Anthropic', 'P 1/1', 'Pr 1/50', 'M 0/100', 'IA 0/5', '15/01/2027']) assert.ok(page.includes(f), f);
    for (const secret of [SECRET, 'SECRETSECRET', '1234</', 'secret_enc', link.secret_enc, 'SMTPCHIFFRE', 'ProjetConfidentiel', 'secret.git', 'RESUMEPRIVE', 'EntreprisePrivee', 'client@prive.fr', 'ACCROCHEPRIVEE', 'NOTEPRIVEE', 'OBJETPRIVE']) {
      assert.ok(!page.includes(secret), `la page d'administration ne doit pas contenir « ${secret} »`);
    }
    // Les administrateurs figurent avec « Administrateur (ADMIN_EMAILS) » et sans bouton d'action sur leur propre ligne
    assert.match(page, /Ton compte/);
    // Seules routes /admin : aucune ne renvoie de donnée métier
    const paths = s.app.router.routes.filter((r) => /admin/.test(r.re.source)).map((r) => r.re.source);
    assert.ok(paths.length >= 6);
    for (const p of paths) assert.doesNotMatch(p, /prospect|mail|note|project/i);
  } finally { await s.close(); }
});

test('liste paginée et recherche par email (caractères spéciaux neutralisés)', async () => {
  const s = await startApp();
  try {
    const admin = await s.newUser({ admin: true });
    for (let i = 0; i < ADMIN_PAGE_SIZE + 5; i++) await s.newUser({ admin: false, email: `membre${String(i).padStart(2, '0')}@liste.fr` });
    await s.newUser({ admin: false, email: '100%_vrai@liste.fr' });
    const rows = (h) => (h.match(/<tr>\s*<td>[^<]*@/g) || []).length;
    const p1 = await (await admin.get('/admin', html)).text();
    assert.equal(rows(p1), ADMIN_PAGE_SIZE);
    assert.match(p1, /page 1 \/ 2/);
    assert.match(p1, /href="\/admin\?page=2"/);
    const p2 = await (await admin.get('/admin?page=2', html)).text();
    assert.equal(rows(p2), 1 + ADMIN_PAGE_SIZE + 5 + 1 - ADMIN_PAGE_SIZE);
    assert.match(p2, /Précédent/);
    assert.equal(rows(await (await admin.get('/admin?page=99', html)).text()), rows(p2), 'page hors bornes ramenée à la dernière');
    assert.equal(rows(await (await admin.get('/admin?page=abc', html)).text()), ADMIN_PAGE_SIZE);
    const found = await (await admin.get('/admin?q=membre07', html)).text();
    assert.equal(rows(found), 1);
    assert.ok(found.includes('membre07@liste.fr'));
    const special = await (await admin.get('/admin?q=' + encodeURIComponent('100%_'), html)).text();
    assert.equal(rows(special), 1, '% et _ sont cherchés littéralement');
    assert.equal(rows(await (await admin.get('/admin?q=%25', html)).text()), 1);
  } finally { await s.close(); }
});

test('suspendre : sessions fermées, connexion refusée, jobs en file refusés, audit ; réactiver rétablit', async () => {
  const s = await startApp();
  try {
    const admin = await s.newUser({ admin: true, email: 'chef@x.fr' });
    const bob = await s.newUser({ admin: false, email: 'bob@x.fr', link: { v: 1, mode: 'api_key', valid: true } });
    const pid = Number((await s.db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'p', 'u', ?)").run(bob.id, now())).lastInsertRowid);
    const job = (await enqueue(s.db, { userId: bob.id, projectId: pid, type: 'template' })).id;
    assert.ok(await getSession(s.db, { headers: { cookie: bob.cookie } }));
    const r = await form(admin, `/admin/users/${bob.id}/suspend`, { page: '1' });
    assert.equal(r.status, 303);
    assert.match(where(r), /^\/admin\?page=1&done=suspend$/);
    assert.equal((await s.db.prepare('SELECT status FROM users WHERE id = ?').get(bob.id)).status, 'suspended');
    assert.equal(await getSession(s.db, { headers: { cookie: bob.cookie } }), null, 'sa session est fermée');
    assert.equal((await bob.get('/api/system')).status, 401);
    // Son job en file ne s'exécute pas
    const w = new Worker(s.db, { template: async () => { throw new Error('ne doit pas tourner'); } }, { log: { error() {} } });
    await w.tick();
    assert.equal((await s.db.prepare('SELECT status, error FROM jobs WHERE id = ?').get(job)).error, 'Compte suspendu');
    await assert.rejects(enqueue(s.db, { userId: bob.id, projectId: pid, type: 'prospect' }), { status: 403 });
    // La page le montre, puis la réactivation
    assert.match(await (await admin.get('/admin?done=suspend', html)).text(), /suspendu/);
    assert.equal((await form(admin, `/admin/users/${bob.id}/reactivate`)).status, 303);
    assert.equal((await s.db.prepare('SELECT status FROM users WHERE id = ?').get(bob.id)).status, 'active');
    const log = await recentAudit(s.db);
    assert.deepEqual(log.map((l) => l.action), ['reactivate', 'suspend']);
    assert.equal(log[1].admin, 'chef@x.fr');
    assert.equal(log[1].target, 'b***@x.fr', 'adresse masquée dans le journal');
    assert.equal(log[1].targetId, bob.id);
  } finally { await s.close(); }
});

test('un administrateur ne peut ni se suspendre, ni se supprimer, ni toucher un autre administrateur', async () => {
  const s = await startApp();
  try {
    const a = await s.newUser({ admin: true, email: 'a@x.fr' });
    const b = await s.newUser({ admin: true, email: 'b@x.fr' });
    await s.newUser({ admin: false, email: 'u@x.fr' });
    const refusals = [
      [a.id, 'suspend', {}, /propre compte/], [a.id, 'delete', { confirm: 'a@x.fr' }, /propre compte/], [a.id, 'plan', { plan: 'free' }, /propre compte/],
      [b.id, 'suspend', {}, /administrateur/], [b.id, 'delete', { confirm: 'b@x.fr' }, /administrateur/], [b.id, 'plan', { plan: 'pro' }, /administrateur/],
    ];
    for (const [id, action, body, re] of refusals) {
      const r = await form(a, `/admin/users/${id}/${action}`, body);
      assert.equal(r.status, 303, action);
      const loc = where(r);
      assert.match(loc, /[?&]e=/, `${action} sur ${id} : ${loc}`);
      assert.match(loc, re, `${action} sur ${id}`);
    }
    for (const id of [a.id, b.id]) {
      const row = await s.db.prepare('SELECT status FROM users WHERE id = ?').get(id);
      assert.equal(row?.status, 'active', `compte ${id} intact`);
    }
    assert.deepEqual(await recentAudit(s.db), [], 'un refus n\'est pas une action : rien au journal');
    assert.equal(await getSession(s.db, { headers: { cookie: a.cookie } }) !== null, true, 'la session de l\'admin reste ouverte');
  } finally { await s.close(); }
});

test('plan : gratuit / pro attribuables, rien d\'autre ; le plan pro lève les plafonds', async () => {
  const s = await startApp();
  try {
    const admin = await s.newUser({ admin: true });
    const bob = await s.newUser({ admin: false });
    assert.equal((await form(admin, `/admin/users/${bob.id}/plan`, { plan: 'pro' })).status, 303);
    assert.equal((await s.db.prepare('SELECT plan FROM users WHERE id = ?').get(bob.id)).plan, 'pro');
    for (const bad of ['admin', 'enterprise', '', 'PRO ']) {
      const loc = where(await form(admin, `/admin/users/${bob.id}/plan`, { plan: bad }));
      assert.match(loc, /Plan inconnu/, bad);
    }
    assert.equal((await s.db.prepare('SELECT plan FROM users WHERE id = ?').get(bob.id)).plan, 'pro');
    await form(admin, `/admin/users/${bob.id}/plan`, { plan: 'free' });
    assert.deepEqual((await recentAudit(s.db)).map((l) => l.action), ['plan_free', 'plan_pro']);
    assert.match(await (await admin.get('/admin?done=plan', html)).text(), /Plan modifié/);
    assert.equal(where(await form(admin, '/admin/users/99999/plan', { plan: 'pro' })).includes('introuvable'), true);
  } finally { await s.close(); }
});

test('suppression : confirmation par saisie de l\'email, mêmes effets que la suppression du compte, audit conservé', async () => {
  const s = await startApp();
  try {
    const admin = await s.newUser({ admin: true });
    const bob = await s.newUser({ admin: false, email: 'bob@exemple.fr' });
    const pid = Number((await s.db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'p', 'u', ?)").run(bob.id, now())).lastInsertRowid);
    await s.db.prepare("INSERT INTO prospects(project_id, company, email, created_at) VALUES(?, 'E', 'e@x.fr', ?)").run(pid, now());
    await s.db.prepare("INSERT INTO blacklist(email, reason, created_at) VALUES('opp@x.fr', 'unsubscribe', ?)").run(now());
    for (const bad of ['', 'autre@exemple.fr', 'bob@exemple.f']) {
      assert.match(where(await form(admin, `/admin/users/${bob.id}/delete`, { confirm: bad })), /ne correspond pas/, bad);
    }
    assert.ok(await s.db.prepare('SELECT 1 x FROM users WHERE id = ?').get(bob.id), 'toujours là sans la bonne saisie');
    const ok = await form(admin, `/admin/users/${bob.id}/delete`, { confirm: ' Bob@Exemple.fr ' });
    assert.match(where(ok), /done=delete/);
    for (const [t, col] of [['users', 'id'], ['projects', 'user_id'], ['sessions', 'user_id'], ['jobs', 'user_id']]) {
      assert.equal((await s.db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${col} = ?`).get(bob.id)).n, 0, t);
    }
    assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM prospects WHERE project_id = ?').get(pid)).n, 0);
    assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM blacklist').get()).n, 1, 'la liste d\'opposition est conservée, comme à la suppression du compte');
    const [entry] = await recentAudit(s.db);
    assert.equal(entry.action, 'delete');
    assert.equal(entry.target, 'b***@exemple.fr');
    assert.ok(!JSON.stringify(entry).includes('bob@exemple.fr'), 'l\'adresse complète n\'est pas gardée');
  } finally { await s.close(); }
});

test('journal d\'audit : en lecture seule, aucune route ni requête ne le modifie, purge des lignes anciennes', async () => {
  const s = await startApp();
  try {
    const admin = await s.newUser({ admin: true });
    const target = { id: 5, email: 'jean@exemple.fr' };
    await logAudit(s.db, { admin: { id: admin.id, email: 'a@x.fr' }, action: 'suspend', target, at: now() - 400 * 86400 });
    await logAudit(s.db, { action: 'abuse_pause', target, detail: 'x'.repeat(900), at: now() });
    await assert.rejects(logAudit(s.db, { action: 'inconnue', target }), /inconnue/);
    const page = await (await admin.get('/admin', html)).text();
    assert.match(page, /Journal d'audit/);
    assert.match(page, /Envois mis en pause/);
    assert.match(page, /système/);
    assert.doesNotMatch(page, /jean@exemple\.fr/);
    assert.equal((await recentAudit(s.db)).find((l) => l.action === 'abuse_pause').detail.length, 500, 'détail borné');
    // La section du journal ne propose aucun formulaire
    const section = page.slice(page.indexOf("Journal d'audit"));
    assert.doesNotMatch(section, /<form|<button/);
    // Aucune route d'écriture sur le journal
    assert.ok(!s.app.router.routes.some((r) => /audit/.test(r.re.source)));
    // Dans le code, seule la purge ancienne supprime des lignes ; rien ne les met à jour
    const files = [];
    const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); e.isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p); } };
    walk('src');
    const src = files.map((f) => [f, readFileSync(f, 'utf8')]);
    for (const [f, text] of src) {
      assert.doesNotMatch(text, /UPDATE\s+admin_audit/i, f);
      if (!f.endsWith('admin.js')) assert.doesNotMatch(text, /DELETE\s+FROM\s+admin_audit/i, f);
    }
    await purgeAudit(s.db, 12);
    assert.deepEqual((await recentAudit(s.db)).map((l) => l.action), ['abuse_pause'], 'la ligne de plus de 12 mois est retirée');
    assert.equal(maskEmail('a@b.fr'), 'a***@b.fr');
    assert.equal(maskEmail('sans-arobase'), 's***');
  } finally { await s.close(); }
});
