import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { now, setSetting } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { createApp } from '../src/server.js';
import { unsubToken, hashSid } from '../src/crypto.js';
import { addUser, TEST_SECRET_KEY } from './helpers/users.js';
import { PUBLIC_DNS, FAKE_MX } from './helpers/server.js';

const APP_URL = 'https://ai.tony-averty.dev';
let app, base, cookie, tmp, uid;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'aitools-http-'));
  const cfg = {
    appUrl: APP_URL, google: { clientId: 'cid', clientSecret: 'cs' }, apple: null, adminEmails: ['me@gmail.com'],
    secretKey: TEST_SECRET_KEY, dataDir: tmp, claudeBin: 'claude', sandbox: { enabled: false, production: false },
  };
  app = await createApp(cfg, { db: await testDb(), worker: false, resolveHost: PUBLIC_DNS, resolveMx: FAKE_MX }); // DNS injecté : le test ne dépend pas du réseau
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  uid = await addUser(app.db, { email: 'me@gmail.com' });
  await app.db.prepare('INSERT INTO sessions(id, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)').run(hashSid('sess1'), uid, now(), now() + 3600);
  cookie = 'sid=sess1';
});
after(async () => { await app.close(); rmSync(tmp, { recursive: true, force: true }); });

const get = (p, auth = true) => fetch(base + p, { redirect: 'manual', headers: auth ? { cookie, accept: 'application/json' } : {} });
const post = (p, body, { auth = true, origin = APP_URL, form = false } = {}) => fetch(base + p, {
  method: 'POST', redirect: 'manual',
  headers: {
    ...(auth ? { cookie } : {}), ...(origin ? { origin } : {}),
    'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json', accept: 'application/json',
  },
  body: form ? new URLSearchParams(body).toString() : JSON.stringify(body ?? {}),
});

test('non connecté : redirection / 401 et pages publiques', async () => {
  // La racine est le site public pour un visiteur ; une page d'application renvoie vers la connexion
  let r = await get('/', false);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<h1[^>]*>Trouve de nouveaux clients/);
  r = await get('/account', false);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/login');
  r = await get('/api/system', false);
  assert.equal(r.status, 401);
  r = await get('/login', false);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Se connecter avec Google/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  r = await get('/auth/google', false);
  assert.equal(r.status, 303);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.host, 'accounts.google.com');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(loc.searchParams.get('redirect_uri'), `${APP_URL}/auth/google/callback`);
  r = await get('/static/app.js', false);
  assert.equal(r.status, 200);
});

test('callback OAuth avec state inconnu → retour login avec erreur', async () => {
  const r = await get('/auth/google/callback?code=x&state=forge', false);
  assert.equal(r.status, 303);
  assert.match(decodeURIComponent(r.headers.get('location')), /State OAuth invalide/);
});

test('anti-CSRF : POST sans bonne origine refusé', async () => {
  let r = await post('/api/projects', { name: 'x' }, { origin: 'https://evil.com' });
  assert.equal(r.status, 403);
  r = await post('/api/projects', { name: 'x' }, { origin: null });
  assert.equal(r.status, 403);
});

test('dashboard, réglages, création de projet et statut', async () => {
  let r = await get('/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Aucun projet/);

  r = await post('/api/projects', { name: 'MEP', gitUrl: 'https://git.tony-averty.dev/Tony/MEP.git' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /github\.com/);

  r = await post('/settings', { notify_email: 'moi@x.fr', git_type_0: 'forgejo', git_host_0: 'https://git.tony-averty.dev/', git_token_0: 'tok123', global_daily_cap: '9999', send_delay_min: '1', send_delay_max: '2', prospect_model: 'opus', analyze_model: 'gpt-4; rm -rf /' }, { form: true });
  assert.equal(r.status, 303);
  const s = async (k) => (await app.db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND `key` = ?').get(uid, k))?.value;
  const servers = JSON.parse(await s('git_servers_json'));
  assert.deepEqual(servers.map((x) => [x.type, x.host]), [['forgejo', 'git.tony-averty.dev']]);
  assert.equal(await s('global_daily_cap'), '300', 'plafond borné');
  assert.equal(await s('send_delay_min'), '5');
  assert.equal(await s('prospect_model'), 'opus', 'tous les modèles du catalogue sont acceptés');
  assert.equal(await s('analyze_model'), 'haiku', 'un identifiant hors catalogue n\'est jamais transmis à Claude : retour à Haiku');
  assert.ok(servers[0].tokenEnc && !servers[0].tokenEnc.includes('tok123'), 'token chiffré');

  // Un autre hôte que GitHub et le serveur Git personnel : refusé (GitHub, lui, est accepté d'office : voir test/git-hosts.test.js)
  r = await post('/api/projects', { name: 'MEP', gitUrl: 'https://gitlab.com/Tony/MEP.git' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /doit être sur github\.com ou git\.tony-averty\.dev/);
  r = await post('/api/projects', { name: 'MEP', gitUrl: 'https://git.tony-averty.dev/Tony/MEP.git' });
  assert.equal(r.status, 200);
  const { id } = await r.json();
  r = await post('/api/projects', { name: 'MEP2', gitUrl: 'https://git.tony-averty.dev/Tony/MEP.git' });
  assert.equal(r.status, 409);

  r = await get(`/api/projects/${id}/status`);
  const st = await r.json();
  assert.equal(st.jobs.analyze.status, 'queued');
  assert.equal(st.sendMax, 0);

  r = await post(`/api/projects/${id}/prospect`, { count: 5 });
  assert.equal(r.status, 400, 'cible non validée');
  r = await post(`/api/projects/${id}/target`, { description: 'commerces', secteurs: 'boulangerie\nfleuriste', zone: 'Rennes' });
  assert.equal(r.status, 200);
  r = await post(`/api/projects/${id}/prospect`, { count: 999 });
  assert.equal(r.status, 200);
  const job = await app.db.prepare("SELECT params_json FROM jobs WHERE type = 'prospect'").get();
  assert.equal(JSON.parse(job.params_json).count, 50, 'borné à 50');

  r = await post(`/api/projects/${id}/send`, { count: 5 });
  assert.equal(r.status, 400, 'confirmation obligatoire');
  r = await post(`/api/projects/${id}/send`, { count: 5, confirm: true });
  assert.equal(r.status, 409, 'recherche encore en cours');

  r = await post(`/api/projects/${id}/db`, { type: 'mysql', sql_users: 'DELETE FROM users' });
  assert.equal(r.status, 400);
  r = await post(`/api/projects/${id}/smtp`, { host: 'smtp.x', user: 'u', pass: 'secretpass', fromEmail: 'a@x.fr', dailyCap: 5000 });
  assert.equal(r.status, 200);
  const row = await app.db.prepare('SELECT smtp_enc, daily_mail_cap FROM projects WHERE id = ?').get(id);
  assert.ok(!row.smtp_enc.includes('secretpass'));
  assert.equal(row.daily_mail_cap, 200);

  r = await get('/');
  const page = await r.text();
  assert.ok(!page.includes('secretpass'), 'le mot de passe ne ressort jamais dans la page');
  assert.doesNotMatch(page, /readonly disabled/, 'plus de SMTP commun affiché en lecture seule : chaque projet a le sien');

  r = await get(`/api/projects/${id}/recap`);
  assert.match((await r.json()).error, /non configuré/);
});

test('désinscription : GET confirme, POST blackliste, token forgé refusé', async () => {
  const email = 'contact@fournil.fr';
  const tok = unsubToken(app.cfg.secretKey, email);
  let r = await get(`/u/${encodeURIComponent(email)}/${tok}`, false);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Confirmer/);
  assert.equal((await app.db.prepare('SELECT COUNT(*) n FROM blacklist').get()).n, 0);
  r = await post(`/u/${encodeURIComponent(email)}/${tok}`, 'List-Unsubscribe=One-Click', { auth: false, origin: null, form: true });
  assert.equal(r.status, 200);
  assert.equal((await app.db.prepare('SELECT COUNT(*) n FROM blacklist WHERE email = ?').get(email)).n, 1);
  r = await post(`/u/${encodeURIComponent(email)}/faux`, {}, { auth: false, origin: null });
  assert.equal(r.status, 400);
});

test('SECRET_KEY changée : le panel reste utilisable, les secrets sont à ressaisir', async () => {
  const id = (await app.db.prepare('SELECT id FROM projects LIMIT 1').get()).id;
  await app.db.prepare('UPDATE projects SET smtp_enc = ? WHERE id = ?').run('v1:AAAA:BBBB:CCCC', id);
  const warn = console.warn; console.warn = () => {};
  try {
    let r = await get('/');
    assert.equal(r.status, 200);
    r = await get('/settings');
    assert.equal(r.status, 200);
    r = await get(`/api/projects/${id}/status`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).hasSmtp, true, 'la colonne existe toujours');
    r = await post(`/api/projects/${id}/smtp`, { host: 'smtp.x', user: 'u', pass: 'nouveau', fromEmail: 'a@x.fr' });
    assert.equal(r.status, 200, 'on peut ressaisir');
  } finally { console.warn = warn; }
});

test('« Cette nuit » programme le job au prochain créneau 1h-6h', async () => {
  const id = (await app.db.prepare('SELECT id FROM projects LIMIT 1').get()).id;
  await app.db.prepare("UPDATE jobs SET status = 'cancelled' WHERE status IN ('queued', 'running')").run();
  const r = await post(`/api/projects/${id}/evolution`, { count: 3, level: 'rapide', when: 'night' });
  assert.equal(r.status, 200);
  const job = await app.db.prepare("SELECT run_after FROM jobs WHERE type = 'evolution' ORDER BY id DESC LIMIT 1").get();
  const { parisParts } = await import('../src/services/paris-time.js');
  const p = parisParts(new Date(job.run_after * 1000));
  assert.ok(p.hour >= 1 && p.hour < 6, `démarrage à ${p.hour}h`);
  const sys = await (await get('/api/system')).json();
  assert.ok(job.run_after > now() ? sys.scheduled >= 1 : true);
  // Le menu « jobs » de la barre du haut reçoit le détail, avec le nom du projet
  const listed = sys.jobs.find((j) => j.type === 'evolution');
  assert.equal(listed.status, 'queued');
  assert.equal(listed.projectId, id);
  assert.ok(listed.project);
});

test('réglages Discord : URL validée, chiffrée, événements enregistrés, plusieurs webhooks', async () => {
  const base = { notify_email: 'moi@x.fr', git_type_0: 'forgejo', git_host_0: 'git.tony-averty.dev', global_daily_cap: '100', send_delay_min: '20', send_delay_max: '60' };
  const stored = async () => JSON.parse((await app.db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND `key` = 'discord_hooks_json'").get(uid)).value);
  let r = await post('/settings', { ...base, discord_url_0: 'https://evil.com/api/webhooks/1/x' }, { form: true });
  assert.equal(r.status, 400);
  const hook = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz-ABC_123';
  const hook2 = 'https://discord.com/api/webhooks/223456789012345678/zyxwvutsrqponmlkjihgfedcba-ABC_123';
  r = await post('/settings', { ...base, discord_url_0: hook, discord_ev_0_reply: 'on', discord_ev_0_job_error: 'on' }, { form: true });
  assert.equal(r.status, 303);
  let list = await stored();
  assert.equal(list.length, 1);
  assert.ok(!JSON.stringify(list).includes('abcdefghijklmnop'), 'URL chiffrée');
  assert.deepEqual(list[0].events, ['job_error', 'reply']);
  r = await get('/settings');
  let page = await r.text();
  assert.ok(!page.includes('abcdefghijklmnop'), 'URL jamais réaffichée');
  assert.match(page, /data-notify-test/);
  assert.match(page, /data-chan-pick="discord"/, 'menu « + » : Discord, pour un autre webhook');
  assert.match(page, /Aucun canal ne reçoit pour l&#39;instant|Aucun canal ne reçoit pour l'instant/, 'événements sans webhook signalés');

  // Un second webhook pour d'autres événements ; l'adresse laissée vide du premier est conservée
  const id0 = list[0].id;
  r = await post('/settings', { ...base, discord_id_0: id0, discord_url_0: '', discord_ev_0_reply: 'on', discord_ev_0_job_error: 'on', discord_url_1: hook2, discord_ev_1_weekly: 'on', discord_ev_1_job_done: 'on' }, { form: true });
  assert.equal(r.status, 303);
  list = await stored();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, id0);
  assert.deepEqual(list[1].events, ['job_done', 'weekly']);
  r = await post('/settings', { ...base, discord_id_0: id0, discord_ev_0_reply: 'on', discord_url_0: '', discord_id_1: list[1].id, discord_url_1: '', discord_del_1: '1' }, { form: true });
  list = await stored();
  assert.equal(list.length, 1, 'webhook retiré');
  r = await post('/settings', { ...base, discord_id_0: id0, discord_url_0: '', discord_del_0: '1' }, { form: true });
  assert.deepEqual(await stored(), []);
});

test('budget : réglages, jauge et avertissement au lancement', async () => {
  const base = { notify_email: 'moi@x.fr', git_type_0: 'forgejo', git_host_0: 'git.tony-averty.dev', global_daily_cap: '100', send_delay_min: '20', send_delay_max: '60' };
  // Les plafonds en $ n'existent qu'avec une clé API ; le quota d'abonnement, qu'avec un jeton d'abonnement : on passe de l'un à l'autre
  const subscriptionLink = (await app.db.prepare('SELECT claude_link_json j FROM users WHERE id = ?').get(uid)).j;
  const setLink = (j) => app.db.prepare('UPDATE users SET claude_link_json = ? WHERE id = ?').run(j, uid);
  await setLink(JSON.stringify({ v: 1, mode: 'api_key', valid: true }));
  let r = await post('/settings', { ...base, budget_day_usd: '0,5', budget_month_usd: 'abc' }, { form: true });
  assert.equal(r.status, 303);
  const s = async (k) => (await app.db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND `key` = ?').get(uid, k))?.value;
  assert.equal(await s('budget_day_usd'), '0.5', 'virgule française acceptée');
  assert.equal(await s('budget_month_usd'), '', 'valeur invalide = pas de limite');
  await app.db.prepare("INSERT INTO jobs(user_id, type, status, cost_usd, created_at, finished_at) VALUES(?, 'evolution', 'done', 0.8, ?, ?)").run(uid, now(), now());
  let sys = await (await get('/api/system')).json();
  assert.equal(sys.budget.blocked, true);
  assert.equal(sys.claudeRateLimit, null, 'pas encore mesuré sans appel Claude');
  await setLink(subscriptionLink);
  await setSetting(app.db, uid, 'claude_rate_limit_json', JSON.stringify({ at: now(), fiveHour: { utilization: 0.42, resetsAt: 4_000_000_000 }, sevenDay: { utilization: 0.1, resetsAt: 4_000_000_000 } }));
  sys = await (await get('/api/system')).json();
  assert.equal(sys.claudeRateLimit.fiveHour.utilization, 0.42);
  assert.equal(sys.claudeRateLimit.sevenDay.utilization, 0.1);
  await setLink(JSON.stringify({ v: 1, mode: 'api_key', valid: true }));
  const id = (await app.db.prepare('SELECT id FROM projects LIMIT 1').get()).id;
  await app.db.prepare("UPDATE jobs SET status = 'cancelled' WHERE status IN ('queued', 'running')").run();
  r = await post(`/api/projects/${id}/evolution`, { count: 2, level: 'rapide' });
  assert.match((await r.json()).budgetBlocked, /budget IA des dernières 24 h atteint/);
  await post('/settings', { ...base, budget_day_usd: '' }, { form: true });
  await setLink(subscriptionLink);
});

test('fiche prospect : routes notes et prochaine action', async () => {
  const pid = (await app.db.prepare('SELECT id FROM projects LIMIT 1').get()).id;
  const id = Number((await app.db.prepare("INSERT INTO prospects(project_id, company, email, website, created_at) VALUES(?, 'Atelier', 'a@atelier.fr', 'javascript:alert(1)', ?)").run(pid, now())).lastInsertRowid);
  let r = await post(`/api/prospects/${id}/notes`, { body: '<script>x</script>' });
  assert.equal(r.status, 200);
  r = await post(`/api/prospects/${id}/notes`, { body: '' });
  assert.equal(r.status, 400);
  r = await post(`/api/prospects/${id}/next`, { action: 'Rappeler', day: '2026-02-31' });
  assert.equal(r.status, 400);
  r = await post(`/api/prospects/${id}/next`, { action: 'Rappeler', day: '2026-11-03' });
  assert.equal(r.status, 200);
  const d = await (await get(`/api/prospects/${id}`)).json();
  assert.equal(d.notes[0].body, '<script>x</script>', 'stocké brut, échappé à l\'affichage');
  assert.equal(d.prospect.next_action, 'Rappeler');
  r = await get('/api/prospects/999999');
  assert.equal(r.status, 404);
  r = await post(`/api/prospects/${id}/notes/${d.notes[0].id}/delete`, {}, { origin: 'https://evil.com' });
  assert.equal(r.status, 403, 'CSRF bloqué');
  const list = await (await get(`/api/projects/${pid}/prospects?q=atelier`)).json();
  assert.equal(list.rows[0].next_action, 'Rappeler');
});

test('CSV : export en pièce jointe, import via l\'API', async () => {
  const pid = (await app.db.prepare('SELECT id FROM projects LIMIT 1').get()).id;
  let r = await get(`/api/projects/${pid}/prospects.csv?q=atelier`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="prospects-mep-\d{4}-\d{2}-\d{2}\.csv"/);
  assert.match(await r.text(), /a@atelier\.fr/);
  r = await post(`/api/projects/${pid}/prospects/import`, { csv: 'email;entreprise\nnouveau@client.fr;Nouveau' });
  assert.deepEqual(await r.json(), { total: 1, imported: 1, skipped: 0, invalid: [] });
  r = await post(`/api/projects/${pid}/prospects/import`, { csv: 'nom\nx' });
  assert.equal(r.status, 400);
  r = await fetch(`${base}/api/projects/${pid}/prospects.csv`);
  assert.equal(r.status, 401, 'pas d\'export sans session');
});
