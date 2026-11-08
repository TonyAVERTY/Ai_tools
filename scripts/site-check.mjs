// Vérifie dans un vrai navigateur le champ « Site du produit » de l'En-tête d'un projet : enregistrement, valeur conservée au rechargement,
// adresse invalide refusée avec un message, aucun clic double, aucune erreur JS.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const chromium = pw.chromium || pw.default.chromium;
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const u = await s.newUser();
await addProject(s.db, u.userId ?? u.id, { name: 'MonEspacePro' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const [name, value] = u.cookie.split('=');
await ctx.addCookies([{ name, value, url: s.base }]);
await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */ await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
const open = async () => { await p.goto(`${s.base}/projets`); await p.evaluate(() => { document.querySelector('details.project').open = true; }); await p.waitForTimeout(500); };
await open();
const input = p.locator('input[name="site_url"]').first();
ok(await input.isVisible(), 'champ « Site du produit » visible dans l\'En-tête');
await input.fill('monespacepro.fr');
await p.locator('form[data-action="site"] button').first().click();
await p.waitForSelector('.toast');
ok(/Site enregistré/.test(await p.locator('.toast').first().innerText()), 'message « Site enregistré »');
ok(await input.inputValue() === 'https://monespacepro.fr', 'adresse normalisée dans le champ');
await open();
ok(await p.locator('input[name="site_url"]').first().inputValue() === 'https://monespacepro.fr', 'valeur conservée au rechargement');
await p.locator('input[name="site_url"]').first().fill('ftp://x.fr');
await p.locator('form[data-action="site"] button').first().click();
await p.waitForFunction(() => [...document.querySelectorAll('.toast.error')].some((t) => /invalide/.test(t.textContent)));
ok(true, 'adresse invalide refusée avec un message');
ok(errs.length === 0, `aucune erreur JS ${errs.join(' | ')}`);
await b.close();
await s.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
