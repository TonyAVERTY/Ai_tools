// Vérifie dans un vrai navigateur que, quand l'accès Claude devient invalide pendant que le tableau de bord est ouvert,
// une fenêtre propose « Reconnecter Claude » (lien vers /link), qu'elle se ferme avec « Plus tard » et ne revient pas sur la même page.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
import { markLinkInvalid } from '../src/claudelink.js';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const chromium = pw.chromium || pw.default.chromium;
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const u = await s.newUser();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const [name, value] = u.cookie.split('=');
await ctx.addCookies([{ name, value, url: s.base }]);
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${s.base}/`);
await p.waitForSelector('.top');
ok(!(await p.locator('dialog.reconnect').count()), 'pas de fenêtre tant que Claude est relié');
await markLinkInvalid(s.db, u.id ?? u.userId);
// Le prochain appel de l'interface (rafraîchissement du système, clic…) reçoit « link_required »
await p.evaluate(async () => { await fetch('/api/system', { headers: { Accept: 'application/json' } }); });
await p.evaluate(() => document.querySelector('[data-report-send]')?.click());
await p.goto(`${s.base}/settings`).catch(() => {});
ok(/\/link/.test(p.url()), 'navigation : renvoi vers la page « Relier Claude »');
// Page déjà ouverte : un appel d'API qui échoue ouvre la fenêtre
const u2 = await s.newUser();
const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 } });
const [n2, v2] = u2.cookie.split('=');
await ctx2.addCookies([{ name: n2, value: v2, url: s.base }]);
const p2 = await ctx2.newPage();
const errs2 = [];
p2.on('pageerror', (e) => errs2.push(e.message));
await p2.goto(`${s.base}/`);
await p2.waitForSelector('.top');
await markLinkInvalid(s.db, u2.id ?? u2.userId);
await p2.waitForSelector('dialog.reconnect[open]', { timeout: 45000 }).catch(() => {});
ok(await p2.locator('dialog.reconnect[open]').count() === 1, 'fenêtre ouverte sur la page déjà affichée');
ok(/Claude est déconnecté/.test(await p2.locator('dialog.reconnect').innerText()), 'titre « Claude est déconnecté »');
ok((await p2.locator('dialog.reconnect a.btn.primary').getAttribute('href')) === '/link' && /Reconnecter Claude/.test(await p2.locator('dialog.reconnect a.btn.primary').innerText()), 'bouton « Reconnecter Claude » vers /link');
await p2.locator('dialog.reconnect [data-close]').click();
await p2.waitForTimeout(6000);
ok(await p2.locator('dialog.reconnect[open]').count() === 0, 'fermée avec « Plus tard », ne revient pas');
ok(errs.length + errs2.length === 0, `aucune erreur JS ${[...errs, ...errs2].join(' | ')}`);
await b.close();
await s.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
