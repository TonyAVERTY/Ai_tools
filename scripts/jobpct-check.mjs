// Vérifie dans un vrai navigateur que le pourcentage d'une tâche s'affiche partout : menu « Activité » et zone du projet, y compris pour une tâche en attente (0 %).
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const u = await s.newUser();
const pid = await addProject(s.db, u.id, { name: 'AiTools', gitUrl: 'https://github.com/u/aitools.git' });
const job = (type, status, progress) => s.db.prepare('INSERT INTO jobs(project_id, user_id, type, status, progress_json, created_at, started_at) VALUES(?, ?, ?, ?, ?, ?, ?)').run(pid, u.id, type, status, JSON.stringify(progress), now(), status === 'running' ? now() : null);
await job('analyze', 'queued', { message: 'En attente : quota de la session Claude (5 h) à 95 %' }); // la capture de l'utilisateur
await job('evolution', 'running', { message: 'Lecture du code…', pct: 42 });
await job('audit', 'queued', {});
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
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');
  await p.waitForSelector('.jobs-btn:not([hidden])', { state: 'attached' });
  await p.locator('.jobs-btn').click();
  await p.waitForSelector('.jitem');
  const items = await p.locator('.jitem').evaluateAll((els) => els.map((e) => ({ title: e.querySelector('strong')?.textContent, pct: e.querySelector('.jpct')?.textContent, bar: !!e.querySelector('.bar'), indet: !!e.querySelector('.bar.indet'), cls: e.className })));
  const by = (t) => items.find((i) => i.title === t);
  ok(by('Analyse')?.pct === '0 %' && by('Analyse')?.bar && !by('Analyse')?.indet, `${tag} tâche en attente (quota) : « 0 % » et barre vide (${JSON.stringify(by('Analyse')?.pct)})`);
  ok(by('Évolutions')?.pct === '42 %', `${tag} tâche en cours : « 42 % » (${by('Évolutions')?.pct})`);
  ok(by('Audit')?.pct === '0 %', `${tag} tâche en file sans progression : « 0 % »`);
  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/jobs-${vp.width}.png` });
  // Zone du projet
  await p.keyboard.press('Escape');
  if (!(await p.locator('details.project').evaluate((d) => d.open))) await p.locator('details.project > summary').click();
  await p.waitForFunction(() => document.querySelector('[data-job="audit"] .jpct') && document.querySelector('[data-job="evolution"] .jpct'), null, { timeout: 15000 }).catch(() => {});
  ok(((await p.locator('[data-job="audit"] .jpct').first().textContent().catch(() => '')) || '').trim() === '0 %', `${tag} zone du projet : la tâche en attente affiche « 0 % »`);
  ok(((await p.locator('[data-job="evolution"] .jpct').first().textContent().catch(() => '')) || '').trim() === '42 %', `${tag} zone du projet : la tâche en cours affiche « 42 % »`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
