// Vérifie dans Chromium la barre du haut : large page, elle colle en haut, se rétracte en descendant, revient en remontant ; sur téléphone elle reste en place.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core'); const chromium = pw.chromium || pw.default.chromium;
const s = await startApp();
const u = await s.newUser({ email: 'h@x.fr' });
const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
let bad = 0; const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const [n, v] = u.cookie.split('=');
const open = async (vp) => { const ctx = await b.newContext({ viewport: vp, reducedMotion: 'reduce' }); await ctx.addCookies([{ name: n, value: v, url: s.base }]); const p = await ctx.newPage(); await p.goto(`${s.base}/support`, { waitUntil: 'load' }); await p.waitForSelector('html[data-nav="ready"]'); await p.waitForTimeout(300); return p; };
const tall = (p) => p.evaluate(() => { const d = document.createElement('div'); d.style.height = '3000px'; document.querySelector('.page').append(d); }); // la CSP refuse style="…" mais pas le CSSOM
const hidden = (p) => p.evaluate(() => document.querySelector('header.top').classList.contains('top-hidden'));
const scroll = async (p, y) => { await p.evaluate((yy) => window.scrollTo(0, yy), y); await p.waitForTimeout(150); };
{
  const p = await open({ width: 1600, height: 900 });
  await tall(p);
  const w = await p.evaluate(() => document.querySelector('.page').getBoundingClientRect().width);
  ok(w > 1300, `page large sur grand écran (${Math.round(w)} px)`);
  await scroll(p, 600); ok(await hidden(p), 'descendre rétracte la barre');
  await scroll(p, 450); ok(!(await hidden(p)), 'remonter la ramène');
  await scroll(p, 900); ok(await hidden(p), 'descendre de nouveau la rétracte');
  await p.keyboard.press('Tab'); ok(!(await hidden(p)), 'le focus clavier dans la barre la ramène');
  await scroll(p, 0); ok(!(await hidden(p)), 'en haut de page elle est visible');
  await p.close();
}
{
  const p = await open({ width: 390, height: 780 });
  await tall(p);
  await scroll(p, 800);
  const r = await p.evaluate(() => { const e = document.querySelector('.pills').getBoundingClientRect(); return { bottom: Math.round(e.bottom), h: innerHeight }; });
  ok(Math.abs(r.bottom - r.h) <= 1, 'sur téléphone la barre des onglets reste en bas de l\'écran');
  await p.close();
}
await b.close(); await s.close(); console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON'); process.exit(bad ? 1 : 0);
