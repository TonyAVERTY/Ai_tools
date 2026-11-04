// Régressions de sécurité du serveur HTTP : requêtes mal formées, en-têtes, mise en cache, limites des routes publiques.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startApp } from './helpers/server.js';
import { unsubToken } from '../src/crypto.js';
import { TEST_SECRET_KEY } from './helpers/users.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

// fetch normalise l'URL : pour envoyer une cible brute (`//`, `%zz`), on parle HTTP directement sur le socket
const raw = (target, { headers = '' } = {}) => new Promise((resolve, reject) => {
  const c = net.connect(new URL(s.base).port, '127.0.0.1', () => c.write(`GET ${target} HTTP/1.1\r\nHost: x\r\n${headers}Connection: close\r\n\r\n`));
  let data = '';
  c.on('data', (d) => { data += d; });
  c.on('close', () => resolve(data));
  c.on('error', reject);
  setTimeout(() => { c.destroy(); resolve(data); }, 2000);
});
const status = (res) => Number(/^HTTP\/1\.1 (\d{3})/.exec(res)?.[1] || 0);

test('une cible illisible (//) répond 400 au lieu de faire tomber le processus', async () => {
  const crashes = [];
  const onRej = (e) => crashes.push(e);
  process.on('unhandledRejection', onRej);
  try {
    for (const t of ['//', '///', '//:80']) assert.equal(status(await raw(t)), 400, t);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(crashes, [], 'aucune promesse rejetée non gérée');
    assert.equal((await fetch(`${s.base}/login`)).status, 200, 'le serveur répond toujours');
  } finally { process.off('unhandledRejection', onRej); }
});

test('encodage % invalide dans l\'URL ou un cookie : erreur du client (400) ou ignoré, jamais 500', async () => {
  assert.equal(status(await raw('/u/%zz/x')), 400);
  assert.equal(status(await raw('/api/projects/%zz/status')), 400);
  const r = await raw('/login', { headers: 'Cookie: sid=%E0%A4%A\r\n' });
  assert.equal(status(r), 200, 'cookie mal encodé = visiteur sans session');
});

test('JSON invalide : 400 (et pas 500) sur une route authentifiée', async () => {
  const u = await s.newUser();
  const r = await fetch(`${s.base}/api/projects`, {
    method: 'POST', headers: { cookie: u.cookie, origin: 'https://ai.tony-averty.dev', 'content-type': 'application/json', accept: 'application/json' }, body: '{{{',
  });
  assert.equal(r.status, 400);
  assert.doesNotMatch(await r.text(), /SyntaxError|at /);
});

test('en-têtes : pages et API privées jamais en cache, ressources non partageables entre origines', async () => {
  const u = await s.newUser();
  const api = await u.get('/api/system');
  assert.match(api.headers.get('cache-control'), /no-store/);
  const login = await fetch(`${s.base}/login`);
  assert.match(login.headers.get('cache-control'), /no-store/);
  assert.equal(login.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(login.headers.get('x-content-type-options'), 'nosniff');
  assert.match(login.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  // les fichiers statiques gardent leur cache
  assert.match((await fetch(`${s.base}/static/app.css`)).headers.get('cache-control'), /max-age/);
});

test('aucune route d\'écriture ne répond à GET, et le routeur ignore les méthodes inattendues', async () => {
  const u = await s.newUser();
  for (const p of ['/logout', '/account/delete', '/api/projects/1/delete', '/team/delete']) {
    assert.equal((await u.get(p, { headers: { accept: 'text/html' } })).status, 404, `GET ${p}`);
  }
  const r = await fetch(`${s.base}/api/projects`, { method: 'DELETE', headers: { cookie: u.cookie, origin: 'https://ai.tony-averty.dev' } });
  assert.equal(r.status, 404);
});

test('désinscription : un jeton faux est refusé, et la route publique est limitée par adresse', async () => {
  const lim = await startApp({ rateLimit: true });
  try {
    const good = unsubToken(TEST_SECRET_KEY, 'a@b.fr');
    assert.equal((await fetch(`${lim.base}/u/a%40b.fr/${good}`)).status, 200);
    assert.equal((await fetch(`${lim.base}/u/a%40b.fr/faux`)).status, 400);
    let last = 0;
    for (let i = 0; i < 70; i++) last = (await fetch(`${lim.base}/u/a%40b.fr/faux`)).status;
    assert.equal(last, 429);
  } finally { await lim.close(); }
});

test('injection SQL dans la recherche de prospects : traitée comme du texte', async () => {
  const u = await s.newUser();
  const r = await u.get(`/api/projects/1/prospects?q=${encodeURIComponent("' OR 1=1; DROP TABLE prospects;--")}&sort=${encodeURIComponent('score; DROP TABLE users')}&status=x`);
  assert.ok([200, 404].includes(r.status), `statut ${r.status}`);
  const n = await s.db.prepare('SELECT COUNT(*) n FROM users').get();
  assert.ok(Number(n.n) >= 1, 'la table users existe toujours');
});

test('sessions : la base ne garde que l\'empreinte du cookie, et la déconnexion la supprime', async () => {
  const { hashSid } = await import('../src/crypto.js');
  const u = await s.newUser();
  const sid = u.cookie.split('=')[1];
  const rows = await s.db.prepare('SELECT id FROM sessions WHERE user_id = ?').all(u.id);
  assert.deepEqual(rows.map((r) => r.id), [hashSid(sid)], 'empreinte en base');
  assert.notEqual(rows[0].id, sid, 'jamais la valeur du cookie');
  // l'empreinte seule (ce que verrait quelqu'un qui lit la base) n'ouvre aucune session
  assert.equal((await fetch(`${s.base}/api/system`, { headers: { cookie: `sid=${rows[0].id}`, accept: 'application/json' } })).status, 401);
  assert.equal((await u.get('/api/system')).status, 200);
  await u.post('/logout', {}, { form: true });
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(u.id)).n, 0);
});

test('migration : les sessions existantes restent valides (cookie inchangé), sans double hachage', async () => {
  const { testDb } = await import('./helpers/db.js');
  const { MIGRATIONS } = await import('../src/migrations.js');
  const { hashSid } = await import('../src/crypto.js');
  const { now } = await import('../src/db.js');
  const i = MIGRATIONS.findIndex((m) => m.name === 'session_id_hashing');
  assert.ok(i > 0);
  const db = await testDb();
  const uid = Number((await db.prepare("INSERT INTO users(email, status, is_admin, plan, created_at) VALUES('m@x.fr','active',0,'free',?)").run(now())).lastInsertRowid);
  const t = now();
  await db.prepare('INSERT INTO sessions(id, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)').run('ancien-cookie', uid, t, t + 99);
  await MIGRATIONS[i].sqlite[0].run(async (sql, p = []) => db.prepare(sql).all(...p), {}, async (sql, p = []) => db.prepare(sql).run(...p));
  assert.deepEqual((await db.prepare('SELECT id FROM sessions').all()).map((r) => r.id), [hashSid('ancien-cookie')]);
  // rejouée : l'empreinte n'est pas rehachée
  await MIGRATIONS[i].sqlite[0].run(async (sql, p = []) => db.prepare(sql).all(...p), {}, async (sql, p = []) => db.prepare(sql).run(...p));
  assert.deepEqual((await db.prepare('SELECT id FROM sessions').all()).map((r) => r.id), [hashSid('ancien-cookie')]);
});
