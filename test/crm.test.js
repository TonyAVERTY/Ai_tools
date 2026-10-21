import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, now } from '../src/db.js';
import { parseFilters, listProspects } from '../src/services/crm.js';

function setup() {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO projects(name, git_url, created_at) VALUES('A', 'a', ?), ('B', 'b', ?)").run(now(), now());
  const add = (project, company, email, o = {}) => db.prepare(`INSERT INTO prospects(project_id, company, email, city, sector, score, status, sent_at, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(project, company, email, o.city ?? 'Rennes', o.sector ?? 'boulangerie', o.score ?? 5, o.status ?? 'new', o.sent ?? null, o.created ?? now());
  add(1, 'Le Fournil', 'contact@fournil.fr', { score: 9, status: 'replied', sent: now() - 100 });
  add(1, 'Coiffure Zen', 'hello@zen.fr', { city: 'Vern-sur-Seiche', sector: 'coiffeur', score: 6, status: 'sent', sent: now() - 50 });
  add(1, 'Fleurs & Co', 'bonjour@fleurs.fr', { sector: 'fleuriste', score: 3, created: now() - 1000 });
  add(1, '100% Bio', 'bio@100pourcent.fr', { score: 7 });
  add(2, 'Le Fournil', 'contact@fournil.fr', { score: 10 });
  return db;
}
const f = (o = {}) => parseFilters(new URLSearchParams(o));
const names = (r) => r.rows.map((x) => x.company);

test('parseFilters ignore tout ce qui n\'est pas prévu', () => {
  assert.deepEqual(f({ status: 'drop table', sort: 'id; --', minScore: '99', page: '-3', q: '  zen  ' }),
    { q: 'zen', status: '', minScore: 10, sort: 'score', page: 1 });
});

test('recherche, filtres, tri, et isolation entre projets', () => {
  const db = setup();
  assert.deepEqual(names(listProspects(db, 1, f())), ['Le Fournil', '100% Bio', 'Coiffure Zen', 'Fleurs & Co'], 'tri par score');
  assert.deepEqual(names(listProspects(db, 1, f({ q: 'ZEN' }))), ['Coiffure Zen'], 'insensible à la casse');
  assert.deepEqual(names(listProspects(db, 1, f({ q: 'vern' }))), ['Coiffure Zen'], 'par ville');
  assert.deepEqual(names(listProspects(db, 1, f({ q: 'fleuriste' }))), ['Fleurs & Co'], 'par secteur');
  assert.deepEqual(names(listProspects(db, 1, f({ q: '100%' }))), ['100% Bio'], '% littéral, pas un joker');
  assert.deepEqual(names(listProspects(db, 1, f({ q: '_' }))), [], '_ littéral, pas un joker');
  assert.deepEqual(names(listProspects(db, 1, f({ status: 'sent' }))), ['Coiffure Zen']);
  assert.deepEqual(names(listProspects(db, 1, f({ minScore: '7' }))), ['Le Fournil', '100% Bio']);
  assert.deepEqual(names(listProspects(db, 1, f({ sort: 'company' }))), ['100% Bio', 'Coiffure Zen', 'Fleurs & Co', 'Le Fournil']);
  assert.deepEqual(names(listProspects(db, 1, f({ sort: 'contacted' }))).slice(0, 2), ['Coiffure Zen', 'Le Fournil']);
  assert.equal(listProspects(db, 2, f()).total, 1, 'jamais les prospects d\'un autre projet');
});

test('pagination', () => {
  const db = setup();
  for (let i = 0; i < 250; i++) db.prepare("INSERT INTO prospects(project_id, company, email, score, created_at) VALUES(1, ?, ?, 1, ?)").run(`E${i}`, `e${i}@x.fr`, now());
  const p1 = listProspects(db, 1, f());
  assert.deepEqual({ total: p1.total, pages: p1.pages, n: p1.rows.length }, { total: 254, pages: 3, n: 100 });
  const p3 = listProspects(db, 1, f({ page: '3' }));
  assert.equal(p3.rows.length, 54);
  assert.equal(listProspects(db, 1, f({ page: '99' })).page, 3, 'page trop grande ramenée à la dernière');
  const ids = new Set([...p1.rows, ...listProspects(db, 1, f({ page: '2' })).rows, ...p3.rows].map((x) => x.id));
  assert.equal(ids.size, 254, 'aucun doublon ni trou entre les pages');
});
