// Vérifie dans un vrai navigateur la section « Générer un document » de la Facturation : champs selon le type (facture, avoir, devis), client choisi qui remplit ses champs,
// génération depuis la page, liste des clients, bureau et téléphone, aucun défilement horizontal, aucune erreur console. Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM).
// SHOTS=<dossier> enregistre des captures. Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { makeClaudeBin } from '../test/helpers/claude-bin.js';
import { addProject, testTokenLink } from '../test/helpers/users.js';
import { Worker } from '../src/services/jobs.js';
import { makeHandlers } from '../src/handlers.js';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const chromium = pw.chromium || pw.default.chromium;
const s = await startApp(); s.app.cfg.claudeBin = makeClaudeBin(s.tmp);
const worker = new Worker(s.db, makeHandlers(s.app), { log: { error: () => {} } });
const u = await s.newUser({ link: testTokenLink() });
const pid = await addProject(s.db, u.id, { name: 'Fidélio', gitUrl: 'https://github.com/u/f.git' });
const L = { legal_form: 'micro', legal_name: 'Tony Averty', siret: '12345678900012', address: '12 rue des Lilas', postal_code: '35000', city: 'Rennes', vat_mode: 'franchise', email: 't@e.fr', payment_terms_days: '30', quote_validity_days: '30', activity_label: 'Dev', offer_description: 'Apps.' };
const post = (p, b) => u.post(p, b, { form: true }); const B = `/facturation/projet/${pid}`;
await post('/compta/situation', { regime: 'micro', activity: 'services', vat: 'franchise', freq: 'quarterly' });
await post(`${B}/legal`, L); await post(`${B}/generer`, {}); await worker.tick(); await post(`${B}/choisir`, { variant: 1 });
const o = (await s.db.prepare('SELECT * FROM billing_docs WHERE project_id=?').all(pid))[0]; await post(`${B}/valider`, { doc: o.id }); await worker.tick();
const fin = (await s.db.prepare("SELECT * FROM billing_docs WHERE project_id=? AND kind<>'quote_option'").all(pid)); for (const d of fin) await post(`${B}/valider`, { doc: d.id });
const f = fin.find((d) => d.kind === 'facture');
await post(`${B}/emettre`, { doc: f.id, client_nom: 'Boulangerie Dupont', client_adresse: '5 place du Marché, 35000 Rennes', client_siret: '98765432100011' });
await post(`${B}/emettre`, { doc: fin.find((d) => d.kind === 'acompte').id, client_nom: 'Boulangerie Dupont', client_adresse: '5 place du Marché, 35000 Rennes' });
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
let bad = 0; const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
for (const w of [1280, 390]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } }); const [n, v] = u.cookie.split('=');
  await ctx.addCookies([{ name: n, value: v, url: s.base }]); await ctx.route('**/*', (route) => { const r = route.request(); const h = { ...r.headers() }; if (r.method() === 'POST') h.origin = APP_URL; route.continue({ headers: h }); });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}${B}?type=facture`); await p.waitForTimeout(800);
  const form = p.locator('[data-issue]');
  ok(await form.isVisible(), `${w} section « Générer un document » visible`);
  ok(await form.locator('[name="facture_numero"]').isHidden() && await form.locator('[name="date_prestation"]').isVisible(), `${w} facture : date de prestation visible, champs d'avoir masqués`);
  await form.locator('[data-issue-kind]').selectOption({ label: 'Avoir' });
  ok(await form.locator('[name="facture_numero"]').isVisible() && await form.locator('[name="date_prestation"]').isHidden(), `${w} avoir : champs de l'avoir visibles`);
  await form.locator('[data-issue-kind]').selectOption({ label: 'Devis' });
  ok(await form.locator('[name="to_accounting"]').isHidden(), `${w} devis : pas de case comptabilité`);
  await form.locator('[data-issue-client]').selectOption({ label: 'Boulangerie Dupont' });
  ok(await form.locator('[name="client_nom"]').inputValue() === 'Boulangerie Dupont' && (await form.locator('[name="client_adresse"]').inputValue()).startsWith('5 place'), `${w} le client choisi remplit ses champs`);
  await form.locator('[data-issue-client]').selectOption({ index: 0 });
  ok(await form.locator('[name="client_nom"]').inputValue() === '', `${w} « Nouveau client » vide les champs`);
  await form.locator('[data-issue-kind]').selectOption({ label: 'Facture finale' });
  await form.locator('[data-issue-client]').selectOption({ label: 'Boulangerie Dupont' });
  await p.screenshot({ path: `${process.env.SHOTS || '.'}/gen-${w}.png`, fullPage: false });
  await p.locator('#generer').screenshot({ path: `${process.env.SHOTS || '.'}/gen-sec-${w}.png` });
  await form.getByRole('button', { name: 'Générer le PDF' }).click(); await p.waitForTimeout(900);
  ok(/Document émis/.test(await p.locator('body').innerText()), `${w} génération depuis la page`);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${w} aucun défilement horizontal`);
  await p.locator('#clients').screenshot({ path: `${process.env.SHOTS || '.'}/gen-clients-${w}.png` });
  ok(errs.length === 0, `${w} aucune erreur console ${errs.slice(0,2)}`);
}
await b.close(); await s.close(); console.log(bad ? 'ECHEC' : 'TOUT EST BON');
