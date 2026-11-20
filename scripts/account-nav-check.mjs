// Vérifie dans Chromium la barre de gauche de « Mon compte » : elle reste collée pendant le défilement (≥ 900 px) et l'onglet actif suit la section lue.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
import { testTokenLink } from '../test/helpers/users.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const u = await s.newUser({ admin: false, link: testTokenLink() });
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const [name, value] = u.cookie.split('=');
await ctx.addCookies([{ name, value, url: s.base }]);
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${s.base}/account`);
await p.waitForSelector('html[data-nav="ready"]');
const nav = p.locator('.acct .tools-nav');
const cur = () => p.locator('.acct .tools-nav [aria-current="true"]').allTextContents();
ok((await cur()).join() === 'Mon IA', `en haut de page, « Mon IA » est actif (${await cur()})`);
const top0 = Math.round((await nav.boundingBox()).y);
for (const [id, label] of [['profil', 'Mon profil'], ['danger', 'Zone de danger']]) {
  await p.evaluate((i) => document.getElementById(i).scrollIntoView(), id);
  await p.waitForTimeout(400);
  const bx = await nav.boundingBox();
  ok(bx.y >= 0 && bx.y < 120 && bx.y <= top0, `barre collée en haut après défilement vers « ${label} » (y=${Math.round(bx.y)})`);
  ok(bx.y + bx.height <= 800, `barre entièrement visible (bas à ${Math.round(bx.y + bx.height)} px)`);
  ok((await cur()).join() === label, `« ${label} » devient l'onglet actif (${await cur()})`);
}
ok(errs.length === 0, `aucune erreur JavaScript ${errs.join(' | ')}`);
await b.close(); await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
