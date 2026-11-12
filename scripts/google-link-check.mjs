// Vérifie dans un vrai navigateur la connexion guidée « Se connecter avec Google » (fenêtre de la page « Relier mon IA ») : bouton grisé tant que la case n'est pas
// cochée, lien de Google affiché, compte à rebours, code refusé puis « Nouveau lien », code accepté et page rechargée. Antigravity CLI est simulé (test/fixtures/fake-agy.js).
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, APP_URL } from '../test/helpers/server.js';
import { makeClaudeBin } from '../test/helpers/claude-bin.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const tmp = mkdtempSync(join(tmpdir(), 'google-check-'));
const s = await startApp({ cfg: { googleAccountEnabled: true, sandbox: { enabled: false, production: false } } });
s.app.cfg.geminiBin = process.execPath;
s.app.cfg.agyBin = makeClaudeBin(tmp, { fixture: 'fake-agy.js', name: 'agy-check', env: {} });
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };

for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  const u = await s.newUser({ admin: false });
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errs.push(m.text()); });
  await p.goto(`${s.base}/link?ia=gemini`);
  await p.waitForSelector('html[data-nav="ready"], .ai-cards');
  ok(await p.locator('[data-open-dialog="google-dialog"]').isVisible(), `${tag} l'option « Se connecter avec Google » est proposée`);
  await p.locator('[data-open-dialog="google-dialog"]').click();
  const dlg = p.locator('#google-dialog');
  const go1 = dlg.locator('form[data-google-login] button[data-consent-submit]');
  ok(await go1.isDisabled(), `${tag} « Continuer » est grisé tant que la case n'est pas cochée`);
  ok((await dlg.innerText()).includes("n'est pas clairement autorisé par Google"), `${tag} l'avertissement dit que la règle de Google n'est pas tranchée`);
  await dlg.locator('form[data-google-login] label.check').click();
  await go1.click();
  await dlg.locator('[data-google-link]').waitFor({ state: 'visible', timeout: 15000 });
  const href = await dlg.locator('[data-google-link]').getAttribute('href');
  ok(/^https:\/\/accounts\.google\.com\/o\/oauth2\/auth\?.*response_type=code/.test(href), `${tag} le lien de Google est affiché en entier`);
  ok(/Il te reste \d+ secondes? pour coller le code/.test(await dlg.locator('[data-google-timer]').innerText()), `${tag} le compte à rebours s'affiche`);
  await dlg.locator('input[name=code]').fill('MAUVAISCODE123');
  await dlg.locator('[data-google-send]').click();
  await dlg.locator('[data-google-error2]').waitFor({ state: 'visible', timeout: 15000 });
  ok(/refusé le code/.test(await dlg.locator('[data-google-error2]').innerText()) && await dlg.locator('[data-google-again]').isVisible(), `${tag} code refusé : le message le dit et « Nouveau lien » apparaît`);
  await dlg.locator('[data-google-again]').click();
  await dlg.locator('[data-google-link]').waitFor({ state: 'visible', timeout: 15000 });
  await dlg.locator('input[name=code]').fill('GOODCODE1234');
  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/google-link-${vp.width}.png` });
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
  await dlg.locator('[data-google-send]').click();
  await p.waitForURL((url) => url.pathname === '/', { timeout: 30000 });
  const link = JSON.parse((await s.db.prepare('SELECT claude_link_json FROM users WHERE id = ?').get(u.id)).claude_link_json);
  ok(link.mode === 'google_account' && link.provider === 'gemini', `${tag} code accepté : compte Google relié, page rechargée`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
s.app.googleLogins?.closeAll();
await s.close?.();
rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
