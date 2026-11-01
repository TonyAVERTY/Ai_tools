// Vérifie dans un vrai navigateur le menu IA (survol, deux choix) et le mode Support : page, question, réponse, conversations séparées.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { makeClaudeBin } from '../test/helpers/claude-bin.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'fake-claude.js' });
const u = await s.newUser();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
for (const vp of [{ width: 1280, height: 800, mouse: true }, { width: 390, height: 780, mouse: false }]) {
  const tag = `${vp.width}px`;
  const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !vp.mouse });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */ await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');
  const menu = p.locator('details.ia-menu');
  ok(!(await menu.evaluate((d) => d.open)), `${tag} menu IA fermé au départ`);
  if (vp.mouse) {
    await p.locator('details.ia-menu > summary').hover();
    await p.waitForFunction(() => document.querySelector('details.ia-menu').open);
    ok(true, `${tag} le menu IA s'ouvre au survol`);
    await p.locator('details.user > summary').hover();
    await p.waitForFunction(() => document.querySelector('details.user').open && !document.querySelector('details.ia-menu').open);
    ok(true, `${tag} un seul menu ouvert à la fois (avatar / IA)`);
    await p.locator('details.ia-menu > summary').hover();
  } else {
    await p.locator('details.ia-menu > summary').tap();
    await p.waitForFunction(() => document.querySelector('details.ia-menu').open);
    ok(true, `${tag} au doigt : le menu IA s'ouvre au toucher`);
  }
  await p.waitForSelector('.ia-pop a[href="/support"]', { state: 'visible' });
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/ia-menu-${vp.width}.png`, clip: { x: 0, y: 0, width: vp.width, height: 260 } });
  ok(await p.locator('.ia-pop a').count() === 2, `${tag} deux choix : Claude et Support`);
  await p.locator('.ia-pop a[href="/support"]').click();
  await p.waitForURL('**/support');
  await p.waitForSelector('#chat[data-mode="support"]');
  ok((await p.locator('.chat-main h1').textContent()).includes('Support'), `${tag} page Support`);
  ok(await p.locator('[data-chat-projmenu]').count() === 0, `${tag} pas de projet joint dans le Support`);
  await p.fill('textarea', 'ECHO Comment relier Claude ?');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.msg.bot .bubble:not(.streaming)', { timeout: 15000 });
  await p.waitForFunction(() => document.querySelector('[data-chat-stop]').hidden, null, { timeout: 15000 });
  ok(/Comment relier Claude/.test(await p.locator('.msg.bot .bubble').last().textContent()), `${tag} la réponse s'affiche`);
  ok(/\/support\/\d+$/.test(p.url()), `${tag} adresse de la conversation sous /support`);
  ok(await p.locator('[data-chat-list] a[href^="/support/"]').count() >= 1, `${tag} la conversation est dans la liste du Support`);
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/support-${vp.width}.png` });
  await p.goto(`${s.base}/chat`);
  ok(await p.locator('[data-chat-list] a').count() === 0, `${tag} la liste de Claude ne montre pas les conversations du Support`);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag} pas de défilement horizontal`);
  ok(errs.length === 0, `${tag} aucune erreur console ${errs.join(' | ')}`);
  await s.db.prepare('DELETE FROM chat_conversations').run();
  await ctx.close();
}
await b.close(); await s.close();
console.log(bad ? `\n${bad} PROBLÈME(S)` : '\nTOUT EST BON');
process.exit(bad ? 1 : 0);
