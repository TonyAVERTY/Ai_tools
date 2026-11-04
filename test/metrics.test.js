import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { testDb } from './helpers/db.js';
import { addUser, TEST_SECRET_KEY } from './helpers/users.js';
import { saveSnapshot, snapshotAll, history, parisDay } from '../src/services/metrics.js';
import { createProject, saveSecretConfig } from '../src/projects.js';

const ts = (iso) => Math.floor(Date.parse(iso) / 1000);

async function setup() {
  const db = await testDb();
  const app = { resolveHost: async () => [{ address: '93.184.216.34', family: 4 }], db, cfg: { secretKey: TEST_SECRET_KEY } };
  const userId = await addUser(db);
  const id = await createProject(app, { userId, name: 'MEP', gitUrl: 'https://g/T/M.git' });
  return { db, app, id, userId };
}

test('jour de Paris, même à 23h30 UTC', () => {
  assert.equal(parisDay(new Date('2026-10-21T22:30:00Z')), '2026-10-22');
  assert.equal(parisDay(new Date('2026-12-31T22:59:00Z')), '2026-12-31');
});

test('photo du jour : une ligne par jour, valeurs non numériques ignorées', async () => {
  const s = await setup();
  const d = new Date('2026-10-21T10:00:00Z');
  await saveSnapshot(s.db, s.id, { users: 10, clients: 2, revenue: 'n/a' }, { date: d });
  await saveSnapshot(s.db, s.id, { users: 12, clients: 3, revenue: 150.5 }, { date: d });
  const rows = await s.db.prepare('SELECT * FROM metrics_daily').all();
  assert.equal(rows.length, 1, 'mise à jour, pas de doublon');
  assert.deepEqual({ ...rows[0] }, { project_id: s.id, day: '2026-10-21', users: 12, clients: 3, revenue: 150.5 });
});

test('photo automatique : une seule par jour et par projet, les erreurs n\'arrêtent pas les autres', async () => {
  const s = await setup();
  const other = await createProject(s.app, { userId: s.userId, name: 'GoSortir', gitUrl: 'https://g/T/G.git' });
  await createProject(s.app, { userId: s.userId, name: 'Sans BDD', gitUrl: 'https://g/T/X.git' });
  for (const id of [s.id, other]) await saveSecretConfig(s.app, id, 'db_enc', { type: 'mysql', host: 'h', sql_users: 'SELECT 1' }, 'password');
  let calls = 0;
  s.app.fetchRecap = async (id) => { calls++; if (id === other) throw new Error('BDD injoignable'); return { users: 5, clients: 1, revenue: 30 }; };
  const log = { errors: [], error(...a) { this.errors.push(a.join(' ')); } };
  const date = new Date('2026-10-21T10:00:00Z');
  assert.equal(await snapshotAll(s.app, { date, log }), 1);
  assert.match(log.errors[0], /BDD injoignable/);
  assert.equal(calls, 2, 'le projet sans BDD n\'est pas interrogé');
  await snapshotAll(s.app, { date: new Date('2026-10-21T15:00:00Z'), log });
  assert.equal(calls, 3, 'déjà pris : seul le projet en erreur est retenté');
  await snapshotAll(s.app, { date: new Date('2026-10-22T08:00:00Z'), log });
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM metrics_daily WHERE project_id = ?').get(s.id)).n, 2);
});

test('historique : fenêtre 30/90 jours et semaines du lundi au dimanche (heure de Paris)', async () => {
  const s = await setup();
  const at = ts('2026-10-21T12:00:00Z'); // mercredi
  for (const day of ['2026-08-01', '2026-09-25', '2026-10-20']) await s.db.prepare('INSERT INTO metrics_daily VALUES(?, ?, 1, 1, 1)').run(s.id, day);
  assert.deepEqual((await history(s.db, s.id, { days: 30, at })).daily.map((d) => d.day), ['2026-09-25', '2026-10-20']);
  assert.equal((await history(s.db, s.id, { days: 90, at })).daily.length, 3);

  const log = (iso, kind = 'initial', error = null) => s.db.prepare('INSERT INTO mail_log(project_id, email, sent_at, kind, error) VALUES(?, ?, ?, ?, ?)').run(s.id, 'x@y.fr', ts(iso), kind, error);
  log('2026-10-19T00:30:00+02:00');           // lundi 0h30 Paris = dimanche UTC : semaine du 19
  log('2026-10-18T23:30:00+02:00');           // dimanche soir : semaine du 12
  log('2026-10-20T10:00:00+02:00');
  log('2026-10-20T10:00:00+02:00', 'followup'); // les relances ne comptent pas comme premiers mails
  log('2026-10-20T10:00:00+02:00', 'initial', '550'); // ni les échecs
  await s.db.prepare('INSERT INTO prospects(project_id, company, email, replied_at, created_at) VALUES(?, ?, ?, ?, ?)').run(s.id, 'A', 'a@a.fr', ts('2026-10-21T09:00:00+02:00'), at);
  const w = (await history(s.db, s.id, { days: 30, at })).weeks;
  assert.equal(w.length, 5);
  assert.equal(w.at(-1).start, '2026-10-19');
  assert.deepEqual(w.slice(-2).map((x) => [x.start, x.sent, x.replies]), [['2026-10-12', 1, 0], ['2026-10-19', 2, 1]]);
});
