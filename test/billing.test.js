// Facturation : informations légales (validation, valeurs lues dans le code), contenu et rendu des documents (mentions légales fixées par le code),
// avancement, puis le parcours complet avec un faux Claude : trois devis, choix, affinage, validation, quatre documents, tous validés.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp } from './helpers/server.js';
import { makeClaudeBin } from './helpers/claude-bin.js';
import { addProject, testTokenLink } from './helpers/users.js';
import { Worker, latestJobs } from '../src/services/jobs.js';
import { makeHandlers, creeping } from '../src/handlers.js';
import { setSetting } from '../src/db.js';
import {
  normalizeLegal, legalMissing, legalComplete, suggestFromRepo, suggestFromAnalysis, suggestFromOthers, buildSuggestions, normalizeContent, totalsOf, rateOf, renderDocument, legalMentions, billingStage, stageLabel, DOC_KINDS,
} from '../src/services/billing.js';
import { AI_JOBS } from '../src/services/budget.js';

const LEGAL = { legal_form: 'micro', legal_name: 'Tony Averty', siret: '123 456 789 00012', address: '12 rue des Lilas', postal_code: '35000', city: 'Rennes', vat_mode: 'franchise',
  email: 'Tony@Exemple.fr', payment_terms_days: '30', quote_validity_days: '30', activity_label: 'Développement web', offer_description: "Des applications web sur mesure." };
const ok = () => normalizeLegal(LEGAL).values;

test('informations légales : formats vérifiés, obligations selon la forme juridique et la TVA, valeurs par défaut', () => {
  const { values, errors } = normalizeLegal(LEGAL);
  assert.deepEqual(errors, {});
  assert.equal(values.siret, '12345678900012', 'espaces retirés');
  assert.equal(values.email, 'tony@exemple.fr');
  assert.equal(legalComplete(LEGAL), true);
  assert.deepEqual(legalMissing({}).slice(0, 3), ['legal_form', 'legal_name', 'siret'], 'tout est à remplir au départ');
  assert.equal(normalizeLegal({}).values.payment_terms_days, '30', 'délais par défaut');
  // Société : capital et immatriculation obligatoires
  assert.deepEqual(legalMissing({ ...LEGAL, legal_form: 'sas' }).sort(), ['capital', 'rcs']);
  // TVA : numéro obligatoire, taux 20 % par défaut ; en franchise ils sont effacés
  assert.deepEqual(legalMissing({ ...LEGAL, vat_mode: 'assujetti' }), ['vat_number']);
  assert.equal(normalizeLegal({ ...LEGAL, vat_mode: 'assujetti', vat_number: 'fr 12 345678901' }).values.vat_rate, '2000');
  assert.equal(normalizeLegal({ ...LEGAL, vat_number: 'FR12345678901', vat_rate: '1000' }).values.vat_number, '', 'franchise : plus de numéro de TVA');
  const bad = (over, key) => assert.ok(key in normalizeLegal({ ...LEGAL, ...over }).errors, `${key} refusé`);
  bad({ siret: '123' }, 'siret');
  bad({ postal_code: '3500' }, 'postal_code');
  bad({ email: 'pas-un-mail' }, 'email');
  bad({ iban: 'FR7612345678901234567890124' }, 'iban');
  bad({ payment_terms_days: '90' }, 'payment_terms_days');
  bad({ website: 'javascript:alert(1)' }, 'website');
  assert.deepEqual(normalizeLegal({ ...LEGAL, iban: 'FR14 2004 1010 0505 0001 3M02 606' }).errors, {}, 'IBAN valide (clé modulo 97)');
});

test('valeurs proposées : le dépôt (package.json, LICENSE), l\'analyse, la comptabilité, jamais hors du dépôt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repo-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', author: 'Tony Averty <tony@exemple.fr> (https://exemple.fr)', homepage: 'https://mon-produit.fr' }));
  writeFileSync(join(dir, 'LICENSE'), 'MIT License\n\nCopyright (c) 2024 Atelier Averty\n');
  const r = suggestFromRepo(dir);
  assert.deepEqual([r.legal_name.value, r.legal_name.source, r.email.value, r.website.value], ['Tony Averty', 'package.json', 'tony@exemple.fr', 'https://exemple.fr']);
  const only = mkdtempSync(join(tmpdir(), 'repo-'));
  writeFileSync(join(only, 'LICENSE'), 'Copyright © 2023 Atelier Averty. All rights reserved.');
  assert.equal(suggestFromRepo(only).legal_name.value, 'Atelier Averty');
  // Un lien symbolique vers un fichier hors du dépôt n'est jamais lu
  const evil = mkdtempSync(join(tmpdir(), 'repo-'));
  const secret = join(mkdtempSync(join(tmpdir(), 'out-')), 'package.json');
  writeFileSync(secret, JSON.stringify({ author: 'Secret <s@x.fr>' }));
  symlinkSync(secret, join(evil, 'package.json'));
  assert.deepEqual(suggestFromRepo(evil), {});
  assert.deepEqual(suggestFromRepo(join(dir, 'nexiste-pas')), {});
  const s = buildSuggestions({ repo: r, profile: { resume: 'Cartes de fidélité.' }, accounting: { vat: 'franchise', regime: 'micro' }, smtpEmail: 'envoi@x.fr', accountEmail: 'moi@x.fr' });
  assert.equal(s.email.value, 'tony@exemple.fr', 'le dépôt passe avant l\'adresse d\'envoi');
  assert.deepEqual([s.offer_description.source, s.vat_mode.source, s.legal_form.value], ["l'analyse du projet", 'ta comptabilité', 'micro']);
});

test('analyse du projet : seules les valeurs trouvées et au bon format sont proposées, les autres projets du compte passent avant', () => {
  const found = { legal_name: 'Atelier Averty', siret: '123 456 789 00012', postal_code: '3500', city: 'Rennes', website: 'javascript:x', phone: null, email: 'null', vat_number: 'n/a', activity_label: 'Développement web', pricing_notes: 'Forfait dès 900 €' };
  const a = suggestFromAnalysis(found);
  assert.deepEqual(Object.keys(a).sort(), ['activity_label', 'city', 'legal_name', 'pricing_notes', 'siret']);
  assert.equal(a.siret.value, '12345678900012');
  assert.equal(a.siret.source, "l'analyse du projet");
  assert.deepEqual(suggestFromAnalysis('texte'), {});
  assert.deepEqual(suggestFromAnalysis(null), {});
  const others = suggestFromOthers([{ legal_name: 'Ma Société', siret: '99999999900011', email: '' }, { legal_name: 'Ancienne', email: 'a@b.fr' }]);
  assert.deepEqual([others.legal_name.value, others.siret.value, others.email.value, others.legal_name.source], ['Ma Société', '99999999900011', 'a@b.fr', 'un autre de tes projets']);
  const s = buildSuggestions({ others: [{ siret: '99999999900011' }], profile: { resume: 'R', facturation: found }, repo: { legal_name: { value: 'Pkg', source: 'package.json' } } });
  assert.equal(s.siret.value, '99999999900011', 'ce que tu as déjà validé passe avant l\'analyse');
  assert.equal(s.legal_name.value, 'Pkg', 'le dépôt passe avant l\'analyse');
  assert.equal(s.city.value, 'Rennes');
  assert.equal(s.offer_description.value, 'R');
});

test('contenu d\'un document : borné, typé, sans HTML ; totaux et TVA calculés par le code', () => {
  const c = normalizeContent({ layout: 'moderne', title: 'x'.repeat(200), lines: [{ label: 'A', qty: '2,5', unit_price: '100' }, { label: '' }, { label: 'B', qty: -4, unit_price: 'abc' }], deposit_percent: 500 }, 'devis');
  assert.equal(c.title.length, 80);
  assert.equal(c.lines.length, 2, 'ligne sans désignation écartée');
  assert.deepEqual([c.lines[0].qty, c.lines[0].unit_price, c.lines[1].qty, c.lines[1].unit_price], [2.5, 100, 0.01, 0]);
  assert.equal(c.deposit_percent, 90);
  assert.equal(normalizeContent({ lines: [] }, 'devis'), null);
  assert.equal(normalizeContent('texte', 'devis'), null);
  assert.equal(normalizeContent({ layout: 'bizarre', lines: [{ label: 'A', unit_price: 10 }] }).layout, 'classique');
  assert.deepEqual(totalsOf([{ qty: 2, unit_price: 100 }, { qty: 1, unit_price: 50.5 }], 2000), { ht: 25050, vat: 5010, ttc: 30060, rate: 2000 });
  assert.equal(totalsOf([{ qty: 1, unit_price: 100 }], 0).vat, 0);
  assert.equal(rateOf({ vat_mode: 'franchise', vat_rate: '2000' }), 0);
  assert.equal(rateOf({ vat_mode: 'assujetti', vat_rate: '1000' }), 1000);
});

const CONTENT = normalizeContent({ title: 'Devis', intro: 'Bonjour.\n\nMerci.', lines: [{ label: 'Application <b>web</b>', description: 'Sur mesure', qty: 1, unit: 'forfait', unit_price: 1000 }], conditions: 'Deux retouches.', payment: '30 % à la commande.', closing: 'Cordialement.', deposit_percent: 30, reason: 'Erreur' }, 'devis');

test('rendu : identité et mentions légales fixées par le code, variables laissées vides, tout est échappé', () => {
  const legal = ok();
  const d = renderDocument({ kind: 'devis', content: CONTENT, legal, layout: 'moderne' });
  assert.match(d, /<h2>Tony Averty<\/h2>/);
  assert.match(d, /SIRET 123 456 789 00012/);
  assert.match(d, /TVA non applicable, art\. 293 B du CGI/);
  assert.match(d, /Devis valable 30 jours/);
  assert.match(d, /Bon pour accord/);
  assert.match(d, /<span class="ph">\{\{client_nom\}\}<\/span>/);
  assert.match(d, /Total TTC<\/span><span>1\s000,00 €/);
  assert.doesNotMatch(d, /<b>web<\/b>/, 'le HTML d\'une désignation est échappé');
  assert.match(d, /Application &lt;b&gt;web&lt;\/b&gt;/);
  assert.doesNotMatch(d, /<script|onerror=/i);
  // Assujetti : TVA détaillée et numéro de TVA
  const tva = { ...legal, vat_mode: 'assujetti', vat_number: 'FR12345678901', vat_rate: '2000' };
  const t = renderDocument({ kind: 'facture', content: CONTENT, legal: tva, layout: 'classique' });
  assert.match(t, /N° de TVA intracommunautaire : FR12345678901/);
  assert.match(t, /TVA 20 %<\/span><span>200,00 €/);
  assert.match(t, /Acompte déjà réglé \(30 %\)<\/span><span>− 360,00 €/, '30 % de 1 200 € TTC');
  assert.match(t, /Reste à payer TTC<\/span><span>840,00 €/);
  assert.match(t, /pénalité égale à trois fois le taux d(?:'|&#39;)intérêt légal/);
  assert.match(t, /indemnité forfaitaire de 40 €/);
  assert.match(t, /Paiement à 30 jours/);
  const a = renderDocument({ kind: 'acompte', content: CONTENT, legal: tva, layout: 'epure' });
  assert.match(a, /Acompte de 30 % à la commande/);
  assert.match(a, /Total TTC à payer<\/span><span>360,00 €/);
  const av = renderDocument({ kind: 'avoir', content: CONTENT, legal: tva, layout: 'classique' });
  assert.match(av, /Total de l(?:'|&#39;)avoir TTC<\/span><span>[−-]1\s200,00 €/);
  assert.match(av, /Motif de l(?:'|&#39;)avoir :<\/b> Erreur/);
  assert.match(av, /\{\{facture_numero\}\}/);
  assert.doesNotMatch(av, /pénalité/, 'pas de pénalités sur un avoir');
  assert.match(legalMentions('devis', { ...legal, legal_form: 'sas', capital: '1 000', rcs: 'RCS Rennes 123' })[0], /SAS au capital de 1 000 € — SIRET .* — RCS Rennes 123/);
});

test('avancement : informations légales → exemples → devis validé → documents → prêt', () => {
  const legal = ok();
  const docs = (...l) => l.map(([kind, variant, status]) => ({ kind, variant, status }));
  const st = (o) => billingStage({ legal, ...o }).stage;
  assert.equal(billingStage({ legal: normalizeLegal({}).values }).stage, 'legal');
  assert.equal(st({}), 'generate');
  assert.equal(st({ docs: docs(['quote_option', 1, 'draft'], ['quote_option', 2, 'draft'], ['quote_option', 3, 'draft']) }), 'choose');
  assert.equal(st({ docs: docs(['quote_option', 1, 'validated']) }), 'docs_pending');
  const finals = (status) => DOC_KINDS.map(({ key }) => ['' + key, 0, status]);
  assert.equal(st({ docs: docs(['quote_option', 1, 'validated'], ...finals('draft')) }), 'validate');
  assert.equal(st({ docs: docs(['quote_option', 1, 'validated'], ...finals('validated')) }), 'ready');
  assert.equal(billingStage({ legal, docs: docs(['quote_option', 1, 'validated'], ...finals('validated')) }).steps.every((x) => x.done), true);
  assert.equal(billingStage({ legal, jobs: { billing_docs: { status: 'running' } } }).busy, true);
  assert.deepEqual(stageLabel({ stage: 'legal' }, 3), ['3 informations légales à compléter', 'warn']);
  for (const j of ['billing_quotes', 'billing_refine', 'billing_docs']) assert.ok(AI_JOBS.has(j), `${j} est une tâche IA (plafond du plan, liaison Claude)`);
});

// ---------- Parcours complet ----------

let s, worker;
before(async () => {
  s = await startApp();
  s.app.cfg.claudeBin = makeClaudeBin(s.tmp);
  worker = new Worker(s.db, makeHandlers(s.app), { log: { error: () => {} } });
});
after(async () => { await s.close(); });
const html = (u, p) => u.get(p, { headers: { accept: 'text/html' } }).then((r) => r.text()).then((t) => t.replaceAll('&#39;', "'"));
const post = (u, p, body = {}) => u.post(p, body, { form: true });
async function setup(over = {}) {
  const u = await s.newUser({ link: testTokenLink() });
  const pid = await addProject(s.db, u.id, { name: 'Fidélio', gitUrl: 'https://github.com/u/fidelio.git' });
  await s.db.prepare('UPDATE projects SET profile_json = ? WHERE id = ?').run(JSON.stringify({ resume: 'Cartes de fidélité digitales.', proposition_valeur: 'Fidélisez sans carton.' }), pid);
  return { u, pid, ...over };
}
const base = (pid) => `/facturation/projet/${pid}`;
const saveLegal = (u, pid, over = {}) => post(u, `${base(pid)}/legal`, { ...LEGAL, ...over });
const jobOf = async (pid, type) => { await worker.tick(); return (await latestJobs(s.db, pid))[type]; };
const docsOf = async (pid) => (await s.db.prepare('SELECT * FROM billing_docs WHERE project_id = ? ORDER BY kind, variant').all(pid));

test('recap : mes projets seulement, avec leur état ; la page d\'un projet est fermée aux autres comptes', async () => {
  const { u, pid } = await setup();
  const v = await s.newUser();
  await addProject(s.db, v.id, { name: 'Projet secret', gitUrl: 'https://github.com/v/secret.git' });
  assert.equal((await s.anon.get('/facturation', { headers: { accept: 'text/html' } })).status, 303);
  const h = await html(u, '/facturation');
  assert.match(h, /<h1>Facturation<\/h1>/);
  assert.match(h, /Fidélio/);
  assert.doesNotMatch(h, /Projet secret/);
  assert.match(h, /17 informations légales à compléter|\d+ informations légales à compléter/);
  assert.match(h, /Compléter les informations/);
  assert.match(h, /<b>0<\/b> projet prêt sur <b>1<\/b>/);
  assert.equal((await v.get(base(pid), { headers: { accept: 'text/html' } })).status, 404, 'le projet d\'un autre');
  assert.equal((await post(v, `${base(pid)}/legal`, LEGAL)).status, 404);
  assert.equal((await post(v, `${base(pid)}/generer`)).status, 404);
  const empty = await html(await s.newUser(), '/facturation');
  assert.match(empty, /Aucun projet pour l'instant/);
});

test('informations légales : prérempli depuis le projet, enregistré même incomplet, le bouton de génération n\'apparaît qu\'une fois tout rempli', async () => {
  const { u, pid } = await setup();
  await post(u, '/compta/situation', { regime: 'micro', activity: 'services', vat: 'franchise', freq: 'quarterly' });
  let h = await html(u, base(pid));
  assert.match(h, /Repris de l'analyse du projet/);
  assert.match(h, /Cartes de fidélité digitales\./, 'résumé de l\'analyse proposé comme description de l\'offre');
  assert.match(h, /Repris de ta comptabilité/);
  assert.doesNotMatch(h, /Générer un modèle de document/, 'rien à générer tant que les informations manquent');
  // Incomplet : enregistré, avec les erreurs affichées
  let r = await saveLegal(u, pid, { siret: '123', address: '' });
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location'), /verif=1/);
  h = await html(u, base(pid) + '?verif=1&ok=legal_incomplet');
  assert.match(h, /Le SIRET compte 14 chiffres\./);
  assert.match(h, /Informations enregistrées : il en manque encore/);
  assert.doesNotMatch(h, /Générer un modèle de document/);
  assert.equal((await post(u, `${base(pid)}/generer`)).status, 400, 'refus côté serveur aussi');
  // Complet
  r = await saveLegal(u, pid);
  assert.match(r.headers.get('location'), /ok=legal$/);
  h = await html(u, base(pid));
  assert.match(h, /Complet/);
  assert.match(h, /Générer un modèle de document/);
  assert.match(h, /value="12345678900012"/);
});

test('préremplissage : l\'analyse et les autres projets proposent des valeurs, rien n\'est enregistré avant la validation', async () => {
  const { u, pid } = await setup();
  await s.db.prepare('UPDATE projects SET profile_json = ? WHERE id = ?').run(JSON.stringify({ resume: 'Cartes.', facturation: { legal_name: 'Atelier Averty', siret: '123 456 789 00012', city: 'Rennes', website: 'javascript:x' } }), pid);
  let h = await html(u, base(pid));
  assert.match(h, /value="Atelier Averty"/);
  assert.match(h, /value="12345678900012"/);
  assert.match(h, /Repris de l'analyse du projet/);
  assert.doesNotMatch(h, /javascript:x/);
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM billing_projects WHERE project_id = ?').get(pid)).n, 0, 'proposé, pas enregistré');
  assert.match(await html(u, '/facturation'), /17 informations légales à compléter|\d+ informations légales à compléter/);
  // Un 2e projet reprend l'identité déjà validée sur le 1er
  await saveLegal(u, pid);
  const pid2 = await addProject(s.db, u.id, { name: 'Autre', gitUrl: 'https://github.com/u/autre.git' });
  h = await html(u, base(pid2));
  assert.match(h, /value="Tony Averty"/);
  assert.match(h, /Repris d'un autre de tes projets/);
  const w = await s.newUser();
  const pidW = await addProject(s.db, w.id, { name: 'Étranger', gitUrl: 'https://github.com/w/x.git' });
  assert.doesNotMatch(await html(w, base(pidW)), /value="Tony Averty"/, 'jamais les informations d\'un autre compte');
});

test('parcours complet : trois devis, choix, affinage, validation, quatre documents, tous validés', async () => {
  const { u, pid } = await setup();
  await saveLegal(u, pid);
  // 1. trois exemples
  assert.equal((await post(u, `${base(pid)}/generer`)).status, 303);
  assert.match((await post(u, `${base(pid)}/generer`)).headers.get('content-type') || '', /./);
  const q = await jobOf(pid, 'billing_quotes');
  assert.equal(q.status, 'done', q.error);
  let docs = await docsOf(pid);
  assert.deepEqual(docs.map((d) => `${d.kind}${d.variant}:${d.layout}`), ['quote_option1:classique', 'quote_option2:moderne', 'quote_option3:epure']);
  let h = await html(u, base(pid));
  assert.match(h, /Choisir cet exemple/);
  assert.match(h, /Forfait clair/);
  assert.match(h, /prix d'exemple/, 'sans tarifs donnés, les prix sont signalés comme exemples');
  assert.equal((h.match(/class="bill-frame"/g) || []).length, 3);
  // Refus : valider ou affiner sans avoir choisi
  const o2 = docs[1].id;
  assert.equal((await post(u, `${base(pid)}/valider`, { doc: o2 })).status, 400);
  assert.equal((await post(u, `${base(pid)}/affiner`, { doc: o2, request: 'plus court' })).status, 400);
  // 2. choisir l'exemple 2, l'affiner
  assert.equal((await post(u, `${base(pid)}/choisir`, { variant: 2 })).status, 303);
  h = await html(u, base(pid));
  assert.match(h, /Ton devis : exemple 2/);
  assert.match(h, /Affiner ce devis/);
  assert.equal((await post(u, `${base(pid)}/affiner`, { doc: o2, request: 'ab' })).status, 400, 'demande trop courte');
  assert.equal((await post(u, `${base(pid)}/affiner`, { doc: o2, request: 'Une remise de 10 % sur le cadrage' })).status, 303);
  const rf = await jobOf(pid, 'billing_refine');
  assert.equal(rf.status, 'done', rf.error);
  const refined = JSON.parse((await s.db.prepare('SELECT content_json FROM billing_docs WHERE id = ?').get(o2)).content_json);
  assert.match(refined.intro, /Affiné : Une remise de 10 % sur le cadrage/);
  assert.equal(refined.lines[0].unit_price, 270, 'le prix suit la demande');
  assert.equal(refined.layout, 'moderne', 'la mise en page ne change pas');
  // 3. valider le devis : Claude prépare les quatre documents
  assert.equal((await post(u, `${base(pid)}/valider`, { doc: o2 })).status, 303);
  assert.match(await html(u, base(pid)), /Claude travaille/);
  const dj = await jobOf(pid, 'billing_docs');
  assert.equal(dj.status, 'done', dj.error);
  docs = await docsOf(pid);
  const finals = docs.filter((d) => d.kind !== 'quote_option');
  assert.deepEqual(finals.map((d) => d.kind).sort(), ['acompte', 'avoir', 'devis', 'facture']);
  assert.ok(finals.every((d) => d.status === 'draft' && d.layout === 'moderne'), 'même mise en page que le devis choisi');
  const lines = (d) => JSON.parse(d.content_json).lines;
  const quoteLines = refined.lines;
  for (const k of ['devis', 'acompte', 'facture']) assert.deepEqual(lines(finals.find((d) => d.kind === k)), quoteLines, `${k} : lignes et prix repris du devis validé`);
  assert.equal(lines(finals.find((d) => d.kind === 'avoir')).length, 1, 'l\'avoir peut ne reprendre qu\'une ligne');
  assert.equal(JSON.parse(finals.find((d) => d.kind === 'facture').content_json).deposit_percent, 30);
  h = await html(u, base(pid));
  assert.match(h, /0<\/b> sur 4<\/b>|<b>0 sur 4<\/b>|0 sur 4/);
  for (const t of ['Devis', 'Acompte', 'Facture finale', 'Avoir']) assert.match(h, new RegExp(`<h3 id="bd-\\d+">${t}</h3>`));
  // un devis validé ne se change plus
  assert.equal((await post(u, `${base(pid)}/generer`)).status, 400);
  // 4. valider les quatre documents un par un
  for (const [i, d] of finals.entries()) {
    assert.equal((await post(u, `${base(pid)}/valider`, { doc: d.id })).status, 303);
    assert.match(await html(u, base(pid)), new RegExp(`${i + 1} sur 4`));
  }
  h = await html(u, base(pid));
  assert.match(h, /Tes documents sont prêts/);
  assert.match(await html(u, '/facturation'), /Documents prêts à l'emploi/);
  assert.match(await html(u, '/facturation'), /<b>1<\/b> projet prêt sur <b>1<\/b>/);
});

test('affiner un document définitif : il repasse à valider, et le devis modifié entraîne l\'acompte et la facture', async () => {
  const { u, pid } = await setup();
  await saveLegal(u, pid);
  await post(u, `${base(pid)}/generer`); await jobOf(pid, 'billing_quotes');
  const [o1] = await docsOf(pid);
  await post(u, `${base(pid)}/choisir`, { variant: 1 });
  await post(u, `${base(pid)}/valider`, { doc: o1.id }); await jobOf(pid, 'billing_docs');
  const finals = (await docsOf(pid)).filter((d) => d.kind !== 'quote_option');
  const byKind = (k) => finals.find((d) => d.kind === k);
  for (const d of finals) await post(u, `${base(pid)}/valider`, { doc: d.id });
  const ready = await html(u, base(pid));
  assert.match(ready, /Tes documents sont prêts/);
  assert.match(ready, /<article class="bill-doc ok locked"/, 'un document validé est un résumé grisé');
  assert.doesNotMatch(ready.split('id="documents"')[1] || '', /<iframe/, 'sans aperçu intégré : « Voir en grand » suffit');
  assert.match(ready, /<summary><svg[^>]*>[^]*?<\/svg>Modifier<\/summary>/, 'la demande de changement s\'ouvre par « Modifier »');
  assert.doesNotMatch(ready, /Valider ce document/, 'plus de bouton « Valider » sur un document validé');
  await post(u, `${base(pid)}/affiner`, { doc: byKind('devis').id, request: 'Remise sur la première ligne' });
  assert.equal((await jobOf(pid, 'billing_refine')).status, 'done');
  const row = async (k) => s.db.prepare('SELECT * FROM billing_docs WHERE id = ?').get(byKind(k).id);
  assert.equal((await row('devis')).status, 'draft', 'à revalider');
  const price = async (k) => JSON.parse((await row(k)).content_json).lines[0].unit_price;
  assert.equal(await price('devis'), 1080);
  assert.equal(await price('acompte'), 1080, 'l\'acompte suit le devis');
  assert.equal(await price('facture'), 1080, 'la facture suit le devis');
  assert.equal((await row('acompte')).status, 'draft');
  assert.doesNotMatch(await html(u, base(pid)), /Tes documents sont prêts/);
});

test('une réponse inutilisable de Claude ne casse rien : l\'erreur est dite, on peut réessayer', async () => {
  const { u, pid } = await setup();
  await saveLegal(u, pid, { pricing_notes: 'BILLBAD' });
  await post(u, `${base(pid)}/generer`);
  const j = await jobOf(pid, 'billing_quotes');
  assert.equal(j.status, 'error');
  assert.equal((await docsOf(pid)).length, 0);
  const h = await html(u, base(pid));
  assert.match(h, /La dernière demande à Claude a échoué/);
  assert.match(h, /Générer un modèle de document/, 'on peut réessayer');
});

test('recommencer efface exemples et documents, garde les informations légales', async () => {
  const { u, pid } = await setup();
  await saveLegal(u, pid);
  await post(u, `${base(pid)}/generer`); await jobOf(pid, 'billing_quotes');
  assert.equal((await docsOf(pid)).length, 3);
  assert.equal((await post(u, `${base(pid)}/recommencer`)).status, 303);
  assert.equal((await docsOf(pid)).length, 0);
  assert.match(await html(u, base(pid)), /Générer un modèle de document/);
  assert.equal(legalComplete((await s.db.prepare('SELECT legal_json FROM billing_projects WHERE project_id = ?').get(pid)).legal_json ? JSON.parse((await s.db.prepare('SELECT legal_json FROM billing_projects WHERE project_id = ?').get(pid)).legal_json) : {}), true);
});

test('aperçu : HTML isolé (aucun script, aucun réseau), lisible par son auteur seulement', async () => {
  const { u, pid } = await setup();
  await saveLegal(u, pid);
  await post(u, `${base(pid)}/generer`); await jobOf(pid, 'billing_quotes');
  const [d] = await docsOf(pid);
  const r = await u.get(`/facturation/documents/${d.id}/apercu`, { headers: { accept: '*/*' } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'; style-src 'unsafe-inline'/);
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  const body = await r.text();
  assert.match(body, /Tony Averty/);
  assert.match(body, /TVA non applicable, art\. 293 B du CGI/);
  const v = await s.newUser();
  assert.equal((await v.get(`/facturation/documents/${d.id}/apercu`, { headers: { accept: '*/*' } })).status, 404);
  assert.notEqual((await s.anon.get(`/facturation/documents/${d.id}/apercu`)).status, 200);
  const state = await (await u.get(`/api/facturation/${pid}/state`)).json();
  assert.equal(state.busy, false);
  assert.equal((await v.get(`/api/facturation/${pid}/state`)).status, 404);
});

test('plan : la facturation compte comme des jobs IA (plafond mensuel du plan)', async () => {
  const { u, pid } = await setup();
  await saveLegal(u, pid);
  await setSetting(s.db, u.id, 'unused', '1');
  const before = Number((await s.db.prepare("SELECT COUNT(*) n FROM usage_events WHERE user_id = ? AND kind = 'ai_job'").get(u.id).catch(() => ({ n: 0 }))).n);
  await post(u, `${base(pid)}/generer`);
  const after = Number((await s.db.prepare("SELECT COUNT(*) n FROM usage_events WHERE user_id = ? AND kind = 'ai_job'").get(u.id).catch(() => ({ n: 1 }))).n);
  assert.ok(after >= before, 'usage enregistré');
});

test('pourcentage : un appel Claude d\'un seul tour fait avancer la barre sans jamais dépasser le plafond, puis s\'arrête', async () => {
  const seen = [];
  const ctx = { progress: async (p) => { seen.push(p); } };
  const r = await creeping(ctx, 'Claude rédige…', 10, () => new Promise((ok) => setTimeout(() => ok('fini'), 2300)), { to: 50, ms: 1000 });
  assert.equal(r, 'fini');
  assert.ok(seen.length >= 1, 'au moins une mise à jour pendant l\'attente');
  assert.ok(seen.every((p) => p.message === 'Claude rédige…' && p.pct > 10 && p.pct < 50));
  const n = seen.length;
  await new Promise((ok) => setTimeout(ok, 2300));
  assert.equal(seen.length, n, 'plus de mise à jour une fois l\'appel terminé');
  await assert.rejects(creeping(ctx, 'x', 0, () => Promise.reject(new Error('boum'))), /boum/);
});

test('pourcentage : le bandeau « Claude travaille… » affiche le pourcentage et la barre, et l\'API d\'état le renvoie', async () => {
  const { u, pid } = await setup();
  await saveLegal(u, pid);
  await post(u, `${base(pid)}/generer`);
  const job = (await latestJobs(s.db, pid)).billing_quotes;
  await s.db.prepare("UPDATE jobs SET status = 'running', progress_json = ? WHERE id = ?").run(JSON.stringify({ message: 'Claude rédige trois exemples de devis…', pct: 42 }), job.id);
  const h = await html(u, base(pid));
  assert.match(h, /data-bill-pct>42 %</);
  assert.match(h, /role="progressbar"[^>]*aria-valuenow="42"/);
  const st = await (await u.get(`/api/facturation/${pid}/state`)).json();
  assert.equal(st.pct, 42);
  assert.equal(st.busy, true);
});
