// Vérifie dans un vrai navigateur que la Vue d'ensemble d'un projet se met à jour quand une tâche se termine : l'étape « Demander des idées
// d'évolution » se raie toute seule, et la page n'est pas rechargée pendant qu'on écrit dans un champ.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const u = await s.newUser();
const pid = await addProject(s.db, u.id, { name: 'iaboss', gitUrl: 'https://github.com/u/aitools.git' });
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };

const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const [name, value] = u.cookie.split('=');
await ctx.addCookies([{ name, value, url: s.base }]);
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
const evo = () => p.locator('.pj-opt li', { hasText: "idées d'évolution" }).getAttribute('class');
const startJob = async () => (await s.db.prepare("INSERT INTO jobs(project_id, user_id, type, status, created_at, started_at) VALUES(?, ?, 'evolution', 'running', ?, ?)").run(pid, u.id, now(), now())).lastInsertRowid;
const endJob = (id, status) => s.db.prepare('UPDATE jobs SET status = ?, finished_at = ? WHERE id = ?').run(status, now(), id);

await p.goto(`${s.base}/p/${pid}`);
await p.waitForSelector('.pj-opt');
ok(!(await evo()).includes('done'), "l'étape évolution est à faire au départ");

// Une tâche se termine : la page se met à jour seule (le relevé des tâches tourne toutes les 2 s quand quelque chose est actif)
const id = await startJob();
await p.waitForSelector('#jobs.is-busy', { timeout: 15000 }); // le relevé (toutes les 10 s au repos) voit la tâche active
await endJob(id, 'done');
await p.waitForFunction(() => document.querySelector('.pj-opt li.done'), null, { timeout: 15000 }).catch(() => {});
ok((await evo()).includes('done'), "l'étape évolution se raie toute seule quand la tâche se termine");

// Pendant la saisie dans un champ, la page n'est pas rechargée
const id2 = await startJob();
await p.waitForSelector('#jobs.is-busy', { timeout: 15000 });
await p.evaluate(() => { const i = document.createElement('input'); i.id = 'tmp-saisie'; document.body.appendChild(i); i.focus(); });
await p.fill('#tmp-saisie', 'texte en cours');
await endJob(id2, 'error');
await p.waitForTimeout(6000);
ok(await p.locator('#tmp-saisie').count() === 1 && await p.inputValue('#tmp-saisie') === 'texte en cours', 'la saisie en cours est conservée (pas de rechargement)');
ok(errs.length === 0, `aucune erreur JavaScript (${errs.join(' | ')})`);

await b.close();
console.log(bad ? `${bad} KO` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
