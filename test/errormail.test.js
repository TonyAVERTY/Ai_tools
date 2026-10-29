// Erreurs serveur envoyées par mail HTML aux administrateurs ; migrations : l'ordre de la liste est figé (le numéro = la version).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { MIGRATIONS } from '../src/migrations.js';
import { redact, errorMail, reportError } from '../src/services/errormail.js';

const SMTP = { host: 'smtp.serveur', port: 587, user: 'srv', pass: 'p', fromEmail: 'aitools@serveur.test' };
const mails = [];
let s;
before(async () => {
  s = await startApp({
    cfg: { systemSmtp: SMTP, adminEmails: ['tony@admin.test', 'second@admin.test'] },
    createTransport: () => ({ sendMail: async (m) => { mails.push(m); }, close() {} }),
  });
});
after(async () => { await s.close(); });
const until = async (fn) => { for (let i = 0; i < 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); };

test('migrations : ordre figé, on n\'ajoute qu\'à la fin (le runner MySQL suit les numéros de version)', () => {
  const names = MIGRATIONS.map((m) => m.name);
  assert.equal(names.indexOf('replies'), 8, 'version 9');
  assert.equal(names.indexOf('read_receipts'), 9, 'version 10');
  assert.equal(names.indexOf('calendar'), 10, 'version 11');
  assert.equal(names.indexOf('api_tokens'), 11, 'version 12');
  assert.equal(names.indexOf('session_id_hashing'), 12, 'version 13');
  assert.equal(names.indexOf('calendar_events'), 14, 'version 15 : jamais appliquée en production avant le correctif');
  assert.equal(new Set(names).size, names.length, 'noms uniques');
});

test('une page qui plante : l\'utilisateur voit « Erreur interne », les admins reçoivent un mail HTML', async () => {
  mails.length = 0;
  const u = await s.newUser();
  await s.db.prepare('DROP TABLE calendar_events').run(); // même panne qu'en production : table absente
  const r = await u.get('/calendar?m=2026-11&token=aitk_SECRETSECRETSECRET', { headers: { accept: 'text/html' } });
  assert.equal(r.status, 500);
  const page = await r.text();
  assert.match(page, /Erreur interne/);
  assert.doesNotMatch(page, /calendar_events/, 'aucun détail technique à l\'écran');
  await until(() => mails.length);
  assert.equal(mails.length, 1);
  const m = mails[0];
  assert.equal(m.from, SMTP.fromEmail);
  assert.equal(m.to, 'tony@admin.test, second@admin.test');
  assert.match(m.subject, /^\[AiTools\] Erreur serveur · GET \/calendar$/);
  assert.match(m.html, /^<!doctype html>/);
  assert.match(m.html, /calendar_events/, 'le détail technique est dans le mail');
  assert.match(m.html, /GET \/calendar/);
  assert.match(m.html, new RegExp(`n° ${u.id}`));
  assert.match(m.text, /Erreur serveur : GET \/calendar/);
  const all = m.html + m.text;
  assert.doesNotMatch(all, /SECRETSECRET|token=/, 'paramètres d\'URL jamais joints');
  assert.doesNotMatch(all, /SELECT \* FROM calendar_events/, 'requête SQL jamais jointe');
  // la même erreur répétée ne re-spamme pas
  await u.get('/calendar?m=2026-12', { headers: { accept: 'text/html' } });
  await new Promise((r2) => setTimeout(r2, 100));
  assert.equal(mails.length, 1, 'même erreur : un seul mail par fenêtre');
});

test('secrets masqués ; limite horaire ; rien sans SMTP ou sans administrateur ; un envoi qui échoue ne casse rien', async () => {
  assert.equal(redact('clé aitk_AbCdEf123_xyz et Bearer abc.def-ghi'), 'clé aitk_[masqué] et Bearer [masqué]');
  assert.equal(redact('mysql://root:hunter2@db/x'), 'mysql://root:[masqué]@db/x');
  assert.equal(redact('password=hunter2 ok'), 'password=[masqué] ok');
  assert.equal(redact(`sid ${'a1b2c3d4'.repeat(8)}`), 'sid [masqué]');
  const html = errorMail({ error: Object.assign(new Error('boom <script>alert(1)</script> aitk_ZZZZZZ'), { code: 'X' }), method: 'POST', path: '/x', userId: null, at: 'jeudi', repeats: 3, appUrl: 'https://ai.test' });
  assert.doesNotMatch(html, /<script>alert/, 'échappé');
  assert.doesNotMatch(html, /aitk_ZZZZZZ/);
  assert.match(html, /3 fois depuis le dernier mail/);
  assert.match(html, /visiteur ou API/);

  const sent = [];
  const mk = (cfg, fail = false) => ({ cfg: { appUrl: 'https://ai.test', ...cfg }, createTransport: () => ({ sendMail: async (m) => { if (fail) throw new Error('smtp KO'); sent.push(m); }, close() {} }), resolveHost: async () => [{ address: '93.184.216.34', family: 4 }] });
  assert.equal((await reportError(mk({ systemSmtp: null, adminEmails: ['a@b.fr'] }), new Error('x'))).reason, 'smtp-ou-admin-absent');
  assert.equal((await reportError(mk({ systemSmtp: SMTP, adminEmails: [] }), new Error('x'))).reason, 'smtp-ou-admin-absent');
  const app = mk({ systemSmtp: SMTP, adminEmails: ['a@b.fr'] });
  for (let i = 0; i < 10; i++) assert.equal((await reportError(app, new Error(`erreur ${i}`))).sent, true);
  assert.equal((await reportError(app, new Error('onzième'))).reason, 'limite-horaire', 'au plus 10 mails par heure');
  assert.equal(sent.length, 10);
  const ko = mk({ systemSmtp: SMTP, adminEmails: ['a@b.fr'] }, true);
  const origErr = console.error; console.error = () => {};
  try { assert.deepEqual(await reportError(ko, new Error('y')), { sent: false, reason: 'envoi-impossible' }); } finally { console.error = origErr; }
});

test('alerte d\'erreur : part de la boîte erreur@ quand elle est configurée', async () => {
  const sent = [];
  const app = { cfg: { systemSmtp: SMTP, errorSmtp: { ...SMTP, user: 'erreur@x.test', fromEmail: 'erreur@x.test' }, adminEmails: ['a@b.fr'] },
    createTransport: (c) => ({ sendMail: async (m) => { sent.push({ user: c.user, from: m.from }); }, close() {} }),
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }] };
  assert.equal((await reportError(app, new Error('boîte dédiée'))).sent, true);
  assert.deepEqual(sent, [{ user: 'erreur@x.test', from: 'erreur@x.test' }]);
});
