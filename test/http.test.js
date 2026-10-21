import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, now } from '../src/db.js';
import { createApp } from '../src/server.js';
import { unsubToken } from '../src/crypto.js';

const APP_URL = 'https://ai.tony-averty.dev';
let app, base, cookie, tmp;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'aitools-http-'));
  const cfg = {
    appUrl: APP_URL, google: { clientId: 'cid', clientSecret: 'cs' }, allowedEmails: ['me@gmail.com'],
    secretKey: randomBytes(32), dataDir: tmp, claudeBin: 'claude', thermalMax: 75,
  };
  app = createApp(cfg, { db: openDb(':memory:'), worker: false });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  app.db.prepare('INSERT INTO sessions(id, email, created_at, expires_at) VALUES(?, ?, ?, ?)').run('sess1', 'me@gmail.com', now(), now() + 3600);
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
  let r = await get('/', false);
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
  assert.match((await r.json()).error, /Forgejo/);

  r = await post('/settings', { notify_email: 'moi@x.fr', forgejo_host: 'https://git.tony-averty.dev/', forgejo_token: 'tok123', global_daily_cap: '9999', send_delay_min: '1', send_delay_max: '2', prospect_model: 'opus', analyze_model: 'opus' }, { form: true });
  assert.equal(r.status, 303);
  const s = (k) => app.db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
  assert.equal(s('forgejo_host'), 'git.tony-averty.dev');
  assert.equal(s('global_daily_cap'), '300', 'plafond borné');
  assert.equal(s('send_delay_min'), '5');
  assert.equal(s('prospect_model'), 'haiku', 'opus refusé pour la prospection');
  assert.equal(s('analyze_model'), 'haiku', 'opus refusé pour l\'analyse');
  assert.ok(!s('forgejo_token_enc').includes('tok123'), 'token chiffré');

  r = await post('/api/projects', { name: 'MEP', gitUrl: 'https://github.com/Tony/MEP.git' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /doit être sur git\.tony-averty\.dev/);
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
  const job = app.db.prepare("SELECT params_json FROM jobs WHERE type = 'prospect'").get();
  assert.equal(JSON.parse(job.params_json).count, 50, 'borné à 50');

  r = await post(`/api/projects/${id}/send`, { count: 5 });
  assert.equal(r.status, 400, 'confirmation obligatoire');
  r = await post(`/api/projects/${id}/send`, { count: 5, confirm: true });
  assert.equal(r.status, 409, 'recherche encore en cours');

  r = await post(`/api/projects/${id}/db`, { type: 'mysql', sql_users: 'DELETE FROM users' });
  assert.equal(r.status, 400);
  r = await post(`/api/projects/${id}/smtp`, { host: 'smtp.x', user: 'u', pass: 'secretpass', fromEmail: 'a@x.fr', dailyCap: 5000 });
  assert.equal(r.status, 200);
  const row = app.db.prepare('SELECT smtp_enc, daily_mail_cap FROM projects WHERE id = ?').get(id);
  assert.ok(!row.smtp_enc.includes('secretpass'));
  assert.equal(row.daily_mail_cap, 200);

  r = await get('/');
  const page = await r.text();
  assert.ok(!page.includes('secretpass'), 'le mot de passe ne ressort jamais dans la page');
  assert.match(page, /readonly disabled/);

  r = await get(`/api/projects/${id}/recap`);
  assert.match((await r.json()).error, /non configuré/);
});

test('désinscription : GET confirme, POST blackliste, token forgé refusé', async () => {
  const email = 'contact@fournil.fr';
  const tok = unsubToken(app.cfg.secretKey, email);
  let r = await get(`/u/${encodeURIComponent(email)}/${tok}`, false);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Confirmer/);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM blacklist').get().n, 0);
  r = await post(`/u/${encodeURIComponent(email)}/${tok}`, 'List-Unsubscribe=One-Click', { auth: false, origin: null, form: true });
  assert.equal(r.status, 200);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM blacklist WHERE email = ?').get(email).n, 1);
  r = await post(`/u/${encodeURIComponent(email)}/faux`, {}, { auth: false, origin: null });
  assert.equal(r.status, 400);
});

test('SECRET_KEY changée : le panel reste utilisable, les secrets sont à ressaisir', async () => {
  const id = app.db.prepare('SELECT id FROM projects LIMIT 1').get().id;
  app.db.prepare('UPDATE projects SET smtp_enc = ? WHERE id = ?').run('v1:AAAA:BBBB:CCCC', id);
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
  const id = app.db.prepare('SELECT id FROM projects LIMIT 1').get().id;
  app.db.prepare("UPDATE jobs SET status = 'cancelled' WHERE status IN ('queued', 'running')").run();
  const r = await post(`/api/projects/${id}/evolution`, { count: 3, level: 'rapide', when: 'night' });
  assert.equal(r.status, 200);
  const job = app.db.prepare("SELECT run_after FROM jobs WHERE type = 'evolution' ORDER BY id DESC LIMIT 1").get();
  const { parisParts } = await import('../src/services/paris-time.js');
  const p = parisParts(new Date(job.run_after * 1000));
  assert.ok(p.hour >= 1 && p.hour < 6, `démarrage à ${p.hour}h`);
  const sys = await (await get('/api/system')).json();
  assert.ok(job.run_after > now() ? sys.scheduled >= 1 : true);
});

test('réglages Discord : URL validée, chiffrée, événements enregistrés', async () => {
  const base = { notify_email: 'moi@x.fr', forgejo_host: 'git.tony-averty.dev', global_daily_cap: '100', send_delay_min: '20', send_delay_max: '60' };
  let r = await post('/settings', { ...base, discord_webhook: 'https://evil.com/api/webhooks/1/x' }, { form: true });
  assert.equal(r.status, 400);
  const hook = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz-ABC_123';
  r = await post('/settings', { ...base, discord_webhook: hook, ev_reply: 'on', ev_job_error: 'on' }, { form: true });
  assert.equal(r.status, 303);
  const enc = app.db.prepare("SELECT value FROM settings WHERE key = 'discord_webhook_enc'").get().value;
  assert.ok(!enc.includes('abcdefghijklmnop'), 'URL chiffrée');
  assert.deepEqual(JSON.parse(app.db.prepare("SELECT value FROM settings WHERE key = 'discord_events'").get().value), ['job_error', 'reply']);
  r = await get('/settings');
  const page = await r.text();
  assert.ok(!page.includes('abcdefghijklmnop'), 'URL jamais réaffichée');
  assert.match(page, /data-notify-test/);
  r = await post('/settings', { ...base, discord_remove: 'on' }, { form: true });
  assert.equal(app.db.prepare("SELECT value FROM settings WHERE key = 'discord_webhook_enc'").get().value, null);
});

test('budget : réglages, jauge et avertissement au lancement', async () => {
  const base = { notify_email: 'moi@x.fr', forgejo_host: 'git.tony-averty.dev', global_daily_cap: '100', send_delay_min: '20', send_delay_max: '60' };
  let r = await post('/settings', { ...base, budget_day_usd: '0,5', budget_month_usd: 'abc' }, { form: true });
  assert.equal(r.status, 303);
  const s = (k) => app.db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
  assert.equal(s('budget_day_usd'), '0.5', 'virgule française acceptée');
  assert.equal(s('budget_month_usd'), '', 'valeur invalide = pas de limite');
  app.db.prepare("INSERT INTO jobs(type, status, cost_usd, created_at, finished_at) VALUES('evolution', 'done', 0.8, ?, ?)").run(now(), now());
  const sys = await (await get('/api/system')).json();
  assert.equal(sys.budget.blocked, true);
  const id = app.db.prepare('SELECT id FROM projects LIMIT 1').get().id;
  app.db.prepare("UPDATE jobs SET status = 'cancelled' WHERE status IN ('queued', 'running')").run();
  r = await post(`/api/projects/${id}/evolution`, { count: 2, level: 'rapide' });
  assert.match((await r.json()).budgetBlocked, /budget IA des dernières 24 h atteint/);
  await post('/settings', { ...base, budget_day_usd: '' }, { form: true });
});

test('fiche prospect : routes notes et prochaine action', async () => {
  const pid = app.db.prepare('SELECT id FROM projects LIMIT 1').get().id;
  const id = Number(app.db.prepare("INSERT INTO prospects(project_id, company, email, website, created_at) VALUES(?, 'Atelier', 'a@atelier.fr', 'javascript:alert(1)', ?)").run(pid, now()).lastInsertRowid);
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
  const pid = app.db.prepare('SELECT id FROM projects LIMIT 1').get().id;
  let r = await get(`/api/projects/${pid}/prospects.csv?q=atelier`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="prospects-mep-\d{4}-\d{2}-\d{2}\.csv"/);
  assert.match(await r.text(), /a@atelier\.fr/);
  r = await post(`/api/projects/${pid}/prospects/import`, { csv: 'email;entreprise\nnouveau@client.fr;Nouveau' });
  assert.deepEqual(await r.json(), { total: 1, imported: 1, duplicates: 0, blacklisted: 0, invalid: [] });
  r = await post(`/api/projects/${pid}/prospects/import`, { csv: 'nom\nx' });
  assert.equal(r.status, 400);
  r = await fetch(`${base}/api/projects/${pid}/prospects.csv`);
  assert.equal(r.status, 401, 'pas d\'export sans session');
});
