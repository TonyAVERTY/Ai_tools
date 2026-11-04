// Vérifie dans un vrai navigateur la page Développeur : la suppression d'un jeton demande confirmation (refus = le jeton reste, accord = il part),
// le bouton « Copier » copie la commande, les routes de l'API sont repliées, pas de défilement horizontal à 1280 et 390 px, aucune erreur console.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { testTokenLink } from '../test/helpers/users.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const u = await s.newUser({ admin: false, link: testTokenLink() });
await u.post('/account/developer', { enabled: 'on' }, { form: true });
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  await u.post('/developer/tokens', { name: `Jeton ${vp.width}`, scope_read: 'on' }, { form: true });
  const ctx = await b.newContext({ viewport: vp, permissions: ['clipboard-read', 'clipboard-write'] });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */ await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/developer`);
  await p.waitForSelector('html[data-nav="ready"]');
  ok(!(await p.locator('details.routes').evaluate((d) => d.open)), `${tag} les routes de l'API sont repliées`);
  await p.locator('details.routes > summary').click();
  ok(await p.locator('details.routes table').isVisible(), `${tag} un clic déplie le tableau des routes`);

  // Copier la commande Claude Code
  await p.locator('[data-copy-cmd]').last().click();
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  ok(/^claude mcp add aitools/.test(clip) && /AITOOLS_TOKEN=aitk_/.test(clip), `${tag} « Copier » met la commande dans le presse-papiers`);

  // Suppression : refus puis accord
  const row = p.locator('tr', { hasText: `Jeton ${vp.width}` });
  await row.locator('button.danger').click();
  await p.locator('dialog.confirm').waitFor();
  await p.getByRole('button', { name: 'Annuler' }).click();
  await p.waitForTimeout(400);
  ok((await p.locator('tr', { hasText: `Jeton ${vp.width}` }).count()) === 1, `${tag} un refus garde le jeton`);
  await row.locator('button.danger').click();
  await p.locator('dialog.confirm').waitFor();
  ok(/Supprimer le jeton « Jeton \d+ »/.test(await p.locator('dialog.confirm h2').innerText()), `${tag} la confirmation nomme le jeton`);
  ok(await p.locator('dialog.confirm [data-yes]').evaluate((b) => b.classList.contains('danger-fill')), `${tag} le bouton de suppression est en rouge`);
  await p.locator('dialog.confirm [data-yes]').click();
  await p.waitForFunction((n) => ![...document.querySelectorAll('tr')].some((tr) => tr.textContent.includes(n)), `Jeton ${vp.width}`, { timeout: 5000 }).catch(() => {});
  ok((await p.locator('tr', { hasText: `Jeton ${vp.width}` }).count()) === 0, `${tag} un accord supprime le jeton`);

  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
