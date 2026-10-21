import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openDb, now, setSetting, getSetting } from '../src/db.js';
import { encrypt, encryptJson } from '../src/crypto.js';
import { weeklyStats, weeklyText, maybeSendWeekly } from '../src/services/report.js';
import { createProject } from '../src/projects.js';

function setup() {
  const db = openDb(':memory:');
  const mails = [], hooks = [];
  const app = {
    db, cfg: { secretKey: randomBytes(32), appUrl: 'https://ai.test' },
    createTransport: () => ({ sendMail: async (m) => { mails.push(m); }, close() {} }),
    fetch: async (url, o) => { hooks.push(JSON.parse(o.body)); return { ok: true }; },
  };
  const mep = createProject(app, { name: 'MonEspacePro', gitUrl: 'https://g/T/M.git' });
  createProject(app, { name: 'GoSortir', gitUrl: 'https://g/T/G.git' });
  const t = now() - 2 * 86400;
  for (let i = 0; i < 20; i++) {
    const v = i % 2 ? 'B' : 'A';
    const replied = (v === 'B' && i < 10) || i === 0;
    const pid = Number(db.prepare('INSERT INTO prospects(project_id, company, email, status, sent_at, variant, replied_at, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
      .run(mep, `E${i}`, `e${i}@x${i}.fr`, i === 3 ? 'client' : replied ? 'replied' : 'sent', t, v, replied ? t + 60 : null, t).lastInsertRowid);
    db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, variant) VALUES(?, ?, ?, ?, 'initial', ?)").run(mep, pid, `e${i}@x${i}.fr`, t, v);
  }
  db.prepare("INSERT INTO mail_log(project_id, email, sent_at, kind) VALUES(?, 'e5@x5.fr', ?, 'followup')").run(mep, t);
  db.prepare("INSERT INTO mail_log(project_id, email, sent_at, kind, error) VALUES(?, 'e6@x6.fr', ?, 'followup', 'refusé')").run(mep, t);
  db.prepare("INSERT INTO blacklist(email, reason, created_at) VALUES('e7@x7.fr', 'bounce', ?)").run(t);
  db.prepare("INSERT INTO jobs(project_id, type, status, cost_usd, created_at, finished_at) VALUES(?, 'prospect', 'done', 0.42, ?, ?)").run(mep, t, t);
  db.prepare("INSERT INTO jobs(project_id, type, status, cost_usd, created_at, finished_at) VALUES(?, 'prospect', 'done', 9, ?, ?)").run(mep, t - 30 * 86400, t - 30 * 86400);
  return { db, app, mails, hooks };
}

test('statistiques de la semaine', () => {
  const s = setup();
  const st = weeklyStats(s.db);
  const mep = st.projects.find((p) => p.name === 'MonEspacePro');
  assert.deepEqual({ ...mep, bestSubject: mep.bestSubject?.variant }, {
    name: 'MonEspacePro', found: 20, sent: 20, followups: 1, replies: 6, clients: 1, bounces: 1, cost: 0.42, bestSubject: 'B',
  });
  assert.equal(st.totals.cost, 0.42, 'le job d\'il y a 30 jours ne compte pas');
  const txt = weeklyText(st);
  assert.match(txt, /^AiTools · semaine du \d\d\/\d\d au \d\d\/\d\d/);
  assert.match(txt, /Réponses {10}: 6 \(taux 30 %\)/);
  assert.match(txt, /l'objet B gagne \(50 % de réponses\)/);
  assert.match(txt, /GoSortir : rien cette semaine/);
});

const MON_0830 = new Date('2026-10-26T08:30:00+01:00');

test('envoi automatique : lundi 8h, une seule fois par semaine, désactivé par défaut', async () => {
  const s = setup();
  setSetting(s.db, 'notify_email', 'moi@x.fr');
  setSetting(s.db, 'smtp_enc', encryptJson(s.app.cfg.secretKey, { host: 'h', user: 'u', pass: 'p', fromEmail: 'aitools@x.fr' }));
  setSetting(s.db, 'discord_webhook_enc', encrypt(s.app.cfg.secretKey, 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz'));

  assert.equal(await maybeSendWeekly(s.app, { date: MON_0830 }), null, 'désactivé par défaut');
  setSetting(s.db, 'weekly_report', '1');
  assert.equal(await maybeSendWeekly(s.app, { date: new Date('2026-10-26T07:45:00+01:00') }), null, 'lundi 7h45 : trop tôt');
  assert.equal(await maybeSendWeekly(s.app, { date: new Date('2026-10-27T09:00:00+01:00') }), null, 'mardi : non');

  const r = await maybeSendWeekly(s.app, { date: MON_0830 });
  assert.deepEqual(r.channels, ['mail', 'discord']);
  assert.equal(s.mails[0].to, 'moi@x.fr');
  assert.match(s.mails[0].subject, /^\[AiTools\] Rapport du/);
  assert.match(s.hooks[0].embeds[0].description, /\*\*MonEspacePro\*\* : 20 trouvés · 20 envoyés · 6 réponses/);

  assert.equal(await maybeSendWeekly(s.app, { date: new Date('2026-10-26T08:45:00+01:00') }), null, 'pas deux fois le même lundi');
  assert.notEqual(await maybeSendWeekly(s.app, { date: new Date('2026-11-02T08:15:00+01:00') }), null, 'lundi suivant');
  assert.equal(s.mails.length, 2);
});

test('aucun canal configuré : rien n\'est marqué comme envoyé', async () => {
  const s = setup();
  setSetting(s.db, 'weekly_report', '1');
  const r = await maybeSendWeekly(s.app, { date: MON_0830 });
  assert.deepEqual(r.channels, []);
  assert.equal(getSetting(s.db, 'weekly_report_last'), null);
});
