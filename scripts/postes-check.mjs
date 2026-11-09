// Vérifie dans un vrai navigateur le filtre par poste (sections cachées, mémorisé), le lancement d'une tâche d'un poste et la lecture du livrable.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { makeClaudeBin } from '../test/helpers/claude-bin.js';
import { addProject } from '../test/helpers/users.js';
import { Worker } from '../src/services/jobs.js';
import { makeHandlers } from '../src/handlers.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'fake-claude.js' });
const worker = new Worker(s.db, makeHandlers(s.app), { log: { error: () => {} } });
const u = await s.newUser();
const pid = await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
await s.db.prepare('UPDATE projects SET profile_json = ? WHERE id = ?').run(JSON.stringify({ resume: 'Cartes de fidélité.', proposition_valeur: 'Fidéliser sans carton.', arguments: ['simple'] }), pid);
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
  await p.goto(`${s.base}/p/${pid}/outils`); // les postes et leurs tâches sont dans l'onglet Outils IA (plus de filtre par poste : décision F2 de la refonte)
  await p.waitForSelector('html[data-nav="ready"]');
  ok((await p.locator('[data-role-select]').count()) === 0, `${tag} plus de filtre par poste`);
  ok(await p.locator('details[data-acc="postes"]').first().isVisible() && await p.locator('details[data-acc="audit"]').first().isVisible(), `${tag} Évolution, Audit et Postes sont dans le même onglet`);
  await p.evaluate(() => document.querySelectorAll('details.role').forEach((d) => { d.open = true; }));

  // Lancer une tâche et lire le livrable
  const task = p.locator('li.task[data-task="faq"]');
  await task.locator('input[name=notes]').fill('Ton chaleureux');
  await task.locator('button.primary').click();
  await p.waitForFunction(() => document.querySelector('[data-job="poste_faq"]')?.textContent.trim().length > 0, null, { timeout: 15000 });
  ok(true, `${tag} la tâche est lancée et son état s'affiche`);
  await worker.tick();
  await p.waitForSelector('[data-job="poste_faq"] [data-poste-view]', { timeout: 30000 });
  ok(true, `${tag} « Voir le résultat » apparaît à la fin de la tâche`);
  await p.locator('[data-job="poste_faq"] [data-poste-view]').click();
  await p.waitForSelector('dialog.posteview[open] .poste-md');
  ok((await p.locator('dialog.posteview .poste-md').innerText()).trim().length > 5, `${tag} le livrable s'affiche dans la fenêtre`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal avec le résultat ouvert`);
  await p.locator('dialog.posteview [data-close]').click();
  ok(!(await p.locator('dialog.posteview').evaluate((d) => d.open)), `${tag} la fenêtre se ferme`);

  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/postes-${vp.width}.png`, fullPage: false }).catch(() => {});
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await s.db.prepare("DELETE FROM jobs WHERE type = 'poste_faq'").run(); // second passage : tâche à relancer
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
