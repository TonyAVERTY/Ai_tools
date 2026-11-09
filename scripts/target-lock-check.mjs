// Vérifie dans un vrai navigateur qu'une cible VALIDÉE est grisée et en lecture seule jusqu'à « Modifier » (public/app.js, styles .target-locked) :
// « Modifier » rend les champs modifiables, « Annuler » remet les valeurs validées, une cible non validée reste modifiable.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const TARGET = JSON.stringify({ description: 'TPE du bâtiment', zone: 'Bretagne', taille: '1-10', decideur: 'Gérant', secteurs: ['plomberie'], requetes: ['plombier rennes'] });

for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
  await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?').run(JSON.stringify({ resume: 'Un outil.', proposition_valeur: 'Gagner du temps.' }), TARGET, pid);
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/p/${pid}/prospection`);
  await p.waitForSelector('html[data-nav="ready"]');
  if (!(await p.locator('details.project').evaluate((d) => d.open))) await p.locator('details.project > summary').click();
  await p.evaluate(() => document.querySelectorAll('details.project details').forEach((d) => { d.open = true; }));
  const f = p.locator('form.target');
  const btn = (n) => f.getByRole('button', { name: n, exact: true });
  ok(await f.evaluate((e) => e.classList.contains('target-locked')) && await f.locator('[name=description]').evaluate((e) => e.readOnly), `${tag} validée : verrouillée, lecture seule`);
  ok(await btn('Modifier').isVisible() && !(await btn('Mettre à jour').isVisible()), `${tag} validée : « Modifier » visible, pas de « Mettre à jour »`);
  await f.locator('[name=description]').click();
  await p.keyboard.type('zzz');
  ok((await f.locator('[name=description]').inputValue()) === 'TPE du bâtiment', `${tag} validée : rien ne se tape`);
  await btn('Modifier').click();
  ok(!(await f.locator('[name=secteurs]').evaluate((e) => e.readOnly)) && await btn('Mettre à jour').isVisible() && await btn('Annuler').isVisible() && !(await btn('Modifier').isVisible()), `${tag} Modifier : champs modifiables, « Mettre à jour » et « Annuler »`);
  await f.locator('[name=description]').fill('Autre');
  await f.locator('[name=secteurs]').fill('couverture');
  await p.waitForTimeout(3500); // le rafraîchissement automatique ne doit pas écraser la saisie
  ok((await f.locator('[name=description]').inputValue()) === 'Autre', `${tag} Modifier : la saisie survit au rafraîchissement automatique`);
  await btn('Annuler').click();
  ok((await f.locator('[name=description]').inputValue()) === 'TPE du bâtiment' && (await f.locator('[name=secteurs]').inputValue()) === 'plomberie' && await f.evaluate((e) => e.classList.contains('target-locked')), `${tag} Annuler : valeurs validées remises, reverrouillée`);
  await btn('Modifier').click();
  await f.locator('[name=description]').fill('TPE de la couverture');
  await btn('Mettre à jour').click();
  await p.waitForFunction(() => document.querySelector('form.target')?.classList.contains('target-locked') && document.querySelector('form.target [name=description]').value === 'TPE de la couverture', null, { timeout: 8000 });
  const row = await s.db.prepare('SELECT target_json, target_validated FROM projects WHERE id = ?').get(pid);
  ok(JSON.parse(row.target_json).description === 'TPE de la couverture' && Number(row.target_validated) === 1, `${tag} Mettre à jour : enregistré, reverrouillé`);
  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/target-lock-${vp.width}.png` });
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
