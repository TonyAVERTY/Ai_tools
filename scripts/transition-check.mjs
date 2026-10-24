// Vérifie dans un vrai navigateur les transitions de page : vers la droite dans la barre du haut = le contenu arrive par la droite, vers la gauche = par la gauche,
// hors onglets = fondu vers le haut, même page = rien ; pas de défilement horizontal ; mouvement réduit respecté ; la liste « Mise en route » ne saute pas.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const u = await s.newUser();
await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };

async function session(vp, reduced = false) {
  const ctx = await b.newContext({ viewport: vp, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', (route) => { const r = route.request(); const h = { ...r.headers() }; if (r.method() === 'POST') h.origin = APP_URL; route.continue({ headers: h }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');
  return { ctx, p, errs };
}
// Clique, attend le contenu et relève l'état de l'animation dès son début
async function go(p, click, path) {
  await p.evaluate(() => { window.__sawMove = null; new MutationObserver(() => { const pg = document.querySelector('#contenu > .page'); if (pg?.dataset.move && !window.__sawMove) { const c = [...pg.children].find((e) => !e.matches('.todo, dialog')); const cs = getComputedStyle(c); window.__sawMove = { move: pg.dataset.move, name: cs.animationName, opacity: Number(cs.opacity), x: new DOMMatrixReadOnly(cs.transform).m41, overflowX: scrollX > 0 || document.documentElement.scrollWidth > innerWidth + 1 }; } }).observe(document.body, { subtree: true, attributes: true, childList: true }); });
  await click();
  await p.waitForFunction((x) => location.pathname === x, path);
  await p.waitForSelector('html[data-nav="ready"]');
  await p.waitForTimeout(900); // fin de l'animation et du nettoyage
  return p.evaluate(() => window.__sawMove);
}

for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  const { ctx, p, errs } = await session(vp);
  const pill = (label) => () => p.locator('.pills a.pill', { hasText: label }).click();
  let r = await go(p, pill('Mails'), '/mails');
  ok(r?.move === 'right' && r.name === 'page-from-right', `${tag} Projets → Mails (vers la droite) : le contenu arrive par la droite`);
  ok(r && r.opacity < 1 && r.x > 0, `${tag} l'animation démarre bien décalée et transparente (opacité ${r?.opacity?.toFixed(2)}, x ${r?.x?.toFixed(0)} px)`);
  ok(r && r.overflowX === false, `${tag} pas de défilement horizontal pendant la transition`);
  r = await go(p, pill('Calendrier'), '/calendar');
  ok(r?.move === 'right', `${tag} Mails → Calendrier : par la droite`);
  r = await go(p, pill('Projets'), '/');
  ok(r?.move === 'left' && r.name === 'page-from-left' && r.x < 0, `${tag} Calendrier → Projets (vers la gauche) : le contenu arrive par la gauche`);
  ok(await p.locator('#contenu > .page').evaluate((e) => !e.dataset.move) && await p.locator('#contenu').evaluate((e) => !e.classList.contains('pt-run')), `${tag} nettoyage après la transition`);
  // Hors onglets : fondu vers le haut
  r = await go(p, async () => { await p.locator('details.user > summary').click(); await p.locator('.user-pop a', { hasText: 'Réglages' }).click(); }, '/settings');
  ok(r?.move === 'up' && r.name === 'page-from-below', `${tag} Projets → Réglages (hors onglets) : fondu vers le haut`);
  // Même page : rien
  await p.goto(`${s.base}/mails`); await p.waitForSelector('html[data-nav="ready"]');
  r = await go(p, pill('Mails'), '/mails');
  ok(r === null, `${tag} cliquer sur la page déjà ouverte : aucune animation`);
  // La liste « Mise en route » ne bouge pas (position fixe) : vérifié sur le tableau de bord pendant l'animation
  await p.locator('.pills a.pill', { hasText: 'Mails' }).waitFor();
  await p.evaluate(() => { window.__todo = []; });
  const click = p.locator('.pills a.pill', { hasText: 'Projets' }).click();
  await p.waitForSelector('#contenu > .page[data-move]', { timeout: 5000 }).catch(() => {});
  const todo = await p.locator('#todo').evaluate((e) => { const r = e.getBoundingClientRect(); return { bottom: Math.round(innerHeight - r.bottom), hidden: e.hidden }; }).catch(() => null);
  await click;
  await p.waitForTimeout(900);
  const after = await p.locator('#todo').evaluate((e) => { const r = e.getBoundingClientRect(); return { bottom: Math.round(innerHeight - r.bottom), hidden: e.hidden }; }).catch(() => null);
  ok(!todo || todo.hidden || after.hidden || todo.bottom === after.bottom, `${tag} la liste « Mise en route » reste à sa place pendant la transition (bas ${todo?.bottom} → ${after?.bottom})`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}

// Mouvement réduit : pas d'animation, mais la navigation fonctionne
{
  const { ctx, p, errs } = await session({ width: 1280, height: 800 }, true);
  const r = await go(p, () => p.locator('.pills a.pill', { hasText: 'Mails' }).click(), '/mails');
  ok(!r || r.name === 'none' || r.opacity === 1, `mouvement réduit : aucune animation (${r?.name ?? 'rien'})`);
  ok(await p.locator('h1').first().isVisible(), 'mouvement réduit : la page s\'affiche normalement');
  ok(errs.length === 0, `mouvement réduit : aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
