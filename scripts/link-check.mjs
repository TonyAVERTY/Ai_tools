// Vérifie dans un vrai navigateur la page « Relier Claude » : l'option recommandée d'abord, le risque annoncé sur les alternatives par abonnement,
// la fenêtre d'avertissement (« Continuer » grisé tant que le risque n'est pas accepté, Échap la ferme), le jeton collé à la main, pas de défilement
// horizontal à 1280 et 390 px, aucune erreur console. Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const u = await s.newUser({ admin: false });
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */ await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/link`);
  await p.waitForSelector('html[data-nav="ready"]');

  const key = await p.locator('#h-key').boundingBox();
  const alt = await p.locator('#h-alt').boundingBox();
  ok(key && alt && key.y < alt.y, `${tag} la clé API (recommandée) vient avant les alternatives par abonnement`);
  ok(/Recommandée/.test(await p.locator('.link-main .badge').innerText()), `${tag} badge « Recommandée »`);
  ok(/Risque pour ton compte/.test(await p.locator('.alts-h .badge').innerText()), `${tag} le risque est annoncé dans le titre des alternatives`);

  // Fenêtre d'avertissement : « Continuer » grisé tant que la case n'est pas cochée ; Échap la ferme
  await p.locator('[data-open-dialog="consent-dialog"]').click();
  await p.waitForSelector('#consent-dialog[open]');
  const go = p.locator('#consent-dialog [data-consent-submit]');
  ok(await go.isDisabled(), `${tag} « Continuer » est grisé tant que le risque n'est pas accepté`);
  await p.locator('#consent-dialog label.opt').click(); // la case dessinée recouvre l'input natif : on clique comme un utilisateur
  ok(await go.isEnabled(), `${tag} cocher « J'ai compris » active « Continuer »`);
  await p.keyboard.press('Escape');
  ok(!(await p.locator('#consent-dialog').evaluate((d) => d.open)), `${tag} Échap ferme la fenêtre`);

  // Jeton collé à la main : le formulaire se déplie, le bouton reste grisé tant que la case n'est pas cochée
  await p.locator('.manual > summary').click();
  const send = p.locator('.manual [data-consent-submit]');
  ok(await send.isVisible() && await send.isDisabled(), `${tag} « Relier avec mon jeton » est grisé sans acceptation`);
  await p.locator('.manual label.opt').click();
  ok(await send.isEnabled(), `${tag} accepter active le bouton`);

  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
