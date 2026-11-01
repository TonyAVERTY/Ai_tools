// Vérifie dans un vrai navigateur l'ajout manuel d'un prospect, la modification et la suppression depuis la fiche, et l'aperçu du mail (A/B, texte).
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const u = await s.newUser();
const pid = await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */ await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');
  if (!(await p.locator('details.project').evaluate((d) => d.open))) await p.locator('details.project > summary').click();
  for (const k of ['prospect', 'prospects', 'template']) await p.evaluate((x) => { const d = document.querySelector(`details[data-acc="${x}"]`); if (d) d.open = true; }, k);
  const email = `neuf-${vp.width}@boulangerie.fr`;
  // ajout manuel
  await p.locator('[data-pform-toggle]').click();
  ok(await p.locator('form[data-pform]').isVisible(), `${tag} le formulaire d'ajout s'ouvre`);
  await p.fill('form[data-pform] [name=email]', email);
  await p.fill('form[data-pform] [name=company]', 'Boulangerie Neuve');
  await p.fill('form[data-pform] [name=hook]', 'Votre pain au levain');
  await p.locator('form[data-pform] button.primary').click();
  await p.waitForSelector('[data-prospects] >> text=Boulangerie Neuve');
  if (process.env.DBG) { console.log(await p.evaluate(() => { const b = document.querySelector('[data-open-prospect]'); const r = b.getBoundingClientRect(); const chain = []; for (let e = b; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || e.tagName === 'DETAILS') chain.push(e.tagName + '.' + e.className + ' open=' + e.open + ' disp=' + cs.display); } return JSON.stringify({ r, chain }); })); }
  ok(true, `${tag} le prospect ajouté apparaît dans la liste`);
  // fiche : modification
  await p.locator('[data-prospects] >> text=Boulangerie Neuve').first().click();
  await p.waitForSelector('dialog[open] form[data-dlg="edit"]');
  await p.fill('dialog[open] form[data-dlg="edit"] [name=city]', 'Rennes');
  await p.locator('dialog[open] form[data-dlg="edit"] button.primary, dialog[open] form[data-dlg="edit"] button:not([type=button])').first().click();
  await p.waitForFunction(() => document.querySelector('[data-prospects]')?.textContent.includes('Rennes'));
  ok(true, `${tag} la modification (ville) est enregistrée et visible dans la liste`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal avec la fiche ouverte`);
  // suppression
  p.once('dialog', (d) => d.accept());
  await p.locator('dialog[open] [data-del-prospect]').click();
  await p.waitForFunction(() => !document.querySelector('[data-prospects]')?.textContent.includes('Boulangerie Neuve'));
  ok(true, `${tag} le prospect supprimé disparaît de la liste`);
  // aperçu
  const tpl = 'form[data-action=template][data-kind=initial]';
  await p.fill(`${tpl} [name=subject]`, 'Bonjour {{entreprise}}');
  await p.fill(`${tpl} [name=subjectB]`, 'Une idée pour {{entreprise}}');
  await p.fill(`${tpl} [name=body]`, 'Bonjour,\n\n{{accroche}}\n\n{{expediteur}}');
  await p.locator(`${tpl} label.opt:has([name=html])`).click(); // sans cette case le mail part en texte simple : l'aperçu n'a pas d'iframe
  await p.locator(`${tpl} [data-tpl-preview]`).click();
  await p.waitForSelector('dialog.mailprev[open] iframe');
  const sandbox = await p.locator('dialog.mailprev iframe').getAttribute('sandbox');
  ok(sandbox !== null && !/allow-scripts/.test(sandbox), `${tag} l'aperçu est dans une iframe sans scripts (sandbox="${sandbox}")`);
  const frame = await p.locator('dialog.mailprev iframe').elementHandle().then((h) => h.contentFrame());
  await frame.waitForLoadState();
  ok((await frame.locator('body').innerText()).trim().length > 20, `${tag} le mail s'affiche dans l'aperçu`);
  ok(await p.locator('dialog.mailprev').getByText('Objet B').count() > 0, `${tag} bouton Objet B présent`);
  await p.locator('dialog.mailprev').getByText('Version texte').click();
  await p.waitForSelector('dialog.mailprev .pv-text', { timeout: 8000 }).catch(() => {});
  ok(await p.locator('dialog.mailprev .pv-text').isVisible(), `${tag} l'onglet Version texte s'affiche`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal avec l'aperçu ouvert`);
  await p.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/preview-${vp.width}.png` : undefined }).catch(() => {});
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
