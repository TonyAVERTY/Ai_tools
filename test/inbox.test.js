import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openDb, now } from '../src/db.js';
import { parseHeaders, classify, applyMessages, checkInbox } from '../src/services/inbox.js';
import { createProject, saveSecretConfig, getProject, imapCredentials } from '../src/projects.js';

function setup() {
  const db = openDb(':memory:');
  const app = { db, cfg: { secretKey: randomBytes(32) } };
  const id = createProject(app, { name: 'P', gitUrl: 'https://git.x/T/P.git' });
  const add = (company, email, msgId, status = 'sent') => {
    const r = db.prepare('INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(id, company, email, status, now(), now());
    const pid = Number(r.lastInsertRowid);
    if (msgId) {
      db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, message_id) VALUES(?, ?, ?, ?, 'initial', ?)")
        .run(id, pid, email, now(), msgId);
    }
    return pid;
  };
  const status = (pid) => db.prepare('SELECT status, replied_at, reply_subject FROM prospects WHERE id = ?').get(pid);
  return { db, app, id, add, status };
}

test('parseHeaders déplie les en-têtes multi-lignes', () => {
  const h = parseHeaders(Buffer.from('References: <a@x>\r\n <b@x>\r\nAuto-Submitted: auto-replied\r\n\r\n'));
  assert.equal(h.references, '<a@x> <b@x>');
  assert.equal(h['auto-submitted'], 'auto-replied');
});

test('classify : réponse, réponse automatique, bounce', () => {
  assert.equal(classify({ from: 'Jean@Fournil.fr', subject: 'Re: Idée', inReplyTo: '<1@codebzh.fr>' }).type, 'reply');
  assert.deepEqual(classify({ from: 'a@b.fr', inReplyTo: '<1@x.fr>', headers: { references: '<0@x.fr> <1@x.fr>' } }).ids, ['<1@x.fr>', '<0@x.fr>']);
  assert.equal(classify({ from: 'a@b.fr', subject: 'Absence du 12 au 20', headers: {} }).type, 'auto');
  assert.equal(classify({ from: 'a@b.fr', subject: 'Re: x', headers: { 'auto-submitted': 'auto-replied' } }).type, 'auto');
  assert.equal(classify({ from: 'a@b.fr', subject: 'Re: x', headers: { 'auto-submitted': 'no' } }).type, 'reply');
  assert.equal(classify({ from: 'a@b.fr', subject: 'Out of Office: Re: x', headers: {} }).type, 'auto');
  const b = classify({ from: 'MAILER-DAEMON@mx.orange.fr', subject: 'Undelivered Mail', body: 'Original-Message-ID: <42@codebzh.fr>' });
  assert.equal(b.type, 'bounce');
  assert.deepEqual(b.ids, ['<42@codebzh.fr>']);
  assert.equal(classify({ from: 'x@y.fr', subject: 'Rapport', headers: { 'content-type': 'multipart/report; report-type=delivery-status' } }).type, 'bounce');
});

test('réponse rattachée par le fil (In-Reply-To), même depuis une autre adresse', () => {
  const s = setup();
  const p = s.add('Fournil', 'contact@fournil.fr', '<m1@codebzh.fr>');
  const r = applyMessages(s.db, s.id, [{ from: 'jean.dupont@gmail.com', subject: 'Re: Une idée', inReplyTo: '<m1@codebzh.fr>' }]);
  assert.deepEqual(r, { replies: 1, bounces: 0, ignored: 0 });
  assert.equal(s.status(p).status, 'replied');
  assert.equal(s.status(p).reply_subject, 'Re: Une idée');
  assert.ok(s.status(p).replied_at > 0);
});

test('réponse rattachée par adresse puis par domaine pro', () => {
  const s = setup();
  const byMail = s.add('Zen', 'hello@zen.fr', null);
  const byDomain = s.add('Atelier', 'contact@atelier-bois.fr', null);
  const r = applyMessages(s.db, s.id, [
    { from: 'Hello@Zen.fr', subject: 'Intéressé' },
    { from: 'marc@atelier-bois.fr', subject: 'Re: votre message' },
  ]);
  assert.equal(r.replies, 2);
  assert.equal(s.status(byMail).status, 'replied');
  assert.equal(s.status(byDomain).status, 'replied');
});

test('pas de faux positif : webmail générique, domaine ambigu, réponse auto, statut déjà traité', () => {
  const s = setup();
  const g = s.add('Perso', 'boulanger.rennes@gmail.com', null);
  const a1 = s.add('Groupe A', 'rennes@groupe.fr', null);
  const a2 = s.add('Groupe B', 'nantes@groupe.fr', null);
  const client = s.add('Déjà client', 'boss@client.fr', null, 'client');
  const r = applyMessages(s.db, s.id, [
    { from: 'autre@gmail.com', subject: 'Re: ?' },                       // gmail : on ne devine pas
    { from: 'direction@groupe.fr', subject: 'Re: ?' },                   // 2 prospects sur ce domaine
    { from: 'boulanger.rennes@gmail.com', subject: 'Absence', headers: {} },
    { from: 'boss@client.fr', subject: 'Merci' },                        // déjà client : on ne rétrograde pas
    { from: 'inconnu@ailleurs.fr', subject: 'Spam' },
  ]);
  assert.deepEqual(r, { replies: 0, bounces: 0, ignored: 5 });
  for (const pid of [g, a1, a2]) assert.equal(s.status(pid).status, 'sent');
  assert.equal(s.status(client).status, 'client');
});

test('bounce : prospect rejeté + liste d\'opposition, et traitement idempotent', () => {
  const s = setup();
  const p = s.add('Fermé', 'contact@ferme-definitivement.fr', '<m9@codebzh.fr>');
  const bounce = { from: 'mailer-daemon@mx.ovh.net', subject: 'Mail delivery failed', body: 'Message-ID: <m9@codebzh.fr>\n550 user unknown' };
  assert.equal(applyMessages(s.db, s.id, [bounce]).bounces, 1);
  assert.equal(s.status(p).status, 'bounced');
  assert.equal(s.db.prepare("SELECT reason FROM blacklist WHERE email = 'contact@ferme-definitivement.fr'").get().reason, 'bounce');
  assert.deepEqual(applyMessages(s.db, s.id, [bounce]), { replies: 0, bounces: 0, ignored: 1 });
});

test('imapCredentials : utilisateur vide = identifiants SMTP', () => {
  const smtp = { user: 'tony@x.fr', pass: 'smtp' };
  assert.deepEqual(imapCredentials({ host: 'imap.x.fr' }, smtp), { host: 'imap.x.fr', port: 993, user: 'tony@x.fr', pass: 'smtp', reuseSmtp: true });
  assert.equal(imapCredentials({ host: 'imap.x.fr', user: 'autre', pass: 'p', port: '143' }, smtp).port, 143);
  assert.equal(imapCredentials({ host: '' }, smtp), null);
  assert.equal(imapCredentials({ host: 'imap.x.fr' }, null), null);
});

test('checkInbox : reprend au dernier UID, mémorise l\'état et les erreurs', async () => {
  const s = setup();
  saveSecretConfig(s.app, s.id, 'smtp_enc', { host: 'smtp.x', user: 'u', pass: 'p', fromEmail: 'a@x.fr' }, 'pass');
  saveSecretConfig(s.app, s.id, 'imap_enc', { host: 'imap.x', port: 993, user: '', pass: '' }, 'pass');
  const p = s.add('Fournil', 'contact@fournil.fr', '<m1@x.fr>');
  const calls = [];
  s.app.fetchInbox = async (creds, state) => {
    calls.push({ creds, state });
    if (calls.length === 3) throw Object.assign(new Error('x'), { responseText: 'AUTHENTICATIONFAILED' });
    return calls.length === 1
      ? { uidValidity: '7', lastUid: 12, messages: [{ uid: 12, from: 'contact@fournil.fr', subject: 'Re: idée' }] }
      : { uidValidity: '7', lastUid: 12, messages: [] };
  };
  assert.deepEqual(await checkInbox(s.app, s.id), { replies: 1, bounces: 0, ignored: 0 });
  assert.equal(calls[0].creds.user, 'u', 'identifiants SMTP réutilisés');
  await checkInbox(s.app, s.id);
  assert.deepEqual(calls[1].state && { v: calls[1].state.uidValidity, u: calls[1].state.lastUid }, { v: '7', u: 12 });
  await assert.rejects(checkInbox(s.app, s.id), /AUTHENTICATIONFAILED/);
  const inbox = getProject(s.app, s.id).inbox;
  assert.equal(inbox.lastError, 'AUTHENTICATIONFAILED');
  assert.equal(inbox.replies, 1);
  assert.equal(inbox.lastUid, 12, 'le dernier UID est conservé après une erreur');
  assert.equal(s.status(p).status, 'replied');
});
