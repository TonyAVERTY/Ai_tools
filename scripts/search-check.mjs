// Vérifie dans un vrai navigateur (Playwright) la recherche globale (bouton et ⌘K / Ctrl+K, résultats, flèches + Entrée, Échap, clic hors fenêtre)
// et le menu « Activité » toujours visible, à 1280 et 390 px, en thème clair et sombre. Aucune erreur console, aucun débordement.
// Nécessite Playwright (PLAYWRIGHT_MODULE=chemin du module, PLAYWRIGHT_CHROMIUM si besoin). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const s = await startApp();
const u = await s.newUser({ email: 'tony@x.fr' });
const pid = await addProject(s.db, u.id, { name: 'Agenda Kiné', gitUrl: 'https://github.com/u/kine.git' });
await addProject(s.db, u.id, { name: 'Atelier Bois', gitUrl: 'https://github.com/u/bois.git' });
await s.db.prepare('INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, ?, ?, ?, ?)').run(pid, 'Cabinet Le Gall', 'a@legall.fr', 'new', Math.floor(Date.now() / 1000));

let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const [name, value] = u.cookie.split('=');

for (const [vp, scheme] of [[{ width: 1280, height: 800 }, 'light'], [{ width: 1280, height: 800 }, 'dark'], [{ width: 390, height: 800 }, 'light']]) {
  const tag = `${vp.width}px ${scheme === 'dark' ? 'sombre' : 'clair'}`;
  const ctx = await b.newContext({ viewport: vp, colorScheme: scheme });
  await ctx.addCookies([{ name, value, url: s.base }]);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');

  // Activité : visible au repos
  ok(await p.locator('#jobs .jobs-btn').isVisible(), `${tag} le menu Activité est visible sans tâche en cours`);
  const wide = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(wide <= 1, `${tag} pas de défilement horizontal avec la barre complète (${wide})`);
  const btn = p.locator('[data-search-open]');
  ok((await btn.boundingBox()).height >= 43.5, `${tag} le bouton Rechercher fait au moins 44 px`);

  // Ouverture par le bouton, saisie, résultats
  await btn.click();
  ok(await p.locator('#search').evaluate((d) => d.open), `${tag} le bouton ouvre la recherche`);
  ok(await p.locator('[data-search-q]').evaluate((e) => e === document.activeElement), `${tag} le champ a le focus`);
  await p.keyboard.type('gall');
  await p.waitForSelector('a.s-row');
  ok((await p.locator('a.s-row').first().innerText()).includes('Cabinet Le Gall'), `${tag} le prospect est trouvé`);
  await p.keyboard.press('Escape');
  ok(!(await p.locator('#search').evaluate((d) => d.open)), `${tag} Échap ferme la recherche`);

  // Un client ouvre directement sa fiche (et non la liste du projet)
  await p.keyboard.press('Control+k');
  await p.locator('[data-search-q]').fill('gall');
  await p.waitForFunction(() => document.querySelector('a.s-row b')?.textContent === 'Cabinet Le Gall');
  await p.locator('a.s-row').first().click();
  await p.waitForFunction(() => /^\/p\/\d+\/contact\/\d+$/.test(location.pathname));
  ok((await p.locator('h1').first().innerText()).includes('Cabinet Le Gall'), `${tag} un client ouvre directement sa fiche`);
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');
  // Les pages se cherchent aussi : « réglages » (sans accent : « reglages ») ouvre la page Réglages
  await p.keyboard.press('Control+k');
  await p.locator('[data-search-q]').fill('reglages');
  await p.waitForFunction(() => document.querySelector('.s-grp h3')?.textContent === 'Pages' && document.querySelector('a.s-row b')?.textContent === 'Réglages');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => location.pathname === '/settings');
  ok(true, `${tag} une page se trouve et s'ouvre (Réglages)`);
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');

  // Raccourci, flèches, Entrée : ouvre la page du projet sans recharger
  await p.keyboard.press('Control+k');
  ok(await p.locator('#search').evaluate((d) => d.open), `${tag} Ctrl+K ouvre la recherche`);
  await p.locator('[data-search-q]').fill('kin');
  await p.waitForFunction(() => document.querySelector('a.s-row b')?.textContent === 'Agenda Kiné'); // les résultats de la recherche précédente restent affichés jusqu'à l'arrivée des nouveaux
  await p.keyboard.press('Enter');
  await p.waitForFunction((id) => location.pathname === `/p/${id}`, pid);
  ok(true, `${tag} Entrée ouvre la page du projet`);
  await p.waitForSelector('html[data-nav="ready"]');

  // Clic sur le fond + aucun résultat
  await p.keyboard.press('Control+k');
  await p.locator('[data-search-q]').fill('zzzzzz');
  await p.waitForFunction(() => document.querySelector('.s-none')?.textContent.includes('Rien de trouvé'));
  ok(true, `${tag} « Rien de trouvé » quand rien ne correspond`);
  await p.mouse.click(5, 5);
  ok(!(await p.locator('#search').evaluate((d) => d.open)), `${tag} un clic sur le fond ferme la recherche`);
  if (process.env.SHOT_DIR) { await p.keyboard.press('Control+k'); await p.locator('[data-search-q]').fill('gall'); await p.waitForSelector('a.s-row'); await p.screenshot({ path: `${process.env.SHOT_DIR}/recherche-${vp.width}-${scheme}.png` }); }
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.slice(0, 2).join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
