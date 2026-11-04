import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { now, setSetting } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { addUser, TEST_SECRET_KEY } from './helpers/users.js';
import { encrypt } from '../src/crypto.js';
import { notify, notifyJob, WEBHOOK_RE } from '../src/services/notify.js';
import { Worker, enqueue } from '../src/services/jobs.js';
import { checkInbox } from '../src/services/inbox.js';
import { createProject, saveSecretConfig } from '../src/projects.js';

const HOOK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz-ABC_123';

async function setup({ events } = {}) {
  const db = await testDb();
  const sent = [];
  const app = { resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    db, cfg: { secretKey: TEST_SECRET_KEY, appUrl: 'https://ai.test' },
    fetch: async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 204 }; },
  };
  const userId = await addUser(db);
  await setSetting(db, userId, 'discord_webhook_enc', encrypt(app.cfg.secretKey, HOOK));
  if (events) await setSetting(db, userId, 'discord_events', JSON.stringify(events));
  const id = await createProject(app, { userId, name: 'MonEspacePro', gitUrl: 'https://g/T/M.git' });
  return { db, app, sent, id, userId };
}

test('validation stricte de l\'URL de webhook', () => {
  assert.ok(WEBHOOK_RE.test(HOOK));
  assert.ok(WEBHOOK_RE.test(HOOK.replace('discord.com', 'discordapp.com')));
  for (const bad of ['http://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz', 'https://evil.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz',
    'https://discord.com.evil.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz', `${HOOK}?wait=true`, 'https://discord.com/api/webhooks/1/a']) {
    assert.ok(!WEBHOOK_RE.test(bad), bad);
  }
});

test('notif : forme du message, aucune mention possible', async () => {
  const s = await setup();
  assert.equal(await notify(s.app, s.userId, 'reply', { title: '@everyone Boulangerie', description: 'x', level: 'ok', fields: [{ name: 'a', value: '' }] }), true);
  const b = s.sent[0].body;
  assert.equal(s.sent[0].url, HOOK);
  assert.deepEqual(b.allowed_mentions, { parse: [] });
  assert.equal(b.embeds[0].title, '@everyone Boulangerie');
  assert.equal(b.embeds[0].color, 0x15803d);
  assert.equal(b.embeds[0].fields[0].value, '-');
});

test('événement désactivé, webhook absent ou Discord en panne : rien ne casse', async () => {
  const s = await setup({ events: ['job_error'] });
  assert.equal(await notify(s.app, s.userId, 'reply', { title: 'x' }), false);
  assert.equal(s.sent.length, 0);
  assert.equal(await notify(s.app, s.userId, 'reply', { title: 'x' }, { force: true }), true, 'le bouton de test force l\'envoi');
  const warn = console.warn; console.warn = () => {};
  try {
    s.app.fetch = async () => ({ ok: false, status: 404 });
    assert.equal(await notify(s.app, s.userId, 'job_error', { title: 'x' }), false);
    s.app.fetch = async () => { throw new Error('réseau'); };
    assert.equal(await notify(s.app, s.userId, 'job_error', { title: 'x' }), false);
  } finally { console.warn = warn; }
  await setSetting(s.db, s.userId, 'discord_webhook_enc', null);
  assert.equal(await notify(s.app, s.userId, 'job_error', { title: 'x' }), false);
});

test('fin de job : succès, erreur, relances, et silence pour les jobs courts', async () => {
  const s = await setup();
  const job = (type) => ({ type, project_id: s.id, user_id: s.userId });
  await notifyJob(s.app, job('prospect'), { status: 'done', result: { found: 7, requested: 10 } });
  await notifyJob(s.app, job('send'), { status: 'error', error: 'SMTP refusé' });
  await notifyJob(s.app, job('followup'), { status: 'done', result: { sent: 3, failed: 0 } });
  await notifyJob(s.app, job('followup'), { status: 'done', result: { sent: 0, postponed: true } });
  await notifyJob(s.app, job('template'), { status: 'done', result: {} });
  assert.deepEqual(s.sent.map((x) => x.body.embeds[0].title), [
    'MonEspacePro · Recherche de prospects terminée',
    'MonEspacePro · Envoi en échec',
    'MonEspacePro · Relances envoyées',
  ]);
  assert.match(s.sent[0].body.embeds[0].description, /7 nouveau\(x\) prospect\(s\) sur 10/);
});

test('le worker notifie en fin de job, et un callback qui plante ne le bloque pas', async () => {
  const s = await setup();
  const seen = [];
  const w = new Worker(s.db, { prospect: async () => ({ found: 2, requested: 5 }), evolution: async () => { throw new Error('boom'); } }, {
    log: { error() {} },
    onFinish: (job, r) => { seen.push(`${job.type}:${r.status}`); if (job.type === 'evolution') throw new Error('callback cassé'); },
  });
  await enqueue(s.db, { userId: s.userId, projectId: s.id, type: 'prospect' });
  await enqueue(s.db, { userId: s.userId, projectId: s.id, type: 'evolution' });
  await w.tick(); await w.tick();
  assert.deepEqual(seen, ['prospect:done', 'evolution:error']);
  assert.equal((await s.db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('done','error')").get()).n, 2);
});

test('nouvelles réponses détectées → une notif avec les entreprises', async () => {
  const s = await setup();
  await saveSecretConfig(s.app, s.id, 'smtp_enc', { host: 'h', user: 'u', pass: 'p', fromEmail: 'a@x.fr' }, 'pass');
  await saveSecretConfig(s.app, s.id, 'imap_enc', { host: 'imap.x' }, 'pass');
  await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, 'Le Fournil', 'contact@fournil.fr', 'sent', ?, ?)").run(s.id, now(), now());
  s.app.fetchInbox = async () => ({ uidValidity: '1', lastUid: 1, messages: [{ uid: 1, from: 'contact@fournil.fr', subject: 'Re: idée' }] });
  await checkInbox(s.app, s.userId, s.id);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].body.embeds[0].title, 'MonEspacePro · 1 réponse(s) de prospect');
  assert.match(s.sent[0].body.embeds[0].description, /\*\*Le Fournil\*\* \(contact@fournil\.fr\) : Re: idée/);
  await checkInbox(s.app, s.userId, s.id);
  assert.equal(s.sent.length, 1, 'pas de notif quand rien de neuf');
});

test('plusieurs webhooks : chacun ne reçoit que ses événements, le test cible un webhook', async () => {
  const { saveDiscordHooks, listHooks } = await import('../src/services/notify.js');
  const s = await setup();
  const H2 = 'https://discord.com/api/webhooks/223456789012345678/zyxwvutsrqponmlkjihgfedcba-ABC_123';
  await saveDiscordHooks(s.app, s.userId, { discord_url_0: HOOK, discord_ev_0_reply: 'on', discord_url_1: H2, discord_ev_1_job_error: 'on', discord_ev_1_weekly: 'on' });
  const hooks = await listHooks(s.app, s.userId);
  assert.equal(hooks.length, 2);
  s.sent.length = 0;
  assert.equal(await notify(s.app, s.userId, 'reply', { title: 'Réponse' }), true);
  assert.equal(s.sent.length, 1, 'seul le premier webhook reçoit les réponses');
  s.sent.length = 0;
  assert.equal(await notify(s.app, s.userId, 'job_error', { title: 'Erreur' }), true);
  assert.equal(s.sent.length, 1);
  s.sent.length = 0;
  assert.equal(await notify(s.app, s.userId, 'budget', { title: 'Budget' }), false, 'aucun webhook ne reçoit cet événement');
  assert.equal(s.sent.length, 0);
  assert.equal(await notify(s.app, s.userId, 'test', { title: 'Test' }, { force: true, hookId: hooks[1].id }), true);
  assert.equal(s.sent.length, 1, 'le test ne vise que le webhook choisi');
});
