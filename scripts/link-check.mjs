// Vérifie dans un vrai navigateur la page « Relier mon IA » : trois cartes avec logo (rien d'ouvert au départ), un clic ouvre les options de l'IA,
// Claude (clé recommandée d'abord, risque annoncé, fenêtre d'avertissement, jeton collé), ChatGPT (connexion guidée jusqu'au bout avec un faux Codex :
// lien, code, attente, liaison enregistrée), Gemini (avertissement sur la clé gratuite), pas de défilement horizontal à 1280 et 390 px, aucune erreur console.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, APP_URL } from '../test/helpers/server.js';
import { makeClaudeBin } from '../test/helpers/claude-bin.js';
import { getLinkState } from '../src/claudelink.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const tmp = mkdtempSync(join(tmpdir(), 'aitools-linkcheck-'));
// Faux Codex : la connexion par code d'appareil « aboutit » au bout de 2 s, la vérification de la liaison répond
const codexBin = makeClaudeBin(tmp, { fixture: 'fake-codex.js', name: 'codex-ui', env: { FAKE_LOGIN_MS: '2000' } });
const s = await startApp({ cfg: { codexBin, geminiBin: process.execPath } });
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const openPanels = (p) => p.locator('.ai-panel:not([hidden])').evaluateAll((els) => els.map((e) => e.dataset.aiPanel));

for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  const u = await s.newUser({ admin: false });
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

  // Cartes : trois, avec logo, rien d'ouvert au départ
  const names = await p.locator('.ai-card b').allInnerTexts();
  ok(JSON.stringify(names) === JSON.stringify(['Claude', 'ChatGPT', 'Gemini']), `${tag} trois cartes : ${names.join(', ')}`);
  ok(await p.locator('.ai-card svg use').count() === 3, `${tag} chaque carte a son logo`);
  const boxes = await p.locator('.ai-card svg').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  ok(boxes.every(([w, h]) => w >= 24 && h >= 24), `${tag} les logos sont visibles (${JSON.stringify(boxes)})`);
  ok((await openPanels(p)).length === 0, `${tag} rien n'est ouvert avant le clic`);
  ok(await p.locator('.ai-pick').isVisible(), `${tag} « Clique sur une IA » guide l'utilisateur`);

  // Claude : un clic ouvre ses options, la clé API (recommandée) d'abord, le risque annoncé sur l'abonnement
  await p.locator('[data-ai-card="claude"]').click();
  ok(JSON.stringify(await openPanels(p)) === '["claude"]', `${tag} clic sur Claude : ses options seulement`);
  ok(p.url().endsWith('/link?ia=claude'), `${tag} l'adresse suit le choix (${p.url().replace(s.base, '')})`);
  ok(await p.locator('[data-ai-card="claude"]').getAttribute('aria-pressed') === 'true', `${tag} la carte choisie est marquée`);
  ok(!(await p.locator('.ai-pick').isVisible()), `${tag} le guide disparaît`);
  const key = await p.locator('#h-key').boundingBox();
  const alt = await p.locator('#h-alt').boundingBox();
  ok(key && alt && key.y < alt.y, `${tag} la clé API (recommandée) vient avant les alternatives par abonnement`);
  ok(/Recommandée/.test(await p.locator('#ai-panel-claude .link-main .badge').innerText()), `${tag} badge « Recommandée »`);
  ok(/Risque pour ton compte/.test(await p.locator('#ai-panel-claude .alts-h .badge').innerText()), `${tag} le risque est annoncé dans le titre des alternatives`);
  await p.locator('[data-open-dialog="consent-dialog"]').click();
  await p.waitForSelector('#consent-dialog[open]');
  const go = p.locator('#consent-dialog [data-consent-submit]');
  ok(await go.isDisabled(), `${tag} « Continuer » est grisé tant que le risque n'est pas accepté`);
  await p.locator('#consent-dialog label.opt').click(); // la case dessinée recouvre l'input natif : on clique comme un utilisateur
  ok(await go.isEnabled(), `${tag} cocher « J'ai compris » active « Continuer »`);
  await p.keyboard.press('Escape');
  ok(!(await p.locator('#consent-dialog').evaluate((d) => d.open)), `${tag} Échap ferme la fenêtre`);
  await p.locator('#ai-panel-claude .manual > summary').click();
  const send = p.locator('#ai-panel-claude .manual [data-consent-submit]');
  ok(await send.isVisible() && await send.isDisabled(), `${tag} « Relier avec mon jeton » est grisé sans acceptation`);
  await p.locator('#ai-panel-claude .manual label.opt').click();
  ok(await send.isEnabled(), `${tag} accepter active le bouton`);

  // Gemini : l'avertissement sur la clé gratuite est visible, pas de connexion par compte
  await p.locator('[data-ai-card="gemini"]').click();
  ok(JSON.stringify(await openPanels(p)) === '["gemini"]', `${tag} clic sur Gemini : ses options seulement`);
  const warn = await p.locator('#ai-panel-gemini .notice').innerText();
  ok(/Une clé gratuite suffit pour essayer/.test(warn) && /améliorer ses produits, et des personnes peuvent les relire/.test(warn) && /données de prospects/.test(warn), `${tag} l'avertissement sur la clé gratuite est visible`);
  ok(await p.locator('#ai-panel-gemini input[name="apiKey"]').isVisible(), `${tag} le champ de clé Google est visible`);
  ok(await p.locator('#ai-panel-gemini [data-open-dialog]').count() === 0, `${tag} pas de connexion par compte pour Gemini`);

  // ChatGPT : connexion guidée jusqu'au bout (faux Codex), la liaison est enregistrée
  await p.locator('[data-ai-card="openai"]').click();
  ok(JSON.stringify(await openPanels(p)) === '["openai"]', `${tag} clic sur ChatGPT : ses options seulement`);
  await p.locator('[data-open-dialog="chatgpt-dialog"]').click();
  await p.waitForSelector('#chatgpt-dialog[open]');
  const cont = p.locator('#chatgpt-dialog [data-consent-submit]');
  ok(await cont.isDisabled(), `${tag} ChatGPT : « Continuer » est grisé tant que le risque n'est pas accepté`);
  await p.locator('#chatgpt-dialog label.opt').click();
  await cont.click();
  await p.waitForSelector('#chatgpt-dialog [data-chatgpt-step2]:not([hidden])');
  ok(/^ABCD-12345$/.test((await p.locator('[data-chatgpt-code]').innerText()).trim()), `${tag} le code à saisir s'affiche`);
  ok(/auth\.openai\.com/.test(await p.locator('[data-chatgpt-link]').getAttribute('href')), `${tag} le lien mène chez OpenAI`);
  ok(/J'attends ta validation/.test(await p.locator('[data-chatgpt-wait]').innerText()), `${tag} la fenêtre dit qu'elle attend`);
  await p.waitForFunction(() => location.pathname === '/', null, { timeout: 15000 });
  const link = await getLinkState(s.db, u.id);
  ok(link?.provider === 'openai' && link.mode === 'chatgpt_account' && link.valid, `${tag} la connexion est enregistrée (${link?.provider}/${link?.mode})`);

  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal (accueil)`);
  await p.goto(`${s.base}/link?ia=openai`);
  await p.waitForSelector('html[data-nav="ready"]');
  ok(await p.locator('[data-ai-card="openai"] .badge').isVisible(), `${tag} l'IA reliée porte le badge « Connectée »`);
  ok(JSON.stringify(await openPanels(p)) === '["openai"]', `${tag} ?ia=openai ouvre ChatGPT d'emblée`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal (page de liaison)`);
  // Fermer la fenêtre en pleine connexion l'annule côté serveur (aucun dossier ni processus ne reste)
  await p.locator('[data-open-dialog="chatgpt-dialog"]').click();
  await p.locator('#chatgpt-dialog label.opt').click();
  await p.locator('#chatgpt-dialog [data-consent-submit]').click();
  await p.waitForSelector('#chatgpt-dialog [data-chatgpt-step2]:not([hidden])');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  ok((s.app.chatgptLogins?.sessions.size ?? 0) === 0, `${tag} fermer la fenêtre annule la connexion en cours`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
s.app.chatgptLogins?.closeAll();
await s.close?.();
rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
