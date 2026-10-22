import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { now, setSetting } from '../src/db.js';
import { testDb } from './helpers/db.js';

import { isBusinessHours, followupPlan, followupSubject } from '../src/services/followup.js';
import { Worker, latestJobs } from '../src/services/jobs.js';
import { Scheduler } from '../src/services/scheduler.js';
import { makeHandlers } from '../src/handlers.js';
import { createProject, saveSecretConfig, getProject } from '../src/projects.js';
import { addUser } from './helpers/users.js';

const paris = (iso) => new Date(iso); // ISO avec décalage explicite

test('heures ouvrées à Paris, y compris autour du passage à l\'heure d\'hiver', () => {
  assert.equal(isBusinessHours(paris('2026-10-21T10:00:00+02:00')), true, 'mercredi 10h');
  assert.equal(isBusinessHours(paris('2026-10-21T08:59:00+02:00')), false, 'mercredi 8h59');
  assert.equal(isBusinessHours(paris('2026-10-21T18:00:00+02:00')), false, 'mercredi 18h');
  assert.equal(isBusinessHours(paris('2026-10-24T11:00:00+02:00')), false, 'samedi');
  assert.equal(isBusinessHours(paris('2026-10-25T11:00:00+01:00')), false, 'dimanche');
  // Lundi 26/10 : Paris est passé en UTC+1 la veille
  assert.equal(isBusinessHours(new Date('2026-10-26T08:30:00Z')), true, '8h30 UTC = 9h30 Paris');
  assert.equal(isBusinessHours(new Date('2026-10-26T07:30:00Z')), false, '7h30 UTC = 8h30 Paris');
});

test('objet de la relance : même fil par défaut', () => {
  assert.equal(followupSubject({ subject: '' }, { subject: 'Une idée pour Fournil' }), 'Re: Une idée pour Fournil');
  assert.equal(followupSubject({ subject: '' }, { subject: 'RE: déjà' }), 'RE: déjà');
  assert.equal(followupSubject({ subject: 'Petite question' }, { subject: 'x' }), 'Petite question');
  assert.equal(followupSubject({ subject: '' }, null), 'Re: notre échange');
});

const WED_10H = Math.floor(new Date('2026-10-21T10:00:00+02:00').getTime() / 1000);

async function setup() {
  const tmp = mkdtempSync(join(tmpdir(), 'aitools-fu-'));
  const db = await testDb();
  const sentMails = [];
  const app = {
    db, cfg: { dataDir: tmp, claudeBin: resolve('test/fixtures/fake-claude.js'), sandbox: { enabled: false, production: false }, secretKey: randomBytes(32), appUrl: 'https://ai.test' },
    createTransport: () => ({ verify: async () => true, sendMail: async (m) => { sentMails.push(m); }, close() {} }),
    isBusinessHours: () => true, // horloge figée : le test ne dépend pas de l'heure à laquelle on le lance
  };
  const userId = await addUser(db);
  await setSetting(db, userId, 'send_delay_min', '0');
  await setSetting(db, userId, 'send_delay_max', '0');
  const id = await createProject(app, { userId, name: 'P', gitUrl: 'https://git.x/T/P.git' });
  await saveSecretConfig(app, id, 'smtp_enc', { host: 'smtp.x', user: 'u', pass: 'p', fromEmail: 'tony@codebzh.fr' }, 'pass');
  await saveSecretConfig(app, id, 'imap_enc', { host: 'imap.x', port: 993 }, 'pass');
  const inboxOk = (at = now(), extra = {}) => db.prepare('UPDATE projects SET inbox_json = ? WHERE id = ?')
    .run(JSON.stringify({ lastOk: at, lastCheck: at, lastError: null, ...extra }), id);
  await inboxOk();
  await db.prepare("INSERT INTO templates(project_id, kind, subject, body, status, updated_at) VALUES(?, 'followup', '', 'Toujours partant, {{entreprise}} ?', 'validated', ?)").run(id, now());
  await db.prepare('UPDATE projects SET followup_enabled = 1, followup_days = 7 WHERE id = ?').run(id);
  const add = async (email, daysAgo, status = 'sent') => {
    const t = now() - daysAgo * 86400;
    const pid = Number((await db.prepare('INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(id, email.split('@')[1], email, status, t, t)).lastInsertRowid);
    await db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, subject, message_id) VALUES(?, ?, ?, ?, 'initial', ?, ?)")
      .run(id, pid, email, t, `Une idée pour ${email}`, `<orig-${pid}@codebzh.fr>`);
    return pid;
  };
  const worker = new Worker(db, makeHandlers(app), { log: { error() {} } });
  const scheduler = new Scheduler(app, { log: { error() {} } });
  return { tmp, db, app, id, userId, add, inboxOk, worker, scheduler, sentMails };
}

test('relance : seulement les prospects dus, sans réponse, dans le même fil, une seule fois', async () => {
  const s = await setup();
  try {
    const due = await s.add('contact@fournil.fr', 8);
    const tooEarly = await s.add('hello@zen.fr', 3);
    const replied = await s.add('jean@atelier.fr', 10, 'replied');
    const blacklisted = await s.add('stop@ferme.fr', 9);
    await s.db.prepare("INSERT INTO blacklist(email, reason, created_at) VALUES('stop@ferme.fr', 'unsubscribe', ?)").run(now());

    const plan = await followupPlan(s.db, await getProject(s.app, s.id, { userId: s.userId }), { date: new Date(WED_10H * 1000) });
    assert.deepEqual({ due: plan.due, blockers: plan.blockers }, { due: 1, blockers: [] });

    const queued = await s.scheduler.queueFollowups({ date: new Date(WED_10H * 1000) });
    assert.equal(queued.length, 1);
    await s.worker.tick();
    const job = (await latestJobs(s.db, s.id)).followup;
    assert.equal(job.status, 'done', job.error);
    assert.deepEqual(job.result, { sent: 1, failed: 0, total: 1 });

    const m = s.sentMails[0];
    assert.equal(m.to, 'contact@fournil.fr');
    assert.equal(m.subject, 'Re: Une idée pour contact@fournil.fr');
    assert.equal(m.inReplyTo, `<orig-${due}@codebzh.fr>`);
    assert.match(m.text, /Toujours partant, fournil\.fr \?/);
    assert.match(m.text, /Pour ne plus être contacté/);
    const log = await s.db.prepare("SELECT * FROM mail_log WHERE kind = 'followup'").all();
    assert.equal(log.length, 1);
    assert.equal(log[0].message_id, m.messageId);

    const st = (pid) => s.db.prepare('SELECT status, followup_at FROM prospects WHERE id = ?').get(pid);
    assert.ok((await st(due)).followup_at > 0);
    assert.equal((await st(due)).status, 'sent', 'reste "contacté" : une réponse à la relance sera détectée normalement');
    for (const pid of [tooEarly, replied, blacklisted]) assert.equal((await st(pid)).followup_at, null);

    assert.equal((await s.scheduler.queueFollowups({ date: new Date(WED_10H * 1000) })).length, 0, 'jamais 2 relances');
  } finally { rmSync(s.tmp, { recursive: true, force: true }); }
});

test('relance bloquée : boîte en erreur, boîte pas lue récemment, week-end, désactivée, modèle non validé', async () => {
  const s = await setup();
  try {
    await s.add('contact@fournil.fr', 8);
    const plan = async (o = {}) => followupPlan(s.db, await getProject(s.app, s.id, { userId: s.userId }), o);
    const sat = new Date('2026-10-24T11:00:00+02:00');
    assert.equal((await plan({ date: sat })).ready, false);
    assert.equal((await plan({ date: sat })).inHours, false);
    assert.equal((await s.scheduler.queueFollowups({ date: sat })).length, 0, 'pas le week-end');

    await s.inboxOk(now(), { lastError: 'AUTHENTICATIONFAILED' });
    assert.deepEqual((await plan()).blockers, ['boîte non vérifiée récemment']);
    await s.inboxOk(now() - 3 * 3600);
    assert.deepEqual((await plan()).blockers, ['boîte non vérifiée récemment']);
    await s.db.prepare('UPDATE projects SET imap_enc = NULL WHERE id = ?').run(s.id);
    assert.deepEqual((await plan()).blockers, ['boîte IMAP à connecter']);
    await s.db.prepare("UPDATE templates SET status = 'draft' WHERE kind = 'followup'").run();
    await s.db.prepare('UPDATE projects SET followup_enabled = 0 WHERE id = ?').run(s.id);
    assert.deepEqual((await plan()).blockers, ['relance désactivée', 'modèle de relance à valider', 'boîte IMAP à connecter']);
  } finally { rmSync(s.tmp, { recursive: true, force: true }); }
});

test('réponse arrivée entre la mise en file et l\'envoi : pas de relance', async () => {
  const s = await setup();
  try {
    const pid = await s.add('contact@fournil.fr', 8);
    assert.equal((await s.scheduler.queueFollowups({ date: new Date(WED_10H * 1000) })).length, 1);
    await s.db.prepare("UPDATE prospects SET status = 'replied' WHERE id = ?").run(pid);
    await s.worker.tick();
    assert.equal(s.sentMails.length, 0);
  } finally { rmSync(s.tmp, { recursive: true, force: true }); }
});

test('relance en file mais heures ouvrées dépassées : reportée, rien n\'est envoyé', async () => {
  const s = await setup();
  try {
    const pid = await s.add('contact@fournil.fr', 8);
    await s.scheduler.queueFollowups({ date: new Date(WED_10H * 1000) });
    s.app.isBusinessHours = () => false;
    await s.worker.tick();
    assert.equal(s.sentMails.length, 0);
    assert.equal((await latestJobs(s.db, s.id)).followup.result.postponed, true);
    assert.equal((await s.db.prepare('SELECT followup_at FROM prospects WHERE id = ?').get(pid)).followup_at, null, 'toujours due');
    s.app.isBusinessHours = () => true;
    assert.equal((await s.scheduler.queueFollowups({ date: new Date(WED_10H * 1000) })).length, 1, 'reprogrammée au créneau suivant');
  } finally { rmSync(s.tmp, { recursive: true, force: true }); }
});

test('génération du modèle de relance par l\'IA', async () => {
  const s = await setup();
  try {
    await s.db.prepare('UPDATE projects SET profile_json = ? WHERE id = ?').run(JSON.stringify({ resume: 'x', proposition_valeur: 'y' }), s.id);
    await s.db.prepare("DELETE FROM templates WHERE kind = 'followup'").run();
    const { enqueue } = await import('../src/services/jobs.js');
    await enqueue(s.db, { userId: s.userId, projectId: s.id, type: 'followup_template' });
    await s.worker.tick();
    const job = (await latestJobs(s.db, s.id)).followup_template;
    assert.equal(job.status, 'done', job.error);
    const t = await s.db.prepare("SELECT * FROM templates WHERE kind = 'followup'").get();
    assert.equal(t.status, 'draft');
    assert.equal(t.subject, '');
    assert.match(t.body, /relance/i);
  } finally { rmSync(s.tmp, { recursive: true, force: true }); }
});
