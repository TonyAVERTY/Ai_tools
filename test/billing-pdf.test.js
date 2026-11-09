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
const page = (pid) => `/p/${pid}/facturation`; // l'onglet Facturation de la page projet
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
const CLIENT = { client_nom: 'Boulangerie Dupont', client_adresse: '5 place du Marché, 35000 Rennes', client_siret: '98765432100011' };
// Ce que le client commande : 900 + 12 × 450 = 6 300 € HT (les lignes des modèles de Claude ne sont que des exemples)
const LINES = { l0_label: 'Cadrage et conception', l0_qty: '1', l0_unit: 'forfait', l0_price: '900', l1_label: 'Développement', l1_description: 'Application web', l1_qty: '12', l1_unit: 'jours', l1_price: '450,00' };
const entries = (uid) => s.db.prepare('SELECT * FROM accounting_entries WHERE user_id = ? ORDER BY id').all(uid);
const compta = async (u, q = '') => html(u, `/compta${q}`);
const invoices = (pid) => s.db.prepare('SELECT * FROM billing_invoices WHERE project_id = ? ORDER BY id').all(pid);
const emit = (u, pid, doc, fields = {}) => post(u, `${base(pid)}/emettre`, { doc: doc.id, to_accounting: '1', ...fields });
const location = (r) => decodeURIComponent(r.headers.get('location') || '');
/** Émet un devis (client + lignes saisis) et renvoie sa ligne. */
async function devisOf(u, pid, byKind, extra = {}) {
  const r = await emit(u, pid, byKind.devis, { ...CLIENT, ...LINES, ...extra });
  assert.equal(r.status, 303, location(r));
  assert.match(location(r), /ok=emis_devis/);
  return (await invoices(pid)).filter((i) => i.kind === 'devis').at(-1);
}

test('modèle en PDF : téléchargeable, variables laissées vides ; interdit aux autres comptes', async () => {
  const { u, byKind } = await ready();
  const r = await u.get(`/facturation/documents/${byKind.facture.id}/pdf`, { headers: { accept: '*/*' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.match(r.headers.get('content-disposition'), /attachment; filename="modele-facture-finale\.pdf"/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(flat(buf).includes('{{client_nom}}'));
  assert.match(await html(u, page(byKind.facture.projectId ?? 0)).catch(() => ''), /./);
  const v = await s.newUser();
  assert.equal((await v.get(`/facturation/documents/${byKind.facture.id}/pdf`, { headers: { accept: '*/*' } })).status, 404);
});

test('devis : les lignes saisies par l\'utilisateur (et non celles du modèle) sont dans le PDF, le client est enregistré, aucun passage en comptabilité', async () => {
  const { u, pid, byKind } = await ready();
  const year = todayIso().slice(0, 4);
  const d = await devisOf(u, pid, byKind);
  assert.equal(d.number, `D-${year}-0001`);
  assert.equal(d.amount_cents, 630000, '900 + 12 × 450 = 6 300 € TTC (franchise de TVA)');
  assert.deepEqual(JSON.parse(d.lines_json).map((l) => [l.label, l.qty, l.unit, l.unit_price]), [['Cadrage et conception', 1, 'forfait', 900], ['Développement', 12, 'jours', 450]]);
  const pdf = await u.get(`/facturation/factures/${d.id}/pdf`, { headers: { accept: '*/*' } });
  const txt = flat(Buffer.from(await pdf.arrayBuffer()));
  assert.ok(txt.includes('Cadrage et conception') && txt.includes('Développement') && txt.includes('Application web'));
  assert.ok(txt.includes(n(fmtEur(630000))) && txt.includes(n(fmtEur(540000))) && txt.includes('12 jours'));
  assert.ok(txt.includes('Boulangerie Dupont') && !txt.includes('{{'));
  assert.equal((await entries(u.id)).length, 0, 'un devis n\'entre jamais en comptabilité');
  assert.equal(d.client_id !== null, true);
  // Lignes obligatoires et vérifiées
  const none = await emit(u, pid, byKind.devis, { ...CLIENT });
  assert.match(location(none), /e=Ajoute au moins une ligne au devis/);
  assert.match(location(await emit(u, pid, byKind.devis, { ...CLIENT, l0_label: 'A', l0_price: 'abc' })), /prix unitaire HT doit être un nombre/);
  assert.match(location(await emit(u, pid, byKind.devis, { ...CLIENT, l0_label: 'A', l0_price: '10', l0_qty: '-2' })), /quantité doit être un nombre positif/);
  assert.equal((await invoices(pid)).length, 1, 'rien d\'émis en cas d\'erreur');
});

test('acompte, facture finale et avoir : rattachés à un devis (client et lignes repris), acomptes déduits du solde, avoir sur une facture', async () => {
  const { u, pid, byKind } = await ready();
  await post(u, '/compta/situation', { regime: 'micro', activity: 'services', vat: 'franchise', freq: 'quarterly' });
  const year = todayIso().slice(0, 4);
  const d = await devisOf(u, pid, byKind);
  // Sans devis de référence : refus clair
  assert.match(location(await emit(u, pid, byKind.facture, {})), /Choisis le devis/);
  // Acompte de 30 % du devis (valeur du modèle) puis de 20 % saisi
  assert.equal((await emit(u, pid, byKind.acompte, { devis_id: d.id })).status, 303);
  assert.equal((await emit(u, pid, byKind.acompte, { devis_id: d.id, deposit_percent: '20' })).status, 303);
  const [, a1, a2] = await invoices(pid);
  assert.deepEqual([a1.number, a1.amount_cents, a2.number, a2.amount_cents], [`AC-${year}-0001`, 189000, `AC-${year}-0002`, 126000]);
  assert.equal(a1.devis_id, d.id);
  assert.deepEqual(JSON.parse(a1.client_json), { name: 'Boulangerie Dupont', address: CLIENT.client_adresse, siret: CLIENT.client_siret }, 'client repris du devis');
  const pa = flat(Buffer.from(await (await u.get(`/facturation/factures/${a1.id}/pdf`, { headers: { accept: '*/*' } })).arrayBuffer()));
  assert.ok(pa.includes(`Devis n° D-${year}-0001`) && pa.includes('Acompte de 30 % à la commande') && pa.includes(n(fmtEur(189000))) && pa.includes('Boulangerie Dupont'));
  // Facture finale : total du devis moins les acomptes réellement facturés (30 % + 20 %)
  assert.equal((await emit(u, pid, byKind.facture, { devis_id: d.id })).status, 303);
  const f = (await invoices(pid)).at(-1);
  assert.equal(f.number, `F-${year}-0001`);
  assert.equal(f.amount_cents, 630000 - 189000 - 126000);
  const pf = flat(Buffer.from(await (await u.get(`/facturation/factures/${f.id}/pdf`, { headers: { accept: '*/*' } })).arrayBuffer()));
  assert.ok(pf.includes('Cadrage et conception') && pf.includes('Acomptes déjà facturés') && pf.includes(n(fmtEur(315000))) && pf.includes('Reste à payer TTC'));
  // Les acomptes ne peuvent pas dépasser le devis
  assert.match(location(await emit(u, pid, byKind.acompte, { devis_id: d.id, deposit_percent: '90' })), /acomptes dépasseraient/);
  assert.match(location(await emit(u, pid, byKind.acompte, { devis_id: d.id, deposit_percent: '0' })), /compris entre 1 et 90/);
  // Avoir : sur une facture du devis, total par défaut ou montant partiel
  assert.match(location(await emit(u, pid, byKind.avoir, { devis_id: d.id })), /Choisis la facture/);
  assert.match(location(await emit(u, pid, byKind.avoir, { devis_id: d.id, ref_id: d.id })), /Choisis la facture/, 'un devis n\'est pas une facture');
  assert.match(location(await emit(u, pid, byKind.avoir, { devis_id: d.id, ref_id: f.id, credit_ttc: '9999' })), /ne peut pas dépasser la facture corrigée/);
  assert.equal((await emit(u, pid, byKind.avoir, { devis_id: d.id, ref_id: f.id, credit_ttc: '1000', motif: 'Geste commercial' })).status, 303);
  const av = (await invoices(pid)).at(-1);
  assert.equal(av.number, `AV-${year}-0001`);
  assert.equal(av.amount_cents, 100000);
  assert.equal(av.ref_id, f.id);
  const pv = flat(Buffer.from(await (await u.get(`/facturation/factures/${av.id}/pdf`, { headers: { accept: '*/*' } })).arrayBuffer()));
  assert.ok(pv.includes(`Sur la facture n° F-${year}-0001`) && pv.includes('Geste commercial') && pv.includes(n(fmtEur(-100000)).replace('\u2212', '-')));
  // Comptabilité : acomptes et facture « à encaisser », avoir « à rembourser », devis absent
  const es = await entries(u.id);
  assert.deepEqual(es.map((e) => [e.kind, e.amount_cents, e.pending]), [['payment_in', 189000, 1], ['payment_in', 126000, 1], ['payment_in', 315000, 1], ['refund_out', 100000, 1]]);
  assert.match(await compta(u, '?periode=tout'), /À rembourser/);
  // Un devis d'un autre projet ou compte n'est jamais une référence valide
  const other = await ready();
  const d2 = await devisOf(other.u, other.pid, other.byKind);
  assert.match(location(await emit(u, pid, byKind.facture, { devis_id: d2.id })), /Choisis le devis/);
  // Tout est facturé par les acomptes : plus de facture finale
  const { u: u3, pid: p3, byKind: k3 } = await ready();
  const d3 = await devisOf(u3, p3, k3);
  assert.equal((await emit(u3, p3, k3.acompte, { devis_id: d3.id, deposit_percent: '90' })).status, 303);
  assert.equal((await emit(u3, p3, k3.facture, { devis_id: d3.id })).status, 303, 'il reste 10 %');
});

test('facture émise : PDF numéroté, ajoutée à la Comptabilité « à encaisser » avec son PDF, hors des chiffres jusqu\'au paiement', async () => {
  const { u, pid, byKind } = await ready();
  await post(u, '/compta/situation', { regime: 'micro', activity: 'services', vat: 'franchise', freq: 'quarterly' });
  const d = await devisOf(u, pid, byKind);
  const r = await emit(u, pid, byKind.facture, { devis_id: d.id });
  assert.equal(r.status, 303);
  const year = todayIso().slice(0, 4);
  assert.match(location(r), new RegExp(`ok=emis&n=F-${year}-0001`));
  const inv = await s.db.prepare("SELECT * FROM billing_invoices WHERE project_id = ? AND kind = 'facture'").get(pid);
  assert.ok(existsSync(join(s.app.cfg.dataDir, 'billing', String(u.id), String(inv.id), inv.pdf_file)));
  const [e] = await entries(u.id);
  assert.equal(e.kind, 'payment_in');
  assert.equal(e.pending, 1);
  assert.equal(e.invoice_id, inv.id);
  assert.equal(e.party, 'Boulangerie Dupont');
  assert.equal(e.doc_mime, 'application/pdf');
  assert.equal(e.project_id, pid);
  assert.equal(e.amount_cents, 630000);
  assert.equal(e.vat_cents, 0, 'franchise : pas de TVA');
  assert.ok(existsSync(join(s.app.cfg.dataDir, 'compta', String(u.id), String(e.id), 'justificatif.pdf')));
  const c = await compta(u, '?periode=tout');
  assert.match(c, /Factures émises, à encaisser/);
  assert.match(c, new RegExp(`Facture finale F-${year}-0001`));
  assert.match(c, /Marquer payée/);
  assert.doesNotMatch(c, /Journal des lignes[\s\S]*Facture finale F-/, 'pas dans le journal tant qu\'elle n\'est pas payée');
  assert.doesNotMatch(await (await u.get('/compta/journal.csv?periode=tout')).text(), /F-20/);
  assert.match(await html(u, page(pid)), /Documents émis[\s\S]*À encaisser/);
  const paid = await post(u, `/compta/entries/${e.id}/paid`, { date: todayIso() });
  assert.equal(paid.status, 303);
  assert.equal((await entries(u.id))[0].pending, 0);
  const c2 = await compta(u, '?periode=tout');
  assert.doesNotMatch(c2, /Factures émises, à encaisser/);
  assert.match(c2, new RegExp(`Facture finale F-${year}-0001`));
  assert.match(await html(u, page(pid)), /Payée/);
  assert.equal((await post(u, `/compta/entries/${e.id}/paid`, { date: todayIso() })).status, 400, 'déjà payée');
  assert.match(await (await u.get('/compta/journal.csv?periode=tout')).text(), new RegExp(`F-${year}-0001`));
});

test('TVA : le montant TTC et la TVA de la facture viennent des lignes saisies', async () => {
  const { u, pid, byKind } = await ready({ vat_mode: 'assujetti', vat_number: 'FR12345678901', vat_rate: '2000' });
  await post(u, '/compta/situation', { regime: 'micro', activity: 'services', vat: 'assujetti', freq: 'quarterly' });
  const d = await devisOf(u, pid, byKind);
  assert.equal(d.amount_cents, 756000, '6 300 € HT + 20 % de TVA');
  await emit(u, pid, byKind.facture, { devis_id: d.id });
  const [e] = await entries(u.id);
  assert.deepEqual([e.amount_cents, e.vat_rate, e.vat_cents], [756000, 2000, 126000]);
});

test('émission refusée : champs manquants, document non validé, autre compte', async () => {
  const { u, pid, byKind } = await ready();
  const miss = await emit(u, pid, byKind.devis, { client_nom: '', ...LINES });
  assert.equal(miss.status, 303);
  assert.match(location(miss), /e=Indique le nom du client\./);
  assert.match(await html(u, miss.headers.get('location')), /Indique le nom du client\./);
  assert.equal((await invoices(pid)).length, 0);
  assert.equal((await entries(u.id)).length, 0);
  assert.match(location(await emit(u, pid, byKind.devis, { client_nom: 'X', ...LINES })), /adresse du client/);
  assert.match(location(await emit(u, pid, byKind.devis, { ...CLIENT, ...LINES, client_siret: '123' })), /14 chiffres/);
  // Un modèle repassé en brouillon (affiné) ne s'émet plus
  await s.db.prepare("UPDATE billing_docs SET status = 'draft' WHERE id = ?").run(byKind.devis.id);
  assert.match(location(await emit(u, pid, byKind.devis, { ...CLIENT, ...LINES })), /Valide d'abord/);
  await s.db.prepare("UPDATE billing_docs SET status = 'validated' WHERE id = ?").run(byKind.devis.id);
  // Autre compte : introuvable
  const v = await s.newUser();
  assert.equal((await emit(v, pid, byKind.devis, { ...CLIENT, ...LINES })).status, 404);
  const d = await devisOf(u, pid, byKind);
  assert.equal((await v.get(`/facturation/factures/${d.id}/pdf`, { headers: { accept: '*/*' } })).status, 404);
  assert.equal((await s.anon.get(`/facturation/factures/${d.id}/pdf`)).status === 200, false);
  await emit(u, pid, byKind.facture, { devis_id: d.id });
  const e = (await entries(u.id))[0];
  assert.equal((await post(v, `/compta/entries/${e.id}/paid`, { date: todayIso() })).status, 404);
  assert.equal((await post(u, `/compta/entries/${e.id}/paid`, { date: '2999-01-01' })).status, 400, 'pas de paiement dans le futur');
  assert.equal((await entries(u.id))[0].pending, 1);
});

test('case « Joindre automatiquement à la comptabilité » : décochée, la facture reste en PDF et n\'entre pas en comptabilité', async () => {
  const { u, pid, byKind } = await ready();
  await post(u, '/compta/situation', { regime: 'micro', activity: 'services', vat: 'franchise', freq: 'quarterly' });
  const d = await devisOf(u, pid, byKind);
  const r = await post(u, `${base(pid)}/emettre`, { doc: byKind.facture.id, devis_id: d.id });
  assert.equal(r.status, 303);
  const inv = await s.db.prepare("SELECT * FROM billing_invoices WHERE project_id = ? AND kind = 'facture'").get(pid);
  assert.ok(inv && inv.entry_id == null);
  assert.equal((await entries(u.id)).length, 0, 'rien dans la Comptabilité');
  assert.doesNotMatch(await compta(u, '?periode=tout'), /Factures émises, à encaisser/);
  const h = await html(u, page(pid));
  assert.match(h, /Non jointe à la comptabilité/);
  assert.equal((await u.get(`/facturation/factures/${inv.id}/pdf`, { headers: { accept: '*/*' } })).status, 200);
  assert.match(h, /name="to_accounting" value="1" checked/);
  assert.equal((h.match(/name="to_accounting"/g) || []).length, 1);
  assert.match(h, /data-for="acompte facture avoir"/);
  await emit(u, pid, byKind.facture, { devis_id: d.id });
  assert.equal((await entries(u.id)).length, 1);
});

test('section « Générer un document » : devis d\'abord (lignes à saisir), puis les autres pièces avec devis de référence', async () => {
  const { u, pid, byKind } = await ready();
  let h = await html(u, `${page(pid)}?type=avoir`);
  assert.match(h, /<h2 id="t-gen">Générer un document<\/h2>/);
  assert.match(h, /data-kind="devis" selected/, 'sans devis émis, seul le devis est possible');
  for (const t of ['Acompte', 'Facture finale', 'Avoir']) assert.match(h, new RegExp(`<option value="\\d+" data-kind="[a-z]+" disabled>${t} \\(génère d'abord un devis\\)</option>`));
  assert.match(h, /name="l0_label"/);
  assert.match(h, /name="l1_label"/);
  assert.match(h, /Ce que ton client commande/);
  assert.match(h, /les lignes des modèles ne sont que des exemples/);
  assert.doesNotMatch(h, /Émettre en PDF :/);
  assert.match(h, /href="\?type=facture#generer"/);
  const d = await devisOf(u, pid, byKind);
  await emit(u, pid, byKind.facture, { devis_id: d.id });
  h = await html(u, `${page(pid)}?type=avoir`);
  assert.match(h, /data-kind="avoir" selected/, 'le type demandé est présélectionné quand il est possible');
  assert.match(h, new RegExp(`<option value="${d.id}">D-\\d{4}-0001 — Boulangerie Dupont — 6\\s300,00\\s€ TTC</option>`));
  assert.match(h, /<option value="\d+" data-devis="\d+">F-\d{4}-0001 — Facture finale — /);
  assert.match(h, /Documents émis[\s\S]*Facture finale · devis D-/);
  await s.db.prepare("UPDATE billing_docs SET status = 'draft' WHERE project_id = ? AND kind = 'acompte'").run(pid);
  assert.match(await html(u, page(pid)), /<option value="\d+" data-kind="acompte" disabled>Acompte \(à valider d'abord\)<\/option>/);
});

test('clients par projet : enregistrés à l\'émission d\'un devis, repris pour les devis suivants, mis à jour sans doublon, jamais partagés', async () => {
  const { u, pid, byKind } = await ready();
  assert.equal((await listClients(s.db, u.id, pid)).length, 0);
  await devisOf(u, pid, byKind);
  let cl = await listClients(s.db, u.id, pid);
  assert.deepEqual(cl.map((c) => [c.name, c.address, c.siret]), [['Boulangerie Dupont', '5 place du Marché, 35000 Rennes', '98765432100011']]);
  let h = await html(u, page(pid));
  assert.match(h, new RegExp(`<option value="${cl[0].id}" data-name="Boulangerie Dupont" data-address="5 place du Marché, 35000 Rennes" data-siret="98765432100011">Boulangerie Dupont</option>`));
  // Même client choisi dans la liste, adresse corrigée : mise à jour, pas de doublon
  await devisOf(u, pid, byKind, { client_id: cl[0].id, client_adresse: '8 rue Neuve, 35000 Rennes' });
  // Même nom saisi à la main (casse différente) : le même client
  await devisOf(u, pid, byKind, { client_nom: 'BOULANGERIE DUPONT', client_adresse: '8 rue Neuve, 35000 Rennes', client_siret: '' });
  cl = await listClients(s.db, u.id, pid);
  assert.equal(cl.length, 1);
  assert.equal(cl[0].address, '8 rue Neuve, 35000 Rennes');
  assert.equal(cl[0].name, 'BOULANGERIE DUPONT');
  await devisOf(u, pid, byKind, { client_nom: 'Atelier Martin', client_adresse: '1 quai, 44000 Nantes', client_siret: '' });
  assert.deepEqual((await listClients(s.db, u.id, pid)).map((c) => c.name), ['Atelier Martin', 'BOULANGERIE DUPONT']);
  // Un client refusé (nom manquant) n'est pas enregistré
  await emit(u, pid, byKind.devis, { client_nom: '', client_adresse: 'x', ...LINES });
  assert.equal((await listClients(s.db, u.id, pid)).length, 2);
  // Un client d'un autre projet ou d'un autre compte n'est jamais repris
  const pid2 = await addProject(s.db, u.id, { name: 'Autre', gitUrl: 'https://github.com/u/autre.git' });
  assert.equal((await listClients(s.db, u.id, pid2)).length, 0);
  const other = await ready();
  assert.doesNotMatch(await html(other.u, page(other.pid)), /Atelier Martin/);
  await devisOf(other.u, other.pid, other.byKind, { client_id: cl[0].id, client_nom: 'Pirate', client_adresse: 'ailleurs', client_siret: '' });
  assert.equal((await listClients(s.db, u.id, pid)).find((c) => c.id === cl[0].id).name, 'BOULANGERIE DUPONT', 'le client d\'un autre compte n\'est pas modifié');
  assert.deepEqual((await listClients(s.db, other.u.id, other.pid)).map((c) => c.name), ['Pirate']);
});
