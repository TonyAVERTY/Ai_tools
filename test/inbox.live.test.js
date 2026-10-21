// Test de bout en bout contre un vrai serveur IMAP. Ignoré par défaut.
// IMAP_TEST=host:port:user:pass npm test   (la boîte doit contenir les 4 mails de test, cf. README)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openDb, now } from '../src/db.js';
import { checkInbox } from '../src/services/inbox.js';
import { createProject, saveSecretConfig, getProject } from '../src/projects.js';

const live = process.env.IMAP_TEST;

test('checkInbox sur un vrai serveur IMAP', { skip: !live && 'IMAP_TEST non défini' }, async () => {
  const [host, port, user, pass] = live.split(':');
  const db = openDb(':memory:');
  const app = { db, cfg: { secretKey: randomBytes(32) } };
  const id = createProject(app, { name: 'P', gitUrl: 'https://git.x/T/P.git' });
  saveSecretConfig(app, id, 'smtp_enc', { host: 'smtp.x', user, pass, fromEmail: user }, 'pass');
  saveSecretConfig(app, id, 'imap_enc', { host, port: Number(port), user: '', pass: '' }, 'pass');
  const add = (email, msgId) => {
    const pid = Number(db.prepare("INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, 'X', ?, 'sent', ?, ?)")
      .run(id, email, now() - 86400 * 30, now()).lastInsertRowid);
    db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, message_id) VALUES(?, ?, ?, ?, 'initial', ?)")
      .run(id, pid, email, now() - 86400 * 30, msgId);
    return pid;
  };
  const fournil = add('contact@fournil.fr', '<m1@codebzh.fr>');
  const zen = add('hello@zen.fr', '<m2@codebzh.fr>');
  const ferme = add('contact@ferme.fr', '<m3@codebzh.fr>');

  assert.deepEqual(await checkInbox(app, id), { replies: 1, bounces: 1, ignored: 2 });
  const st = (pid) => db.prepare('SELECT status FROM prospects WHERE id = ?').get(pid).status;
  assert.equal(st(fournil), 'replied');
  assert.equal(st(zen), 'sent', 'une absence n\'est pas une réponse');
  assert.equal(st(ferme), 'bounced');
  assert.deepEqual(await checkInbox(app, id), { replies: 0, bounces: 0, ignored: 0 }, 'rien de relu');
  assert.equal(getProject(app, id).inbox.lastUid, 4);
});
