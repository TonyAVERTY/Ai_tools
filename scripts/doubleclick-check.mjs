// Vérifie dans un vrai navigateur qu'un double clic (ou une rafale de clics) sur « Envoyer le rapport maintenant » n'envoie qu'une seule requête,
// que le bouton est bloqué pendant l'envoi et libéré ensuite, et qu'un clic isolé fonctionne toujours.
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
let hits = 0;
await ctx.route('**/*', async (route) => {
  const r = route.request();
  if (r.url().endsWith('/api/report/send')) { hits++; await new Promise((res) => setTimeout(res, 400)); return route.fulfill({ json: { ok: true, channels: ['mail'] } }); }
  const h = { ...r.headers() }; if (r.method() === 'POST') h.origin = APP_URL; route.continue({ headers: h });
});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${s.base}/settings`);
const btn = p.locator('[data-report-send]');
await btn.dblclick();
await p.waitForTimeout(900);
ok(hits === 1, `double clic : 1 seule requête (${hits})`);
hits = 0;
await btn.click({ clickCount: 4, delay: 20 });
await p.waitForTimeout(900);
ok(hits === 1, `rafale de 4 clics : 1 seule requête (${hits})`);
hits = 0;
await btn.click();
await p.waitForFunction(() => document.querySelector('[data-report-send]').getAttribute('aria-busy') === 'true').catch(() => {});
ok(await btn.isDisabled(), 'bouton bloqué pendant l\'envoi');
await p.waitForTimeout(900);
ok(!(await btn.isDisabled()) && hits === 1, 'bouton libéré après l\'envoi, clic isolé fonctionnel');
ok(errs.length === 0, `aucune erreur JS ${errs.join(' | ')}`);
await b.close();
await s.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
