// Erreurs (toute réponse d'erreur sauf 404, tâche en échec) envoyées par mail HTML à l'adresse du développeur ; migrations : l'ordre de la liste est figé (le numéro = la version).
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
    cfg: { systemSmtp: SMTP, errorAlertTo: ['dev@exemple.test', 'second@exemple.test'] },
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
  assert.equal(m.to, 'dev@exemple.test, second@exemple.test');
  assert.match(m.subject, /^\[iaboss\] Erreur serveur 500 · GET \/calendar$/);
  assert.match(m.html, /^<!doctype html>/);
  assert.match(m.html, /calendar_events/, 'le détail technique est dans le mail');
  assert.match(m.html, /GET \/calendar/);
  assert.match(m.html, new RegExp(`n° ${u.id}`));
  assert.match(m.text, /Erreur serveur : GET \/calendar \(HTTP 500\)/);
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
  assert.equal(redact('clé iaboss_AbCdEf123_xyz'), 'clé iaboss_[masqué]', 'le nouveau préfixe est masqué aussi');
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
  assert.equal((await reportError(mk({ systemSmtp: null, errorAlertTo: ['a@b.fr'] }), new Error('x'))).reason, 'smtp-ou-admin-absent');
  assert.equal((await reportError(mk({ systemSmtp: SMTP, errorAlertTo: [] }), new Error('x'))).reason, 'smtp-ou-admin-absent');
  const app = mk({ systemSmtp: SMTP, errorAlertTo: ['a@b.fr'] });
  for (let i = 0; i < 20; i++) assert.equal((await reportError(app, new Error(`erreur ${i}`))).sent, true);
  assert.equal((await reportError(app, new Error('vingt et unième'))).reason, 'limite-horaire', 'au plus 20 mails par heure pour les erreurs serveur');
  assert.equal(sent.length, 20);
  const ko = mk({ systemSmtp: SMTP, errorAlertTo: ['a@b.fr'] }, true);
  const origErr = console.error; console.error = () => {};
  try { assert.deepEqual(await reportError(ko, new Error('y')), { sent: false, reason: 'envoi-impossible' }); } finally { console.error = origErr; }
});

test('alerte d\'erreur : part de la boîte erreur@ quand elle est configurée', async () => {
  const sent = [];
  const app = { cfg: { systemSmtp: SMTP, errorSmtp: { ...SMTP, user: 'erreur@x.test', fromEmail: 'erreur@x.test' }, errorAlertTo: ['a@b.fr'] },
    createTransport: (c) => ({ sendMail: async (m) => { sent.push({ user: c.user, from: m.from }); }, close() {} }),
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }] };
  assert.equal((await reportError(app, new Error('boîte dédiée'))).sent, true);
  assert.deepEqual(sent, [{ user: 'erreur@x.test', from: 'erreur@x.test' }]);
});

// ---------- Toute erreur sauf 404 ----------
const byStatus = (status, over = {}) => Object.assign(new Error(over.message || `erreur ${status}`), { status, ...over });
const mkApp = (extra = {}) => { const out = []; return { out, app: { cfg: { appUrl: 'https://ai.test', systemSmtp: SMTP, errorAlertTo: ['contact@tony-averty.dev'], ...extra }, createTransport: () => ({ sendMail: async (m) => { out.push(m); }, close() {} }), resolveHost: async () => [{ address: '93.184.216.34', family: 4 }] } }; };

test('l\'adresse du développeur est celle par défaut, et ERROR_ALERT_TO la remplace', async () => {
  const { loadConfig } = await import('../src/config.js');
  const keep = { ...process.env };
  try {
    Object.assign(process.env, { SECRET_KEY: '00'.repeat(32), APP_URL: 'https://x.test/', GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', DB_HOST: 'h', DB_USER: 'u', DB_NAME: 'n' });
    delete process.env.ERROR_ALERT_TO;
    assert.deepEqual(loadConfig().errorAlertTo, ['contact@tony-averty.dev']);
    process.env.ERROR_ALERT_TO = ' A@x.fr, b@y.fr ,';
    assert.deepEqual(loadConfig().errorAlertTo, ['a@x.fr', 'b@y.fr']);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
  }
});

test('un 404 ne part jamais ; toute autre erreur (400, 401, 403, 429, 502 exposée…) part en HTML avec son statut', async () => {
  const { app, out } = mkApp();
  assert.deepEqual(await reportError(app, byStatus(404), { method: 'GET', path: '/nulle-part' }), { sent: false, reason: 'introuvable' });
  assert.equal(out.length, 0);
  for (const st of [400, 401, 403, 409, 429, 502]) {
    const r = await reportError(app, byStatus(st, { message: `refus ${st}` }), { method: 'POST', path: '/link/api-key', userId: 7, status: st });
    assert.equal(r.sent, true, `HTTP ${st}`);
  }
  assert.equal(out.length, 6);
  const m = out.find((x) => /502/.test(x.subject));
  assert.equal(m.to, 'contact@tony-averty.dev');
  assert.match(m.subject, /^\[iaboss\] Erreur serveur 502 · POST \/link\/api-key$/);
  assert.match(m.html, /Statut HTTP[^]*?502/);
  assert.match(m.html, /^<!doctype html>/);
  const c = out.find((x) => /403/.test(x.subject));
  assert.match(c.subject, /^\[iaboss\] Erreur de requête 403/);
  assert.match(c.html, /Erreur de requête/);
});

test('les erreurs de requête (4xx) ont leur propre budget : elles ne masquent jamais une panne', async () => {
  const { app, out } = mkApp();
  let refused = 0;
  for (let i = 0; i < 12; i++) if ((await reportError(app, byStatus(401, { message: `session ${i}` }), { method: 'GET', path: `/api/x${i}`, status: 401 })).reason === 'limite-horaire') refused++;
  assert.equal(refused, 6, '6 mails de requête par heure');
  assert.equal((await reportError(app, new Error('vraie panne'), { method: 'GET', path: '/calendar', status: 500 })).sent, true, 'une erreur serveur passe encore');
  assert.equal(out.length, 7);
});

test('la même erreur de requête sur deux projets est une seule erreur (numéros d\'adresse ignorés)', async () => {
  const { app, out } = mkApp();
  assert.equal((await reportError(app, byStatus(400, { message: 'cible invalide' }), { method: 'POST', path: '/projects/12/target', status: 400 })).sent, true);
  assert.equal((await reportError(app, byStatus(400, { message: 'cible invalide' }), { method: 'POST', path: '/projects/99/target', status: 400 })).reason, 'deja-signalee');
  assert.equal((await reportError(app, byStatus(400, { message: 'autre message' }), { method: 'POST', path: '/projects/99/target', status: 400 })).sent, true);
  assert.equal(out.length, 2);
});

test('une tâche en échec et un arrêt du processus partent aussi, sous leur nom', async () => {
  const { app, out } = mkApp();
  await reportError(app, new Error('Codex s\'est arrêté sans résultat'), { method: 'JOB', path: 'analyze', userId: 3, status: null });
  await reportError(app, new Error('boom'), { method: 'process', path: 'uncaughtException' });
  assert.match(out[0].subject, /^\[iaboss\] Tâche en échec · tâche analyze$/);
  assert.match(out[0].html, /Tâche en échec/);
  assert.match(out[0].html, /n° 3/);
  assert.match(out[1].subject, /^\[iaboss\] Arrêt du processus/);
});

test('de bout en bout : une saisie refusée (400) et un 502 exposé partent, une page introuvable non', async () => {
  mails.length = 0;
  const u = await s.newUser();
  const nf = await u.get('/une-page-qui-n-existe-pas', { headers: { accept: 'text/html' } });
  assert.equal(nf.status, 404);
  const bad = await u.post('/link/api-key', { apiKey: 'pas une clé', provider: 'gemini' });
  assert.equal(bad.status, 400);
  await until(() => mails.length >= 1);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(mails.length, 1, 'un seul mail : le 404 n\'en a pas produit');
  assert.match(mails[0].subject, /Erreur de requête 400 · POST \/link\/api-key/);
  assert.match(mails[0].html, /Clé API invalide/);
  assert.doesNotMatch(mails[0].html + mails[0].text, /pas une clé/, 'la saisie de l\'utilisateur n\'est jamais jointe');
});
