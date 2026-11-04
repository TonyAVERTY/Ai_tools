// Test de bout en bout contre un vrai serveur IMAP. Ignoré par défaut.
// IMAP_TEST=host:port:user:pass npm test   (la boîte doit contenir les 4 mails de test, cf. README)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { now } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { addUser, TEST_SECRET_KEY } from './helpers/users.js';

import { checkInbox } from '../src/services/inbox.js';
import { createProject, saveSecretConfig, getProject } from '../src/projects.js';

const live = process.env.IMAP_TEST;

test('checkInbox sur un vrai serveur IMAP', { skip: !live && 'IMAP_TEST non défini' }, async () => {
  const [host, port, user, pass] = live.split(':');
  const db = await testDb();
  const app = { db, cfg: { secretKey: TEST_SECRET_KEY } };
  const userId = await addUser(db);
  const id = await createProject(app, { userId, name: 'P', gitUrl: 'https://git.x/T/P.git' });
  await saveSecretConfig(app, id, 'smtp_enc', { host: 'smtp.x', user, pass, fromEmail: user }, 'pass');
  await saveSecretConfig(app, id, 'imap_enc', { host, port: Number(port), user: '', pass: '' }, 'pass');
  const add = async (email, msgId) => {
    const pid = Number((await db.prepare("INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, 'X', ?, 'sent', ?, ?)")
      .run(id, email, now() - 86400 * 30, now())).lastInsertRowid);
    await db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, message_id) VALUES(?, ?, ?, ?, 'initial', ?)")
      .run(id, pid, email, now() - 86400 * 30, msgId);
    return pid;
  };
  const fournil = await add('contact@fournil.fr', '<m1@codebzh.fr>');
  const zen = await add('hello@zen.fr', '<m2@codebzh.fr>');
  const ferme = await add('contact@ferme.fr', '<m3@codebzh.fr>');

  assert.deepEqual(await checkInbox(app, userId, id), { replies: 1, bounces: 1, receipts: 0, ignored: 2 });
  const st = async (pid) => (await db.prepare('SELECT status FROM prospects WHERE id = ?').get(pid)).status;
  assert.equal(await st(fournil), 'replied');
  assert.equal(await st(zen), 'sent', 'une absence n\'est pas une réponse');
  assert.equal(await st(ferme), 'bounced');
  assert.deepEqual(await checkInbox(app, userId, id), { replies: 0, bounces: 0, receipts: 0, ignored: 0 }, 'rien de relu');
  assert.equal((await getProject(app, id, { userId })).inbox.lastUid, 4);
});
