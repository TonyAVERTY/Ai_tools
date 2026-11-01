// Vérifie dans un vrai navigateur le réglage « Pied de page des mails » : avertissement visible, confirmation avant retrait (annuler ne change rien),
// état mémorisé après rechargement, retour sans confirmation. Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const u = await s.newUser();
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
  await p.goto(`${s.base}/settings`);
  await p.waitForSelector('html[data-nav="ready"]');
  const box = p.locator('[data-footer-opt]');
  await box.scrollIntoViewIfNeeded();
  ok(await box.locator('.ban').isVisible() && /risques/.test(await box.locator('.ban').innerText()), `${tag} l'avertissement sur les risques est affiché`);
  ok(await p.locator('[data-footer-off]').isVisible() && await p.locator('[data-footer-on]').isHidden(), `${tag} actif : seul « Retirer… » est proposé`);
  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/footer-${vp.width}.png` });

  // Annuler la confirmation : rien ne change
  let asked = '';
  p.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await p.locator('[data-footer-off]').click();
  await p.waitForTimeout(400);
  ok(/RGPD/.test(asked) && /Spam/.test(asked), `${tag} une confirmation rappelle les risques avant le retrait`);
  ok(await p.locator('[data-footer-off]').isVisible(), `${tag} annuler ne change rien`);

  // Confirmer
  p.once('dialog', (d) => d.accept());
  await p.locator('[data-footer-off]').click();
  await p.waitForSelector('[data-footer-on]:not([hidden])');
  ok(/Retiré/.test(await p.locator('[data-footer-state]').innerText()) && await p.locator('[data-footer-off]').isHidden(), `${tag} confirmé : le pied de page est retiré, « Remettre… » apparaît`);
  await p.reload();
  await p.waitForSelector('html[data-nav="ready"]');
  ok(/Retiré/.test(await p.locator('[data-footer-state]').innerText()), `${tag} l'état est gardé après rechargement`);

  // Remettre : sans confirmation
  let popped = false;
  p.on('dialog', (d) => { popped = true; d.dismiss(); });
  await p.locator('[data-footer-on]').click();
  await p.waitForSelector('[data-footer-off]:not([hidden])');
  ok(!popped, `${tag} remettre le pied de page ne demande pas de confirmation`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
