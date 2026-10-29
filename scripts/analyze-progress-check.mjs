// Vérifie dans un vrai navigateur qu'une analyse en cours apparaît avec son pourcentage dans la ligne du projet, dans la page du projet
// et dans le menu « Activité », et que le bouton « Analyser » ne demande pas de confirmation à la première analyse.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const chromium = pw.chromium || pw.default.chromium;
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const u = await s.newUser();
const pid = await addProject(s.db, u.userId ?? u.id, { name: 'MonEspacePro' });
await s.db.prepare('INSERT INTO jobs(user_id, project_id, type, status, progress_json, created_at, started_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
  .run(u.userId ?? u.id, pid, 'analyze', 'running', JSON.stringify({ message: 'Lecture du code par Claude (étape 4)…', pct: 42, model: 'Sonnet 5.5' }), now(), now());
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const [name, value] = u.cookie.split('=');
await ctx.addCookies([{ name, value, url: s.base }]);
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${s.base}/`);
await p.waitForSelector('[data-state]');
await p.waitForFunction(() => /42 %/.test(document.querySelector('[data-state]')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
ok(/Analyse 42 %/.test(await p.locator('[data-state]').first().innerText()), 'ligne du projet : « Analyse 42 % »');
await p.evaluate(() => { document.querySelector('details.project').open = true; });
await p.waitForTimeout(800);
const box = p.locator('[data-job="analyze"]').first();
ok(/42 %/.test(await box.innerText()) && /Lecture du code/.test(await box.innerText()), 'page du projet : message et pourcentage');
await p.locator('.jobs-btn').click();
await p.waitForFunction(() => /42 %/.test(document.querySelector('[data-jobs-list]')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
ok(/Analyse/.test(await p.locator('[data-jobs-list]').innerText()) && /42 %/.test(await p.locator('[data-jobs-list]').innerText()), 'menu Activité : Analyse 42 %');
ok(/Sonnet 5\.5/.test(await p.locator('[data-jobs-list] .jrow .jmodel').first().innerText()), 'menu Activité : le modèle utilisé est à côté du job');
ok(/Modèle : Sonnet 5\.5/.test(await box.innerText()), 'page du projet : le modèle utilisé est affiché');
ok(errs.length === 0, `aucune erreur JS ${errs.join(' | ')}`);

// Analyse en échec sur un projet sans fiche : le message d'erreur s'affiche dans l'en-tête, sans erreur JavaScript
const u2 = await s.newUser();
const pid2 = await addProject(s.db, u2.userId ?? u2.id, { name: 'EnEchec' });
await s.db.prepare('INSERT INTO jobs(user_id, project_id, type, status, error, created_at, started_at, finished_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
  .run(u2.userId ?? u2.id, pid2, 'analyze', 'error', "Git : EACCES: permission denied, mkdir '/data/repos/1'", now(), now(), now());
const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 } });
const [n2, v2] = u2.cookie.split('=');
await ctx2.addCookies([{ name: n2, value: v2, url: s.base }]);
const p2 = await ctx2.newPage();
const errs2 = [];
p2.on('pageerror', (e) => errs2.push(e.message));
await p2.goto(`${s.base}/`);
await p2.evaluate(() => { document.querySelector('details.project').open = true; });
await p2.waitForTimeout(1500);
ok(/en échec/.test(await p2.locator('[data-job="analyze"]').first().innerText()), 'analyse en échec : message affiché dans l\'en-tête');
ok(errs2.length === 0, `analyse en échec : aucune erreur JS ${errs2.join(' | ')}`);

// Recherche de prospects en cours : l'activité de Claude et les derniers prospects trouvés s'affichent en direct
const u3 = await s.newUser();
const pid3 = await addProject(s.db, u3.userId ?? u3.id, { name: 'Live' });
await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?')
  .run(JSON.stringify({ resume: 'x' }), JSON.stringify({ description: 'd', secteurs: ['s'] }), pid3);
await s.db.prepare('INSERT INTO jobs(user_id, project_id, type, status, progress_json, created_at, started_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
  .run(u3.userId ?? u3.id, pid3, 'prospect', 'running', JSON.stringify({ found: 2, target: 10, message: 'Recherche web : « boulangerie Rennes »', pct: 20, recent: [{ company: 'Le Fournil', city: 'Rennes' }, { company: 'Pain Doré', city: '' }] }), now(), now());
const ctx3 = await b.newContext({ viewport: { width: 1280, height: 900 } });
const [n3, v3] = u3.cookie.split('=');
await ctx3.addCookies([{ name: n3, value: v3, url: s.base }]);
const p3 = await ctx3.newPage();
const errs3 = [];
p3.on('pageerror', (e) => errs3.push(e.message));
await p3.goto(`${s.base}/`);
await p3.evaluate(() => { const d = document.querySelector('details.project'); d.open = true; document.querySelectorAll('details.project details').forEach((x) => { x.open = true; }); });
await p3.waitForTimeout(2500);
const live = await p3.locator('[data-job="prospect"]').first().innerText();
ok(/Recherche web : « boulangerie Rennes »/.test(live) && /Le Fournil/.test(live) && /Pain Doré/.test(live) && /2\s+prospect/.test(live), 'recherche : activité de Claude et prospects trouvés en direct');
ok(errs3.length === 0, `recherche : aucune erreur JS ${errs3.join(' | ')}`);
await b.close();
await s.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
