// Vérifie dans un vrai navigateur : la croix de la liste « Mise en route » (retire aussi la pastille « config »), son retour, et le quota Claude dans « Usage du mois ».
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
for (const vp of [{ width: 1280, height: 800, touch: false }, { width: 390, height: 780, touch: true }]) {
  const tag = `${vp.width}px`;
  const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', (route) => { const r = route.request(); const h = { ...r.headers() }; if (r.method() === 'POST') h.origin = APP_URL; route.continue({ headers: h }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');
  await p.waitForSelector('#todo:not([hidden]) .todo-head');
  await p.waitForSelector('[data-cfg]:not([hidden])');
  ok(true, `${tag} la liste « Mise en route » et la pastille « config » sont là`);

  // Indicateurs du plan en tête de page ; la carte « Consommation Claude » reste masquée tant qu'aucune mesure n'existe (la barre du haut le dit déjà)
  ok((await p.locator('.ukpi-c').count()) === 4, `${tag} quatre indicateurs en tête de la page Projets`);
  await p.waitForFunction(() => document.querySelector('#sys')?.textContent.trim().length > 0);
  const bar = await p.locator('#sys').innerText();
  ok(/Claude/.test(bar) && !/\$/.test(bar), `${tag} la barre du haut parle de Claude, sans montant en dollars (compte par abonnement)`);
  ok(await p.locator('[data-claude-card]').evaluate((e) => e.hidden), `${tag} pas de carte « Consommation Claude » sans mesure`);

  const x = p.locator('#todo [data-todo-close]');
  if (!vp.touch) {
    ok(Number(await x.evaluate((e) => getComputedStyle(e).opacity)) === 0, `${tag} la croix est cachée tant qu'on ne survole pas`);
    await p.locator('#todo .todo-head').hover();
    await p.waitForTimeout(250);
    ok(Number(await x.evaluate((e) => getComputedStyle(e).opacity)) === 1, `${tag} la croix apparaît au survol`);
  } else {
    ok(Number(await x.evaluate((e) => getComputedStyle(e).opacity)) === 1, `${tag} au doigt, la croix est toujours visible`);
  }
  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/todo-${vp.width}.png` });
  await x.click();
  await p.waitForSelector('#todo[hidden]', { state: 'attached' });
  ok(await p.locator('[data-cfg]').isHidden(), `${tag} la croix retire la liste ET masque la pastille « config »`);
  const det = p.locator('details.project');
  if (!(await det.evaluate((d) => d.open))) await det.locator('> summary').click();
  ok(await p.locator('[data-todo-restore]').isVisible(), `${tag} le lien « Afficher la mise en route » apparaît dans l'en-tête du projet`);
  await p.reload();
  await p.waitForSelector('html[data-nav="ready"]');
  await p.waitForTimeout(800);
  ok(await p.locator('#todo').isHidden() && await p.locator('[data-cfg]').isHidden(), `${tag} le choix est gardé après rechargement`);
  if (!(await p.locator('details.project').evaluate((d) => d.open))) await p.locator('details.project > summary').click();
  await p.locator('[data-todo-restore-btn]').click();
  await p.waitForSelector('#todo:not([hidden])');
  ok(await p.locator('[data-cfg]').isVisible(), `${tag} « Afficher la mise en route » remet la liste et la pastille`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
