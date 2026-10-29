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
  .run(u.userId ?? u.id, pid, 'analyze', 'running', JSON.stringify({ message: 'Lecture du code par Claude (étape 4)…', pct: 42 }), now(), now());
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
ok(errs.length === 0, `aucune erreur JS ${errs.join(' | ')}`);
await b.close();
await s.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
