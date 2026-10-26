// Vérifie dans un vrai navigateur : aucun montant en $ avec un compte Claude relié par abonnement (barre du haut et carte « Usage du mois »),
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
    await ctx.route('**/*', (route) => { const r = route.request(); const h = { ...r.headers() }; if (r.method() === 'POST') h.origin = APP_URL; route.continue({ headers: h }); });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(`${s.base}/`);
    await p.waitForSelector('html[data-nav="ready"]');
    await p.waitForFunction(() => document.querySelector('#sys')?.textContent.trim().length > 0);
    const bar = await p.locator('#sys').innerText();
    ok(/\$/.test(bar) === priced, `${tag} barre du haut : ${priced ? 'montants en $ présents' : 'aucun $'} (« ${bar.replace(/\s+/g, ' ').trim().slice(0, 70)} »)`);
    if (priced) {
      // Clé API : la carte « Consommation Claude » montre le budget en $ équivalent API
      await p.waitForSelector('[data-claude-card]:not([hidden]) [data-usage-claude]:not([hidden])');
      const card = await p.locator('[data-usage-claude]').innerText();
      ok(/\$/.test(card) && /IA via AiTools/.test(card), `${tag} carte « Consommation Claude » : lignes « IA via AiTools » en $`);
    } else {
      // Abonnement : aucun montant nulle part, et pas de carte vide quand le quota n'est pas mesuré
      ok(!(await p.locator('.dash').innerText()).includes('$'), `${tag} page Projets : aucun montant en $`);
      ok(await p.locator('[data-claude-card]').evaluate((e) => e.hidden), `${tag} pas de carte « Consommation Claude » sans mesure`);
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
