// Vérifie dans Chromium le sommaire de la documentation de l'API : les sous-rubriques sont repliées, seule celle de la section lue s'ouvre,
// et tout le sommaire tient à l'écran. Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${s.base}/docs/api`);
await p.waitForSelector('.toc[data-fold]');
const visibleSubs = () => p.locator('.toc li > ol > li > a').evaluateAll((as) => as.filter((a) => a.offsetParent !== null).map((a) => a.textContent.trim()));
const sections = await p.locator('.toc > nav > ol > li').evaluateAll((lis) => lis.map((li) => ({ id: li.querySelector(':scope > a').getAttribute('href').slice(1), subs: [...li.querySelectorAll(':scope > ol > li > a')].map((a) => a.getAttribute('href').slice(1)) })));
const withSubs = sections.filter((x) => x.subs.length);
ok(withSubs.length >= 2, `la page a des sections à sous-rubriques (${withSubs.length})`);
ok((await visibleSubs()).length === 0 || sections[0].subs.length > 0, 'en haut de page, aucune sous-rubrique inutile');
const box = await p.locator('.toc').boundingBox();
ok(box.height <= 800 - 48, `tout le sommaire tient à l'écran, collé en haut (hauteur ${Math.round(box.height)} px sur 800)`);
for (const sec of withSubs.slice(0, 2)) {
  await p.evaluate((id) => document.getElementById(id).scrollIntoView(), sec.id);
  await p.waitForTimeout(500);
  const shown = await visibleSubs();
  const own = await p.locator(`.toc a[href="#${sec.subs[0]}"]`).evaluate((a) => a.offsetParent !== null);
  ok(own && shown.length === sec.subs.length, `section « ${sec.id} » : ses ${sec.subs.length} sous-rubriques s'ouvrent seules (${shown.length} visibles)`);
}
await p.evaluate((id) => document.getElementById(id).scrollIntoView(), withSubs[1].subs[withSubs[1].subs.length - 1]);
await p.waitForTimeout(500);
ok((await visibleSubs()).length === withSubs[1].subs.length, 'arrivé sur une sous-rubrique, celles de sa section restent ouvertes');
const box2 = await p.locator('.toc').boundingBox();
ok(box2.y >= 0 && box2.y + box2.height <= 800, `sommaire entièrement visible une section ouverte (bas à ${Math.round(box2.y + box2.height)} px)`);
await p.setViewportSize({ width: 390, height: 780 });
ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'pas de défilement horizontal à 390 px');
ok(errs.length === 0, `aucune erreur JavaScript ${errs.join(' | ')}`);
await b.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
