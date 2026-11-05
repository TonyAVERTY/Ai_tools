import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { now, setSetting, getSetting } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { addUser, TEST_SECRET_KEY } from './helpers/users.js';
import { encrypt, encryptJson } from '../src/crypto.js';
import { weeklyStats, weeklyText, maybeSendWeekly } from '../src/services/report.js';
import { createProject } from '../src/projects.js';

async function setup() {
  const db = await testDb();
  const mails = [], hooks = [];
  const app = { resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    db, cfg: { secretKey: TEST_SECRET_KEY, appUrl: 'https://ai.test', systemSmtp: { host: 'smtp.serveur', port: 587, user: 'srv', pass: 'p', fromEmail: 'aitools@serveur.test' } },
    createTransport: () => ({ sendMail: async (m) => { mails.push(m); }, close() {} }),
    fetch: async (url, o) => { hooks.push(JSON.parse(o.body)); return { ok: true }; },
  };
  const userId = await addUser(db);
  const mep = await createProject(app, { userId, name: 'MonEspacePro', gitUrl: 'https://g/T/M.git' });
  await createProject(app, { userId, name: 'GoSortir', gitUrl: 'https://g/T/G.git' });
  const t = now() - 2 * 86400;
  for (let i = 0; i < 20; i++) {
    const v = i % 2 ? 'B' : 'A';
    const replied = (v === 'B' && i < 10) || i === 0;
    const pid = Number((await db.prepare('INSERT INTO prospects(project_id, company, email, status, sent_at, variant, replied_at, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
      .run(mep, `E${i}`, `e${i}@x${i}.fr`, i === 3 ? 'client' : replied ? 'replied' : 'sent', t, v, replied ? t + 60 : null, t)).lastInsertRowid);
    await db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, variant) VALUES(?, ?, ?, ?, 'initial', ?)").run(mep, pid, `e${i}@x${i}.fr`, t, v);
  }
  await db.prepare("INSERT INTO mail_log(project_id, email, sent_at, kind) VALUES(?, 'e5@x5.fr', ?, 'followup')").run(mep, t);
  await db.prepare("INSERT INTO mail_log(project_id, email, sent_at, kind, error) VALUES(?, 'e6@x6.fr', ?, 'followup', 'refusé')").run(mep, t);
  await db.prepare("INSERT INTO blacklist(email, reason, created_at) VALUES('e7@x7.fr', 'bounce', ?)").run(t);
  await db.prepare("INSERT INTO jobs(user_id, project_id, type, status, cost_usd, created_at, finished_at) VALUES(?, ?, 'prospect', 'done', 0.42, ?, ?)").run(userId, mep, t, t);
  await db.prepare("INSERT INTO jobs(user_id, project_id, type, status, cost_usd, created_at, finished_at) VALUES(?, ?, 'prospect', 'done', 9, ?, ?)").run(userId, mep, t - 30 * 86400, t - 30 * 86400);
  return { db, app, mails, hooks, userId };
}

test('statistiques de la semaine', async () => {
  const s = await setup();
  const st = await weeklyStats(s.db, s.userId);
  const mep = st.projects.find((p) => p.name === 'MonEspacePro');
  assert.deepEqual({ ...mep, bestSubject: mep.bestSubject?.variant }, {
    name: 'MonEspacePro', found: 20, sent: 20, followups: 1, replies: 6, clients: 1, bounces: 1, cost: 0.42, bestSubject: 'B',
  });
  assert.equal(st.totals.cost, 0.42, 'le job d\'il y a 30 jours ne compte pas');
  const txt = weeklyText(st);
  assert.match(txt, /^iaboss · semaine du \d\d\/\d\d au \d\d\/\d\d/);
  assert.match(txt, /Réponses {10}: 6 \(taux 30 %\)/);
  assert.match(txt, /l'objet B gagne \(50 % de réponses\)/);
  assert.match(txt, /GoSortir : rien cette semaine/);
});

const MON_0830 = new Date('2026-10-26T08:30:00+01:00');

test('envoi automatique : lundi 8h, une seule fois par semaine, désactivé par défaut', async () => {
  const s = await setup();
  await setSetting(s.db, s.userId, 'notify_email', 'moi@x.fr');
  await setSetting(s.db, s.userId, 'discord_webhook_enc', encrypt(s.app.cfg.secretKey, 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz'));

  assert.equal(await maybeSendWeekly(s.app, s.userId, { date: MON_0830 }), null, 'désactivé par défaut');
  await setSetting(s.db, s.userId, 'weekly_report', '1');
  assert.equal(await maybeSendWeekly(s.app, s.userId, { date: new Date('2026-10-26T07:45:00+01:00') }), null, 'lundi 7h45 : trop tôt');
  assert.equal(await maybeSendWeekly(s.app, s.userId, { date: new Date('2026-10-27T09:00:00+01:00') }), null, 'mardi : non');

  const r = await maybeSendWeekly(s.app, s.userId, { date: MON_0830 });
  assert.deepEqual(r.channels, ['mail', 'discord']);
  assert.equal(s.mails[0].to, 'moi@x.fr');
  assert.equal(s.mails[0].from, 'aitools@serveur.test', 'le rapport part du SMTP du serveur');
  assert.match(s.mails[0].subject, /^\[iaboss\] Rapport du/);
  const field = s.hooks[0].embeds[0].fields.find((f) => f.name === '📁 MonEspacePro');
  assert.match(field.value, /20 trouvés · ✉️ 20 envoyés · 💬 6 réponses \(30 %\)/);
  assert.match(s.mails[0].html, /Rapport hebdo/);
  assert.match(s.mails[0].html, /MonEspacePro/);

  assert.equal(await maybeSendWeekly(s.app, s.userId, { date: new Date('2026-10-26T08:45:00+01:00') }), null, 'pas deux fois le même lundi');
  assert.notEqual(await maybeSendWeekly(s.app, s.userId, { date: new Date('2026-11-02T08:15:00+01:00') }), null, 'lundi suivant');
  assert.equal(s.mails.length, 2);
});

test('aucun canal configuré : rien n\'est marqué comme envoyé', async () => {
  const s = await setup();
  await setSetting(s.db, s.userId, 'weekly_report', '1');
  const r = await maybeSendWeekly(s.app, s.userId, { date: MON_0830 });
  assert.deepEqual(r.channels, []);
  assert.equal(await getSetting(s.db, s.userId, 'weekly_report_last'), null);
});
