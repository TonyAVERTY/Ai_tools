import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parisParts, parisTime, nextNightSlot, addParisDays } from '../src/services/paris-time.js';
import { now } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { addUser } from './helpers/users.js';
import { enqueue, Worker, latestJobs } from '../src/services/jobs.js';

const iso = (d) => d.toISOString();

test('parisParts / parisTime : aller-retour, été comme hiver', () => {
  assert.deepEqual(parisParts(new Date('2026-10-21T13:34:00Z')), { year: 2026, month: 10, day: 21, hour: 15, minute: 34, weekday: 'Wed' });
  assert.equal(iso(parisTime(2026, 7, 14, 9)), '2026-07-14T07:00:00.000Z', 'été : UTC+2');
  assert.equal(iso(parisTime(2026, 12, 25, 9)), '2026-12-25T08:00:00.000Z', 'hiver : UTC+1');
  assert.deepEqual(addParisDays(new Date('2026-12-31T22:00:00Z'), 1), { year: 2027, month: 1, day: 1 }, 'passage d\'année');
});

test('prochain créneau de nuit (1h-6h Paris)', () => {
  const at = (s) => iso(nextNightSlot(new Date(s)));
  assert.equal(at('2026-10-21T15:30:00+02:00'), '2026-10-21T23:00:00.000Z', 'après-midi → 1h le lendemain');
  assert.equal(at('2026-10-22T00:30:00+02:00'), '2026-10-21T23:00:00.000Z', '0h30 → 1h le même jour');
  assert.equal(at('2026-10-22T03:00:00+02:00'), '2026-10-22T01:00:00.000Z', 'déjà dans le créneau → tout de suite');
  assert.equal(at('2026-10-22T06:00:00+02:00'), '2026-10-22T23:00:00.000Z', '6h pile → nuit suivante');
  assert.equal(at('2026-10-24T22:00:00+02:00'), '2026-10-24T23:00:00.000Z', 'nuit du passage à l\'heure d\'hiver');
  assert.equal(at('2027-03-27T20:00:00+01:00'), '2027-03-28T00:00:00.000Z', 'nuit du passage à l\'heure d\'été');
  assert.equal(at('2026-12-31T23:59:00+01:00'), '2027-01-01T00:00:00.000Z', 'Saint-Sylvestre');
});

test('le worker ne démarre pas un job programmé avant son heure', async () => {
  const db = await testDb();
  let clock = now();
  const ran = [];
  const w = new Worker(db, { prospect: async () => { ran.push('prospect'); }, evolution: async () => { ran.push('evolution'); } },
    { log: { error() {} }, clock: () => clock });
  const u = await addUser(db);
  await db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'p', 'u', ?)").run(u, now());
  await enqueue(db, { userId: u, projectId: 1, type: 'prospect', runAfter: clock + 3600 });
  await enqueue(db, { userId: u, projectId: 1, type: 'evolution' });
  assert.equal(await w.tick(), true);
  assert.deepEqual(ran, ['evolution'], 'le job immédiat passe devant le job programmé');
  assert.equal(await w.tick(), false, 'rien à faire avant l\'heure');
  assert.equal((await latestJobs(db, 1)).prospect.runAfter, clock + 3600);
  clock += 3601;
  assert.equal(await w.tick(), true);
  assert.deepEqual(ran, ['evolution', 'prospect']);
});
