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

  r = await post('/settings', { notify_email: 'moi@x.fr', forgejo_host: 'https://git.tony-averty.dev/', forgejo_token: 'tok123', global_daily_cap: '9999', send_delay_min: '1', send_delay_max: '2', prospect_model: 'opus' }, { form: true });
  assert.equal(r.status, 303);
  const s = (k) => app.db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
  assert.equal(s('forgejo_host'), 'git.tony-averty.dev');
  assert.equal(s('global_daily_cap'), '300', 'plafond borné');
  assert.equal(s('send_delay_min'), '5');
  assert.equal(s('prospect_model'), 'haiku', 'opus refusé pour la prospection');
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
