// Lot « mails » : vérification des adresses, conseil de montée en charge, réponses (texte, intention, brouillon, popup), page Mails.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../src/db.js';
import { startApp } from './helpers/server.js';
import { testDb } from './helpers/db.js';
import { addProject } from './helpers/users.js';
import { verifyAddress } from '../src/services/verify.js';
import { warmupAdvice, warmupNotice, WARMUP } from '../src/services/warmup.js';
import { extractReplyText, classifyIntent, draftReply, INTENTS } from '../src/services/replies.js';
import { applyMessages } from '../src/services/inbox.js';

// ---------- Vérification des adresses ----------

test('adresses : forme, jetables, MX absent ou déclaré nul refusés ; panne DNS = on ne condamne pas', async () => {
  const mx = async (d) => ({ 'ok.fr': [{ exchange: 'mx.ok.fr', priority: 1 }], 'vide.fr': [], 'nul.fr': [{ exchange: '.', priority: 0 }] }[d]
    ?? Promise.reject(Object.assign(new Error('x'), { code: d === 'panne.fr' ? 'ESERVFAIL' : 'ENOTFOUND' })));
  const v = (e) => verifyAddress(e, { resolveMx: mx, cache: new Map() });
  assert.deepEqual(await v('a@ok.fr'), { ok: true });
  assert.equal((await v('pas-une-adresse')).ok, false);
  assert.equal((await v('a..b@ok.fr')).ok, false);
  assert.equal((await v(`${'x'.repeat(70)}@ok.fr`)).ok, false);
  assert.match((await v('a@yopmail.com')).reason, /jetable/);
  assert.match((await v('a@vide.fr')).reason, /MX/);
  assert.match((await v('a@nul.fr')).reason, /ne reçoit pas/);
  assert.match((await v('a@inconnu.fr')).reason, /introuvable/);
  assert.deepEqual(await v('a@panne.fr'), { ok: true, uncertain: true });
  // un domaine n'est résolu qu'une fois par lot
  let calls = 0;
  const cache = new Map();
  for (const e of ['a@ok.fr', 'b@ok.fr', 'c@ok.fr']) await verifyAddress(e, { resolveMx: async () => { calls++; return [{ exchange: 'm', priority: 1 }]; }, cache });
  assert.equal(calls, 1);
});

// ---------- Montée en charge ----------

test('montée en charge : conseil la première semaine, jamais un blocage', async () => {
  const db = await testDb();
  const uid = await (await import('./helpers/users.js')).addUser(db, {});
  const pid = await addProject(db, uid, { gitUrl: 'https://github.com/a/b.git' });
  let a = await warmupAdvice(db, pid, { sentToday: 0 });
  assert.equal(a.active, true);
  assert.equal(warmupNotice(a, 20), null, '20 mails : dans la recommandation');
  assert.match(warmupNotice(a, 200), /Tu peux quand même envoyer plus/);
  assert.match(warmupNotice({ ...a, sentToday: 15 }, 10), /Conseil/, 'compte ce qui est déjà parti aujourd\'hui');
  await db.prepare('INSERT INTO mail_log(project_id, email, sent_at) VALUES(?, ?, ?)').run(pid, 'x@y.fr', now() - 8 * 86400);
  a = await warmupAdvice(db, pid, { sentToday: 150 });
  assert.equal(a.active, false, 'plus de conseil après 7 jours');
  assert.equal(warmupNotice(a, 200), null);
  assert.equal(WARMUP.perDay, 20);
});

// ---------- Texte et intention des réponses ----------

const mime = (headers, body) => `${headers}\r\n\r\n${body}`;

test('texte de la réponse : multipart, quoted-printable, base64, citations retirées', () => {
  const qp = mime('Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable', 'Oui, avec plaisir =C3=A0 vous lire.\r\n\r\nLe lundi 3 mars 2026 à 10:00, Tony a écrit :\r\n> Bonjour');
  assert.equal(extractReplyText(qp), 'Oui, avec plaisir à vous lire.');
  const b64 = mime('Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64', Buffer.from('Pas intéressé, merci.').toString('base64'));
  assert.equal(extractReplyText(b64), 'Pas intéressé, merci.');
  const multi = mime('Content-Type: multipart/alternative; boundary="B1"',
    '--B1\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>HTML <b>seul</b></p>\r\n--B1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nVersion texte\r\n--B1--');
  assert.equal(extractReplyText(multi), 'Version texte', 'text/plain préféré');
  const htmlOnly = mime('Content-Type: text/html; charset=utf-8', '<div>Bonjour<br>Rappelez-moi</div><script>x()</script>');
  assert.match(extractReplyText(htmlOnly), /Bonjour\s+Rappelez-moi/);
  assert.doesNotMatch(extractReplyText(htmlOnly), /x\(\)|<div>/);
  assert.equal(extractReplyText(mime('Content-Type: text/plain', 'a'.repeat(9000))).length, 3000, 'borné');
});

test('intention : refus avant intérêt, plus tard, question, autre ; l\'objet « Re: » ne pèse pas', () => {
  const c = (body, subject = '') => classifyIntent(subject, body);
  assert.equal(c('Je ne suis pas intéressé, merci.'), 'refused');
  assert.equal(c('Merci de ne plus me contacter.'), 'refused');
  assert.equal(c('Veuillez me désinscrire de votre liste'), 'refused');
  assert.equal(c('Pas le moment, revenez vers moi en septembre.'), 'later');
  assert.equal(c('Intéressant ! Pouvez-vous m\'envoyer un devis ?'), 'interested');
  assert.equal(c('Oui, appelons-nous mardi.'), 'interested');
  assert.equal(c('Vous travaillez avec quelles technologies ?'), 'question');
  assert.equal(c('Bien reçu.'), 'other');
  assert.equal(c('Bien reçu.', 'Re: Un audit gratuit : stop au gaspillage'), 'other', 'objet ignoré quand il y a un corps');
  assert.deepEqual(Object.keys(INTENTS), ['interested', 'question', 'later', 'refused', 'other']);
});

test('brouillon : une réponse toute rédigée par intention, signée', () => {
  for (const intent of Object.keys(INTENTS)) {
    const d = draftReply(intent, { company: 'Atelier', senderName: 'Tony' });
    assert.match(d, /^Bonjour/);
    assert.match(d, /Tony$/);
  }
  assert.match(draftReply('interested', { company: 'Atelier', senderName: 'Tony' }), /Atelier/);
  assert.match(draftReply('other', {}), /\[Votre nom\]/, 'sans nom d\'expéditeur : un repère à compléter');
});

// ---------- Réponses lues dans la boîte ----------

test('applyMessages : la réponse est enregistrée (texte, intention, non lue) une seule fois ; un refus vaut opposition', async () => {
  const db = await testDb();
  const { addUser } = await import('./helpers/users.js');
  const uid = await addUser(db, {});
  const pid = await addProject(db, uid, { gitUrl: 'https://github.com/a/b.git' });
  const mk = async (email) => Number((await db.prepare("INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, 'Atelier', ?, 'sent', ?, ?)").run(pid, email, now(), now())).lastInsertRowid);
  const a = await mk('a@atelier.fr'), b = await mk('b@boutique.fr');
  const msgs = [
    { uid: 11, from: 'a@atelier.fr', subject: 'Re: offre', text: 'Intéressé, appelez-moi.', headers: {} },
    { uid: 12, from: 'b@boutique.fr', subject: 'Re: offre', text: 'Non merci, ne plus me contacter.', headers: {} },
  ];
  assert.equal((await applyMessages(db, pid, msgs)).replies, 2);
  assert.equal((await applyMessages(db, pid, msgs)).replies, 0, 'idempotent');
  const rows = await db.prepare('SELECT prospect_id, intent, body, seen_at FROM replies ORDER BY uid').all();
  assert.deepEqual(rows.map((r) => [r.prospect_id, r.intent, r.seen_at]), [[a, 'interested', null], [b, 'refused', null]]);
  assert.equal(rows[0].body, 'Intéressé, appelez-moi.');
  assert.equal((await db.prepare('SELECT status FROM prospects WHERE id = ?').get(a)).status, 'replied');
  assert.equal((await db.prepare('SELECT status FROM prospects WHERE id = ?').get(b)).status, 'refused');
  assert.ok(await db.prepare("SELECT 1 FROM blacklist WHERE email = 'b@boutique.fr'").get(), 'liste d\'opposition');
});

// ---------- Routes et page ----------

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

async function world(user) {
  const pid = await addProject(s.db, user.id, { gitUrl: `https://github.com/u${user.id}/r.git` });
  const prospect = Number((await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, 'Atelier', 'a@atelier.fr', 'replied', ?, ?)").run(pid, now(), now())).lastInsertRowid);
  await s.db.prepare('INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, subject) VALUES(?, ?, ?, ?, ?, ?)').run(pid, prospect, 'a@atelier.fr', now(), 'initial', 'Bonjour Atelier');
  await s.db.prepare('INSERT INTO mail_log(project_id, prospect_id, email, sent_at, error, kind) VALUES(?, ?, ?, ?, ?, ?)').run(pid, null, 'x@y.fr', now(), 'Adresse non envoyée : adresse jetable', 'initial');
  const reply = Number((await s.db.prepare("INSERT INTO replies(project_id, prospect_id, uid, from_email, subject, body, intent, received_at) VALUES(?, ?, 1, 'a@atelier.fr', 'Re: Bonjour', 'Ça m''intéresse <b>beaucoup</b>', 'interested', ?)").run(pid, prospect, now())).lastInsertRowid);
  return { pid, prospect, reply };
}

test('API réponses : popup (non lues), brouillon, marquer comme lu, isolation entre comptes', async () => {
  const u1 = await s.newUser(), u2 = await s.newUser();
  const w = await world(u1);
  const list = await (await u1.get('/api/replies?unseen=1')).json();
  assert.equal(list.unseen, 1);
  assert.equal(list.replies[0].from, 'a@atelier.fr');
  assert.equal(list.replies[0].intent, 'interested');
  assert.match(list.replies[0].draft, /^Bonjour/);
  assert.equal((await (await u2.get('/api/replies?unseen=1')).json()).unseen, 0, 'les réponses d\'un autre compte restent invisibles');
  assert.equal((await u2.post(`/api/replies/${w.reply}/seen`, {})).status, 404);
  assert.equal((await u1.post(`/api/replies/${w.reply}/seen`, {})).status, 200);
  assert.equal((await (await u1.get('/api/replies?unseen=1')).json()).unseen, 0);
  assert.equal((await (await u1.get('/api/replies')).json()).replies.length, 1, 'toujours dans la liste complète');
  assert.equal((await s.anon.get('/api/replies')).status, 401);
});

test('page Mails : envoyés avec leur état, réponses par intention, échappement, isolation', async () => {
  const u1 = await s.newUser(), u2 = await s.newUser();
  await world(u1);
  const get = (u, p) => u.get(p, { headers: { accept: 'text/html' } });
  const sent = await (await get(u1, '/mails')).text();
  assert.match(sent, /Bonjour Atelier/);
  assert.match(sent, /Répondu/);
  assert.match(sent, /Non envoyé/);
  assert.match(sent, /« Lu » vient de l'accusé de lecture standard/);
  const failedOnly = await (await get(u1, '/mails?filter=failed')).text();
  assert.match(failedOnly, /x@y\.fr/);
  assert.doesNotMatch(failedOnly, /Bonjour Atelier/);
  const replies = await (await get(u1, '/mails?v=replies&filter=interested')).text();
  assert.match(replies, /Réponse suggérée/);
  assert.match(replies, /Ça m&#39;intéresse &lt;b&gt;beaucoup&lt;\/b&gt;/, 'texte de la réponse échappé');
  assert.doesNotMatch(replies, /<b>beaucoup/);
  const other = await (await get(u2, '/mails')).text();
  assert.doesNotMatch(other, /Bonjour Atelier|a@atelier\.fr/);
  assert.equal((await s.anon.get('/mails', { headers: { accept: 'text/html' } })).status, 303);
});

test('envoi : une adresse invalide n\'est pas envoyée, marquée « adresse invalide », hors du taux de rejets', async () => {
  const { makeHandlers } = await import('../src/handlers.js');
  const { Worker, enqueue } = await import('../src/services/jobs.js');
  const { saveSecretConfig, saveTemplate } = await import('../src/projects.js');
  const { addUser } = await import('./helpers/users.js');
  const { bounceStats } = await import('../src/services/abuse.js');
  const db = await testDb();
  const uid = await addUser(db, { link: { v: 1, mode: 'api_key', valid: true } });
  const pid = await addProject(db, uid, { gitUrl: 'https://github.com/a/b.git' });
  const app = {
    db, resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    resolveMx: async (d) => (d === 'bon.fr' ? [{ exchange: 'mx.bon.fr', priority: 1 }] : []),
    cfg: { dataDir: '/tmp/x', appUrl: 'https://ai.test', secretKey: (await import('./helpers/users.js')).TEST_SECRET_KEY, sandbox: { enabled: false } },
    createTransport: () => ({ verify: async () => true, sendMail: async (m) => { sent.push(m.to); }, close() {} }),
  };
  const sent = [];
  await saveSecretConfig(app, pid, 'smtp_enc', { host: 'smtp.exemple.fr', port: 587, user: 'u', pass: 'p', fromEmail: 'moi@exemple.fr' }, 'pass');
  await saveTemplate(db, pid, 'initial', { subject: 'Salut', body: 'Bonjour {{entreprise}}', status: 'validated' });
  for (const [i, e] of ['a@mauvais.fr', 'b@jetable.test', 'c@bon.fr'].entries()) {
    await db.prepare("INSERT INTO prospects(project_id, company, email, status, score, created_at) VALUES(?, 'E', ?, 'new', ?, ?)").run(pid, e, 9 - i, now());
  }
  await db.prepare("UPDATE prospects SET email = 'd@yopmail.com' WHERE email = 'b@jetable.test'").run();
  await db.prepare('INSERT INTO user_settings(user_id, `key`, value) VALUES(?, ?, ?)').run(uid, 'send_delay_min', '0');
  await db.prepare('INSERT INTO user_settings(user_id, `key`, value) VALUES(?, ?, ?)').run(uid, 'send_delay_max', '0');
  await enqueue(db, { userId: uid, projectId: pid, type: 'send', params: { count: 1, confirm: true } });
  await new Worker(db, makeHandlers(app), { log: { error() {} } }).tick();
  assert.deepEqual(sent, ['c@bon.fr'], 'les deux adresses invalides sont passées, la bonne est partie');
  const st = Object.fromEntries((await db.prepare('SELECT email, status FROM prospects').all()).map((r) => [r.email, r.status]));
  assert.deepEqual(st, { 'a@mauvais.fr': 'invalid', 'd@yopmail.com': 'invalid', 'c@bon.fr': 'sent' });
  assert.equal((await bounceStats(db, uid, { since: 0 })).bounced, 0, 'une adresse invalide n\'est pas un rejet');
});

// ---------- Accusés de lecture (alternative au pixel espion) ----------

test('accusé de lecture : en-tête demandé seulement si l\'option est active, aucun pixel ni lien traqué', async () => {
  const { buildProspectMail } = await import('../src/services/mailer.js');
  const args = { template: { subject: 'S', body: 'Bonjour {{entreprise}}' }, prospect: { company: 'A', email: 'a@a.fr' }, smtp: { fromEmail: 'moi@x.fr' }, unsubUrl: 'https://p.test/u/a/t' };
  assert.equal(buildProspectMail(args).headers['Disposition-Notification-To'], undefined, 'désactivé par défaut');
  const mail = buildProspectMail({ ...args, readReceipt: true });
  assert.equal(mail.headers['Disposition-Notification-To'], 'moi@x.fr');
  assert.equal(mail.html, undefined, 'texte simple par défaut');
  const html = buildProspectMail({ ...args, readReceipt: true, html: true }).html;
  assert.doesNotMatch(html, /<img/i, 'aucun pixel');
  assert.deepEqual([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((u) => !u.includes('/u/')), [], 'aucun lien traqué');
});

test('accusé reçu dans la boîte : le mail passe en « Lu », jamais compté comme réponse ni comme rejet ; page et API', async () => {
  const { classify } = await import('../src/services/inbox.js');
  const mdn = { from: 'a@atelier.fr', subject: 'Lu : Bonjour', headers: { 'content-type': 'multipart/report; report-type=disposition-notification; boundary=x', 'auto-submitted': 'auto-replied' }, body: 'Original-Message-ID: <abc.def@x.fr>' };
  assert.equal(classify(mdn).type, 'receipt');
  assert.deepEqual(classify(mdn).ids, ['<abc.def@x.fr>']);
  const db = await testDb();
  const { addUser } = await import('./helpers/users.js');
  const uid = await addUser(db, {});
  const pid = await addProject(db, uid, { gitUrl: 'https://github.com/a/b.git' });
  const x = Number((await db.prepare("INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, 'Atelier', 'a@atelier.fr', 'sent', ?, ?)").run(pid, now(), now())).lastInsertRowid);
  await db.prepare('INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, subject, message_id) VALUES(?, ?, ?, ?, ?, ?, ?)').run(pid, x, 'a@atelier.fr', now(), 'initial', 'Bonjour', '<abc.def@x.fr>');
  const r = await applyMessages(db, pid, [mdn, mdn], { at: now() });
  assert.equal(r.receipts, 1, 'une seule fois');
  assert.equal(r.replies + r.bounces, 0);
  assert.ok((await db.prepare('SELECT read_at FROM mail_log WHERE prospect_id = ?').get(x)).read_at);
  assert.equal((await db.prepare('SELECT status FROM prospects WHERE id = ?').get(x)).status, 'sent', 'lire n\'est pas répondre');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM replies').get()).n, 0);
  // l'accusé d'un autre projet ne marque rien
  assert.equal((await applyMessages(db, pid + 99, [mdn], { at: now() })).receipts, 0);
});

test('page Mails : état « Lu (accusé) », filtre, et mention honnête (minimum, jamais « non lu »)', async () => {
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { gitUrl: 'https://github.com/u/read.git' });
  const x = Number((await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, 'Lecteur', 'l@x.fr', 'sent', ?, ?)").run(pid, now(), now())).lastInsertRowid);
  await s.db.prepare('INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, subject, read_at) VALUES(?, ?, ?, ?, ?, ?, ?)').run(pid, x, 'l@x.fr', now(), 'initial', 'Lu celui-ci', now());
  await s.db.prepare('INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, subject) VALUES(?, ?, ?, ?, ?, ?)').run(pid, x, 'l@x.fr', now(), 'followup', 'Pas d\'accusé');
  const get = async (p) => (await u.get(p, { headers: { accept: 'text/html' } })).text();
  const all = await get('/mails');
  assert.match(all, /Lu \(accusé\)/);
  assert.match(all, /« Lu » est donc un minimum/);
  const read = await get('/mails?filter=read');
  assert.match(read, /Lu celui-ci/);
  assert.doesNotMatch(read, /Pas d&#39;accusé/);
  assert.doesNotMatch(await get('/mails?filter=sent'), /Lu celui-ci/, '« Envoyé » exclut ce qui a été lu');
});
