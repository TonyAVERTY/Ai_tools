// Vérifie dans un vrai navigateur l'allègement de la page Projets : « Mise en route » ne montre que ce qu'il reste à faire (les étapes faites sont repliées
// en une ligne), et une tâche terminée tient sur une ligne (résultat, « Voir » et tokens côte à côte). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };

for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
  await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?').run(JSON.stringify({ resume: 'Un outil.', proposition_valeur: 'Gagner du temps.' }), JSON.stringify({ description: 'TPE', secteurs: ['plomberie'] }), pid);
  await s.db.prepare("INSERT INTO jobs(project_id, user_id, type, status, tokens_in, tokens_out, result_json, created_at, started_at, finished_at) VALUES(?, ?, 'prospect', 'done', 300000, 78750, ?, ?, ?, ?)").run(pid, u.id, JSON.stringify({ found: 10, requested: 10 }), now(), now(), now());
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');
  if (!(await p.locator('details.project').evaluate((d) => d.open))) await p.locator('details.project > summary').click();
  await p.waitForSelector('[data-setup] details.setup-done', { state: 'attached', timeout: 8000 });
  const done = p.locator('[data-setup] details.setup-done');
  ok(/^\d+ étapes? faites?$/.test((await done.locator('summary').textContent()).trim()), `${tag} les étapes faites tiennent sur une ligne (« N étapes faites »)`);
  ok(!(await done.evaluate((d) => d.open)) && !(await p.locator('[data-setup] > ul li.done').count()), `${tag} repliées, et aucune étape faite dans la liste du reste à faire`);
  ok((await p.locator('[data-setup] > ul li').count()) > 0, `${tag} il reste à l'écran ce qu'il y a à faire`);
  await p.evaluate(() => document.querySelectorAll('details.project details').forEach((d) => { d.open = true; }));
  const job = p.locator('[data-job="prospect"]');
  await p.waitForFunction(() => document.querySelector('[data-job="prospect"]')?.classList.contains('job-compact'), null, { timeout: 8000 });
  const boxes = await job.evaluate((el) => [...el.children].map((c) => { const r = c.getBoundingClientRect(); return { tag: c.tagName, top: r.top, bottom: r.bottom, w: r.width }; }));
  const text = await job.innerText();
  ok(/Recherche terminée : 10 nouveau/.test(text) && /378[\s  ]750 tokens/.test(text), `${tag} résultat et tokens affichés`);
  const wide = Math.max(...boxes.map((x) => x.w));
  ok(vp.width < 600 || (wide < 700 && (() => { const c = boxes.map((x) => (x.top + x.bottom) / 2); return Math.max(...c) - Math.min(...c) < 12; })()), `${tag} résultat, « Voir » et tokens sur la même ligne, aucun bloc pleine largeur`);
  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/declutter-${vp.width}.png` });
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
