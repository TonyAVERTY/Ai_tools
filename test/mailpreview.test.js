import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import { now } from '../src/db.js';

// Voir ce qui est parti : le texte exact d'un mail envoyé, la raison d'un rejet et la réponse, sur la fiche du prospect (deux pages) et dans l'onglet Envoi.
let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });
const text = (u, p) => u.get(p, { headers: { accept: 'text/html' } }).then((r) => r.text());

async function setup(email, status = 'sent') {
  const u = await s.newUser({ email });
  const pid = await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
  const prospect = Number((await s.db.prepare('INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, ?, ?, ?, ?)').run(pid, 'ANH Coffee', 'contact@anh.fr', status, now())).lastInsertRowid);
  const mail = Number((await s.db.prepare('INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, subject, body, note) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
    .run(pid, prospect, 'contact@anh.fr', now() - 3600, 'initial', 'MonEspacePro pour les commerces', 'Bonjour,\nVoici le texte EXACT du mail <b>parti</b>.', status === 'bounced' ? '550 5.1.1 Boîte inconnue' : null)).lastInsertRowid);
  return { u, pid, prospect, mail };
}

test('fiche du prospect (Clients) : « Voir le mail envoyé » montre le texte exact (échappé) ; un prospect « Rejeté » dit pourquoi', async () => {
  const { u, pid, prospect } = await setup('apercu1@x.fr', 'bounced');
  const h = await text(u, `/clients/p/${prospect}?projet=${pid}`);
  assert.match(h, /<summary>Voir le mail envoyé<\/summary>/);
  assert.match(h, /Voici le texte EXACT du mail &lt;b&gt;parti&lt;\/b&gt;\./, 'le texte est échappé, jamais interprété');
  assert.match(h, /<b>Rejeté :<\/b> 550 5\.1\.1 Boîte inconnue/);
});

test('fiche contact : le mail parti, sa réponse et la raison du rejet sont dépliables', async () => {
  const { u, pid, prospect } = await setup('apercu2@x.fr', 'bounced');
  await s.db.prepare('INSERT INTO replies(project_id, prospect_id, uid, from_email, subject, body, intent, received_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
    .run(pid, prospect, 42, 'mailer-daemon@anh.fr', 'Undelivered', 'Message non remis : boîte inconnue', 'other', now() - 1800);
  const h = await text(u, `/p/${pid}/contact/${prospect}`);
  assert.match(h, /Voici le texte EXACT du mail &lt;b&gt;parti&lt;\/b&gt;\./);
  assert.match(h, /Rejeté :<\/b> 550 5\.1\.1 Boîte inconnue/);
  assert.match(h, /<summary>Voir la réponse<\/summary>[^]*Message non remis : boîte inconnue/);
  // l'API publique d'un prospect ne change pas : elle ne révèle pas le texte des mails
  assert.doesNotMatch(JSON.stringify((await (await u.get(`/api/prospects/${prospect}`)).json()).mails ?? []), /EXACT/);
});

test('un mail parti avant que le texte soit gardé le dit', async () => {
  const { u, pid, prospect, mail } = await setup('apercu3@x.fr');
  await s.db.prepare('UPDATE mail_log SET body = NULL WHERE id = ?').run(mail);
  assert.match(await text(u, `/p/${pid}/contact/${prospect}`), /Contenu non conservé/);
});

test('onglet Envoi : les derniers mails partis (texte, état, réponse) viennent de /api/projects/:id/mails/recent, jamais ceux d\'un autre compte', async () => {
  const { u, pid, prospect } = await setup('apercu4@x.fr', 'replied');
  await s.db.prepare('INSERT INTO replies(project_id, prospect_id, uid, from_email, subject, body, intent, received_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
    .run(pid, prospect, 43, 'contact@anh.fr', 'Re: pour les commerces', 'Ça nous intéresse, appelez-moi.', 'interested', now() - 600);
  const r = await (await u.get(`/api/projects/${pid}/mails/recent`)).json();
  assert.equal(r.mails.length, 1);
  assert.equal(r.mails[0].state, 'replied');
  assert.match(r.mails[0].body, /texte EXACT/);
  assert.equal(r.mails[0].reply.body, 'Ça nous intéresse, appelez-moi.');
  assert.match(await text(u, `/p/${pid}/envoi`), /data-recent-mails data-project="\d+"/);
  const other = await s.newUser({ email: 'apercu5@x.fr' });
  assert.equal((await other.get(`/api/projects/${pid}/mails/recent`)).status, 404, 'projet d\'un autre compte');
  assert.equal((await s.anon.get(`/api/projects/${pid}/mails/recent`)).status, 401);
});
