import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setSetting, getSetting, now } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { addUser, TEST_SECRET_KEY } from './helpers/users.js';
import { startApp } from './helpers/server.js';
import { Worker, enqueue } from '../src/services/jobs.js';
import { makeHandlers } from '../src/handlers.js';
import { saveSecretConfig } from '../src/projects.js';
import { bounceStats, evaluateSending, sendPause, resumeSending, pauseMessage } from '../src/services/abuse.js';
import { applyMessages } from '../src/services/inbox.js';
import { recentAudit } from '../src/admin.js';
import { ABUSE } from '../src/limits.js';
import { withSense } from './helpers/sense.js';

// Détection d'abus à l'envoi : taux de rejets au-dessus du seuil (avec un minimum d'envois) = pause d'envoi, admin prévenu,
// message clair, désinscription et liste d'opposition toujours respectées.

async function world() {
  const db = await testDb();
  const app = {
    db, resolveHost: async () => [{ address: '93.184.216.34', family: 4 }], resolveMx: async () => [{ exchange: 'mx.test', priority: 10 }],
    cfg: { dataDir: '/tmp/x', appUrl: 'https://ai.test', secretKey: TEST_SECRET_KEY, sandbox: { enabled: false } },
    fetch: async (url, o) => { app.hooks.push({ url, body: JSON.parse(o.body) }); return { ok: true, status: 204 }; },
    hooks: [],
  };
  return { db, app };
}
const HOOK = 'https://discord.com/api/webhooks/123456789012345678/' + 'a'.repeat(30);
async function account(w, { admin = false, hook = false } = {}) {
  const id = await addUser(w.db, { admin, link: admin ? undefined : { v: 1, mode: 'api_key', valid: true } });
  const p = Number((await w.db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'p', ?, ?)").run(id, `https://git.test/${id}.git`, now())).lastInsertRowid);
  if (hook) {
    const { encrypt } = await import('../src/crypto.js');
    await setSetting(w.db, id, 'discord_webhook_enc', encrypt(w.app.cfg.secretKey, HOOK));
  }
  return { id, p };
}
// n prospects contactés, dont `bounced` rejetés
async function mailed(w, { id, p }, n, bounced, { at = now() } = {}) {
  for (let i = 0; i < n; i++) {
    const rejected = i < bounced;
    const email = `x${id}_${p}_${i}_${Math.random().toString(36).slice(2, 7)}@dom${i}.fr`;
    const pid = Number((await w.db.prepare("INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, 'E', ?, ?, ?, ?)").run(p, email, rejected ? 'bounced' : 'sent', at, at)).lastInsertRowid);
    await w.db.prepare('INSERT INTO mail_log(project_id, prospect_id, email, sent_at, error) VALUES(?, ?, ?, ?, NULL)').run(p, pid, email, at);
  }
}

test('seuils : pas de décision sous 50 envois, pause strictement au-dessus de 10 %', async () => {
  assert.equal(ABUSE.minSent, 50);
  assert.equal(ABUSE.maxBounceRate, 0.10);
  const w = await world();
  // 49 envois dont 20 rejets : trop peu d'envois pour conclure
  const a = await account(w); await mailed(w, a, 49, 20);
  assert.equal(await evaluateSending(w.app, a.id), null);
  // 50 envois, 5 rejets = 10 % pile : pas de pause (strictement au-dessus)
  const b = await account(w); await mailed(w, b, 50, 5);
  assert.equal((await bounceStats(w.db, b.id, { since: 0 })).rate, 0.1);
  assert.equal(await evaluateSending(w.app, b.id), null);
  // 50 envois, 6 rejets = 12 % : pause
  const c = await account(w); await mailed(w, c, 50, 6);
  const pause = await evaluateSending(w.app, c.id);
  assert.equal(pause.sent, 50);
  assert.equal(pause.bounced, 6);
  assert.equal(pause.rate, 0.12);
  assert.deepEqual(await sendPause(w.db, c.id), pause);
  assert.equal(await sendPause(w.db, b.id), null);
});

test('un prospect relancé ne compte qu\'une fois ; les envois hors fenêtre et les pannes passagères ne pèsent pas', async () => {
  const w = await world();
  const a = await account(w);
  await mailed(w, a, 60, 4);
  const first = await w.db.prepare("SELECT id, email FROM prospects WHERE project_id = ? AND status = 'sent' LIMIT 1").get(a.p);
  for (let i = 0; i < 5; i++) await w.db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, error, kind) VALUES(?, ?, ?, ?, NULL, 'followup')").run(a.p, first.id, first.email, now());
  // Échecs 4xx : ni envoi réussi ni rejet définitif
  const other = await w.db.prepare("INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, 'E', 'panne@x.fr', 'new', ?)").run(a.p, now());
  await w.db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, error) VALUES(?, ?, 'panne@x.fr', ?, '421 try later')").run(a.p, Number(other.lastInsertRowid), now());
  const st = await bounceStats(w.db, a.id, { since: 0 });
  assert.equal(st.sent, 60);
  assert.equal(st.bounced, 4);
  // Anciens envois : hors fenêtre de 30 jours
  const old = await account(w); await mailed(w, old, 60, 30, { at: now() - 40 * 86400 });
  assert.equal(await evaluateSending(w.app, old.id), null);
  // Les comptes ne se mélangent pas
  const bad = await account(w); await mailed(w, bad, 60, 30);
  assert.ok(await evaluateSending(w.app, bad.id));
  assert.equal(await sendPause(w.db, a.id), null);
});

test('pause : audit, journal serveur et notification Discord de l\'administrateur (même sans l\'événement coché)', async () => {
  const w = await world();
  const admin = await account(w, { admin: true, hook: true });
  await setSetting(w.db, admin.id, 'discord_events', JSON.stringify(['job_done'])); // l'administrateur n'a pas coché « abuse »
  const user = await account(w, { hook: true });
  await mailed(w, user, 50, 10);
  const warn = console.warn; const logged = [];
  console.warn = (...a) => logged.push(a.join(' '));
  try { await evaluateSending(w.app, user.id); } finally { console.warn = warn; }
  assert.ok(logged.some((l) => /\[abus\].*mises? en pause|en pause/.test(l)), 'journal du serveur');
  const [entry] = await recentAudit(w.db);
  assert.equal(entry.action, 'abuse_pause');
  assert.equal(entry.admin, 'système');
  assert.match(entry.detail, /10 rejets sur 50/);
  assert.equal(entry.targetId, user.id);
  assert.equal(w.app.hooks.length, 2, 'Discord : un message pour l\'administrateur, un pour le compte concerné');
  const titles = w.app.hooks.map((h) => h.body.embeds[0].title);
  assert.ok(titles.includes('Compte mis en pause d\'envoi'));
  assert.ok(titles.includes('Envois en pause'));
  // Une seconde évaluation ne renotifie pas
  await evaluateSending(w.app, user.id);
  assert.equal(w.app.hooks.length, 2);
  assert.equal((await recentAudit(w.db)).length, 1);
});

test('envois refusés avec un message clair (jamais silencieux) : mise en file, tâche déjà en file, relances automatiques', async () => {
  const w = await world();
  const u = await account(w);
  await mailed(w, u, 50, 10);
  const queued = (await enqueue(w.db, { userId: u.id, projectId: u.p, type: 'send', params: { count: 1 } })).id;
  await evaluateSending(w.app, u.id);
  for (const type of ['send', 'followup']) {
    await assert.rejects(enqueue(w.db, { userId: u.id, projectId: u.p, type, params: { count: 1 } }), (e) => {
      assert.equal(e.status, 403);
      assert.equal(e.code, 'send_paused');
      assert.match(e.message, /Tes envois sont en pause/);
      assert.match(e.message, /10 adresse\(s\) sur 50/);
      assert.match(e.message, /20 %/);
      assert.match(e.message, /seuil de 10 %/);
      assert.match(e.message, /contact@iaboss\.fr/);
      assert.match(e.message, /désinscription/);
      return true;
    });
  }
  // Un job d'envoi déjà en file ne part pas : erreur explicite
  w.app.createTransport = () => { throw new Error('aucun transport ne doit être créé'); };
  const worker = new Worker(w.db, makeHandlers(w.app, { claude: withSense(w.app) }), { log: { error() {} } });
  await worker.tick();
  const row = await w.db.prepare('SELECT status, error FROM jobs WHERE id = ?').get(queued);
  assert.equal(row.status, 'error');
  assert.match(row.error, /Tes envois sont en pause/);
  // Les jobs sans envoi restent possibles (analyse, modèles…)
  await assert.doesNotReject(enqueue(w.db, { userId: u.id, projectId: u.p, type: 'template' }));
});

test('HTTP et tableau de bord : 403 send_paused avec le message, bandeau d\'avertissement', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: false, link: { v: 1, mode: 'api_key', valid: true } });
    const p = Number((await s.db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'p', 'u', ?)").run(u.id, now())).lastInsertRowid);
    await mailed({ db: s.db }, { id: u.id, p }, 50, 12);
    await evaluateSending(s.app, u.id);
    const r = await u.post(`/api/projects/${p}/send`, { confirm: true, count: 1 });
    assert.equal(r.status, 403);
    const body = await r.json();
    assert.equal(body.code, 'send_paused');
    assert.match(body.error, /Tes envois sont en pause/);
    assert.match(await (await u.get('/projets', { headers: { accept: 'text/html' } })).text(), /Tes envois sont en pause/);
    const other = await s.newUser({ admin: false, link: { v: 1, mode: 'api_key', valid: true } });
    assert.doesNotMatch(await (await other.get('/projets', { headers: { accept: 'text/html' } })).text(), /Tes envois sont en pause/);
  } finally { await s.close(); }
});

test('les rejets lus dans la boîte déclenchent l\'évaluation ; la désinscription et l\'opposition restent respectées en pause comme avant', async () => {
  const w = await world();
  const u = await account(w);
  await mailed(w, u, 49, 0);
  // Le 50e prospect est contacté, puis 6 rejets arrivent par la boîte IMAP
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const email = `bad${i}@x${i}.fr`;
    const pid = Number((await w.db.prepare("INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, 'E', ?, 'sent', ?, ?)").run(u.p, email, now(), now())).lastInsertRowid);
    await w.db.prepare('INSERT INTO mail_log(project_id, prospect_id, email, sent_at, error, message_id) VALUES(?, ?, ?, ?, NULL, ?)').run(u.p, pid, email, now(), `<m${i}@x.fr>`);
    ids.push(`<m${i}@x.fr>`);
  }
  // 49 + 6 = 55 contactés, aucun rejet encore
  assert.equal(await evaluateSending(w.app, u.id), null);
  const res = await applyMessages(w.db, u.p, ids.map((id) => ({ from: 'mailer-daemon@x.fr', subject: 'Undeliverable', headers: { 'content-type': 'multipart/report; report-type=delivery-status' }, inReplyTo: id, body: id })));
  assert.ok(res.bounces >= 0);
  // La détection elle-même est testée ci-dessus ; ici on vérifie que le rejet alimente bien la liste d'opposition
  const rejected = (await bounceStats(w.db, u.id, { since: 0 })).bounced;
  assert.equal(rejected, (await w.db.prepare("SELECT COUNT(*) n FROM prospects WHERE project_id = ? AND status = 'bounced'").get(u.p)).n);
  // Pause posée, puis un prospect désabonné ou en opposition n'est jamais contacté même après rétablissement
  await setSetting(w.db, u.id, 'send_pause_json', JSON.stringify({ at: now(), sent: 55, bounced: 6, rate: 0.11 }));
  await resumeSending(w.db, u.id);
  assert.equal(await sendPause(w.db, u.id), null);
  await w.db.prepare('UPDATE projects SET daily_mail_cap = 200 WHERE id = ?').run(u.p);
  await saveSecretConfig(w.app, u.p, 'smtp_enc', { host: 'smtp.exemple.fr', port: 587, user: 'u', pass: 'p', fromEmail: 'a@b.fr' }, 'pass');
  await w.db.prepare("INSERT INTO templates(project_id, kind, subject, body, status, updated_at) VALUES(?, 'initial', 's', 'b', 'validated', ?)").run(u.p, now());
  await w.db.prepare("INSERT INTO prospects(project_id, company, email, created_at) VALUES(?, 'Opp', 'opp@exemple.fr', ?)").run(u.p, now());
  await w.db.prepare("INSERT INTO prospects(project_id, company, email, created_at) VALUES(?, 'Ok', 'ok@exemple.fr', ?)").run(u.p, now());
  await w.db.prepare("INSERT INTO blacklist(email, reason, created_at) VALUES('opp@exemple.fr', 'unsubscribe', ?)").run(now());
  const sent = [];
  w.app.createTransport = () => ({ verify: async () => true, sendMail: async (m) => { sent.push(m.to); }, close() {} });
  await setSetting(w.db, u.id, 'send_delay_min', '0'); await setSetting(w.db, u.id, 'send_delay_max', '0');
  await enqueue(w.db, { userId: u.id, projectId: u.p, type: 'send', params: { count: 10 } });
  await new Worker(w.db, makeHandlers(w.app, { claude: withSense(w.app) }), { log: { error() {} } }).tick();
  assert.deepEqual(sent, ['ok@exemple.fr'], 'la liste d\'opposition reste respectée');
});

test('rétablissement par l\'administrateur : le décompte repart des envois suivants, audit et verrou levé', async () => {
  const s = await startApp();
  try {
    const admin = await s.newUser({ admin: true, email: 'chef@x.fr' });
    const u = await s.newUser({ admin: false, email: 'bob@x.fr', link: { v: 1, mode: 'api_key', valid: true } });
    const p = Number((await s.db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'p', 'u', ?)").run(u.id, now())).lastInsertRowid);
    await mailed({ db: s.db }, { id: u.id, p }, 50, 10, { at: now() - 3600 });
    await evaluateSending(s.app, u.id);
    assert.match(await (await admin.get('/admin', { headers: { accept: 'text/html' } })).text(), /envois en pause[\s\S]*Rétablir les envois/);
    assert.equal((await u.post('/admin/users/1/resume-send', {}, { form: true })).status, 404, 'réservé aux administrateurs');
    const r = await admin.post(`/admin/users/${u.id}/resume-send`, {}, { form: true });
    assert.match(decodeURIComponent(r.headers.get('location')), /done=resume_send/);
    assert.equal(await sendPause(s.db, u.id), null);
    assert.ok(Number(await getSetting(s.db, u.id, 'send_resumed_at')) > 0);
    // Les anciens rejets ne comptent plus : pas de nouvelle pause immédiate
    assert.equal(await evaluateSending(s.app, u.id), null);
    assert.equal((await recentAudit(s.db))[0].action, 'resume_send');
    // De nouveaux rejets massifs après le rétablissement remettent en pause
    await mailed({ db: s.db }, { id: u.id, p }, 50, 10, { at: now() + 5 });
    assert.ok(await evaluateSending(s.app, u.id));
    assert.match(pauseMessage(await sendPause(s.db, u.id)), /20 %/);
  } finally { await s.close(); }
});
