// Vérifie dans un vrai navigateur le tableau (Kanban) de la page Prospection : 3 fiches par colonne, « Voir + » en montre 3 de plus (puis va chercher la suite
// sur le serveur au-delà des 25 déjà chargées), le bouton disparaît quand il n'y a plus rien, la colonne défile au lieu de s'allonger, et le glisser-déposer marche toujours.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const u = await s.newUser();
const pid = await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
const ins = s.db.prepare("INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, ?, ?, ?, ?)");
for (let i = 0; i < 32; i++) await ins.run(pid, `Contacté ${String(i).padStart(2, '0')}`, `c${i}@a.fr`, 'sent', now() - i);
for (let i = 0; i < 2; i++) await ins.run(pid, `Nouveau ${i}`, `n${i}@a.fr`, 'new', now() - i);
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 800 }]) {
  const tag = `${vp.width}px`;
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/p/${pid}/prospection`);
  await p.waitForSelector('html[data-nav="ready"]');
  for (const k of ['prospects']) await p.evaluate((x) => { const d = document.querySelector(`details[data-acc="${x}"]`); if (d) d.open = true; }, k);
  await p.locator('[data-view-mode="board"]').click();
  await p.waitForSelector('.kanban [data-drop="sent"]');
  const count = (st) => p.locator(`[data-drop="${st}"] [data-card]`).count();
  const more = p.locator('[data-kmore="sent"]');
  ok(await count('sent') === 3, `${tag} 3 fiches par colonne au départ`);
  ok(await count('new') === 2 && await p.locator('[data-kmore="new"]').count() === 0, `${tag} une colonne de 2 fiches : pas de « Voir + »`);
  ok((await more.innerText()).includes('29 autres'), `${tag} « Voir + » dit combien il en reste`);
  await more.click(); await p.waitForFunction(() => document.querySelectorAll('[data-drop="sent"] [data-card]').length === 6);
  ok(true, `${tag} « Voir + » en montre 3 de plus (6)`);
  const box = await p.evaluate(() => { const z = document.querySelector('[data-drop="sent"]'); return { scroll: z.scrollHeight, client: z.clientHeight, ov: getComputedStyle(z).overflowY }; });
  ok(box.ov === 'auto' && box.scroll > box.client, `${tag} la colonne défile (${box.scroll} > ${box.client}) au lieu de s'allonger`);
  for (let n = 9; n <= 27; n += 3) { await p.locator('[data-kmore="sent"]').click(); await p.waitForFunction((k) => document.querySelectorAll('[data-drop="sent"] [data-card]').length === k, n); }
  ok(await count('sent') === 27, `${tag} 27 fiches affichées`);
  // au-delà des 25 chargées : la suite vient du serveur
  await p.locator('[data-kmore="sent"]').click(); await p.waitForFunction(() => document.querySelectorAll('[data-drop="sent"] [data-card]').length === 30);
  ok(true, `${tag} 30 fiches : les fiches 26 à 30 ont été demandées au serveur`);
  ok((await p.locator('[data-kmore="sent"]').innerText()).includes('2 autres'), `${tag} il en reste 2`);
  await p.locator('[data-kmore="sent"]').click(); await p.waitForFunction(() => document.querySelectorAll('[data-drop="sent"] [data-card]').length === 32);
  ok(await p.locator('[data-kmore="sent"]').count() === 0, `${tag} 32 fiches : plus de bouton, il n'y a plus rien à montrer`);
  const names = await p.locator('[data-drop="sent"] [data-card] .link').allInnerTexts();
  ok(new Set(names).size === 32, `${tag} aucune fiche en double`);
  ok(errs.length === 0, `${tag} aucune erreur de console${errs.length ? ` : ${errs[0]}` : ''}`);
  await ctx.close();
}
await b.close(); await s.close();
console.log(bad ? `\n${bad} ÉCHEC(S)` : '\nTOUT EST BON');
process.exit(bad ? 1 : 0);
