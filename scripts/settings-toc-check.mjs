// Vérifie dans un vrai navigateur le sommaire des Réglages : un clic sur une rubrique allume cette rubrique (et pas la suivante), le défilement
// à la main allume la rubrique lue, le bas de page allume la dernière. Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). « TOUT EST BON » attendu.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { testTokenLink } from '../test/helpers/users.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const u = await s.newUser({ admin: false, link: testTokenLink() });
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
for (const viewport of [{ width: 1280, height: 800 }, { width: 1248, height: 968 }]) {
  const ctx = await b.newContext({ viewport });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', (route) => { const r = route.request(); const h = { ...r.headers() }; if (r.method() === 'POST') h.origin = APP_URL; route.continue({ headers: h }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${s.base}/settings`);
  await p.waitForSelector('html[data-nav="ready"]');
  const current = () => p.locator('.toc a[aria-current="true"]').getAttribute('href');
  for (const id of ['notif', 'git', 'garde', 'budget', 'prompts']) {
    await p.locator(`.toc a[href="#${id}"]`).click();
    await p.waitForTimeout(1300); // le défilement se termine, la garde du clic aussi
    ok((await current()) === `#${id}`, `${viewport.height} px : un clic sur « ${id} » allume « ${id} » après le défilement (allumé : ${await current()})`);
  }
  await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(400);
  ok((await current()) === '#notif', 'en haut de page : la première rubrique');
  await p.evaluate(() => document.getElementById('garde').scrollIntoView()); await p.waitForTimeout(500);
  ok((await current()) === '#garde', 'un défilement à la main allume la rubrique lue');
  await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(500);
  ok((await current()) === '#prompts', 'tout en bas : la dernière rubrique');
  ok(errs.length === 0, `aucune erreur JavaScript${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close(); await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
