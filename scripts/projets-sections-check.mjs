// Vérifie dans un vrai navigateur l'ouverture des sections d'un projet : « En-tête » ouvert et en haut tant que le projet n'est pas analysé, replié en bas ensuite,
// ouvert automatiquement (une fois par échec) quand une analyse échoue, et retrouvé par la liste « Mise en route » à sa nouvelle place. À 1280 et 390 px.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const PROFILE = JSON.stringify({ resume: 'Un outil de devis pour artisans.', proposition_valeur: 'Gagnez du temps.', arguments: ['a'], stack: 'node' });
const TARGET = JSON.stringify({ description: 'TPE du bâtiment', secteurs: ['plomberie'], zone: 'Bretagne', requetes: ['q'] });
const failJob = (uid, pid, msg) => s.db.prepare('INSERT INTO jobs(user_id, project_id, type, status, error, created_at, started_at, finished_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)').run(uid, pid, 'analyze', 'error', msg, now(), now(), now());
const waitFor = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 120)); } return false; };

async function open(u, vp, { todo = false } = {}) {
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  // liste « Mise en route » : dépliée seulement pour le test qui l'utilise (dépliée, elle recouvre le bas du contenu et intercepte les clics)
  await ctx.addInitScript((open) => { try { localStorage.setItem('todo-min', open ? '0' : '1'); } catch { /* ignore */ } }, todo);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');
  return { ctx, p, errs };
}
const isOpen = (p, key) => p.evaluate((k) => !!document.querySelector(`details[data-acc="${k}"]`)?.open, key);
const projectOpen = (p) => p.evaluate(() => !!document.querySelector('details.project')?.open);
/** Ferme puis rouvre le projet (nouveau relevé à l'ouverture), en attendant la fin de chaque animation. */
async function reopenProject(p) {
  await p.locator('details.project > summary').click();
  await waitFor(async () => !(await projectOpen(p)), 2000);
  await p.locator('details.project > summary').click();
  await waitFor(() => projectOpen(p), 2000);
}
const order = (p, a, c) => p.evaluate(([x, y]) => { const A = document.querySelector(`details[data-acc="${x}"]`), C = document.querySelector(`details[data-acc="${y}"]`); return !!(A && C && (A.compareDocumentPosition(C) & Node.DOCUMENT_POSITION_FOLLOWING)); }, [a, c]);

for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  const tag = `${vp.width}px`;

  // 1) projet pas encore analysé : En-tête ouvert et en haut
  const u1 = await s.newUser();
  await addProject(s.db, u1.id, { name: 'Brut' });
  let { ctx, p, errs } = await open(u1, vp);
  ok(await isOpen(p, 'header'), `${tag} pas analysé : En-tête ouvert`);
  ok(await order(p, 'header', 'prospect'), `${tag} pas analysé : En-tête avant Prospecter`);
  ok(await p.locator('details[data-acc="header"] [data-job="analyze"]').count() === 1, `${tag} pas analysé : la zone de l'analyse est dans l'En-tête`);
  ok(errs.length === 0, `${tag} pas analysé : aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();

  // 2) analysé, cible validée : En-tête replié et en bas, Prospecter ouvert
  const u2 = await s.newUser();
  const pid2 = await addProject(s.db, u2.id, { name: 'Analysé' });
  await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?').run(PROFILE, TARGET, pid2);
  ({ ctx, p, errs } = await open(u2, vp, { todo: true }));
  ok(!(await isOpen(p, 'header')), `${tag} analysé : En-tête replié`);
  ok(await isOpen(p, 'prospect') && await isOpen(p, 'search'), `${tag} cible validée : Prospecter et sa recherche sont ouverts`);
  ok(await order(p, 'prospect', 'header') && await order(p, 'header', 'config'), `${tag} analysé : En-tête descendu, juste avant Configuration`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);

  // 3) la liste « Mise en route » retrouve En-tête à sa nouvelle place et l'ouvre
  await p.waitForSelector('[data-todo-go="analyze"]', { timeout: 8000 });
  await p.locator('[data-todo-go="analyze"]').click();
  ok(await waitFor(() => isOpen(p, 'header')), `${tag} « Mise en route → Analyser le projet » ouvre En-tête, même replié en bas`);
  ok(await p.locator('details[data-acc="header"] >> text=Site du produit').first().isVisible(), `${tag} le champ « Site du produit » est visible une fois En-tête ouvert`);
  ok(errs.length === 0, `${tag} analysé : aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();

  // 4) une réanalyse qui échoue ouvre En-tête (son erreur y est affichée), une seule fois par échec
  const u3 = await s.newUser();
  const pid3 = await addProject(s.db, u3.id, { name: 'Réanalyse' });
  await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?').run(PROFILE, TARGET, pid3);
  await failJob(u3.id, pid3, "Git : EACCES: permission denied, mkdir '/data/repos/1'");
  ({ ctx, p, errs } = await open(u3, vp));
  ok(await waitFor(() => isOpen(p, 'header')), `${tag} analyse en échec : En-tête s'ouvre tout seul`);
  ok(/en échec/.test(await p.locator('details[data-acc="header"] [data-job="analyze"]').innerText()), `${tag} analyse en échec : le message est visible`);
  await p.locator('details[data-acc="header"] > summary').click(); // on le referme (fermeture animée)
  ok(await waitFor(async () => !(await isOpen(p, 'header')), 2000), `${tag} l'utilisateur peut refermer En-tête`);
  await reopenProject(p); // nouveau relevé à la réouverture du projet
  await p.waitForTimeout(1500);
  ok(!(await isOpen(p, 'header')), `${tag} le même échec ne rouvre pas En-tête`);
  await failJob(u3.id, pid3, 'Un autre échec');
  await reopenProject(p);
  ok(await waitFor(() => isOpen(p, 'header')), `${tag} un nouvel échec rouvre En-tête`);
  ok(errs.length === 0, `${tag} analyse en échec : aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
