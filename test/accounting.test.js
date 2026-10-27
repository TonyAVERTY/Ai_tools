// Comptabilité : calculs (montants, TVA, périodes, totaux, déclaration, alertes), journal CSV, archive ZIP, puis la page et ses routes
// (ligne avec justificatif obligatoire, types de fichiers, isolation entre comptes, exports, suppression des pièces).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { startApp, APP_URL } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import {
  parseAmountCents, vatOf, fmtEur, periodRange, periodToDeclare, recentPeriods, deadlineOf, daysLeft, validateEntry, EntryError, computeTotals, rowsInRange,
  declarationGuide, computeAlerts, normalizeSettings, buildCsv, csvCell, exportFileName, validDate, REFERENCE,
} from '../src/services/accounting.js';
import { writeZip, readZip, zipName } from '../src/services/zip.js';
import { userAccountingRoot, deleteUser } from '../src/users.js';

const row = (o) => ({ id: 1, kind: 'payment_in', entry_date: '2026-03-10', label: 'Facture', party: '', category: 'service', amount_cents: 12000, vat_rate: 0, vat_cents: 0, method: 'transfer', project_name: '', doc_mime: 'application/pdf', ...o });

test('montants : saisie souple, centimes entiers, rien d\'absurde', () => {
  assert.equal(parseAmountCents('49,90'), 4990);
  assert.equal(parseAmountCents('1 234,5 €'), 123450);
  assert.equal(parseAmountCents('12'), 1200);
  assert.equal(parseAmountCents('12.345'), null);
  for (const bad of ['', '0', '-5', 'abc', '1e5', '12,3,4']) assert.equal(parseAmountCents(bad), null, bad);
  assert.equal(vatOf(12000, 2000), 2000, '120 € TTC à 20 % = 20 € de TVA');
  assert.equal(vatOf(1100, 1000), 100);
  assert.equal(vatOf(5000, 0), 0);
  assert.match(fmtEur(123450), /1\s234,50\s€/);
});

test('périodes : mois, trimestres, année, échéances et période à déclarer', () => {
  assert.deepEqual([periodRange('2026-Q3').from, periodRange('2026-Q3').to], ['2026-07-01', '2026-10-01']);
  assert.deepEqual([periodRange('2026-12').from, periodRange('2026-12').to], ['2026-12-01', '2027-01-01']);
  assert.equal(periodRange('2026-13'), null);
  assert.equal(periodRange('abc'), null);
  assert.equal(periodToDeclare('quarterly', '2026-10-27'), '2026-Q3');
  assert.equal(periodToDeclare('quarterly', '2026-01-05'), '2025-Q4');
  assert.equal(periodToDeclare('monthly', '2026-01-05'), '2025-12');
  assert.deepEqual(recentPeriods('quarterly', '2026-10-27', 3), ['2026-Q4', '2026-Q3', '2026-Q2']);
  // URSSAF : fin du mois suivant ; fin du mois qui suit le trimestre
  assert.equal(deadlineOf('2026-10'), '2026-11-30');
  assert.equal(deadlineOf('2026-Q3'), '2026-10-31');
  assert.equal(deadlineOf('2026-Q4'), '2027-01-31');
  assert.equal(deadlineOf('2026-01'), '2026-02-28');
  assert.equal(deadlineOf('2026-Q3', 'reel'), '2026-10-24');
  assert.equal(daysLeft('2026-10-31', '2026-10-27'), 4);
  assert.ok(validDate('2026-02-28') && !validDate('2026-02-30') && !validDate('1999-01-01'));
});

test('validation d\'une ligne : type, date, montant, catégorie, TVA', () => {
  const ok = { kind: 'payment_in', date: '2026-03-10', label: ' Facture 12 ', amount: '120', vatRate: 2000, method: 'card' };
  const v = validateEntry(ok, { today: '2026-03-10' });
  assert.deepEqual([v.label, v.amount, v.vat, v.vatRate, v.category, v.method], ['Facture 12', 12000, 2000, 2000, 'service', 'card']);
  assert.equal(validateEntry(ok, { today: '2026-03-10', vatMode: 'franchise' }).vat, 0, 'en franchise de TVA, la TVA est toujours nulle');
  assert.equal(validateEntry({ ...ok, kind: 'social_tax', category: 'social' }, { today: '2026-03-10' }).vat, 0, 'pas de TVA sur une cotisation');
  const bad = (o, re) => assert.throws(() => validateEntry({ ...ok, ...o }, { today: '2026-03-10' }), (e) => e instanceof EntryError && re.test(e.message));
  bad({ kind: 'x' }, /type/);
  bad({ date: '2026-03-11' }, /futur/);
  bad({ date: 'hier' }, /date/);
  bad({ label: '   ' }, /libellé/);
  bad({ amount: '0' }, /montant/);
  bad({ category: 'software' }, /catégorie/);
  bad({ vatRate: 1234 }, /TVA/);
  bad({ method: 'bitcoin' }, /paiement/);
});

test('totaux : encaissé, dépensé, remboursements, cotisations ; les apports et retraits n\'entrent pas dans le chiffre d\'affaires', () => {
  const rows = [
    row({ kind: 'payment_in', amount_cents: 120000, vat_cents: 20000 }),
    row({ id: 2, kind: 'refund_out', amount_cents: 12000, vat_cents: 2000 }),
    row({ id: 3, kind: 'expense', category: 'software', amount_cents: 6000, vat_cents: 1000 }),
    row({ id: 4, kind: 'refund_in', category: 'software', amount_cents: 1200, vat_cents: 200 }),
    row({ id: 5, kind: 'social_tax', category: 'social', amount_cents: 20000 }),
    row({ id: 6, kind: 'social_tax', category: 'vat_paid', amount_cents: 5000 }),
    row({ id: 7, kind: 'owner_in', category: 'loan', amount_cents: 99999 }),
    row({ id: 8, kind: 'owner_out', category: 'withdrawal', amount_cents: 1000 }),
  ];
  const t = computeTotals(rows);
  assert.equal(t.revenue, 108000, 'paiements reçus − remboursements versés');
  assert.equal(t.expenses, 4800, 'dépenses − remboursements reçus');
  assert.equal(t.taxes, 25000);
  assert.equal(t.owner, 98999);
  assert.equal(t.result, 108000 - 4800 - 25000);
  const h = computeTotals(rows, { assujetti: true });
  assert.equal(h.vatCollected, 18000);
  assert.equal(h.vatDeductible, 800);
  assert.equal(h.vatDue, 17200, 'TVA collectée − TVA déductible');
  assert.equal(h.revenue, 90000, 'hors TVA');
  assert.equal(h.taxes, 20000, 'la TVA payée n\'est pas une charge');
  assert.equal(rowsInRange(rows, '2026-04-01', '2026-05-01').length, 0);
  assert.equal(rowsInRange(rows, '2026-03-01', '2026-04-01').length, 8);
});

test('guide de déclaration : micro (URSSAF, bonne case), réel (TVA), situation inconnue ; jamais un montant inventé', () => {
  const totals = computeTotals([row({ amount_cents: 250000 }), row({ id: 2, kind: 'expense', category: 'software', amount_cents: 9900 })]);
  const micro = declarationGuide({ settings: normalizeSettings({ regime: 'micro', activity: 'services', vat: 'franchise', freq: 'quarterly' }), period: '2026-Q1', totals });
  assert.match(micro.where.url, /autoentrepreneur\.urssaf\.fr/);
  assert.equal(micro.amounts.length, 1);
  assert.match(micro.amounts[0].label, /prestations de services \(BIC\)/);
  assert.equal(micro.amounts[0].raw, '2500,00', 'seulement les paiements reçus : les dépenses ne se déduisent pas');
  assert.equal(micro.deadline, '2026-04-30');
  assert.ok(micro.steps.length >= 5);
  const lib = declarationGuide({ settings: normalizeSettings({ regime: 'micro', activity: 'liberal', vat: 'franchise' }), period: '2026-Q1', totals });
  assert.match(lib.amounts[0].label, /BNC/);
  const goods = declarationGuide({ settings: normalizeSettings({ regime: 'micro', activity: 'goods', vat: 'franchise' }), period: '2026-Q1', totals });
  assert.match(goods.amounts[0].label, /marchandises/);
  const zero = declarationGuide({ settings: normalizeSettings({ regime: 'micro', activity: 'services', vat: 'franchise' }), period: '2026-Q1', totals: computeTotals([]) });
  assert.equal(zero.amounts[0].raw, '0,00');
  assert.ok(zero.notes.some((n) => /0 €/.test(n)), 'déclarer 0 € quand rien n\'est encaissé');
  const reel = declarationGuide({ settings: normalizeSettings({ regime: 'reel', activity: 'services', vat: 'assujetti', freq: 'monthly' }), period: '2026-03', totals: computeTotals([row({ amount_cents: 12000, vat_cents: 2000 })], { assujetti: true }) });
  assert.match(reel.where.url, /impots\.gouv\.fr/);
  assert.deepEqual(reel.amounts.map((a) => a.raw), ['100,00', '20,00', '0,00', '20,00']);
  const unknown = declarationGuide({ settings: normalizeSettings({ regime: 'unknown' }), period: '2026-Q1', totals });
  assert.equal(unknown.where, null);
  assert.equal(unknown.amounts.length, 0);
});

test('points d\'attention : échéance, plafonds (valeurs de référence), doublons', () => {
  const settings = normalizeSettings({ regime: 'micro', activity: 'services', vat: 'franchise', freq: 'quarterly' });
  const a = computeAlerts({ rows: [], settings, today: '2026-10-27' });
  assert.equal(a[0].code, 'declaration');
  assert.match(a[0].text, /3e trimestre 2026/);
  assert.equal(a[0].level, 'warn', 'moins de 7 jours');
  assert.equal(computeAlerts({ rows: [], settings, today: '2026-11-05' })[0].level, 'err', 'échéance dépassée');
  assert.equal(computeAlerts({ rows: [], settings, today: '2026-10-27', done: new Set(['2026-Q3']) }).length, 0);
  const big = [row({ amount_cents: REFERENCE.microCeiling.services * 100 * 0.85, entry_date: '2026-02-01' })];
  const ceil = computeAlerts({ rows: big, settings, today: '2026-10-27', done: new Set(['2026-Q3']) });
  assert.ok(ceil.some((x) => x.code === 'ceiling' && /valeur de référence/.test(x.text)));
  assert.ok(ceil.some((x) => x.code === 'vat'), 'seuil de la franchise de TVA');
  const dup = computeAlerts({ rows: [row(), row({ id: 2 })], settings: normalizeSettings({}), today: '2026-10-27' });
  assert.ok(dup.some((x) => x.code === 'duplicate'));
});

test('journal CSV : séparateur « ; », virgule décimale, sorties négatives, jamais de formule exécutée', () => {
  assert.equal(csvCell('=SOMME(A1)'), "'=SOMME(A1)");
  assert.equal(csvCell('+33 6 12'), "'+33 6 12");
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell('il a dit "oui"'), '"il a dit ""oui"""');
  const csv = buildCsv([row({ label: '=HYPERLINK("x")', vat_rate: 2000, vat_cents: 2000 }), row({ id: 2, kind: 'expense', category: 'software', amount_cents: 599, project_name: 'Alpha' })]);
  assert.ok(csv.startsWith('﻿Date;Projet;Type;'));
  const lines = csv.trim().split('\r\n');
  assert.match(lines[1], /;"'=HYPERLINK\(""x""\)";/);
  assert.match(lines[1], /;120,00;20 %;20,00;100,00;/);
  assert.match(lines[2], /;Alpha;Dépense;.*;-5,99;;0,00;-5,99;/);
  assert.equal(exportFileName(row({ id: 9, label: 'Café é!' })), '2026-03-10_9_cafe-e.pdf');
});

test('archive ZIP : relue sans perte, noms sûrs, UTF-8', async () => {
  assert.equal(zipName('../../etc/passwd'), 'etc/passwd');
  assert.equal(zipName('a\\b/../c'), 'a/b/c');
  const out = new PassThrough();
  const chunks = [];
  out.on('data', (c) => chunks.push(c));
  const big = Buffer.alloc(200_000, 7);
  const n = await writeZip(out, [{ name: 'Projet é/justificatifs/a.pdf', read: () => Buffer.from('%PDF-1.4 contenu') }, { name: 'gros.bin', read: () => big }, { name: 'vide.txt', read: () => Buffer.alloc(0) }]);
  out.end();
  assert.equal(n, 3);
  const files = readZip(Buffer.concat(chunks));
  assert.deepEqual(files.map((f) => f.name), ['Projet é/justificatifs/a.pdf', 'gros.bin', 'vide.txt']);
  assert.equal(files[0].data.toString(), '%PDF-1.4 contenu');
  assert.ok(files[1].data.equals(big));
});

// ---------- Page et routes ----------

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
const fields = (o = {}) => ({ kind: 'payment_in', date: today(), label: 'Facture 2026-001', party: 'Client SA', amount: '120', vatRate: 0, method: 'transfer', ...o });
const create = (u, body, f = fields(), { name = 'facture.pdf', type = 'application/pdf' } = {}) => fetch(`${s.base}/api/compta/entries`, {
  method: 'POST', body, headers: { cookie: u.cookie, origin: APP_URL, 'content-type': type, 'x-file-name': encodeURIComponent(name), 'x-entry': encodeURIComponent(JSON.stringify(f)), accept: 'application/json' },
});
// La page n'affiche d'abord que les questions de la situation : on les remplit pour voir le reste
const situation = (u, o = {}) => u.post('/compta/situation', { regime: 'micro', activity: 'services', vat: 'franchise', freq: 'quarterly', ...o }, { form: true });
const page = (u, p = '/compta') => u.get(p, { headers: { accept: 'text/html' } }).then((r) => r.text());

test('la page s\'ouvre pour un compte connecté seulement : d\'abord les questions seules, puis tout le contenu', async () => {
  assert.equal((await s.anon.get('/compta', { headers: { accept: 'text/html' } })).status, 303);
  const u = await s.newUser();
  let h = await page(u);
  assert.match(h, /Comptabilité : dis-nous où tu en es/);
  assert.match(h, /Question 1 sur 4/);
  for (const absent of [/Ajouter une ligne/, /href="\/compta\?declarer/, /Tes chiffres/, /Journal des lignes/, /Questions fréquentes/, /data-compta-dlg/]) assert.doesNotMatch(h, absent, `${absent} : caché tant que la situation n'est pas donnée`);
  assert.equal((await situation(u)).status, 303);
  h = await page(u);
  assert.match(h, /<h1>Comptabilité<\/h1>/);
  assert.doesNotMatch(h, /dis-nous où tu en es/);
  for (const present of [/Ajouter une ligne/, /Faire ma déclaration/, /Tes chiffres/, /Journal des lignes/, /Questions fréquentes/, /Aucune ligne pour l'instant/]) assert.match(h, present);
  assert.doesNotMatch(h, /href="\/compta\/export/, 'rien à exporter sans ligne');
  assert.match(h, /Comptabilité<\/a>/, 'dans la barre du haut');
});

test('une ligne exige un justificatif (PDF ou image reconnu à sa signature)', async () => {
  const u = await s.newUser();
  let r = await fetch(`${s.base}/api/compta/entries`, { method: 'POST', headers: { cookie: u.cookie, origin: APP_URL, 'x-entry': encodeURIComponent(JSON.stringify(fields())) } });
  assert.equal(r.status, 411, 'sans fichier');
  r = await create(u, Buffer.from('juste du texte'), fields(), { name: 'facture.pdf', type: 'application/pdf' });
  assert.equal(r.status, 415, 'un nom en .pdf ne suffit pas');
  r = await create(u, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]), fields(), { name: 'x.png', type: 'image/png' });
  assert.equal(r.status, 415);
  r = await create(u, PDF, fields({ amount: 'abc' }));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /montant/);
  r = await create(u, PDF, fields({ date: '2999-01-01' }));
  assert.equal(r.status, 400);
  r = await create(u, PDF, { ...fields(), projectId: 999999 });
  assert.equal(r.status, 400, 'un projet qui n\'est pas à lui');
  assert.equal(Number((await s.db.prepare('SELECT COUNT(*) n FROM accounting_entries WHERE user_id = ?').get(u.id)).n), 0, 'aucune ligne sans justificatif valide');
  r = await create(u, PDF);
  assert.equal(r.status, 200);
  assert.equal((await create(u, PNG, fields({ label: 'Photo du ticket' }), { name: 'ticket.png', type: 'image/png' })).status, 200);
});

test('ligne enregistrée : fichier sur le disque, relu par son auteur seulement, sans exécution', async () => {
  const u = await s.newUser();
  const v = await s.newUser();
  await situation(u, { vat: 'assujetti' }); await situation(v);
  const pid = await addProject(s.db, u.id, { name: 'Alpha', gitUrl: 'https://github.com/u/a.git' });
  const r = await create(u, PDF, { ...fields({ kind: 'expense', category: 'software', label: 'Abonnement hébergement', amount: '59,90', vatRate: 2000 }), projectId: pid });
  assert.equal(r.status, 200);
  const { id } = await r.json();
  const row = await s.db.prepare('SELECT * FROM accounting_entries WHERE id = ?').get(id);
  assert.deepEqual([row.amount_cents, row.vat_cents, row.project_name, row.doc_file, row.doc_mime], [5990, 998, 'Alpha', 'justificatif.pdf', 'application/pdf']);
  assert.ok(existsSync(`${userAccountingRoot(s.app.cfg, u.id)}/${id}/justificatif.pdf`));
  const f = await u.get(`/compta/entries/${id}/file`, { headers: { accept: '*/*' } });
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('content-type'), 'application/pdf');
  assert.equal(f.headers.get('x-content-type-options'), 'nosniff');
  assert.match(f.headers.get('content-security-policy'), /sandbox/);
  assert.match(f.headers.get('content-disposition'), /^inline/);
  assert.match((await u.get(`/compta/entries/${id}/file?telecharger=1`, { headers: { accept: '*/*' } })).headers.get('content-disposition'), /^attachment/);
  assert.equal((await v.get(`/compta/entries/${id}/file`, { headers: { accept: '*/*' } })).status, 404, 'un autre compte ne voit pas la pièce');
  assert.equal((await v.post(`/api/compta/entries/${id}`, fields())).status, 404);
  assert.equal((await v.post(`/compta/entries/${id}/delete`, {}, { form: true })).status, 404);
  assert.doesNotMatch(await page(v), /Abonnement hébergement/);
  const h = await page(u);
  assert.match(h, /Abonnement hébergement/);
  assert.match(h, /59,90/);
  assert.match(h, /Alpha/);
});

test('modifier une ligne, remplacer son justificatif, puis la supprimer avec son fichier', async () => {
  const u = await s.newUser();
  const { id } = await (await create(u, PDF)).json();
  let r = await u.post(`/api/compta/entries/${id}`, fields({ label: 'Facture corrigée', amount: '150' }));
  assert.equal(r.status, 200);
  const edited = await s.db.prepare('SELECT label, amount_cents FROM accounting_entries WHERE id = ?').get(id);
  assert.deepEqual([edited.label, edited.amount_cents], ['Facture corrigée', 15000]);
  r = await fetch(`${s.base}/api/compta/entries/${id}/file`, { method: 'POST', body: PNG, headers: { cookie: u.cookie, origin: APP_URL, 'x-file-name': 'nouveau.png' } });
  assert.equal(r.status, 200);
  const dir = `${userAccountingRoot(s.app.cfg, u.id)}/${id}`;
  assert.deepEqual(readdirSync(dir), ['justificatif.png'], 'l\'ancien fichier est retiré');
  assert.equal((await s.db.prepare('SELECT doc_mime FROM accounting_entries WHERE id = ?').get(id)).doc_mime, 'image/png');
  r = await u.post(`/compta/entries/${id}/delete`, {}, { form: true });
  assert.equal(r.status, 303);
  assert.equal(existsSync(dir), false, 'le justificatif disparaît avec la ligne');
  assert.equal(await s.db.prepare('SELECT 1 FROM accounting_entries WHERE id = ?').get(id), undefined);
});

test('situation et déclaration : le bouton dit où déclarer et quoi renseigner, avec les montants de la période', async () => {
  const u = await s.newUser();
  const t = new Date();
  const y = t.getFullYear();
  // Un paiement reçu dans le trimestre précédent (calculé pour rester vrai quelle que soit la date du test)
  const q = Math.ceil((t.getMonth() + 1) / 3);
  const [py, pq] = q === 1 ? [y - 1, 4] : [y, q - 1];
  const date = `${py}-${String(pq * 3 - 1).padStart(2, '0')}-10`;
  assert.equal((await create(u, PDF, fields({ date, amount: '2500', label: 'Gros contrat' }))).status, 200);
  assert.equal((await create(u, PDF, fields({ date, kind: 'expense', category: 'software', amount: '99', label: 'Outil' }))).status, 200);
  let h = await page(u, '/compta?declarer=1#declaration');
  assert.match(h, /dis-nous où tu en es/, 'sans situation : seules les questions');
  assert.equal((await situation(u, { regime: 'unknown' })).status, 303);
  h = await page(u, '/compta?declarer=1#declaration');
  assert.match(h, /Trouver où déclarer/, '« Je ne sais pas encore » : on explique comment trouver son statut');
  const set = await situation(u);
  assert.equal(set.status, 303);
  h = await page(u, `/compta?declarer=${py}-Q${pq}#declaration`);
  assert.match(h, /autoentrepreneur\.urssaf\.fr/);
  assert.match(h, /prestations de services \(BIC\)/);
  assert.match(h, /2\s500,00\s€/, 'le montant à saisir : seulement ce qui a été encaissé');
  assert.match(h, /data-compta-copy="2500,00"/);
  assert.match(h, /J'ai fait ma déclaration/);
  const done = await u.post('/compta/declaration', { period: `${py}-Q${pq}`, done: '1' }, { form: true });
  assert.equal(done.status, 303);
  assert.match(await page(u, `/compta?declarer=${py}-Q${pq}#declaration`), /Tu as indiqué avoir fait cette déclaration/);
  assert.equal((await u.post('/compta/declaration', { period: 'nimportequoi', done: '1' }, { form: true })).status, 400);
  assert.equal((await u.post('/compta/situation', { regime: 'nimportequoi' }, { form: true })).status, 303, 'situation inconnue : retour à la page, rien d\'enregistré');
  assert.equal(await s.db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND `key` = 'acc_regime'").get(u.id).then((x) => x.value), 'micro');
});

test('exports : archive par projet et globale (justificatifs + journal), journal CSV, rien d\'un autre compte', async () => {
  const u = await s.newUser();
  const v = await s.newUser();
  const a = await addProject(s.db, u.id, { name: 'Alpha', gitUrl: 'https://github.com/u/a.git' });
  const b = await addProject(s.db, u.id, { name: 'Bêta', gitUrl: 'https://github.com/u/b.git' });
  await create(u, PDF, { ...fields({ label: 'Facture Alpha' }), projectId: a });
  await create(u, PNG, { ...fields({ kind: 'expense', category: 'hosting', label: 'Serveur Bêta', amount: '12' }), projectId: b }, { name: 'r.png', type: 'image/png' });
  await create(u, PDF, fields({ label: 'Sans projet' }));
  await create(v, PDF, fields({ label: 'Secret de l\'autre compte' }));
  const get = async (path) => { const r = await u.get(path, { headers: { accept: '*/*' } }); assert.equal(r.status, 200, path); return r; };
  const all = await get('/compta/export?periode=tout');
  assert.equal(all.headers.get('content-type'), 'application/zip');
  assert.match(all.headers.get('content-disposition'), /^attachment; filename="comptabilite-tous-les-projets-/);
  const files = readZip(Buffer.from(await all.arrayBuffer()));
  const names = files.map((f) => f.name);
  assert.ok(names.includes('LISEZMOI.txt') && names.includes('journal.csv'));
  assert.equal(names.filter((n) => n.includes('/justificatifs/')).length, 3, 'tous les justificatifs, classés par projet');
  assert.ok(names.some((n) => n.startsWith('Alpha/justificatifs/')) && names.some((n) => n.startsWith('Bêta/justificatifs/')) && names.some((n) => n.startsWith('Hors projet/justificatifs/')));
  const csv = files.find((f) => f.name === 'journal.csv').data.toString('utf8');
  assert.match(csv, /Facture Alpha/);
  assert.doesNotMatch(csv, /Secret de l'autre compte/);
  const one = readZip(Buffer.from(await (await get(`/compta/export?projet=${a}&periode=tout`)).arrayBuffer()));
  assert.deepEqual(one.map((f) => f.name).filter((n) => n.includes('justificatifs')).length, 1);
  assert.ok(one.some((f) => /^justificatifs\//.test(f.name)), 'un seul projet : pas de sous-dossier de projet');
  const csvOnly = await get('/compta/journal.csv?periode=tout');
  assert.match(csvOnly.headers.get('content-type'), /text\/csv/);
  assert.match(await csvOnly.text(), /Serveur Bêta/);
  assert.equal((await v.get(`/compta/export?projet=${a}&periode=tout`, { headers: { accept: '*/*' } })).status, 404, 'le projet d\'un autre n\'exporte rien');
  const empty = await s.newUser();
  assert.equal((await empty.get('/compta/export', { headers: { accept: '*/*' } })).status, 404, 'rien à exporter');
});

test('page : chiffres par période et par projet, filtres, projet supprimé (les lignes restent)', async () => {
  const u = await s.newUser();
  await situation(u);
  const a = await addProject(s.db, u.id, { name: 'Projet temporaire', gitUrl: 'https://github.com/u/t.git' });
  await create(u, PDF, { ...fields({ label: 'Paiement A', amount: '1000' }), projectId: a });
  await create(u, PDF, fields({ kind: 'expense', category: 'software', label: 'Dépense B', amount: '200' }));
  let h = await page(u, '/compta?periode=tout');
  assert.match(h, /Paiement A/);
  assert.match(h, /1\s000,00\s€/);
  assert.match(h, /Projet temporaire/);
  const filtered = await page(u, `/compta?periode=tout&projet=${a}`);
  assert.match(filtered, /Paiement A/);
  assert.doesNotMatch(filtered, /Dépense B/);
  assert.doesNotMatch(await page(u, '/compta?periode=tout&type=expense'), /Paiement A/);
  assert.match(await page(u, '/compta?periode=tout&q=d%C3%A9pense'), /Dépense B/);
  await s.db.prepare('DELETE FROM projects WHERE id = ?').run(a);
  h = await page(u, '/compta?periode=tout');
  assert.match(h, /Paiement A/, 'la comptabilité survit à la suppression du projet');
  assert.match(h, /Projet temporaire \(supprimé\)/);
});

test('supprimer le compte efface aussi les justificatifs', async () => {
  const u = await s.newUser();
  assert.equal((await create(u, PDF)).status, 200);
  const root = userAccountingRoot(s.app.cfg, u.id);
  assert.ok(existsSync(root));
  await deleteUser(s.app, u.id);
  assert.equal(existsSync(root), false);
});

test('situation : l\'assistant l\'enregistre en JSON (statut obligatoire), la page pose une question à la fois', async () => {
  const u = await s.newUser();
  const h = await page(u);
  assert.match(h, /data-wizard data-wiz-json="\/compta\/situation\?json=1"/);
  assert.equal((h.match(/<fieldset class="wiz-step"/g) || []).length, 4, 'quatre questions');
  assert.match(h, /data-required/, 'le statut attend une réponse');
  assert.doesNotMatch(h, /name="freq" value="quarterly" checked/, 'rien de coché à la première visite');
  let r = await u.post('/compta/situation?json=1', { activity: 'services' }, { form: true });
  assert.equal(r.status, 400, 'sans statut : refusé, l\'assistant retombe sur l\'envoi classique');
  r = await u.post('/compta/situation?json=1', { regime: 'reel', activity: 'liberal', vat: 'assujetti', freq: 'monthly' }, { form: true });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  const again = await page(u);
  assert.doesNotMatch(again, /Commence ici/);
  assert.doesNotMatch(again, /Ma situation/, 'plus de ligne « Ma situation » sur la page');
  assert.doesNotMatch(again, /data-wizard/);
  // La modification se fait depuis le guide de déclaration : les questions seules, réponses actuelles cochées
  const guide = await page(u, '/compta?declarer=1');
  assert.match(guide, /Ce guide vient de ta situation : Société ou entreprise au réel · Profession libérale · Je facture la TVA · déclaration chaque mois/);
  assert.match(guide, /href="\/compta\?situation=1">Modifier mes réponses/);
  const edit = await page(u, '/compta?situation=1');
  assert.match(edit, /Comptabilité : modifie ta situation/);
  assert.match(edit, /name="regime" value="reel" checked/, 'en modification, les réponses actuelles sont cochées');
  assert.doesNotMatch(edit, /Tes chiffres|Journal des lignes/, 'seules les questions');
});
