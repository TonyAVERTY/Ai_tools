import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransport } from '../src/services/mailer.js';
import { pinArgs, cloneArgs, fetchArgs } from '../src/services/git.js';
import { blockedReason, normalizeIp } from '../src/ip.js';
import { resolvePublic, guardTarget, pinSmtp, pinImap, pinDb, pinGit, assertPort } from '../src/netguard.js';
import { ALLOWED_PORTS } from '../src/limits.js';
import { loadConfig } from '../src/config.js';
import { Worker, enqueue } from '../src/services/jobs.js';
import { makeHandlers } from '../src/handlers.js';
import { checkInbox } from '../src/services/inbox.js';
import { saveSecretConfig } from '../src/projects.js';
import { now } from '../src/db.js';
import { startApp } from './helpers/server.js';

// Filtrage des hôtes saisis par l'utilisateur (SSRF) : adresses, résolution, ports, rebinding, branchement sur chaque service.
// Aucune requête DNS ni connexion réelle : le résolveur est injecté.

const PUBLIC = '93.184.216.34';
const dns = (map) => async (host) => {
  const v = map[host];
  if (v instanceof Error) throw v;
  if (!v) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return [].concat(v).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};

// ---------- Adresses ----------

test('adresses refusées : boucle locale, privées, link-local (métadonnées), CGNAT, IPv6 locales, IPv4 mappées ou encapsulées', () => {
  const blocked = [
    '127.0.0.1', '127.255.255.254', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255',
    '169.254.169.254', '169.254.0.1', '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255', '192.0.2.5',
    '::1', '::', 'fc00::1', 'fdff:ffff::1', 'fe80::1', 'febf::1', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.1.2.3', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::127.0.0.1',
    '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2002:a9fe:a9fe::1', '[::1]', 'fe80::1%eth0',
  ];
  for (const ip of blocked) assert.ok(blockedReason(ip), `${ip} devrait être refusée`);
  const open = ['8.8.8.8', '93.184.216.34', '172.15.255.255', '172.32.0.1', '192.169.0.1', '11.0.0.1', '100.63.255.255', '100.128.0.1',
    '2606:4700:4700::1111', '2a00:1450:4007:80b::200e', '::ffff:8.8.8.8', '::ffff:5db8:d822', '64:ff9b::808:808'];
  for (const ip of open) assert.equal(blockedReason(ip), null, `${ip} devrait passer`);
  assert.ok(blockedReason('pas-une-ip'));
  assert.equal(normalizeIp('::ffff:127.0.0.1'), '127.0.0.1');
});

// ---------- Résolution ----------

test('résolution : IP littérales, noms vers des adresses privées, réponse mixte, formes numériques trompeuses', async () => {
  const resolve = dns({
    'mail.exemple.fr': PUBLIC, 'interne.exemple.fr': '10.0.0.5', 'local.exemple.fr': '127.0.0.1', 'meta.exemple.fr': '169.254.169.254',
    'mixte.exemple.fr': [PUBLIC, '192.168.1.10'], 'v6.exemple.fr': '::1', 'mappe.exemple.fr': '::ffff:127.0.0.1',
    localhost: '127.0.0.1', '2130706433': '127.0.0.1', '127.1': '127.0.0.1', '0x7f.1': '127.0.0.1',
  });
  assert.deepEqual(await resolvePublic('mail.exemple.fr', { resolve }), { address: PUBLIC, family: 4, servername: 'mail.exemple.fr' });
  const refused = async (host) => assert.rejects(resolvePublic(host, { resolve }), (e) => e.status === 400 && /refusé|invalide|introuvable/.test(e.message), host);
  for (const h of ['127.0.0.1', '169.254.169.254', '10.0.0.1', '192.168.1.1', '::1', '[::1]', '::ffff:127.0.0.1',
    'interne.exemple.fr', 'local.exemple.fr', 'meta.exemple.fr', 'mixte.exemple.fr', 'v6.exemple.fr', 'mappe.exemple.fr',
    'localhost', '2130706433', '127.1', '0x7f.1']) await refused(h);
  // Une IP publique littérale passe, sans DNS
  assert.deepEqual(await resolvePublic('8.8.8.8', { resolve: () => { throw new Error('pas de DNS'); } }), { address: '8.8.8.8', family: 4, servername: null });
  // Hôtes mal formés
  for (const h of ['', ' ', 'a b', 'exemple.fr/chemin', 'http://exemple.fr', 'exemple.fr:25', 'x'.repeat(300), 'ex@mple.fr', 'a;b']) await refused(h);
  // Introuvable : refus, sauf à l'enregistrement (lenient) où le nom pourra devenir résolvable
  await assert.rejects(resolvePublic('absent.exemple.fr', { resolve }), /introuvable/);
  assert.equal(await resolvePublic('absent.exemple.fr', { resolve, lenient: true }), null);
  // Mais lenient ne laisse jamais passer une adresse privée
  await assert.rejects(resolvePublic('local.exemple.fr', { resolve, lenient: true }), /refusé/);
  // Exception de développement
  assert.equal((await resolvePublic('local.exemple.fr', { resolve, allowPrivate: true })).address, '127.0.0.1');
});

test('le message de refus n\'affiche pas l\'adresse interne trouvée', async () => {
  await assert.rejects(resolvePublic('x.fr', { resolve: dns({ 'x.fr': '10.9.8.7' }) }), (e) => !e.message.includes('10.9.8.7') && /interne ou réservée/.test(e.message));
});

// ---------- Ports ----------

test('ports : liste par type de service, tout le reste est refusé', () => {
  for (const [kind, ports] of Object.entries(ALLOWED_PORTS)) {
    for (const p of ports) assert.equal(assertPort(kind, p), p);
  }
  for (const [kind, p] of [['smtp', 22], ['smtp', 3306], ['imap', 25], ['mysql', 6379], ['mysql', 80], ['pg', 3306], ['git', 22], ['git', 80], ['git', 8080]]) {
    assert.throws(() => assertPort(kind, p), (e) => e.status === 400 && /refusé/.test(e.message), `${kind}:${p}`);
  }
  for (const bad of [0, -1, 70000, 'abc', 1.5, null]) assert.throws(() => assertPort('smtp', bad), /Port invalide/);
  assert.equal(assertPort('smtp', 1025, { allowPrivate: true }), 1025, 'exception de développement');
});

// ---------- ALLOW_PRIVATE_HOSTS ----------

test('ALLOW_PRIVATE_HOSTS : désactivé par défaut ; en production réservé aux administrateurs', async () => {
  const s = await startApp();
  try {
    const user = await s.newUser({ admin: false });
    const admin = await s.newUser({ admin: true });
    const resolveHost = dns({ 'local.test': '127.0.0.1' });
    const app = (cfg) => ({ db: s.db, cfg, resolveHost });
    const ok = (a, u) => guardTarget(a, u.id, 'smtp', 'local.test', 2525);
    // Drapeau absent : personne, admin compris
    await assert.rejects(ok(app({}), admin), /refusé/);
    // Développement (hors production) : tout le monde
    assert.equal((await ok(app({ allowPrivateHosts: true, production: false }), user)).address, '127.0.0.1');
    // Production : l'administrateur seulement
    await assert.rejects(ok(app({ allowPrivateHosts: true, production: true }), user), /refusé/);
    assert.equal((await ok(app({ allowPrivateHosts: true, production: true }), admin)).address, '127.0.0.1');
    // Les ports hors liste passent aussi avec l'exception
    assert.equal((await guardTarget(app({ allowPrivateHosts: true, production: false }), user.id, 'smtp', 'local.test', 1025)).port, 1025);
    await assert.rejects(guardTarget(app({}), user.id, 'smtp', 'public.test', 1025), /Port 1025 refusé/);
    // Configuration
    const base = { APP_URL: 'https://x.fr', SECRET_KEY: 'a'.repeat(64), GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', DB_DRIVER: 'sqlite' };
    const keep = { ...process.env };
    try {
      delete process.env.ALLOW_PRIVATE_HOSTS; Object.assign(process.env, base);
      assert.equal(loadConfig().allowPrivateHosts, false);
      process.env.ALLOW_PRIVATE_HOSTS = 'true';
      assert.equal(loadConfig().allowPrivateHosts, true);
    } finally { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); }
  } finally { await s.close(); }
});

// ---------- Rebinding DNS : on se connecte à l'adresse vérifiée, et on revérifie à chaque connexion ----------

test('DNS qui change entre deux résolutions : la 2e connexion est refusée, la 1re utilise l\'IP vérifiée', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: false });
    let answers = [[PUBLIC], ['127.0.0.1'], ['169.254.169.254']];
    s.app.resolveHost = async () => answers.shift().map((address) => ({ address, family: 4 }));
    const smtp = { host: 'smtp.rebind.fr', port: 587, user: 'u', pass: 'p', fromEmail: 'a@b.fr' };
    // 1re connexion : nom public → on se connecte à l'IP vérifiée, le nom ne sert qu'à SNI / certificat
    const pinned = await pinSmtp(s.app, u.id, smtp);
    assert.equal(pinned.host, PUBLIC);
    assert.equal(pinned.servername, 'smtp.rebind.fr');
    const transport = createTransport(pinned);
    assert.equal(transport.options.host, PUBLIC, 'le transport vise l\'IP, pas le nom (aucune seconde résolution possible)');
    assert.equal(transport.options.servername, 'smtp.rebind.fr');
    assert.equal(transport.options.tls.servername, 'smtp.rebind.fr');
    transport.close();
    // Le DNS répond maintenant 127.0.0.1, puis l'adresse des métadonnées : refus à chaque nouvelle connexion
    await assert.rejects(pinSmtp(s.app, u.id, smtp), /refusé/);
    await assert.rejects(pinSmtp(s.app, u.id, smtp), /refusé/);
    // Les autres services passent par le même contrôle
    answers = [['127.0.0.1'], ['127.0.0.1'], ['127.0.0.1']];
    await assert.rejects(pinImap(s.app, u.id, { host: 'imap.rebind.fr', port: 993 }), /refusé/);
    await assert.rejects(pinDb(s.app, u.id, { host: 'db.rebind.fr', type: 'mysql' }), /refusé/);
    await assert.rejects(pinGit(s.app, u.id, 'https://git.rebind.fr/a/b.git'), /refusé/);
  } finally { await s.close(); }
});

test('épinglage git : http.curloptResolve vers l\'adresse vérifiée, aucune redirection suivie', async () => {
  const pin = { host: 'git.exemple.fr', port: 443, address: PUBLIC, family: 4 };
  assert.deepEqual(pinArgs(pin), ['-c', `http.curloptResolve=git.exemple.fr:443:${PUBLIC}`, '-c', 'http.followRedirects=false']);
  assert.deepEqual(pinArgs({ ...pin, address: '2606:4700::1', family: 6 }).slice(1, 2), ['http.curloptResolve=git.exemple.fr:443:[2606:4700::1]']);
  assert.deepEqual(pinArgs(null), []);
  const clone = cloneArgs('https://git.exemple.fr/a/b.git', '/d', pin);
  assert.ok(clone.includes(`http.curloptResolve=git.exemple.fr:443:${PUBLIC}`));
  assert.ok(clone.indexOf('clone') > clone.indexOf('http.followRedirects=false'), 'options avant la sous-commande');
  assert.ok(fetchArgs(pin).includes('http.followRedirects=false'));
  assert.equal(cloneArgs('https://x/a/b.git', '/d').includes('http.followRedirects=false'), false);
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: false });
    s.app.resolveHost = dns({ 'git.exemple.fr': PUBLIC });
    assert.deepEqual(await pinGit(s.app, u.id, 'https://git.exemple.fr/a/b.git'), pin);
    assert.deepEqual(await pinGit(s.app, u.id, 'https://git.exemple.fr:8443/a/b.git'), { ...pin, port: 8443 });
    await assert.rejects(pinGit(s.app, u.id, 'https://git.exemple.fr:22/a/b.git'), /Port 22 refusé/);
    assert.equal(await pinGit(s.app, u.id, 'file:///tmp/depot'), null, 'les URL non https sont refusées plus loin par syncRepo');
  } finally { await s.close(); }
});

// ---------- Branchement sur les enregistrements (réponse immédiate) ----------

test('enregistrement : SMTP, IMAP, base du récap, Forgejo et dépôt vers des adresses internes ou des ports interdits = 400', async () => {
  const s = await startApp();
  try {
    s.app.resolveHost = dns({ 'ok.exemple.fr': PUBLIC, 'prive.exemple.fr': '10.0.0.8', 'meta.exemple.fr': '169.254.169.254' });
    const u = await s.newUser({ admin: false, link: { v: 1, mode: 'api_key', valid: true } });
    const pid = Number((await s.db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'p', 'https://ok.exemple.fr/a/b.git', 1)").run(u.id)).lastInsertRowid);
    const refused = async (res, re, label) => { const b = await res.json(); assert.equal(res.status, 400, `${label} : ${JSON.stringify(b)}`); assert.match(b.error, re, label); };

    await refused(await u.post(`/api/projects/${pid}/smtp`, { host: 'prive.exemple.fr', port: 587 }), /interne ou réservée/, 'SMTP privé');
    await refused(await u.post(`/api/projects/${pid}/smtp`, { host: '169.254.169.254', port: 25 }), /interne ou réservée/, 'SMTP métadonnées');
    await refused(await u.post(`/api/projects/${pid}/smtp`, { host: '127.0.0.1', port: 587 }), /interne ou réservée/, 'SMTP loopback');
    await refused(await u.post(`/api/projects/${pid}/smtp`, { host: 'ok.exemple.fr', port: 3306 }), /Port 3306 refusé/, 'SMTP port MySQL');
    assert.equal((await u.post(`/api/projects/${pid}/smtp`, { host: 'ok.exemple.fr', port: 587, user: 'u', pass: 'p' })).status, 200);
    // Hôte pas encore résolvable : enregistré (il sera revérifié à l'usage)
    assert.equal((await u.post(`/api/projects/${pid}/smtp`, { host: 'futur.exemple.fr', port: 587 })).status, 200);

    await refused(await u.post(`/api/projects/${pid}/imap`, { host: 'meta.exemple.fr', port: 993 }), /interne ou réservée/, 'IMAP métadonnées');
    await refused(await u.post(`/api/projects/${pid}/imap`, { host: 'ok.exemple.fr', port: 22 }), /Port 22 refusé/, 'IMAP port SSH');

    const db = { sql_users: '', sql_clients: '', sql_revenue: '' };
    await refused(await u.post(`/api/projects/${pid}/db`, { ...db, host: '127.0.0.1', port: 3306 }), /interne ou réservée/, 'BDD loopback');
    await refused(await u.post(`/api/projects/${pid}/db`, { ...db, type: 'pg', host: 'prive.exemple.fr' }), /interne ou réservée/, 'PostgreSQL privé');
    await refused(await u.post(`/api/projects/${pid}/db`, { ...db, host: 'ok.exemple.fr', port: 6379 }), /Port 6379 refusé/, 'BDD port Redis');
    assert.equal((await u.post(`/api/projects/${pid}/db`, { ...db, host: 'ok.exemple.fr', port: 3306 })).status, 200);

    for (const [host, re] of [['prive.exemple.fr', /interne ou réservée/], ['localhost:3000', /interne|introuvable|Port/], ['ok.exemple.fr:22', /Port 22 refusé/]]) {
      const r = await u.post('/settings', { git_type_0: 'forgejo', git_host_0: host }, { form: true });
      assert.equal(r.status, 400, host);
      assert.match((await r.json()).error, re, host);
    }
    const sm = await u.post('/settings', { git_type_0: 'forgejo', git_host_0: 'ok.exemple.fr', smtp_host: 'prive.exemple.fr', smtp_port: '587' }, { form: true });
    assert.equal(sm.status, 400);
    assert.equal((await u.post('/settings', { git_type_0: 'forgejo', git_host_0: 'ok.exemple.fr' }, { form: true })).status, 303);

    // Création de projet : le dépôt doit être sur un serveur Git enregistré, et cet hôte est revérifié
    await s.db.prepare("UPDATE user_settings SET value = ? WHERE user_id = ? AND `key` = 'git_servers_json'").run(JSON.stringify([{ id: 'x', type: 'forgejo', host: 'prive.exemple.fr', tokenEnc: null }]), u.id);
    await refused(await u.post('/api/projects', { name: 'X', gitUrl: 'https://prive.exemple.fr/a/x.git' }), /interne ou réservée/, 'dépôt privé');
  } finally { await s.close(); }
});

// ---------- Branchement à l'usage (jobs, lecture IMAP, récap) ----------

test('à l\'usage : un hôte devenu interne fait échouer l\'envoi, la lecture IMAP et la synchronisation, sans connexion', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: true });
    s.app.resolveHost = dns({ 'smtp.exemple.fr': PUBLIC, 'imap.exemple.fr': PUBLIC, 'git.exemple.fr': PUBLIC });
    const calls = { transport: 0, imap: 0, sync: 0 };
    s.app.createTransport = () => { calls.transport++; return { verify: async () => true, sendMail: async () => {}, close() {} }; };
    s.app.fetchInbox = async () => { calls.imap++; return { messages: [], uidValidity: '1', lastUid: 0 }; };
    s.app.syncRepo = async (url, dir, token, opts) => { calls.sync++; calls.pin = opts.pin; return 'abc'; };
    const p = Number((await s.db.prepare("INSERT INTO projects(user_id, name, git_url, target_validated, created_at) VALUES(?, 'p', 'https://git.exemple.fr/a/b.git', 1, ?)").run(u.id, now())).lastInsertRowid);
    await saveSecretConfig(s.app, p, 'smtp_enc', { host: 'smtp.exemple.fr', port: 587, user: 'u', pass: 'p', fromEmail: 'a@b.fr' }, 'pass');
    await saveSecretConfig(s.app, p, 'imap_enc', { host: 'imap.exemple.fr', port: 993 }, 'pass');
    await s.db.prepare("INSERT INTO templates(project_id, kind, subject, body, status, updated_at) VALUES(?, 'initial', 's', 'b', 'validated', ?)").run(p, now());
    await s.db.prepare("INSERT INTO prospects(project_id, company, email, created_at) VALUES(?, 'E', 'e@x.fr', ?)").run(p, now());
    const worker = new Worker(s.db, makeHandlers(s.app), { log: { error() {} } });

    // Tout est public : les pièces reçoivent l'adresse vérifiée
    await checkInbox(s.app, u.id, p);
    assert.equal(calls.imap, 1);
    const sentWith = [];
    s.app.createTransport = (smtp) => { sentWith.push(smtp); return { verify: async () => true, sendMail: async () => {}, close() {} }; };
    await enqueue(s.db, { userId: u.id, projectId: p, type: 'send', params: { count: 1 } });
    await worker.tick();
    assert.equal(sentWith[0].host, PUBLIC);
    assert.equal(sentWith[0].servername, 'smtp.exemple.fr');
    await enqueue(s.db, { userId: u.id, projectId: p, type: 'analyze' });
    await worker.tick();
    assert.deepEqual(calls.pin, { host: 'git.exemple.fr', port: 443, address: PUBLIC, family: 4 });

    // Le DNS bascule vers le réseau interne : plus rien ne part, plus rien ne se connecte
    s.app.resolveHost = dns({ 'smtp.exemple.fr': '127.0.0.1', 'imap.exemple.fr': '10.0.0.3', 'git.exemple.fr': '169.254.169.254' });
    const before = { ...calls }; const sentBefore = sentWith.length;
    await s.db.prepare("INSERT INTO prospects(project_id, company, email, created_at) VALUES(?, 'F', 'f@y.fr', ?)").run(p, now());
    const send = (await enqueue(s.db, { userId: u.id, projectId: p, type: 'send', params: { count: 1 } })).id;
    await worker.tick();
    const job = await s.db.prepare('SELECT status, error FROM jobs WHERE id = ?').get(send);
    assert.equal(job.status, 'error');
    assert.match(job.error, /interne ou réservée/);
    assert.equal(sentWith.length, sentBefore, 'aucun transport créé');
    await assert.rejects(checkInbox(s.app, u.id, p), /interne ou réservée/);
    assert.equal(calls.imap, before.imap, 'fetchInbox n\'est pas appelé');
    const an = (await enqueue(s.db, { userId: u.id, projectId: p, type: 'template' })).id;
    await s.db.prepare("UPDATE jobs SET type = 'analyze' WHERE id = ?").run(an);
    await worker.tick();
    assert.equal((await s.db.prepare('SELECT status FROM jobs WHERE id = ?').get(an)).status, 'error');
    assert.equal(calls.sync, before.sync, 'syncRepo n\'est pas appelé');
    // Récap : l'accès BDD est revérifié
    await saveSecretConfig(s.app, p, 'db_enc', { type: 'mysql', host: 'db.exemple.fr', sql_users: 'select 1' }, 'password');
    s.app.resolveHost = dns({ 'db.exemple.fr': '192.168.1.5' });
    const r = await (await u.get(`/api/projects/${p}/recap?force=1`)).json();
    assert.match(r.error, /interne ou réservée/);
  } finally { await s.close(); }
});
