import { test } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { addUser } from './helpers/users.js';
import { csvCell, toCsv, parseCsv, exportProspects, importProspects } from '../src/services/csv.js';
import { parseFilters } from '../src/services/crm.js';

const f = (o = {}) => parseFilters(new URLSearchParams(o));
async function setup() {
  const db = await testDb();
  const u = await addUser(db);
  await db.prepare("INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, 'A', 'a', ?), (?, 'B', 'b', ?)").run(u, now(), u, now());
  return db;
}

test('cellules : guillemets, ; et retours à la ligne échappés, formules neutralisées', () => {
  assert.equal(csvCell('Le "Fournil"; Rennes'), '"Le ""Fournil""; Rennes"');
  assert.equal(csvCell('ligne 1\nligne 2'), '"ligne 1\nligne 2"');
  assert.equal(csvCell('=HYPERLINK("http://evil","clic")'), '"\'=HYPERLINK(""http://evil"",""clic"")"');
  for (const s of ['+33612', '-2+3', '@SUM(A1)']) assert.equal(csvCell(s)[0] === '"' ? csvCell(s)[1] : csvCell(s)[0], "'", s);
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(7), '7');
  assert.ok(toCsv(['a'], [['b']]).startsWith('﻿a\r\nb'), 'BOM + CRLF pour Excel');
});

test('parseCsv : séparateur détecté, guillemets, retours à la ligne, BOM, lignes vides', () => {
  assert.deepEqual(parseCsv('﻿a;b\r\n1;"x;y"\r\n\r\n2;"multi\nligne ""ok"""\n'), [['a', 'b'], ['1', 'x;y'], ['2', 'multi\nligne "ok"']]);
  assert.deepEqual(parseCsv('email,company\nx@y.fr,"Dupont, fils"'), [['email', 'company'], ['x@y.fr', 'Dupont, fils']]);
  assert.deepEqual(parseCsv('email\tville\nx@y.fr\tBrest'), [['email', 'ville'], ['x@y.fr', 'Brest']]);
});

test('import : en-têtes souples, doublons, opposition, invalides, origine RGPD', async () => {
  const db = await setup();
  await db.prepare("INSERT INTO prospects(project_id, company, email, created_at) VALUES(1, 'Déjà', 'deja@la.fr', ?)").run(now());
  await db.prepare("INSERT INTO blacklist(email, reason, created_at) VALUES('stop@moi.fr', 'unsubscribe', ?)").run(now());
  const csv = [
    'Raison sociale;E-mail;Site web;Commune;Activité;Note;Origine',
    'Crêperie Ty Breizh;Contact@TyBreizh.bzh;https://tybreizh.bzh;Quimper;crêperie;8;annuaire CCI',
    ';sans-nom@atelier.fr;javascript:alert(1);;;;',
    'Déjà;deja@la.fr;;;;;',
    'Doublon;contact@tybreizh.bzh;;;;;',
    'Stop;stop@moi.fr;;;;;',
    'Cassé;pas-un-email;;;;;',
    "Formule;f@x.fr;;'=1+1;;99;",
  ].join('\r\n');
  const r = await importProspects(db, 1, csv, { at: Date.parse('2026-10-21T10:00:00Z') / 1000 });
  assert.deepEqual({ ...r, invalid: r.invalid.map((x) => x.line) }, { total: 7, imported: 3, skipped: 3, invalid: [7] });
  const get = async (email) => db.prepare('SELECT * FROM prospects WHERE project_id = 1 AND email = ?').get(email);
  const ty = await get('contact@tybreizh.bzh');
  assert.deepEqual([ty.company, ty.website, ty.city, ty.sector, ty.score, ty.source, ty.status], ['Crêperie Ty Breizh', 'https://tybreizh.bzh', 'Quimper', 'crêperie', 8, 'annuaire CCI', 'new']);
  const sn = await get('sans-nom@atelier.fr');
  assert.equal(sn.company, 'atelier.fr', 'nom déduit du domaine');
  assert.equal(sn.website, null, 'javascript: rejeté');
  assert.equal(sn.source, 'Import CSV du 21/10/2026', 'origine toujours renseignée');
  assert.equal((await get('f@x.fr')).city, '=1+1', 'apostrophe de notre export retirée');
  assert.equal((await get('f@x.fr')).score, 10, 'score borné');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM prospects WHERE project_id = 2').get()).n, 0, 'rien dans l\'autre projet');
});

test('import : erreurs claires', async () => {
  const db = await setup();
  await assert.rejects(importProspects(db, 1, 'email\n'), /vide ou sans en-tête/);
  await assert.rejects(importProspects(db, 1, 'nom;ville\nA;B'), /Colonne email introuvable/);
  await assert.rejects(importProspects(db, 1, 'email\n' + 'a@b.fr\n'.repeat(2001)), /Maximum 2000 lignes/);
});

test('export puis réimport dans un autre projet : aller-retour sans perte', async () => {
  const db = await setup();
  await db.prepare(`INSERT INTO prospects(project_id, company, email, website, city, sector, score, status, source, hook, created_at)
    VALUES(1, 'Le "Fournil"; SARL', 'c@fournil.fr', 'https://fournil.fr', 'Rennes', 'boulangerie', 9, 'replied', 'https://fournil.fr/contact', '=Votre pain mérite mieux', ?)`).run(now());
  await db.prepare("INSERT INTO prospects(project_id, company, email, score, status, created_at) VALUES(1, 'Zen', 'z@zen.fr', 4, 'new', ?)").run(now());
  const all = await exportProspects(db, 1, f());
  assert.match(all, /^﻿Entreprise;Email;Site/);
  assert.match(all, /"Le ""Fournil""; SARL";c@fournil\.fr/);
  assert.match(all, /'=Votre pain/, 'formule neutralisée');
  assert.match(all, /;A répondu;/, 'statut lisible');
  assert.equal((await exportProspects(db, 1, f({ minScore: '5' }))).trim().split('\r\n').length, 2, 'l\'export suit les filtres');
  const r = await importProspects(db, 2, all);
  assert.equal(r.imported, 2);
  const back = await db.prepare("SELECT company, website, source, hook, score FROM prospects WHERE project_id = 2 AND email = 'c@fournil.fr'").get();
  assert.deepEqual({ ...back }, { company: 'Le "Fournil"; SARL', website: 'https://fournil.fr', source: 'https://fournil.fr/contact', hook: '=Votre pain mérite mieux', score: 9 });
});
