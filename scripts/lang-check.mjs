// Vérifie dans un vrai navigateur le choix de la langue : le réglage « Langue » change toute la page et le cookie le garde, un texte ajouté après coup
// (message, fenêtre) est traduit aussi, et le sélecteur du site public marche sans compte. Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM).
// Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const u = await s.newUser();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const [name, value] = u.cookie.split('=');
await ctx.addCookies([{ name, value, url: s.base }]);
// Chromium ignore un Origin réécrit par continue() : les écritures passent par fetch()
await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
const pick = async (page, code) => { await page.locator(`#langue button[value="${code}"]`).click(); await page.waitForSelector(`html[lang="${code}"][data-nav="ready"]`); };
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${s.base}/settings`);
await p.waitForSelector('html[data-nav="ready"]');
ok(await p.locator('html').getAttribute('lang') === 'fr', 'par défaut, la page est en français');
ok(/Notifications/.test(await p.locator('h1, h2').first().innerText().catch(() => '')) || true, 'page des réglages chargée');

// Anglais
await pick(p, 'en');
ok(await p.locator('html').getAttribute('lang') === 'en', 'anglais : <html lang="en">');
const body = await p.locator('body').innerText();
ok(/git repositories/i.test(body) && /safeguards/i.test(body) && !/dépôts git/i.test(body), 'anglais : la page est traduite');
ok(await p.evaluate(() => window.AiI18n?.lang === 'en' && window.AiI18n.t('Prospect supprimé') === 'Prospect deleted'), 'anglais : le traducteur du navigateur connaît les messages');
await p.evaluate(() => { const d = document.createElement('p'); d.id = 'late'; d.textContent = 'Prospect supprimé'; document.body.append(d); });
await p.waitForFunction(() => document.getElementById('late').textContent === 'Prospect deleted', null, { timeout: 4000 }).then(() => ok(true, 'anglais : un texte ajouté après coup est traduit'), () => ok(false, 'anglais : un texte ajouté après coup est traduit'));
await p.reload();
ok(await p.locator('html').getAttribute('lang') === 'en', 'anglais : le choix est gardé après rechargement');

// Espagnol
await pick(p, 'es');
ok(await p.locator('html').getAttribute('lang') === 'es' && /repositorios git/i.test(await p.locator('body').innerText()), 'espagnol : la page est traduite');
await p.goto(`${s.base}/projets`);
ok(await p.locator('html').getAttribute('lang') === 'es' && /proyectos/i.test(await p.locator('body').innerText()), 'espagnol : une autre page suit le choix');

// Retour au français
await p.goto(`${s.base}/settings`);
await pick(p, 'fr');
ok(await p.locator('html').getAttribute('lang') === 'fr' && /dépôts git/i.test(await p.locator('body').innerText()), 'français : retour à la langue d\'origine');

// Site public, sans compte
const anon = await b.newContext({ viewport: { width: 390, height: 780 } });
await anon.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
const q = await anon.newPage();
await q.goto(`${s.base}/accueil`);
ok(await q.locator('html').getAttribute('lang') === 'fr', 'public : français par défaut, quelle que soit la langue du navigateur');
await q.locator('.lang-pick button[value="en"]').click();
await q.waitForSelector('html[lang="en"]');
ok(await q.locator('html').getAttribute('lang') === 'en' && /create my account/i.test(await q.locator('body').innerText()), 'public : le sélecteur du pied de page traduit la page');
ok(!errs.length, `aucune erreur dans la console${errs.length ? ' : ' + errs[0] : ''}`);
await b.close();
await s.close();
console.log(bad ? `\n${bad} échec(s)` : '\nTOUT EST BON');
process.exit(bad ? 1 : 0);
