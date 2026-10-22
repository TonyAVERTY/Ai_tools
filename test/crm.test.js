import { test } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { addUser } from './helpers/users.js';
import { parseFilters, listProspects } from '../src/services/crm.js';

async function setup() {
  const db = await testDb();
  const u = await addUser(db);
  await db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'A', 'a', ?), (?, 'B', 'b', ?)").run(u, now(), u, now());
  const add = (project, company, email, o = {}) => db.prepare(`INSERT INTO prospects(project_id, company, email, city, sector, score, status, sent_at, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(project, company, email, o.city ?? 'Rennes', o.sector ?? 'boulangerie', o.score ?? 5, o.status ?? 'new', o.sent ?? null, o.created ?? now());
  await add(1, 'Le Fournil', 'contact@fournil.fr', { score: 9, status: 'replied', sent: now() - 100 });
  await add(1, 'Coiffure Zen', 'hello@zen.fr', { city: 'Vern-sur-Seiche', sector: 'coiffeur', score: 6, status: 'sent', sent: now() - 50 });
  await add(1, 'Fleurs & Co', 'bonjour@fleurs.fr', { sector: 'fleuriste', score: 3, created: now() - 1000 });
  await add(1, '100% Bio', 'bio@100pourcent.fr', { score: 7 });
  await add(2, 'Le Fournil', 'contact@fournil.fr', { score: 10 });
  return db;
}
const f = (o = {}) => parseFilters(new URLSearchParams(o));
const names = (r) => r.rows.map((x) => x.company);

test('parseFilters ignore tout ce qui n\'est pas prévu', () => {
  assert.deepEqual(f({ status: 'drop table', sort: 'id; --', minScore: '99', page: '-3', q: '  zen  ' }),
    { q: 'zen', status: '', minScore: 10, sort: 'score', todo: false, page: 1 });
});

test('recherche, filtres, tri, et isolation entre projets', async () => {
  const db = await setup();
  assert.deepEqual(names(await listProspects(db, 1, f())), ['Le Fournil', '100% Bio', 'Coiffure Zen', 'Fleurs & Co'], 'tri par score');
  assert.deepEqual(names(await listProspects(db, 1, f({ q: 'ZEN' }))), ['Coiffure Zen'], 'insensible à la casse');
  assert.deepEqual(names(await listProspects(db, 1, f({ q: 'vern' }))), ['Coiffure Zen'], 'par ville');
  assert.deepEqual(names(await listProspects(db, 1, f({ q: 'fleuriste' }))), ['Fleurs & Co'], 'par secteur');
  assert.deepEqual(names(await listProspects(db, 1, f({ q: '100%' }))), ['100% Bio'], '% littéral, pas un joker');
  assert.deepEqual(names(await listProspects(db, 1, f({ q: '_' }))), [], '_ littéral, pas un joker');
  assert.deepEqual(names(await listProspects(db, 1, f({ status: 'sent' }))), ['Coiffure Zen']);
  assert.deepEqual(names(await listProspects(db, 1, f({ minScore: '7' }))), ['Le Fournil', '100% Bio']);
  assert.deepEqual(names(await listProspects(db, 1, f({ sort: 'company' }))), ['100% Bio', 'Coiffure Zen', 'Fleurs & Co', 'Le Fournil']);
  assert.deepEqual(names(await listProspects(db, 1, f({ sort: 'contacted' }))).slice(0, 2), ['Coiffure Zen', 'Le Fournil']);
  assert.equal((await listProspects(db, 2, f())).total, 1, 'jamais les prospects d\'un autre projet');
});

test('pagination', async () => {
  const db = await setup();
  for (let i = 0; i < 250; i++) await db.prepare("INSERT INTO prospects(project_id, company, email, score, created_at) VALUES(1, ?, ?, 1, ?)").run(`E${i}`, `e${i}@x.fr`, now());
  const p1 = await listProspects(db, 1, f());
  assert.deepEqual({ total: p1.total, pages: p1.pages, n: p1.rows.length }, { total: 254, pages: 3, n: 100 });
  const p3 = await listProspects(db, 1, f({ page: '3' }));
  assert.equal(p3.rows.length, 54);
  assert.equal((await listProspects(db, 1, f({ page: '99' }))).page, 3, 'page trop grande ramenée à la dernière');
  const ids = new Set([...p1.rows, ...(await listProspects(db, 1, f({ page: '2' }))).rows, ...p3.rows].map((x) => x.id));
  assert.equal(ids.size, 254, 'aucun doublon ni trou entre les pages');
});

test('fiche : historique des mails, réponse, opposition', async () => {
  const { prospectDetail } = await import('../src/services/crm.js');
  const db = await setup();
  await db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, variant, subject) VALUES(1, 1, 'contact@fournil.fr', 100, 'initial', 'B', 'Objet B')").run();
  await db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, subject, error) VALUES(1, 1, 'contact@fournil.fr', 200, 'followup', 'Re: Objet B', '421 retry')").run();
  await db.prepare("INSERT INTO blacklist(email, reason, created_at) VALUES('contact@fournil.fr', 'unsubscribe', 300)").run();
  const d = await prospectDetail(db, 1);
  assert.equal(d.prospect.company, 'Le Fournil');
  assert.deepEqual(d.mails.map((m) => [m.kind, m.variant, m.error]), [['initial', 'B', null], ['followup', null, '421 retry']]);
  assert.equal(d.optOut.reason, 'unsubscribe');
  assert.equal(await prospectDetail(db, 999), null);
});

test('notes : ajout, ordre, suppression limitée au bon prospect', async () => {
  const { addNote, deleteNote, prospectDetail } = await import('../src/services/crm.js');
  const db = await setup();
  assert.equal(await addNote(db, 1, '   '), null, 'note vide refusée');
  const n1 = await addNote(db, 1, 'A rappelé, intéressé');
  const n2 = await addNote(db, 1, 'x'.repeat(5000));
  assert.equal((await prospectDetail(db, 1)).notes[0].id, n2, 'plus récente en premier');
  assert.equal((await prospectDetail(db, 1)).notes[0].body.length, 2000, 'tronquée à 2000');
  assert.equal(await deleteNote(db, 2, n1), false, 'pas la note d\'un autre prospect');
  assert.equal(await deleteNote(db, 1, n1), true);
  await db.prepare('DELETE FROM prospects WHERE id = 1').run();
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM prospect_notes').get()).n, 0, 'supprimées avec le prospect');
});

test('prochaine action : 9h heure de Paris, dates impossibles refusées, filtre "à faire"', async () => {
  const { setNextAction } = await import('../src/services/crm.js');
  const db = await setup();
  assert.equal(await setNextAction(db, 1, 'Rappeler', '2026-07-14'), Date.parse('2026-07-14T07:00:00Z') / 1000, 'été');
  assert.equal(await setNextAction(db, 2, 'Devis', '2026-12-01'), Date.parse('2026-12-01T08:00:00Z') / 1000, 'hiver');
  await assert.rejects(setNextAction(db, 1, 'x', '2026-02-31'), /Date invalide/);
  await assert.rejects(setNextAction(db, 1, 'x', '14/07/2026'), /AAAA-MM-JJ/);
  const todo = async (at) => names(await listProspects(db, 1, { ...f({ todo: '1' }), at }));
  assert.deepEqual(await todo(Date.parse('2026-08-01T00:00:00Z') / 1000), ['Le Fournil'], 'seule l\'action échue');
  assert.deepEqual(await todo(Date.parse('2027-01-01T00:00:00Z') / 1000), ['Le Fournil', 'Coiffure Zen']);
  assert.equal(await setNextAction(db, 1, '', ''), null);
  assert.deepEqual(await todo(Date.parse('2027-01-01T00:00:00Z') / 1000), ['Coiffure Zen'], 'action effacée');
});
