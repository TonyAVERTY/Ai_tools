// Vérifie dans un vrai navigateur (1) le passage en douceur du questionnaire au tableau de bord (scène de fin, puis arrivée sans coupure) et
// (2) la visite guidée : démarrage automatique une seule fois, chaque étape éclaire son élément (le reste est assombri) avec une carte qui ne le recouvre pas,
// navigation (Suivant, Précédent, flèches, Échap, Passer), relance par « Visite guidée », téléphone (carte en bas), mouvement réduit, aucune erreur console.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). SHOTS=<dossier> enregistre des captures. Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { getSetting } from '../src/db.js';
import { TOUR_STEPS } from '../src/tour.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const open = async (u, vp, scheme = 'dark', extra = {}) => {
  const ctx = await b.newContext({ viewport: vp, colorScheme: scheme, ...extra });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', (route) => { const r = route.request(); const h = { ...r.headers() }; if (r.method() === 'POST') h.origin = APP_URL; route.continue({ headers: h }); });
  // Un relevé du quota Claude (fictif) : la carte « Consommation Claude » n'existe qu'avec une mesure, l'étape qui l'éclaire en dépend
  await ctx.route('**/api/system', async (route) => {
    const j = await (await route.fetch()).json();
    const t = Math.floor(Date.now() / 1000);
    await route.fulfill({ json: { ...j, linkMode: 'subscription', claudeRateLimit: { source: 'live', at: t, fiveHour: { utilization: 0.76, resetsAt: t + 7200 }, sevenDay: { utilization: 0.38, resetsAt: t + 3 * 86400 } } } });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  return { ctx, p, errs };
};
const shot = async (p, name) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${name}.png` }); };
const stepCount = async (p) => (await p.locator('[data-tour-count]').innerText()).match(/Étape (\d+) sur (\d+)/)?.slice(1).map(Number);
const inter = (a, c) => !(a.x + a.width <= c.x || c.x + c.width <= a.x || a.y + a.height <= c.y || c.y + c.height <= a.y);

for (const [vp, scheme, tag] of [[{ width: 1280, height: 800 }, 'dark', '1280px sombre'], [{ width: 390, height: 780 }, 'light', '390px clair']]) {
  const u = await s.newUser({ firstLogin: true });
  const { ctx, p, errs } = await open(u, vp, scheme);
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');

  // ---------- questionnaire jusqu'à la scène de fin ----------
  for (let i = 0; i < 7; i++) {
    const before = await p.locator('[data-wiz-count]').innerText();
    const opt = p.locator('[data-step]:not([hidden]) label.opt').first();
    if (i < 6 && await opt.count()) await opt.click();
    await p.locator('[data-wiz-next]').click();
    if (i < 6) await p.waitForFunction((x) => document.querySelector('[data-wiz-count]').textContent !== x, before, { timeout: 5000 });
  }
  await p.waitForSelector('.wiz-end.show', { timeout: 5000 });
  await p.waitForTimeout(700);
  const endBg = await p.locator('.wiz-end').evaluate((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, op: getComputedStyle(e).opacity }; });
  ok(endBg.w >= vp.width - 1 && endBg.h >= vp.height - 1 && Number(endBg.op) > 0.9, `${tag} fin du questionnaire : une scène plein écran apparaît en fondu`);
  ok(/Merci, ton espace est prêt/.test(await p.locator('.wiz-end').innerText()), `${tag} la scène remercie et annonce la suite`);
  await shot(p, `tour-end-${vp.width}`);
  await p.waitForSelector('.tour-card', { timeout: 10000 });
  ok(new URL(p.url()).pathname === '/', `${tag} on arrive sur le tableau de bord, sans coupure`);
  ok((await getSetting(s.db, u.id, 'user_profile_asked', null)) === 'done', `${tag} le profil est enregistré`);
  await p.waitForTimeout(500);

  // ---------- la visite démarre toute seule ----------
  ok(/Bienvenue dans AiTools/.test(await p.locator('[data-tour-title]').innerText()), `${tag} la visite démarre toute seule, sur « Bienvenue »`);
  const [, total] = await stepCount(p);
  ok(total >= 8, `${tag} ${total} étapes`);
  await shot(p, `tour-1-${vp.width}`);
  const seen = [];
  for (let i = 1; i < total; i++) {
    await p.locator('[data-tour-next]').click();
    await p.waitForTimeout(520); // fin des transitions
    const [n] = await stepCount(p);
    const title = await p.locator('[data-tour-title]').innerText();
    const step = TOUR_STEPS.find((x) => x.title === title);
    seen.push(title);
    const card = await p.locator('.tour-card').boundingBox();
    const hole = await p.locator('.tour-hole').boundingBox();
    const inView = card.x >= 0 && card.y >= 0 && card.x + card.width <= vp.width + 1 && card.y + card.height <= vp.height + 1;
    if (step?.target) {
      const el = await p.locator(step.target).first().boundingBox();
      const also = step.also ? await p.locator(step.also).first().boundingBox().catch(() => null) : null;
      const covers = el && hole.x <= el.x + 1 && hole.y <= el.y + 1 && hole.x + hole.width >= el.x + el.width - 1 && hole.y + hole.height >= el.y + el.height - 1;
      ok(covers, `${tag} étape ${n} « ${title} » : l'élément est dans la zone éclairée`);
      if (step.open) ok(await p.locator(step.open).evaluate((d) => d.open), `${tag} étape ${n} : le menu est bien déplié pendant l'étape`);
      if (also) {
        ok(hole.x <= also.x + 1 && hole.y <= also.y + 1 && hole.x + hole.width >= also.x + also.width - 1 && hole.y + hole.height >= also.y + also.height - 1, `${tag} étape ${n} : le menu déplié est éclairé aussi`);
        // Une seule forme : un seul tracé de contour, et l'ombre est découpée autour (le bouton voisin reste assombri)
        ok(await p.locator('.tour-ring path').evaluate((e) => (e.getAttribute('d').match(/M/g) || []).length === 1), `${tag} étape ${n} : un seul contour pour le bouton et son menu`);
        ok(await p.locator('.tour-dim').evaluate((e) => /evenodd/.test(getComputedStyle(e).clipPath) || getComputedStyle(e).clipPath !== 'none'), `${tag} étape ${n} : l'ombre est découpée autour de cette forme`);
      }
      ok(inView, `${tag} étape ${n} : la carte reste dans l'écran`);
      ok(vp.width < 640 ? card.y >= hole.y + hole.height - 2 : !inter(card, hole), `${tag} étape ${n} : la carte ne recouvre pas l'élément éclairé`);
    }
    if (i === 3 || i === 7 || i === total - 2 || title.startsWith('Ta consommation')) await shot(p, `tour-${n}-${vp.width}`);
  }
  const dim = await p.locator('.tour-hole').evaluate((e) => getComputedStyle(e).boxShadow);
  const spread = Number((dim.match(/(\d+)px\s*$/) || [])[1]);
  ok(/rgba\(5, 9, 26, 0\.76\)/.test(dim) && spread >= Math.max(vp.width, vp.height), `${tag} tout le reste de la page est assombri (ombre de ${spread} px autour de l'élément éclairé)`);
  ok(/Terminer/.test(await p.locator('[data-tour-next]').innerText()), `${tag} dernière étape : « Terminer »`);
  ok(await p.locator('[data-tour-skip]').isHidden(), `${tag} plus de « Passer la visite » à la dernière étape`);
  await p.locator('[data-tour-next]').click();
  await p.waitForSelector('.tour', { state: 'detached', timeout: 3000 });
  await p.waitForTimeout(300);
  ok((await getSetting(s.db, u.id, 'tour_state', null)) === 'done', `${tag} la fin de la visite est mémorisée`);
  await p.reload();
  await p.waitForSelector('html[data-nav="ready"]');
  await p.waitForTimeout(1500);
  ok(await p.locator('.tour-card').count() === 0, `${tag} la visite ne redémarre plus toute seule`);

  // ---------- relance par le menu du compte, navigation clavier, Échap ----------
  await p.locator('details.user > summary').click();
  await p.getByText('Visite guidée').click();
  await p.waitForSelector('.tour-card');
  await p.waitForTimeout(600);
  ok(/Bienvenue/.test(await p.locator('[data-tour-title]').innerText()), `${tag} « Visite guidée » (menu du compte) relance la visite`);
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(450);
  ok((await stepCount(p))[0] === 2, `${tag} flèche droite : étape suivante`);
  await p.keyboard.press('ArrowLeft');
  await p.waitForTimeout(450);
  ok((await stepCount(p))[0] === 1, `${tag} flèche gauche : étape précédente`);
  const active = await p.evaluate(() => document.querySelector('.tour-card').contains(document.activeElement));
  ok(active, `${tag} le focus reste dans la carte de la visite`);
  await p.keyboard.press('Escape');
  await p.waitForSelector('.tour', { state: 'detached', timeout: 3000 });
  ok(new URL(p.url()).search === '', `${tag} Échap quitte la visite et nettoie l'adresse`);
  ok((await getSetting(s.db, u.id, 'tour_state', null)) === 'done', `${tag} une visite relancée ne change pas l'état mémorisé`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}

// ---------- « Passer la visite » mémorise le choix ----------
{
  const u = await s.newUser({ firstLogin: true });
  await s.db.prepare("INSERT INTO user_settings(user_id, `key`, value) VALUES(?, 'user_profile_asked', 'skipped')").run(u.id);
  const { ctx, p } = await open(u, { width: 1280, height: 800 });
  await p.goto(`${s.base}/`);
  await p.waitForSelector('.tour-card');
  await p.getByRole('button', { name: 'Passer la visite' }).click();
  await p.waitForSelector('.tour', { state: 'detached', timeout: 3000 });
  await p.waitForTimeout(300);
  ok((await getSetting(s.db, u.id, 'tour_state', null)) === 'skipped', '« Passer la visite » est mémorisé : elle ne reviendra pas');
  await ctx.close();
}

// ---------- mouvement réduit ----------
{
  const u = await s.newUser();
  const { ctx, p } = await open(u, { width: 1280, height: 800 }, 'dark', { reducedMotion: 'reduce' });
  await p.goto(`${s.base}/?tour=1`);
  await p.waitForSelector('.tour-card');
  const t = await p.locator('.tour-hole').evaluate((e) => getComputedStyle(e).transitionDuration);
  ok(/^0s/.test(t), `mouvement réduit : le projecteur se déplace sans animation (${t})`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
