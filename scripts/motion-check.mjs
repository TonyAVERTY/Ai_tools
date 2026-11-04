// Vérifie dans un vrai navigateur les animations qui tournent en boucle (docs/UX.md, « Animations ») : la barre de progression « indéterminée », le filet de navigation en haut de page et la pastille
// d'une tâche en cours bougent bel et bien, mais sans aucune mise en page ni recalcul de style pendant qu'elles tournent (elles n'animent que transform et opacity). Avec le mouvement réduit,
// rien ne bouge et le filet de navigation reste pleine largeur. À 1280 et 390 px. Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };

for (const [mode, reduced] of [['normal', 'no-preference'], ['mouvement réduit', 'reduce']]) {
  for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
    const tag = `${mode} ${vp.width}px`;
    const u = await s.newUser();
    const ctx = await b.newContext({ viewport: vp, reducedMotion: reduced });
    const [name, value] = u.cookie.split('=');
    await ctx.addCookies([{ name, value, url: s.base }]);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${s.base}/`); await p.waitForSelector('html[data-nav="ready"]');
    // les trois éléments, tels que l'application les écrit (classes de public/app.css)
    await p.evaluate(() => {
      const host = document.createElement('div'); host.className = 'card'; host.style.cssText = 'position:fixed;left:10px;top:60px;width:320px;padding:12px;z-index:9999';
      host.innerHTML = '<div class="bar indet" id="m-indet"><span></span></div><p style="display:flex;gap:10px;margin:12px 0 0"><span class="pulse" id="m-pulse"></span></p>';
      document.body.append(host);
      const nb = document.createElement('div'); nb.className = 'nav-bar on'; nb.id = 'm-nav'; document.body.append(nb);
    });
    const box = (sel) => p.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { x: +r.x.toFixed(1), w: +r.width.toFixed(1) }; }, sel);
    const running = () => p.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName).filter((n) => ['indet', 'nav-run', 'ring-pulse'].includes(n)).sort());

    if (reduced === 'reduce') {
      ok((await running()).length === 0, `${tag} aucune des trois animations ne tourne`);
      const nav = await box('#m-nav');
      ok(nav.x === 0 && Math.abs(nav.w - vp.width) < 1, `${tag} le filet de navigation reste pleine largeur et immobile (x ${nav.x}, largeur ${nav.w} sur ${vp.width})`);
    } else {
      ok(JSON.stringify(await running()) === JSON.stringify(['indet', 'nav-run', 'ring-pulse']), `${tag} les trois animations tournent (${(await running()).join(', ')})`);
      // elles bougent vraiment : la position du trait et du filet change d'un instant à l'autre
      const seen = { indet: new Set(), nav: new Set(), opacity: new Set() };
      for (let i = 0; i < 8; i++) {
        const t = await p.evaluate(() => ({ i: document.querySelector('#m-indet > span').getBoundingClientRect().x.toFixed(0), n: document.querySelector('#m-nav').getBoundingClientRect().x.toFixed(0), o: getComputedStyle(document.querySelector('#m-pulse'), '::after').opacity.slice(0, 4) }));
        seen.indet.add(t.i); seen.nav.add(t.n); seen.opacity.add(t.o);
        await p.waitForTimeout(170);
      }
      ok(seen.indet.size >= 4, `${tag} le trait de la barre avance (${seen.indet.size} positions vues)`);
      ok(seen.nav.size >= 3, `${tag} le filet de navigation avance (${seen.nav.size} positions vues)`);
      ok(seen.opacity.size >= 3, `${tag} le halo de la pastille pulse (${seen.opacity.size} opacités vues)`);
      // et sans le moindre travail de mise en page pendant qu'elles tournent (avant : une mise en page et un recalcul de style par image)
      const cdp = await ctx.newCDPSession(p); await cdp.send('Performance.enable');
      await p.waitForTimeout(400);
      const get = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
      const m0 = await get(); await p.waitForTimeout(2000); const m1 = await get();
      const layouts = m1.LayoutCount - m0.LayoutCount; const recalcs = m1.RecalcStyleCount - m0.RecalcStyleCount;
      ok(layouts <= 2 && recalcs <= 2, `${tag} pendant 2 s : ${layouts} mise(s) en page et ${recalcs} recalcul(s) de style (avant : une de chaque par image, environ 120)`);
    }
    ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
    ok(errs.length === 0, `${tag} aucune erreur JS${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
    await ctx.close();
  }
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
