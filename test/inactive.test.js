import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { getSetting, now } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { addUser } from './helpers/users.js';
import { startApp } from './helpers/server.js';
import { addMonths, runInactiveCleanup, warningMail } from '../src/services/inactive.js';
import { Scheduler } from '../src/services/scheduler.js';
import { recentAudit } from '../src/admin.js';
import { loadConfig } from '../src/config.js';

// Suppression des comptes inactifs avec une horloge injectée : avertissement 30 jours avant, suppression seulement après
// avertissement reçu, jamais un administrateur.

const DAY = 86400;
const T0 = Date.parse('2025-01-15T10:00:00Z') / 1000; // date de dernière connexion de référence
const at = (months, days = 0) => addMonths(T0, months) + days * DAY;

async function world({ smtp = true, months = 24 } = {}) {
  const db = await testDb();
  const mails = [];
  const app = {
    db, resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    cfg: {
      dataDir: '/tmp/aitools-inactive', appUrl: 'https://ai.test', secretKey: randomBytes(32), inactiveMonths: months,
      systemSmtp: smtp ? { host: 'smtp.serveur.fr', port: 587, user: 'u', pass: 'p', fromEmail: 'noreply@ai.test' } : null,
    },
    createTransport: (cfg) => ({ sendMail: async (m) => { mails.push({ ...m, via: cfg.host }); }, close() {} }),
  };
  const log = { warns: [], warn: (...a) => log.warns.push(a.join(' ')), error() {} };
  return { db, app, mails, log };
}
async function member(w, o = {}) {
  const id = await addUser(w.db, { admin: false, email: o.email || `m${Math.random().toString(36).slice(2, 8)}@ex.fr`, ...o });
  await w.db.prepare('UPDATE users SET created_at = ?, last_login_at = ? WHERE id = ?').run(o.createdAt ?? T0 - 10 * DAY, o.lastLogin ?? T0, id);
  return id;
}
const exists = async (w, id) => !!(await w.db.prepare('SELECT 1 x FROM users WHERE id = ?').get(id));
const run = (w, when, extra = {}) => runInactiveCleanup(w.app, { at: when, log: w.log, ...extra });

test('chronologie : rien avant 23 mois, avertissement à J-30, suppression à J0 si avertissement reçu et resté inactif', async () => {
  const w = await world();
  const id = await member(w, { email: 'ada@ex.fr' });
  assert.deepEqual(await run(w, at(23)), { warned: 0, deleted: 0, unsent: 0 }, '23 mois : rien');
  assert.equal(w.mails.length, 0);
  assert.deepEqual(await run(w, at(24, -31)), { warned: 0, deleted: 0, unsent: 0 }, 'à 31 jours de l\'échéance : encore rien');

  // 30 jours avant l'échéance : un avertissement, via le SMTP du serveur, jamais de suppression ce jour-là
  const warnDay = at(24, -30);
  assert.deepEqual(await run(w, warnDay), { warned: 1, deleted: 0, unsent: 0 });
  assert.equal(w.mails.length, 1);
  assert.equal(w.mails[0].to, 'ada@ex.fr');
  assert.equal(w.mails[0].from, 'noreply@ai.test');
  assert.equal(w.mails[0].via, '93.184.216.34', 'le SMTP du serveur passe aussi par le filtre SSRF');
  assert.match(w.mails[0].text, /supprimé avec toutes ses données/);
  assert.match(w.mails[0].text, /https:\/\/ai\.test\/login/);
  assert.match(w.mails[0].text, /15 janvier 2027/);
  assert.equal(await exists(w, id), true);
  // Passages suivants (toutes les 15 min) : ni second mail, ni suppression avant l'échéance
  assert.deepEqual(await run(w, warnDay + 900), { warned: 0, deleted: 0, unsent: 0 });
  assert.deepEqual(await run(w, at(24, -1)), { warned: 0, deleted: 0, unsent: 0 });
  assert.equal(w.mails.length, 1, 'un seul avertissement');
  assert.equal(await exists(w, id), true);
  // Échéance atteinte (24 mois) : supprimé
  assert.deepEqual(await run(w, at(24, 0)), { warned: 0, deleted: 1, unsent: 0 });
  assert.equal(await exists(w, id), false);
  const log = await recentAudit(w.db);
  assert.deepEqual(log.map((l) => l.action), ['inactive_delete', 'inactive_warning']);
  assert.equal(log[0].target, 'a***@ex.fr');
  assert.equal(log[0].admin, 'système');
});

test('un avertissement tardif ne permet pas de supprimer tout de suite : 30 jours de délai après le mail', async () => {
  const w = await world();
  const id = await member(w);
  const late = at(30); // inactif depuis 30 mois, mais premier passage seulement maintenant
  assert.deepEqual(await run(w, late), { warned: 1, deleted: 0, unsent: 0 });
  assert.equal(await exists(w, id), true);
  assert.match(w.mails[0].text, new RegExp(String(new Date((late + 30 * DAY) * 1000).getUTCFullYear())));
  assert.deepEqual(await run(w, late + 29 * DAY), { warned: 0, deleted: 0, unsent: 0 });
  assert.equal(await exists(w, id), true);
  assert.deepEqual(await run(w, late + 30 * DAY), { warned: 0, deleted: 1, unsent: 0 });
  assert.equal(await exists(w, id), false);
});

test('une connexion après l\'avertissement sauve le compte ; l\'ancien avertissement ne vaut plus', async () => {
  const w = await world();
  const id = await member(w);
  await run(w, at(24, -30));
  assert.equal(w.mails.length, 1);
  await w.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(at(24, -10), id); // il se reconnecte
  assert.deepEqual(await run(w, at(24, 5)), { warned: 0, deleted: 0, unsent: 0 });
  assert.equal(await exists(w, id), true);
  // 24 mois après sa nouvelle connexion : il faut un nouvel avertissement avant toute suppression
  const later = addMonths(at(24, -10), 24);
  assert.deepEqual(await run(w, later), { warned: 1, deleted: 0, unsent: 0 });
  assert.equal(w.mails.length, 2);
  assert.equal(await exists(w, id), true);
});

test('un job récent compte comme activité', async () => {
  const w = await world();
  const id = await member(w);
  await w.db.prepare("INSERT INTO jobs(user_id, type, status, created_at) VALUES(?, 'send', 'done', ?)").run(id, at(20));
  assert.deepEqual(await run(w, at(24, -20)), { warned: 0, deleted: 0, unsent: 0 }, 'dernière activité il y a 4 mois seulement');
  assert.equal(w.mails.length, 0);
});

test('jamais un administrateur, ni un compte suspendu, ni un compte actif', async () => {
  const w = await world();
  const admin = await addUser(w.db, { admin: true });
  await w.db.prepare('UPDATE users SET created_at = ?, last_login_at = ? WHERE id = ?').run(T0 - 3000 * DAY, T0 - 3000 * DAY, admin);
  const planAdmin = await member(w); await w.db.prepare("UPDATE users SET plan = 'admin' WHERE id = ?").run(planAdmin);
  const suspended = await member(w, { status: 'suspended' });
  const active = await member(w, { lastLogin: at(40) });
  const never = await member(w, { createdAt: at(40), lastLogin: null });
  await w.db.prepare('UPDATE users SET last_login_at = NULL WHERE id = ?').run(never);
  const when = at(60);
  assert.deepEqual(await run(w, when), { warned: 0, deleted: 0, unsent: 0 });
  assert.deepEqual(await run(w, when + 31 * DAY), { warned: 0, deleted: 0, unsent: 0 });
  assert.equal(w.mails.length, 0);
  for (const id of [admin, planAdmin, suspended, active, never]) assert.equal(await exists(w, id), true, `compte ${id}`);
});

test('sans SMTP du serveur : avertissement journalisé, JAMAIS de suppression automatique', async () => {
  const w = await world({ smtp: false });
  const id = await member(w);
  const r = await run(w, at(30));
  assert.deepEqual(r, { warned: 0, deleted: 0, unsent: 1 });
  assert.ok(w.log.warns.some((l) => /avertissement non envoyé/.test(l) && /SYSTEM_SMTP_HOST/.test(l)));
  const [entry] = await recentAudit(w.db);
  assert.equal(entry.action, 'inactive_warning');
  assert.match(entry.detail, /NON envoyé/);
  // Passages suivants : toujours rien de supprimé, et une seule trace au journal d'audit
  for (let i = 1; i <= 5; i++) await run(w, at(30) + i * 900);
  await run(w, at(40));
  assert.equal(await exists(w, id), true);
  assert.equal((await recentAudit(w.db)).length, 1);
});

test('SMTP du serveur en panne : réessai au passage suivant, pas de suppression, pas de bruit dans le journal d\'audit', async () => {
  const w = await world();
  const id = await member(w);
  let fail = true;
  w.app.createTransport = () => ({ sendMail: async (m) => { if (fail) throw new Error('421 indisponible'); w.mails.push(m); }, close() {} });
  assert.deepEqual(await run(w, at(30)), { warned: 0, deleted: 0, unsent: 1 });
  assert.deepEqual(await run(w, at(30) + 900), { warned: 0, deleted: 0, unsent: 1 });
  assert.equal((await recentAudit(w.db)).length, 0);
  assert.equal(await getSetting(w.db, id, 'inactive_warned_at'), null);
  fail = false;
  assert.deepEqual(await run(w, at(30) + 1800), { warned: 1, deleted: 0, unsent: 0 });
  assert.equal(w.mails.length, 1);
});

test('durée réglable (INACTIVE_ACCOUNT_MONTHS) et désactivable (0)', async () => {
  const w = await world({ months: 12 });
  const id = await member(w);
  assert.equal((await run(w, at(12, -30))).warned, 1);
  assert.equal((await run(w, at(12))).deleted, 1);
  assert.equal(await exists(w, id), false);
  const off = await world({ months: 0 });
  const kept = await member(off);
  assert.deepEqual(await run(off, at(100)), { warned: 0, deleted: 0, unsent: 0 });
  assert.equal(await exists(off, kept), true);
});

test('la suppression a les mêmes effets que celle du compte : données effacées, liste d\'opposition conservée', async () => {
  const w = await world();
  const id = await member(w);
  const p = Number((await w.db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'p', 'u', ?)").run(id, T0)).lastInsertRowid);
  await w.db.prepare("INSERT INTO prospects(project_id, company, email, created_at) VALUES(?, 'E', 'e@x.fr', ?)").run(p, T0);
  await w.db.prepare("INSERT INTO blacklist(email, reason, created_at) VALUES('opp@x.fr', 'unsubscribe', ?)").run(T0);
  await w.db.prepare("INSERT INTO sessions(id, user_id, created_at, expires_at) VALUES('s1', ?, ?, ?)").run(id, T0, T0 + 99);
  await run(w, at(24, -30));
  await run(w, at(24));
  assert.equal((await w.db.prepare('SELECT COUNT(*) n FROM projects WHERE user_id = ?').get(id)).n, 0);
  assert.equal((await w.db.prepare('SELECT COUNT(*) n FROM prospects WHERE project_id = ?').get(p)).n, 0);
  assert.equal((await w.db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(id)).n, 0);
  assert.equal((await w.db.prepare('SELECT COUNT(*) n FROM blacklist').get()).n, 1);
});

test('le planificateur lance le nettoyage avec son horloge injectable', async () => {
  const w = await world();
  const id = await member(w);
  let clock = at(24, -30);
  const sch = new Scheduler(w.app, { log: w.log, clock: () => clock });
  w.app.fetchRecap = async () => ({});
  await sch.tick();
  assert.equal(w.mails.length, 1);
  clock = at(24, 1);
  await sch.tick();
  assert.equal(await exists(w, id), false);
  await sch.stop();
});

test('configuration : INACTIVE_ACCOUNT_MONTHS (24 par défaut) et SMTP du serveur toutes variables ensemble', () => {
  const base = { APP_URL: 'https://x.fr', SECRET_KEY: 'a'.repeat(64), GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', DB_DRIVER: 'sqlite' };
  const keep = { ...process.env };
  const withEnv = (extra, fn) => {
    for (const k of Object.keys(process.env)) if (/^(INACTIVE_|SYSTEM_SMTP)/.test(k)) delete process.env[k];
    Object.assign(process.env, base, extra);
    try { return fn(); } finally { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); }
  };
  assert.equal(withEnv({}, () => loadConfig().inactiveMonths), 24);
  assert.equal(withEnv({ INACTIVE_ACCOUNT_MONTHS: '18' }, () => loadConfig().inactiveMonths), 18);
  assert.equal(withEnv({ INACTIVE_ACCOUNT_MONTHS: '0' }, () => loadConfig().inactiveMonths), 0);
  assert.throws(() => withEnv({ INACTIVE_ACCOUNT_MONTHS: '-1' }, loadConfig), /INACTIVE_ACCOUNT_MONTHS/);
  assert.throws(() => withEnv({ INACTIVE_ACCOUNT_MONTHS: 'deux ans' }, loadConfig), /INACTIVE_ACCOUNT_MONTHS/);
  assert.equal(withEnv({}, () => loadConfig().systemSmtp), null);
  const full = { SYSTEM_SMTP_HOST: 'smtp.x.fr', SYSTEM_SMTP_USER: 'u', SYSTEM_SMTP_PASSWORD: 'p', SYSTEM_SMTP_FROM: 'n@x.fr' };
  assert.deepEqual(withEnv(full, () => loadConfig().systemSmtp), { host: 'smtp.x.fr', port: 587, user: 'u', pass: 'p', fromEmail: 'n@x.fr' });
  assert.throws(() => withEnv({ SYSTEM_SMTP_HOST: 'smtp.x.fr' }, loadConfig), /incomplètes/);
});

test('politique de confidentialité : la suppression automatique est annoncée comme en place, avec la durée configurée', async () => {
  const s = await startApp({ cfg: { inactiveMonths: 18 } });
  const off = await startApp({ cfg: { inactiveMonths: 0 } });
  try {
    const page = async (x) => (await x.anon.get('/confidentialite', { headers: { accept: 'text/html' } })).text();
    const h = await page(s);
    assert.match(h, /Suppression automatique après 18 mois sans connexion ni job, avec un mail d'avertissement 30 jours avant/);
    assert.doesNotMatch(h, /pas encore en place|prévue/);
    assert.match(h, /Journal d'administration/);
    assert.match(await page(off), /Aucune suppression automatique pour inactivité/);
    const def = await startApp();
    try { assert.match(await page(def), /après 24 mois/); } finally { await def.close(); }
  } finally { await s.close(); await off.close(); }
});

test('mail d\'avertissement : jamais le mot de passe ni de donnée métier, lien de connexion et d\'export', () => {
  const m = warningMail({ appUrl: 'https://ai.test' }, { email: 'ada@ex.fr' }, T0);
  assert.match(m.subject, /supprimé pour inactivité/);
  assert.match(m.text, /ada@ex\.fr/);
  assert.match(m.text, /export/i);
  assert.ok(m.text.includes('contact@tony-averty.dev'));
});
