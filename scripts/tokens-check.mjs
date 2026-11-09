// Vérifie dans un vrai navigateur le compteur de tokens du menu « Activité » : Claude les envoie au fil de l'eau (« 0 tokens » est vrai),
// ChatGPT et Gemini seulement à la fin : tant que la tâche tourne à 0, l'écran le dit au lieu d'afficher « 0 tokens ».
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { encrypt } from '../src/crypto.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const link = (provider) => ({ v: 1, provider, mode: 'api_key', valid: true, last4: 'WXYZ', linked_at: 1000, secret_enc: encrypt(s.app.cfg.secretKey, `k${'A'.repeat(40)}`) });
const WAIT = 'Tokens comptés à la fin de la tâche';

async function setup(provider) {
  const u = await s.newUser({ admin: false, link: link(provider) });
  const pid = await addProject(s.db, u.id, { name: 'Projet', gitUrl: 'https://github.com/u/p.git' });
  const job = (type, status, tin, tout) => s.db.prepare('INSERT INTO jobs(project_id, user_id, type, status, tokens_in, tokens_out, created_at, started_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
    .run(pid, u.id, type, status, tin, tout, 1, 1);
  await job('analyze', 'running', 0, 0);          // tourne, rien de compté
  await job('evolution', 'running', 1200, 300);   // tourne, des tokens déjà comptés
  return u;
}

const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };

async function tokensByJob(u, vp) {
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');
  await p.waitForSelector('.jobs-btn:not([hidden])', { state: 'attached' });
  await p.locator('.jobs-btn').click();
  await p.waitForSelector('.jitem');
  const items = await p.locator('.jitem').evaluateAll((els) => els.map((e) => ({ title: e.querySelector('strong')?.textContent, text: e.textContent })));
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  await ctx.close();
  return { items, errs, overflow };
}

for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  const gpt = await tokensByJob(await setup('openai'), vp);
  const analyse = gpt.items.find((i) => i.title === 'Analyse')?.text || '';
  const evo = gpt.items.find((i) => i.title === 'Évolutions')?.text || '';
  ok(analyse.includes(WAIT) && !/\b0 tokens/.test(analyse), `${tag} ChatGPT, tâche à 0 token : « ${WAIT} »`);
  ok(/1\s?500 tokens/.test(evo.replace(/ | /g, ' ')) && !evo.includes(WAIT), `${tag} ChatGPT, tokens déjà comptés : le nombre s'affiche`);
  ok(gpt.errs.length === 0 && !gpt.overflow, `${tag} ChatGPT : aucune erreur console, pas de défilement horizontal`);
  const cl = await tokensByJob(await setup('claude'), vp);
  const clAnalyse = cl.items.find((i) => i.title === 'Analyse')?.text || '';
  ok(/\b0 tokens/.test(clAnalyse) && !clAnalyse.includes(WAIT), `${tag} Claude, tâche à 0 token : « 0 tokens » (il envoie ses tokens en direct)`);
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
