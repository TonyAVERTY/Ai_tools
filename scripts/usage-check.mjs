// Vérifie dans un vrai navigateur : aucun montant en $ avec un compte Claude relié par abonnement (carte « Consommation Claude » et carte « Usage du mois »),
// les montants restent avec une clé API. Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { testTokenLink } from '../test/helpers/users.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const sub = await s.newUser({ admin: false, link: testTokenLink() });
const api = await s.newUser({ admin: false, link: { v: 1, mode: 'api_key', valid: true } });
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
for (const [who, u, priced] of [['abonnement', sub, false], ['clé API', api, true]]) {
  for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
    const tag = `${who} ${vp.width}px`;
    const ctx = await b.newContext({ viewport: vp });
    const [name, value] = u.cookie.split('=');
    await ctx.addCookies([{ name, value, url: s.base }]);
    await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */ await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    // Abonnement : un relevé fictif donne à la carte de quoi afficher les barres et la date de remise à zéro
    if (!priced) await p.route('**/api/system', async (route) => {
      const j = await (await route.fetch()).json();
      const t = Math.floor(Date.now() / 1000);
      await route.fulfill({ json: { ...j, claudeRateLimit: { source: 'live', at: t, fiveHour: { utilization: 0.73, resetsAt: t + 7200 }, sevenDay: { utilization: 0.38, resetsAt: t + 3 * 86400 } } } });
    });
    await p.goto(`${s.base}/projets`);
    await p.waitForSelector('html[data-nav="ready"]');
    ok(await p.locator('#sys, .strip').count() === 0, `${tag} plus de ligne d'état sous la barre du haut`);
    if (priced) {
      // Clé API : la carte « Consommation Claude » montre le budget en $ équivalent API
      await p.waitForSelector('[data-claude-card]:not([hidden]) [data-usage-claude]:not([hidden])');
      const card = await p.locator('[data-usage-claude]').innerText();
      ok(/\$/.test(card) && /IA via iaboss/.test(card), `${tag} carte « Consommation Claude » : lignes « IA via iaboss » en $`);
    } else {
      // Abonnement : aucun montant nulle part, et pas de carte vide quand le quota n'est pas mesuré
      ok(!(await p.locator('.dash').innerText()).includes('$'), `${tag} page Projets : aucun montant en $`);
      await p.waitForSelector('[data-claude-card]:not([hidden]) .g-r');
      const notes = await p.locator('[data-usage-claude] .g-r').allInnerTexts();
      ok(notes.length === 2 && notes.every((n) => /^Remise à zéro (aujourd'hui|demain|[a-zé]+) à \d\d:\d\d$/.test(n)), `${tag} carte « Consommation Claude » : date de remise à zéro sous chaque barre (${notes.join(' | ')})`);
      ok(await p.locator('.g-r').first().evaluate((e) => getComputedStyle(e).color === getComputedStyle(document.querySelector('.g-v')).color), `${tag} le texte de remise à zéro est grisé`);
    }
    ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
    ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
    await ctx.close();
  }
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
