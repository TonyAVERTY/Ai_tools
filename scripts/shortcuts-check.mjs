// Vérifie dans un vrai navigateur les raccourcis clavier (public/app-shortcuts.js) : « g » puis une lettre, « / », « j », « ? », Ctrl K ; rien quand on écrit dans un champ ni après une seconde.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const s = await startApp();
const u = await s.newUser({ email: 'k@x.fr' });
const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
let bad = 0; const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const [n, v] = u.cookie.split('='); await ctx.addCookies([{ name: n, value: v, url: s.base }]);
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${s.base}/`, { waitUntil: 'load' }); await p.waitForSelector('html[data-nav="ready"]'); await p.waitForTimeout(300); // les scripts différés ont tourné
const path = () => p.evaluate(() => location.pathname);
await p.keyboard.press('g'); await p.keyboard.press('p'); await p.waitForFunction(() => location.pathname === '/projets'); ok(await path() === '/projets', 'g p → /projets');
await p.keyboard.press('g'); await p.keyboard.press('m'); await p.waitForFunction(() => location.pathname === '/mails'); ok(true, 'g m → /mails (sans rechargement de la page)');
await p.keyboard.press('g'); await p.waitForTimeout(1200); await p.keyboard.press('a'); await p.waitForTimeout(300); ok(await path() === '/mails', 'g puis une pause de plus d\'une seconde : rien');
await p.keyboard.press('g'); await p.keyboard.press('x'); await p.waitForTimeout(300); ok(await path() === '/mails', 'g x (inconnue) : rien');
await p.keyboard.press('/'); await p.waitForSelector('dialog#search[open]'); ok(true, '/ ouvre la recherche');
await p.keyboard.type('gp'); await p.waitForTimeout(300); ok(await path() === '/mails', 'écrire « gp » dans la recherche ne change pas de page');
await p.keyboard.press('Escape'); await p.waitForTimeout(200); ok(!(await p.locator('dialog#search[open]').count()), 'Échap ferme la recherche');
await p.keyboard.press('j'); await p.waitForSelector('.jobs-btn[aria-expanded="true"]'); ok(true, 'j ouvre l\'Activité');
await p.keyboard.press('Escape');
await p.keyboard.press('Shift+?'); await p.waitForFunction(() => location.pathname === '/raccourcis'); ok(await p.locator('h1', { hasText: 'Raccourcis clavier' }).isVisible(), '? ouvre la page des raccourcis');
await p.keyboard.press('Control+k'); await p.waitForSelector('dialog#search[open]'); ok(true, 'Ctrl K ouvre toujours la recherche');
ok(errs.length === 0, `aucune erreur de page${errs[0] ? ` : ${errs[0]}` : ''}`);
await b.close(); await s.close(); console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON'); process.exit(bad ? 1 : 0);
