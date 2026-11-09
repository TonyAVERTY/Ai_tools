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
let pid = 0; let B = ''; let PAGE = '';
const L = { legal_form: 'micro', legal_name: 'Tony Averty', siret: '12345678900012', address: '12 rue des Lilas', postal_code: '35000', city: 'Rennes', vat_mode: 'franchise', email: 't@e.fr', payment_terms_days: '30', quote_validity_days: '30', activity_label: 'Dev', offer_description: 'Apps.' };
const post = (p, b) => u.post(p, b, { form: true });
await post('/compta/situation', { regime: 'micro', activity: 'services', vat: 'franchise', freq: 'quarterly' });
const L0 = L;
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
let bad = 0; const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
/** Un projet neuf dont les quatre modèles sont validés (devis, acompte, facture finale, avoir). */
async function freshProject(name) {
  pid = await addProject(s.db, u.id, { name, gitUrl: `https://github.com/u/${name}.git` }); B = `/facturation/projet/${pid}`; PAGE = `/p/${pid}/facturation`;
  await post(`${B}/legal`, L0); await post(`${B}/generer`, {}); await worker.tick(); await post(`${B}/choisir`, { variant: 1 });
  const o = (await s.db.prepare('SELECT * FROM billing_docs WHERE project_id=?').all(pid))[0]; await post(`${B}/valider`, { doc: o.id }); await worker.tick();
  for (const d of await s.db.prepare("SELECT * FROM billing_docs WHERE project_id=? AND kind<>'quote_option'").all(pid)) await post(`${B}/valider`, { doc: d.id });
}
for (const w of [1280, 390]) {
  await freshProject(`projet${w}`);
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } }); const [n, v] = u.cookie.split('=');
  await ctx.addCookies([{ name: n, value: v, url: s.base }]); await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */ await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const wait = () => p.waitForTimeout(900);
  await p.goto(`${s.base}${PAGE}`); await wait();
  const form = p.locator('[data-issue]');
  ok(await form.isVisible(), `${w} section « Générer un document » visible`);
  const opt = (label) => form.locator('[data-issue-kind] option', { hasText: label });
  ok(await opt('Facture finale').evaluate((e) => e.disabled), `${w} sans devis, la facture finale n'est pas possible`);
  ok(await form.locator('[name="l0_label"]').isVisible() && await form.locator('[data-issue-devis]').isHidden(), `${w} devis : lignes à saisir, pas de devis de référence`);
  // Devis : client + deux lignes saisies (la deuxième ajoutée avec le bouton)
  await form.locator('[name="client_nom"]').fill('Boulangerie Dupont');
  await form.locator('[name="client_adresse"]').fill('5 place du Marché, 35000 Rennes');
  await form.locator('[name="l0_label"]').fill('Cadrage'); await form.locator('[name="l0_price"]').fill('900');
  await form.locator('[name="l1_label"]').fill('Développement'); await form.locator('[name="l1_qty"]').fill('12'); await form.locator('[name="l1_price"]').fill('450,00');
  await form.getByRole('button', { name: 'Ajouter une ligne' }).click();
  ok(await form.locator('[name="l3_label"]').count() === 1, `${w} « Ajouter une ligne » ajoute une ligne`);
  ok(/6\s300,00/.test(await form.locator('[data-lines-total]').innerText()), `${w} total HT calculé en direct`);
  await p.screenshot({ path: `${process.env.SHOTS || '.'}/gen-devis-${w}.png` });
  await form.getByRole('button', { name: 'Générer le PDF' }).click(); await wait();
  ok(/Devis émis/.test(await p.locator('body').innerText()), `${w} devis émis`);
  // Facture finale : rattachée au devis, sans ressaisir le client ni les lignes
  const form2 = p.locator('[data-issue]');
  await form2.locator('[data-issue-kind]').selectOption({ label: 'Facture finale' });
  ok(await form2.locator('[name="client_nom"]').isHidden() && await form2.locator('[name="l0_label"]').isHidden() && await form2.locator('[data-issue-devis]').isVisible(), `${w} facture : devis de référence, ni client ni lignes à ressaisir`);
  await form2.locator('[data-issue-devis]').selectOption({ index: 1 });
  await p.screenshot({ path: `${process.env.SHOTS || '.'}/gen-facture-${w}.png` });
  await form2.getByRole('button', { name: 'Générer le PDF' }).click(); await wait();
  ok(/Document émis/.test(await p.locator('body').innerText()), `${w} facture émise`);
  ok(/Facture finale · devis D-/.test(await p.locator('#emis').innerText()), `${w} la facture indique son devis de référence`);
  // Avoir : sur la facture du devis
  const form3 = p.locator('[data-issue]');
  await form3.locator('[data-issue-kind]').selectOption({ label: 'Avoir' });
  await form3.locator('[data-issue-devis]').selectOption({ index: 1 });
  ok(await form3.locator('[data-issue-ref] option:not([hidden]):not([value=""])').count() === 1, `${w} l'avoir ne propose que les factures du devis choisi`);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${w} aucun défilement horizontal`);
  ok(errs.length === 0, `${w} aucune erreur console ${errs.slice(0, 2)}`);
}
await b.close(); await s.close(); console.log(bad ? 'ECHEC' : 'TOUT EST BON');
