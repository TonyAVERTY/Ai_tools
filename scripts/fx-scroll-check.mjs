// Vérifie dans un vrai navigateur que le trait du lancement d'une tâche reste accroché au bouton d'action quand la page défile :
// son départ suit le bouton (qui monte avec la page), son arrivée reste sur le menu « Activité », et il disparaît à la fin sans erreur.
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
const id = u.userId ?? u.id;
for (let i = 0; i < 6; i++) await addProject(s.db, id, { name: `P${i}` });
const pid = await addProject(s.db, id, { name: 'Cible' });
await s.db.prepare('INSERT INTO jobs(user_id, project_id, type, status, progress_json, created_at, started_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
  .run(id, pid, 'analyze', 'running', JSON.stringify({ pct: 10 }), now(), now());
const ctx = await b.newContext({ viewport: { width: 1280, height: 700 } });
const [name, value] = u.cookie.split('=');
await ctx.addCookies([{ name, value, url: s.base }]);
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${s.base}/projets`);
await p.waitForSelector('.jobs-btn:visible');
// Un bouton bas dans la page, comme « Générer un post » : on le met à mi-hauteur de l'écran, puis on lance
await p.evaluate(() => {
  const btn = document.createElement('button'); btn.id = 'fx-test'; btn.className = 'btn'; btn.textContent = 'Générer'; btn.style.margin = '600px 0 900px 300px'; btn.style.display = 'block';
  document.querySelector('main, .wrap, body').append(btn);
});
await p.evaluate(() => document.querySelector('#fx-test').scrollIntoView({ block: 'center' }));
await p.waitForTimeout(300);
await p.evaluate(() => { window.__done = window.AiFx.launch(document.querySelector('#fx-test'), document.querySelector('#jobs .jobs-btn')); });
await p.waitForSelector('.fx-trail path[d]');
await p.waitForTimeout(900);
const startOf = async () => p.evaluate(() => {
  const d = document.querySelector('.fx-trail path').getAttribute('d');
  const m = /^M([\d.\-]+) ([\d.\-]+)/.exec(d);
  const r = document.querySelector('#fx-test').getBoundingClientRect();
  return { x: +m[1], y: +m[2], btnMidY: r.top + r.height / 2, btnLeft: r.left, btnRight: r.right };
});
const before = await startOf();
ok(Math.abs(before.y - before.btnMidY) < 2, `le départ du trait est à la hauteur du bouton (${before.y.toFixed(0)} ≈ ${before.btnMidY.toFixed(0)})`);
await p.evaluate(() => window.scrollBy(0, 160));
await p.waitForTimeout(150);
const after = await startOf();
ok(Math.abs(after.y - after.btnMidY) < 2, `après défilement, le départ suit toujours le bouton (${after.y.toFixed(0)} ≈ ${after.btnMidY.toFixed(0)})`);
ok(Math.abs((after.y - before.y) + 160) < 6 || after.btnMidY !== before.btnMidY, 'le départ a bougé avec le bouton');
await p.evaluate(() => window.__done);
await p.waitForTimeout(300);
ok(await p.locator('.fx-trail').count() === 0, 'le trait disparaît à la fin');
ok(errs.length === 0, `aucune erreur JS ${errs.join(' | ')}`);
await b.close();
await s.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
