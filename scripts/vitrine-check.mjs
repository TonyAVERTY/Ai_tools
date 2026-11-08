// Vérifie dans un vrai navigateur (Playwright) le site public (accueil et pages intérieures) de 320 à 1920 px, en thème clair et sombre :
// aucun défilement horizontal, aucun élément qui dépasse de l'écran, cibles tactiles d'au moins 44 px, en-tête sur une ligne dès 760 px et jamais coupé
// en dessous, polices de la charte chargées, aucune erreur console, bascule mois / année et questions fréquentes qui fonctionnent.
// Nécessite Playwright (PLAYWRIGHT_MODULE=chemin du module, PLAYWRIGHT_CHROMIUM si besoin). SHOT_DIR=dossier : enregistre des captures. Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const s = await startApp();
const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const WIDTHS = [320, 360, 390, 430, 600, 768, 900, 1024, 1280, 1440, 1920];
const PAGES = ['/', '/tarifs', '/fonctionnement', '/login', '/cgu', '/docs'];

for (const scheme of ['light', 'dark']) {
  for (const w of WIDTHS) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    for (const path of PAGES) {
      const tag = `${w}px ${scheme === 'dark' ? 'sombre' : 'clair'} ${path}`;
      await p.goto(`${s.base}${path}`, { waitUntil: 'load' });
      await p.waitForTimeout(150);
      const m = await p.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
        const out = [...document.querySelectorAll('body *')].filter((e) => vis(e) && !e.closest('svg, pre, .tw, .code, .ctabs') && e.getBoundingClientRect().right > W + 1 && getComputedStyle(e).position !== 'fixed')
          .slice(0, 4).map((e) => `${e.tagName}.${String(e.className).slice(0, 30)} → ${Math.round(e.getBoundingClientRect().right)}`);
        const small = [...document.querySelectorAll('a[href], button, summary')].filter((e) => vis(e) && getComputedStyle(e).pointerEvents !== 'none' && !e.closest('svg, .skip, [hidden]') && !e.closest('pre, .code, article.art, .acc-b, p, li.leaf') && e.getBoundingClientRect().height < 43.5 && e.textContent.trim().length > 0)
          .slice(0, 4).map((e) => `${e.tagName} « ${e.textContent.trim().slice(0, 24)} » ${Math.round(e.getBoundingClientRect().height)} px`);
        const top = document.querySelector('.top-in');
        const logo = top?.querySelector('.lockup')?.getBoundingClientRect();
        const cta = top?.querySelector('.top-cta')?.getBoundingClientRect();
        const nav = top?.querySelector('.nav')?.getBoundingClientRect();
        return { sw: document.documentElement.scrollWidth, W, out, small, logo: logo && [logo.top, logo.height], cta: cta && [cta.top, cta.height, cta.right, cta.left], nav: nav && [nav.top, nav.left, nav.right], hh: top && top.getBoundingClientRect().height };
      });
      ok(m.sw <= m.W + 1 && !m.out.length, `${tag} pas de débordement horizontal${m.out.length ? ` : ${m.out.join(' ; ')}` : ''}`);
      ok(!m.small.length, `${tag} cibles tactiles d'au moins 44 px${m.small.length ? ` : ${m.small.join(' ; ')}` : ''}`);
      if (m.logo && m.cta && m.nav) {
        const sameRow = Math.abs((m.logo[0] + m.logo[1] / 2) - (m.cta[0] + m.cta[1] / 2)) < 12 && Math.abs((m.nav[0]) - (m.logo[0])) < 40 + 12;
        if (w >= 760) ok(sameRow && m.hh < 90, `${tag} en-tête sur une seule ligne (${Math.round(m.hh)} px)`);
        else ok(m.cta[2] <= m.W + 1 && m.cta[3] >= 0 && m.nav[0] > m.logo[0] + 20, `${tag} en-tête : actions visibles, liens sur la 2e ligne`);
      }
      if (path === '/' && (w === 390 || w === 1280) && process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/accueil-${w}-${scheme}.png`, fullPage: true });
    }
    ok(errs.length === 0, `${w}px ${scheme === 'dark' ? 'sombre' : 'clair'} aucune erreur console${errs.length ? ` : ${errs.slice(0, 2).join(' | ')}` : ''}`);
    await ctx.close();
  }
}

// Comportements de l'accueil
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(`${s.base}/`, { waitUntil: 'load' });
  await p.waitForTimeout(300);
  const fonts = await p.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
  ok(fonts.includes('Fraunces') && fonts.includes('Instrument Sans'), 'les polices de la charte sont chargées');
  const price = () => p.evaluate(() => [...document.querySelectorAll('.v-plan-g .v-plan-p')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  const before = await price();
  ok(before.length === 4 && /mois/.test(before[0]) && !/an,/.test(before[0]), 'prix au mois affichés d\'abord');
  await p.locator('.v-seg [data-period="year"]').click();
  const after = await price();
  ok(/par an/.test(after[0]) && after[0] !== before[0], 'bascule « À l\'année » : les prix changent');
  ok((await p.locator('.v-seg [data-period="year"]').getAttribute('aria-pressed')) === 'true', 'bouton « À l\'année » pressé');
  const d = p.locator('.v-faq details').nth(1);
  const wasOpen = await d.evaluate((e) => e.open);
  await d.locator('summary').click();
  ok((await d.evaluate((e) => e.open)) !== wasOpen, 'une question de la FAQ s\'ouvre');
  const rows = await p.evaluate(() => [...document.querySelectorAll('.v-chain li')].map((e) => Math.round(e.getBoundingClientRect().width)));
  ok(rows.length === 5 && rows.every((x) => x > 200), 'les cinq temps de la chaîne tiennent en une colonne sur téléphone');
  await ctx.close();
}
// Colonnes à moitié vides : en 2 colonnes, la 5e étape de la chaîne prend toute la largeur
for (const w of [600, 768, 900]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(`${s.base}/`, { waitUntil: 'load' });
  const r = await p.evaluate(() => { const li = [...document.querySelectorAll('.v-chain li')]; const box = document.querySelector('.v-chain').getBoundingClientRect(); const last = li.at(-1).getBoundingClientRect(); return { last: Math.round(last.width), box: Math.round(box.width) }; });
  ok(r.last >= r.box - 2, `${w}px la dernière étape de la chaîne remplit la ligne (${r.last} sur ${r.box})`);
  await ctx.close();
}
await b.close();
await s.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
