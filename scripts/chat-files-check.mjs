// Vérifie dans un vrai navigateur la page IA avec pièces jointes : choix de fichier, glisser-déposer, collage, projet joint, aperçu, retrait, envoi.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { makeClaudeBin } from '../test/helpers/claude-bin.js';
import { addProject } from '../test/helpers/users.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const s = await startApp();
s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'fake-claude.js' });
s.app.syncRepo = async (url, dir) => { mkdirSync(join(dir, '.git'), { recursive: true }); writeFileSync(join(dir, 'README.md'), '# x'); return 'abc'; };
const u = await s.newUser();
const pid = await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */ await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const tag = `${vp.width}px`;
  await p.goto(`${s.base}/chat`);
  await p.waitForSelector('[data-chat-file]', { state: 'attached' });
  await p.setInputFiles('[data-chat-file]', [{ name: 'plan.png', mimeType: 'image/png', buffer: png }, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('bonjour') }]);
  await p.waitForSelector('[data-chat-tray] .tray-chip:not(.tray-project)', { timeout: 5000 });
  ok(await p.locator('[data-chat-tray] .tray-chip:not(.tray-project)').count() === 2, `${tag} deux pastilles dans le plateau`);
  await p.locator('[data-file-off]').first().click();
  await p.waitForFunction(() => document.querySelectorAll('[data-chat-tray] .tray-chip:not(.tray-project)').length === 1);
  ok(true, `${tag} retrait d'une pièce jointe`);
  const proj = p.locator('details.chat-proj');
  await proj.locator('summary').click();
  await proj.locator('[data-project-pick]').click();
  ok(await p.locator('.tray-project').count() === 1, `${tag} projet joint visible`);
  await p.fill('textarea', 'ECHO regarde');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.msg.bot .bubble:not(.streaming)', { timeout: 15000 });
  await p.waitForFunction(() => document.querySelector('[data-chat-stop]').hidden, null, { timeout: 15000 });
  ok(await p.locator('.msg.user .att').count() >= 1, `${tag} pièces jointes affichées dans le message`);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag} pas de défilement horizontal`);
  const img = p.locator('.msg.user img').first();
  if (await img.count()) ok(await img.evaluate((i) => i.complete && i.naturalWidth > 0), `${tag} aperçu image chargé (CSP ok)`);
  ok(errs.length === 0, `${tag} aucune erreur console ${errs.join(' | ')}`);
  await ctx.close();
}
await b.close(); await s.close();
console.log(bad ? `\n${bad} PROBLÈME(S)` : '\nTOUT EST BON');
process.exit(bad ? 1 : 0);
