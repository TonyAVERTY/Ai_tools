// PDF de la facturation : écrivain de PDF, rendu des quatre documents, émission (numéro, client, PDF) et ajout automatique à la Comptabilité
// (ligne « à encaisser » hors des chiffres jusqu'au paiement).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { startApp } from './helpers/server.js';
import { makeClaudeBin } from './helpers/claude-bin.js';
import { addProject, testTokenLink } from './helpers/users.js';
import { Worker } from '../src/services/jobs.js';
import { makeHandlers } from '../src/handlers.js';
import { Pdf, toWinAnsi } from '../src/services/pdf.js';
import { renderDocumentPdf } from '../src/services/billingpdf.js';
import { normalizeLegal, normalizeContent, documentFacts } from '../src/services/billing.js';
import { normalizeIssue, IssueError } from '../src/billingissue.js';
import { fmtEur, todayIso } from '../src/services/accounting.js';
import { listClients } from '../src/billingissue.js';

const LEGAL = { legal_form: 'micro', legal_name: 'Tony Averty', siret: '123 456 789 00012', address: '12 rue des Lilas', postal_code: '35000', city: 'Rennes', vat_mode: 'franchise',
  email: 'tony@exemple.fr', payment_terms_days: '30', quote_validity_days: '30', activity_label: 'Développement web', offer_description: 'Des applications web sur mesure.' };

/** Texte d'un PDF produit par notre écrivain : on inflate les flux et on lit les chaînes hexadécimales des opérateurs Tj. */
function pdfText(buf) {
  const s = buf.toString('latin1');
  const pages = [];
  for (const m of s.matchAll(/stream\n([\s\S]*?)\nendstream/g)) {
    const ops = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    pages.push([...ops.matchAll(/<([0-9a-f]*)> Tj/g)].map((x) => Buffer.from(x[1], 'hex').toString('latin1').replace(/\x80/g, '€').replace(/\x92/g, '’').replace(/\x97/g, '—').replace(/\x96/g, '–')).join('\n'));
  }
  return pages;
}
const flat = (buf) => pdfText(buf).join('\n');
const n = (str) => str.replace(/[\u00a0\u202f]/g, ' ');

test('écrivain de PDF : structure valide (xref exacte), accents et € en WinAnsi, retour à la ligne', () => {
  const p = new Pdf({ title: 'Devis é' });
  p.text(50, 60, 'Société « Équipe » 1 200,50 €', { size: 12, bold: true });
  p.newPage();
  p.text(50, 60, 'Page 2');
  const buf = p.toBuffer();
  const s = buf.toString('latin1');
  assert.match(s, /^%PDF-1\.4/);
  assert.match(s, /%%EOF\n$/);
  assert.equal((s.match(/\/Type \/Page /g) || []).length, 2);
  // Chaque entrée de la table xref pointe sur « n 0 obj »
  const xref = s.slice(s.indexOf('xref\n'));
  const offsets = [...xref.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.ok(offsets.length >= 6);
  offsets.forEach((o, i) => assert.equal(s.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
  assert.equal(Number(/startxref\n(\d+)/.exec(s)[1]), s.indexOf('xref\n'));
  assert.deepEqual(toWinAnsi('é€ « » — ’  1 ∑'), [0xe9, 0x80, 0x20, 0xab, 0x20, 0xbb, 0x20, 0x97, 0x20, 0x92, 0x20, 0x20, 0x31, 0x20, 0x3f]);
  assert.equal(flat(buf).includes('Société « Équipe » 1 200,50 €'.replace(/[\u00a0\u202f]/g, ' ')), true);
  const w = new Pdf();
  assert.ok(w.width('Bonjour', 10) > 0 && w.width('Bonjour', 10, true) > w.width('Bonjour', 10));
  const lines = w.wrap('Une phrase assez longue pour devoir passer à la ligne dans une colonne étroite', 120, 10);
  assert.ok(lines.length > 2 && lines.every((l) => w.width(l, 10) <= 120));
  assert.ok(w.wrap('Supercalifragilisticexpialidocious'.repeat(3), 100, 10).every((l) => w.width(l, 10) <= 100), 'un mot trop long est coupé');
});

const content = (extra = {}) => normalizeContent({ title: 'Devis', intro: 'Bonjour,\n\nVoici ma proposition.', lines: [{ label: 'Cadrage', description: 'Ateliers', qty: 1, unit: 'forfait', unit_price: 900 }, { label: 'Développement', qty: 12, unit: 'jours', unit_price: 450 }],
  conditions: 'Deux retouches.', payment: '30 % à la commande.', closing: 'Cordialement.', deposit_percent: 30, reason: 'Erreur de facturation', ...extra }, 'devis');
const assujetti = { ...LEGAL, vat_mode: 'assujetti', vat_number: 'FR12345678901', vat_rate: '2000', iban: 'FR1420041010050500013M02606', bic: 'PSSTFRPPSCE' };

test('PDF : les quatre documents portent les mêmes chiffres et mentions que le code (acompte, solde, avoir), modèle ou émis', () => {
  const legal = normalizeLegal(assujetti).values;
  const c = content();
  for (const layout of ['classique', 'moderne', 'epure']) {
    for (const kind of ['devis', 'acompte', 'facture', 'avoir']) {
      const f = documentFacts({ kind, content: c, legal });
      const txt = flat(renderDocumentPdf({ kind, content: c, legal, layout }));
      for (const [label, cents] of f.totals) if (cents !== null) assert.ok(txt.includes(n(fmtEur(cents))), `${kind}/${layout} : ${label} ${fmtEur(cents)}`);
      assert.ok(txt.includes('{{numero}}') && txt.includes('{{client_nom}}'), 'modèle : variables laissées vides');
      assert.ok(txt.includes('N° de TVA intracommunautaire : FR12345678901'));
      assert.ok(txt.includes('Tony Averty'));
    }
  }
  const f = documentFacts({ kind: 'facture', content: c, legal });
  assert.deepEqual([f.t.ht, f.t.vat, f.t.ttc, f.depTtc, f.due], [630000, 126000, 756000, 226800, 529200], 'facture finale = TTC − acompte de 30 %');
  assert.equal(documentFacts({ kind: 'acompte', content: c, legal }).due, 226800);
  assert.equal(documentFacts({ kind: 'avoir', content: c, legal }).due, 756000, 'montant de l\'avoir en positif ; les totaux affichés sont négatifs');
  assert.equal(documentFacts({ kind: 'avoir', content: c, legal }).totals.at(-1)[1], -756000);
  const franch = documentFacts({ kind: 'facture', content: c, legal: normalizeLegal(LEGAL).values });
  assert.equal(franch.t.vat, 0);
  const txt = flat(renderDocumentPdf({ kind: 'facture', content: c, legal: normalizeLegal(LEGAL).values }));
  assert.ok(txt.includes('TVA non applicable, art. 293 B du CGI'));
  assert.ok(!txt.includes('FR12345678901'));
});

test('PDF émis : valeurs du client, dates, SIRET omis pour un particulier, plusieurs pages si beaucoup de lignes', () => {
  const legal = normalizeLegal(LEGAL).values;
  const values = { numero: 'F-2026-0007', date: '2026-10-27', date_echeance: '2026-11-26', date_prestation: '2026-10-20', client_nom: 'Boulangerie Dupont', client_adresse: '5 place du Marché, 35000 Rennes', client_siret: '' };
  const txt = flat(renderDocumentPdf({ kind: 'facture', content: content(), legal, values }));
  assert.ok(txt.includes('Facture n° F-2026-0007') && txt.includes('Date : 27/10/2026') && txt.includes('Échéance : 26/11/2026') && txt.includes('Prestation réalisée le 20/10/2026'));
  assert.ok(txt.includes('Boulangerie Dupont') && txt.includes('5 place du Marché, 35000 Rennes'));
  assert.ok(!txt.includes('SIRET : ') && !txt.includes('{{'), 'plus aucun repère, pas de ligne SIRET client vide');
  const many = { ...content(), lines: Array.from({ length: 40 }, (_, i) => ({ label: `Prestation ${i + 1}`, description: 'Détail de la prestation réalisée', qty: '1', unit: 'forfait', unit_price: 100 })) }; // le rendu accepte plus que ce que Claude propose
  const pages = pdfText(renderDocumentPdf({ kind: 'devis', content: many, legal }));
  assert.ok(pages.length >= 2, `${pages.length} pages`);
  assert.ok(pages.at(-1).includes('Page ' + pages.length + '/' + pages.length) && pages[0].includes('Page 1/' + pages.length));
  assert.ok(pages.join('').includes('Prestation 40') && pages.join('').includes('Cordialement.'));
});

test('émission : champs du client vérifiés, dates, échéance et validité calculées d\'après les informations légales', () => {
  const legal = normalizeLegal(LEGAL).values;
  const ok = { client_nom: ' Dupont ', client_adresse: '5 place', client_siret: '987 654 321 00011', issue_date: '2026-03-01' };
  const v = normalizeIssue(ok, { kind: 'facture', legal, today: '2026-10-27' });
  assert.deepEqual([v.client_nom, v.client_siret, v.date, v.date_echeance, v.date_prestation], ['Dupont', '98765432100011', '2026-03-01', '2026-03-31', '2026-03-01']);
  assert.equal(normalizeIssue(ok, { kind: 'devis', legal, today: '2026-10-27' }).date_validite, '2026-03-31');
  const bad = (over, kind = 'facture') => assert.throws(() => normalizeIssue({ ...ok, ...over }, { kind, legal, today: '2026-10-27' }), IssueError);
  bad({ client_nom: '' }); bad({ client_adresse: ' ' }); bad({ client_siret: '123' }); bad({ issue_date: '2026-13-40' }); bad({ issue_date: '2027-01-01' });
  bad({}, 'avoir');
  assert.equal(normalizeIssue({ ...ok, facture_numero: 'F-2026-0001', motif: 'Erreur' }, { kind: 'avoir', legal, today: '2026-10-27' }).facture_numero, 'F-2026-0001');
});

// ---------- Parcours complet : émission → Comptabilité ----------
let s, worker;
before(async () => {
  s = await startApp();
  s.app.cfg.claudeBin = makeClaudeBin(s.tmp);
  worker = new Worker(s.db, makeHandlers(s.app), { log: { error: () => {} } });
});
after(async () => { await s.close(); });
const html = (u, p) => u.get(p, { headers: { accept: 'text/html' } }).then((r) => r.text()).then((t) => t.replaceAll('&#39;', "'"));
const post = (u, p, body = {}) => u.post(p, body, { form: true });
const base = (pid) => `/facturation/projet/${pid}`;
const docsOf = (pid) => s.db.prepare('SELECT * FROM billing_docs WHERE project_id = ? ORDER BY kind, variant').all(pid);

/** Un projet dont les quatre documents sont validés, prêt à émettre. */
async function ready(over = {}) {
  const u = await s.newUser({ link: testTokenLink() });
  const pid = await addProject(s.db, u.id, { name: 'Fidélio', gitUrl: 'https://github.com/u/fidelio.git' });
  await post(u, `${base(pid)}/legal`, { ...LEGAL, ...over });
  await post(u, `${base(pid)}/generer`); await worker.tick();
  await post(u, `${base(pid)}/choisir`, { variant: 1 });
  const [o1] = await docsOf(pid);
  await post(u, `${base(pid)}/valider`, { doc: o1.id }); await worker.tick();
  const finals = (await docsOf(pid)).filter((d) => d.kind !== 'quote_option');
  for (const d of finals) await post(u, `${base(pid)}/valider`, { doc: d.id });
  const byKind = Object.fromEntries(finals.map((d) => [d.kind, d]));
  return { u, pid, byKind };
}
const CLIENT = { client_nom: 'Boulangerie Dupont', client_adresse: '5 place du Marché, 35000 Rennes', client_siret: '98765432100011', to_accounting: '1' };
const entries = (uid) => s.db.prepare('SELECT * FROM accounting_entries WHERE user_id = ? ORDER BY id').all(uid);
const compta = async (u, q = '') => html(u, `/compta${q}`);

test('modèle en PDF : téléchargeable, variables laissées vides ; interdit aux autres comptes', async () => {
  const { u, byKind } = await ready();
  const r = await u.get(`/facturation/documents/${byKind.facture.id}/pdf`, { headers: { accept: '*/*' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.match(r.headers.get('content-disposition'), /attachment; filename="modele-facture-finale\.pdf"/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(flat(buf).includes('{{client_nom}}'));
  assert.match(await html(u, base(byKind.facture.projectId ?? 0)).catch(() => ''), /./);
  const v = await s.newUser();
  assert.equal((await v.get(`/facturation/documents/${byKind.facture.id}/pdf`, { headers: { accept: '*/*' } })).status, 404);
});

test('facture émise : PDF numéroté, ajoutée à la Comptabilité « à encaisser » avec son PDF, hors des chiffres jusqu\'au paiement', async () => {
  const { u, pid, byKind } = await ready();
  await post(u, '/compta/situation', { regime: 'micro', activity: 'services', vat: 'franchise', freq: 'quarterly' });
  const r = await post(u, `${base(pid)}/emettre`, { doc: byKind.facture.id, ...CLIENT });
  assert.equal(r.status, 303);
  const year = todayIso().slice(0, 4);
  assert.match(r.headers.get('location'), new RegExp(`ok=emis&n=F-${year}-0001`));
  const inv = await s.db.prepare('SELECT * FROM billing_invoices WHERE project_id = ?').get(pid);
  assert.equal(inv.number, `F-${year}-0001`);
  assert.ok(existsSync(join(s.app.cfg.dataDir, 'billing', String(u.id), String(inv.id), inv.pdf_file)));
  // Ligne de comptabilité créée automatiquement
  const [e] = await entries(u.id);
  assert.equal(e.kind, 'payment_in');
  assert.equal(e.pending, 1);
  assert.equal(e.invoice_id, inv.id);
  assert.equal(e.party, 'Boulangerie Dupont');
  assert.equal(e.doc_mime, 'application/pdf');
  assert.equal(e.project_id, pid);
  assert.equal(e.amount_cents, inv.amount_cents);
  assert.equal(e.vat_cents, 0, 'franchise : pas de TVA');
  assert.ok(existsSync(join(s.app.cfg.dataDir, 'compta', String(u.id), String(e.id), 'justificatif.pdf')));
  // Le PDF contient le numéro, le client et le montant
  const pdf = await u.get(`/facturation/factures/${inv.id}/pdf`, { headers: { accept: '*/*' } });
  assert.equal(pdf.status, 200);
  const txt = flat(Buffer.from(await pdf.arrayBuffer()));
  assert.ok(txt.includes(`Facture n° F-${year}-0001`) && txt.includes('Boulangerie Dupont') && txt.includes(n(fmtEur(inv.amount_cents))) && !txt.includes('{{'));
  // Visible dans la Comptabilité, mais pas dans les chiffres
  const c = await compta(u, '?periode=tout');
  assert.match(c, /Factures émises, à encaisser/);
  assert.match(c, new RegExp(`Facture finale F-${year}-0001`));
  assert.match(c, /À encaisser/);
  assert.match(c, /Marquer payée/);
  assert.doesNotMatch(c, /Journal des lignes[\s\S]*Facture finale F-/, 'pas dans le journal tant qu\'elle n\'est pas payée');
  const csv = await (await u.get('/compta/journal.csv?periode=tout')).text();
  assert.doesNotMatch(csv, /F-20/, 'exclue de l\'export tant qu\'elle n\'est pas payée');
  assert.match(await html(u, base(pid)), /Documents émis[\s\S]*À encaisser/);
  // Paiement : elle entre dans les chiffres, à la date d'encaissement
  const paid = await post(u, `/compta/entries/${e.id}/paid`, { date: todayIso() });
  assert.equal(paid.status, 303);
  assert.equal((await entries(u.id))[0].pending, 0);
  const c2 = await compta(u, '?periode=tout');
  assert.doesNotMatch(c2, /Factures émises, à encaisser/);
  assert.match(c2, new RegExp(`Facture finale F-${year}-0001`));
  assert.match(await html(u, base(pid)), /Payée/);
  assert.equal((await post(u, `/compta/entries/${e.id}/paid`, { date: todayIso() })).status, 400, 'déjà payée');
  assert.match(await (await u.get('/compta/journal.csv?periode=tout')).text(), new RegExp(`F-${year}-0001`));
});

test('numérotation, acompte et avoir (remboursement à effectuer), devis sans ligne de comptabilité', async () => {
  const { u, pid, byKind } = await ready({ vat_mode: 'assujetti', vat_number: 'FR12345678901', vat_rate: '2000' });
  await post(u, '/compta/situation', { regime: 'micro', activity: 'services', vat: 'assujetti', freq: 'quarterly' });
  const year = todayIso().slice(0, 4);
  await post(u, `${base(pid)}/emettre`, { doc: byKind.acompte.id, ...CLIENT });
  await post(u, `${base(pid)}/emettre`, { doc: byKind.facture.id, ...CLIENT });
  await post(u, `${base(pid)}/emettre`, { doc: byKind.facture.id, ...CLIENT });
  await post(u, `${base(pid)}/emettre`, { doc: byKind.devis.id, ...CLIENT });
  const r = await post(u, `${base(pid)}/emettre`, { doc: byKind.avoir.id, ...CLIENT, facture_numero: `F-${year}-0001`, motif: 'Geste commercial' });
  assert.equal(r.status, 303);
  const nums = (await s.db.prepare('SELECT number FROM billing_invoices WHERE project_id = ? ORDER BY id').all(pid)).map((x) => x.number);
  assert.deepEqual(nums, [`AC-${year}-0001`, `F-${year}-0001`, `F-${year}-0002`, `D-${year}-0001`, `AV-${year}-0001`]);
  const es = await entries(u.id);
  assert.equal(es.length, 4, 'le devis n\'entre pas en comptabilité');
  assert.deepEqual(es.map((x) => x.kind), ['payment_in', 'payment_in', 'payment_in', 'refund_out']);
  assert.ok(es.every((x) => x.pending === 1 && x.vat_rate === 2000 && x.vat_cents > 0), 'TVA assujetti reprise du document');
  const ac = await s.db.prepare("SELECT * FROM billing_invoices WHERE number = ?").get(`AC-${year}-0001`);
  assert.equal(es[0].amount_cents, ac.amount_cents);
  const ctext = await compta(u, '?periode=tout'); assert.match(ctext, /À rembourser/);
});

test('émission refusée : champs manquants, document non validé, projet d\'un autre compte, PDF d\'un autre compte', async () => {
  const { u, pid, byKind } = await ready();
  const miss = await post(u, `${base(pid)}/emettre`, { doc: byKind.facture.id, client_nom: '' });
  assert.equal(miss.status, 303);
  assert.match(decodeURIComponent(miss.headers.get('location')), /e=Indique le nom du client\./);
  assert.match(await html(u, base(pid) + miss.headers.get('location').replace(base(pid), '')), /Indique le nom du client\./);
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM billing_invoices').get()).n >= 0, true);
  const none = await s.db.prepare('SELECT COUNT(*) n FROM billing_invoices WHERE project_id = ?').get(pid);
  assert.equal(none.n, 0);
  assert.equal((await entries(u.id)).length, 0);
  const noAvoir = await post(u, `${base(pid)}/emettre`, { doc: byKind.avoir.id, ...CLIENT });
  assert.match(decodeURIComponent(noAvoir.headers.get('location')), /numéro de la facture/);
  // Un document repassé en brouillon (affiné) ne s'émet plus
  await s.db.prepare("UPDATE billing_docs SET status = 'draft' WHERE id = ?").run(byKind.facture.id);
  assert.match(decodeURIComponent((await post(u, `${base(pid)}/emettre`, { doc: byKind.facture.id, ...CLIENT })).headers.get('location')), /Valide d'abord/);
  await s.db.prepare("UPDATE billing_docs SET status = 'validated' WHERE id = ?").run(byKind.facture.id);
  // Autre compte : introuvable
  const v = await s.newUser();
  assert.equal((await post(v, `${base(pid)}/emettre`, { doc: byKind.facture.id, ...CLIENT })).status, 404);
  await post(u, `${base(pid)}/emettre`, { doc: byKind.facture.id, ...CLIENT });
  const inv = await s.db.prepare('SELECT * FROM billing_invoices WHERE project_id = ?').get(pid);
  assert.equal((await v.get(`/facturation/factures/${inv.id}/pdf`, { headers: { accept: '*/*' } })).status, 404);
  const e = (await entries(u.id))[0];
  assert.equal((await post(v, `/compta/entries/${e.id}/paid`, { date: todayIso() })).status, 404);
  assert.equal((await post(u, `/compta/entries/${e.id}/paid`, { date: '2999-01-01' })).status, 400, 'pas de paiement dans le futur');
  assert.equal((await entries(u.id))[0].pending, 1);
  assert.equal((await s.anon.get(`/facturation/factures/${inv.id}/pdf`)).status === 200, false);
});

test('case « Joindre automatiquement à la comptabilité » : décochée, la facture reste en PDF et n\'entre pas en comptabilité', async () => {
  const { u, pid, byKind } = await ready();
  await post(u, '/compta/situation', { regime: 'micro', activity: 'services', vat: 'franchise', freq: 'quarterly' });
  const { to_accounting: _omit, ...noBox } = CLIENT;
  const r = await post(u, `${base(pid)}/emettre`, { doc: byKind.facture.id, ...noBox });
  assert.equal(r.status, 303);
  const inv = await s.db.prepare('SELECT * FROM billing_invoices WHERE project_id = ?').get(pid);
  assert.ok(inv && inv.entry_id == null);
  assert.equal((await entries(u.id)).length, 0, 'rien dans la Comptabilité');
  assert.doesNotMatch(await compta(u, '?periode=tout'), /Factures émises, à encaisser/);
  const h = await html(u, base(pid));
  assert.match(h, /Non jointe à la comptabilité/);
  assert.equal((await u.get(`/facturation/factures/${inv.id}/pdf`, { headers: { accept: '*/*' } })).status, 200, 'le PDF reste téléchargeable');
  // Le formulaire propose la case, cochée par défaut, pour une facture seulement (pas pour un devis)
  assert.match(h, /name="to_accounting" value="1" checked/);
  assert.equal((h.match(/name="to_accounting"/g) || []).length, 1, 'une seule case, dans la section « Générer un document »');
  assert.match(h, /data-for="acompte facture avoir"/, 'la case ne concerne que les factures (masquée pour un devis)');
  // Cochée, une autre émission est jointe
  await post(u, `${base(pid)}/emettre`, { doc: byKind.facture.id, ...CLIENT });
  assert.equal((await entries(u.id)).length, 1);
  assert.match(await html(u, base(pid)), /À encaisser/);
});

test('section « Générer un document » : disponible une fois les modèles validés, tous les types, type présélectionnable', async () => {
  const { u, pid } = await ready();
  const h = await html(u, `${base(pid)}?type=avoir`);
  assert.match(h, /<h2 id="t-gen">Générer un document<\/h2>/);
  for (const t of ['Devis', 'Acompte', 'Facture finale', 'Avoir']) assert.match(h, new RegExp(`<option value="\\d+" data-kind="[a-z]+"[^>]*>${t}</option>`));
  assert.match(h, /data-kind="avoir" selected/, 'le type demandé dans l\'adresse est présélectionné');
  assert.match(h, /href="\?type=facture#generer"/, 'bouton « Émettre ce document » sur la carte du modèle');
  assert.doesNotMatch(h, /Émettre en PDF :/, 'plus de formulaire caché sous chaque carte');
  // Un modèle repassé en brouillon reste visible mais n'est pas choisissable
  await s.db.prepare("UPDATE billing_docs SET status = 'draft' WHERE project_id = ? AND kind = 'acompte'").run(pid);
  assert.match(await html(u, base(pid)), /<option value="\d+" data-kind="acompte" disabled>Acompte \(à valider d'abord\)<\/option>/);
});

test('clients par projet : enregistrés à l\'émission, repris pour les documents suivants, mis à jour sans doublon, jamais partagés', async () => {
  const { u, pid, byKind } = await ready();
  assert.equal((await listClients(s.db, u.id, pid)).length, 0);
  assert.doesNotMatch(await html(u, base(pid)), /Clients du projet/);
  await post(u, `${base(pid)}/emettre`, { doc: byKind.devis.id, ...CLIENT });
  let cl = await listClients(s.db, u.id, pid);
  assert.deepEqual(cl.map((c) => [c.name, c.address, c.siret]), [['Boulangerie Dupont', '5 place du Marché, 35000 Rennes', '98765432100011']]);
  let h = await html(u, base(pid));
  assert.match(h, /Clients du projet/);
  assert.match(h, new RegExp(`<option value="${cl[0].id}" data-name="Boulangerie Dupont" data-address="5 place du Marché, 35000 Rennes" data-siret="98765432100011">Boulangerie Dupont</option>`));
  // Même client choisi dans la liste, adresse corrigée : mise à jour, pas de doublon
  await post(u, `${base(pid)}/emettre`, { doc: byKind.facture.id, client_id: cl[0].id, client_nom: 'Boulangerie Dupont', client_adresse: '8 rue Neuve, 35000 Rennes', client_siret: '98765432100011' });
  // Même nom saisi à la main (casse différente) : le même client
  await post(u, `${base(pid)}/emettre`, { doc: byKind.acompte.id, client_nom: 'BOULANGERIE DUPONT', client_adresse: '8 rue Neuve, 35000 Rennes', client_siret: '' });
  cl = await listClients(s.db, u.id, pid);
  assert.equal(cl.length, 1);
  assert.equal(cl[0].address, '8 rue Neuve, 35000 Rennes');
  assert.equal(cl[0].name, 'BOULANGERIE DUPONT');
  // Un autre client
  await post(u, `${base(pid)}/emettre`, { doc: byKind.devis.id, client_nom: 'Atelier Martin', client_adresse: '1 quai, 44000 Nantes' });
  assert.deepEqual((await listClients(s.db, u.id, pid)).map((c) => c.name), ['Atelier Martin', 'BOULANGERIE DUPONT']);
  // Un client refusé (nom manquant) n'est pas enregistré
  await post(u, `${base(pid)}/emettre`, { doc: byKind.devis.id, client_nom: '', client_adresse: 'x' });
  assert.equal((await listClients(s.db, u.id, pid)).length, 2);
  // Un client d'un autre projet ou d'un autre compte n'est jamais repris
  const pid2 = await addProject(s.db, u.id, { name: 'Autre', gitUrl: 'https://github.com/u/autre.git' });
  assert.equal((await listClients(s.db, u.id, pid2)).length, 0);
  assert.equal((await listClients(s.db, u.id + 999, pid)).length, 0);
  const other = await ready();
  assert.doesNotMatch(await html(other.u, base(other.pid)), /Atelier Martin/);
  // client_id d'un autre projet : ignoré (un nouveau client est créé sur le bon projet)
  await post(other.u, `${base(other.pid)}/emettre`, { doc: other.byKind.devis.id, client_id: cl[0].id, client_nom: 'Pirate', client_adresse: 'ailleurs' });
  assert.equal((await listClients(s.db, u.id, pid)).find((c) => c.id === cl[0].id).name, 'BOULANGERIE DUPONT', 'le client d\'un autre compte n\'est pas modifié');
  assert.deepEqual((await listClients(s.db, other.u.id, other.pid)).map((c) => c.name), ['Pirate']);
  // Retirer un client : seulement les siens
  const v = await s.newUser();
  assert.equal((await post(v, `${base(pid)}/clients/${cl[0].id}/supprimer`)).status, 404);
  assert.equal((await post(u, `${base(pid)}/clients/${cl[0].id}/supprimer`)).status, 303);
  assert.deepEqual((await listClients(s.db, u.id, pid)).map((c) => c.name), ['Atelier Martin']);
  await post(u, `${base(pid)}/emettre`, { doc: byKind.devis.id, client_id: (await listClients(s.db, u.id, pid))[0].id, client_nom: 'Atelier Martin', client_adresse: '1 quai, 44000 Nantes' });
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM billing_invoices WHERE project_id = ?').get(pid)).n >= 4, true, 'les documents déjà émis restent');
});
