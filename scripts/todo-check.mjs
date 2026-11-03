// Vérifie dans un vrai navigateur la liste « Mise en route » : c'est une SECTION du projet (la première, repliée), ouverte par le badge « config x/N » de la ligne du projet
// (au clic et au clavier) sans replier le projet ; ses lignes ouvrent les bonnes sections ; elle disparaît une fois tout fait ; plus aucun panneau ne flotte au-dessus de la page.
// Contrôle aussi les indicateurs du plan et la carte « Consommation Claude » en tête de page.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

for (const vp of [{ width: 1280, height: 800, touch: false }, { width: 390, height: 780, touch: true }]) {
  const tag = `${vp.width}px`;
  const u = await s.newUser();
  await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
  const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  let finished = false; // simule un projet dont toutes les étapes sont faites (le statut renvoie une liste complète)
  await ctx.route('**/*', async (route) => {
    const r = route.request();
    if (r.method() === 'GET' && /\/api\/projects\/\d+\/(status|checklist)$/.test(r.url()) && finished) {
      const res = await route.fetch();
      const j = await res.json();
      const done = (c) => ({ ...c, done: c.total, complete: true, ready: true, steps: c.steps.map((x) => ({ ...x, done: true })) });
      return route.fulfill({ response: res, json: j.checklist ? { ...j, checklist: done(j.checklist) } : done(j) });
    }
    if (r.method() !== 'POST') return route.continue();
    /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */
    return route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');
  await p.waitForSelector('[data-cfg]:not([hidden])');
  const setup = 'details[data-acc="setup"]';
  const open = (sel) => p.evaluate((q) => !!document.querySelector(q)?.open, sel);

  // 1) au départ : un badge, une section repliée et la première du projet, et aucun panneau flottant
  const badge = await p.locator('[data-cfg]').evaluate((e) => ({ tag: e.tagName, text: e.textContent.trim(), label: e.getAttribute('aria-label') }));
  ok(badge.tag === 'BUTTON' && /^config 0\/\d+$/.test(badge.text), `${tag} le badge est un bouton « ${badge.text} »`);
  ok(/Mise en route : 0 étape sur \d+\. Voir la liste/.test(badge.label), `${tag} le badge a un nom accessible (« ${badge.label} »)`);
  ok(await p.locator('#todo, .todo, .ring').count() === 0, `${tag} plus aucun panneau ni pastille qui flotte`);
  ok(await p.locator(setup).count() === 1 && !(await open(setup)), `${tag} la section « Mise en route » est repliée`);
  ok(await p.evaluate(() => { const first = document.querySelector('details.project .pcard > details.acc'); return first?.dataset.acc === 'setup'; }), `${tag} c'est la première section du projet`);
  ok(/^Mise en route/.test(await p.locator(`${setup} .acc-title`).innerText()) && /0 étape sur \d+/.test(await p.locator(`${setup} .acc-sub`).innerText()), `${tag} titre et avancement dans la section`);

  // 2) indicateurs du plan en tête de page ; la carte « Consommation Claude » reste masquée tant qu'aucune mesure n'existe
  ok((await p.locator('.ukpi-c').count()) === 4, `${tag} quatre indicateurs en tête de la page Projets`);
  ok(await p.locator('#sys, .strip').count() === 0, `${tag} plus de ligne d'état sous la barre du haut`);
  ok(await p.locator('[data-claude-card]').evaluate((e) => e.hidden), `${tag} pas de carte « Consommation Claude » sans mesure`);

  // 3) le badge ouvre la section SANS replier le projet (avant : il repliait le projet)
  if (!(await open('details.project'))) await p.locator('details.project > summary').click();
  ok(await open('details.project'), `${tag} le projet est ouvert`);
  await p.locator('[data-cfg]').click();
  ok(await waitFor(() => open(setup)), `${tag} un clic sur le badge ouvre la section « Mise en route »`);
  await p.waitForTimeout(900); // défilement doux
  ok(await open('details.project'), `${tag} le projet reste ouvert (le clic sur le badge ne le replie plus)`);
  const box = await p.locator(setup).evaluate((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), vh: innerHeight }; });
  ok(box.top >= -2 && box.top < box.vh, `${tag} la section est amenée à l'écran (haut à ${box.top}px)`);
  const steps = await p.locator(`${setup} [data-setup-go]`).count();
  ok(steps >= 6, `${tag} la liste montre les étapes (${steps})`);
  ok(/Analyser le projet/.test(await p.locator(`${setup} [data-setup-go="analyze"]`).innerText()), `${tag} première étape : « Analyser le projet »`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal avec la liste ouverte`);
  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/todo-${vp.width}.png` });

  // 4) un deuxième clic ne replie toujours pas le projet ; au clavier, Entrée sur le badge ouvre aussi la section
  await p.locator(`${setup} > summary`).click(); // on referme la section
  ok(await waitFor(async () => !(await open(setup)), 2000), `${tag} la section se referme au clic sur son titre`);
  await p.locator('[data-cfg]').focus();
  await p.keyboard.press('Enter');
  ok(await waitFor(() => open(setup)) && await open('details.project'), `${tag} au clavier, Entrée sur le badge ouvre la section sans replier le projet`);

  // 5) une ligne de la liste ouvre la bonne section
  ok(!(await open('details[data-acc="config"]')), `${tag} « Configuration du projet » est repliée`);
  await p.locator(`${setup} [data-setup-go="smtp"]`).click();
  ok(await waitFor(() => open('details[data-acc="config"]')), `${tag} « Configurer l'envoi des mails (SMTP) » ouvre « Configuration du projet »`);

  // 6) tout est fait : la section disparaît, le badge devient « config ✓ »
  finished = true;
  await p.reload(); await p.waitForSelector('html[data-nav="ready"]');
  await p.waitForSelector('[data-cfg]:not([hidden])');
  ok(await waitFor(async () => (await p.locator('[data-cfg]').innerText()).trim() === 'config ✓'), `${tag} tout est fait : le badge devient « config ✓ »`);
  ok(await p.locator(setup).evaluate((e) => e.hidden || getComputedStyle(e).display === 'none'), `${tag} la section « Mise en route » disparaît`);
  ok(await p.locator('[data-cfg]').evaluate((e) => e.classList.contains('ok')), `${tag} le badge passe en vert`);

  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.unrouteAll({ behavior: 'ignoreErrors' }); await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
