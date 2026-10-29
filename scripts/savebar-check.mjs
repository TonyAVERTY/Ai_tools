// Vérifie dans un vrai navigateur que la barre « Enregistrer les réglages » n'apparaît que s'il y a une modification non enregistrée,
// disparaît quand on revient à la valeur d'origine, et qu'après l'enregistrement elle est de nouveau masquée.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const chromium = pw.chromium || pw.default.chromium;
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const u = await s.newUser();
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const [name, value] = u.cookie.split('=');
await ctx.addCookies([{ name, value, url: s.base }]);
await ctx.route('**/*', (route) => { const r = route.request(); const h = { ...r.headers() }; if (r.method() === 'POST') h.origin = APP_URL; route.continue({ headers: h }); });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${s.base}/settings`);
const bar = p.locator('[data-savebar]');
ok(!(await bar.isVisible()), 'barre masquée à l\'ouverture');
const mail = p.locator('input[name="notify_email"]');
await mail.fill('moi@exemple.fr');
ok(await bar.isVisible(), 'barre visible après une modification');
await mail.fill('');
ok(!(await bar.isVisible()), 'barre masquée quand on revient à la valeur d\'origine');
await mail.fill('moi@exemple.fr');
await p.locator('[data-savebar] button').click();
await p.waitForURL(/ok/);
ok(!(await p.locator('[data-savebar]').isVisible()), 'barre masquée après l\'enregistrement');
ok(await p.locator('input[name="notify_email"]').inputValue() === 'moi@exemple.fr', 'valeur enregistrée');
ok(errs.length === 0, `aucune erreur JS ${errs.join(' | ')}`);
await b.close();
await s.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
