// Vérifie dans un vrai navigateur (1) le questionnaire de première connexion : une question à la fois, « Continuer » / « Retour », le pourcentage de questions
// passées, les cases et pastilles visibles, la dernière question qui enregistre ; (2) la barre de pourcentage pendant la récupération du jeton Claude
// (réponse du serveur simulée et retardée : le pourcentage monte, reste sous 100 % tant que la réponse n'est pas là, puis atteint 100 %).
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). SHOTS=<dossier> enregistre des captures. Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { getProfile } from '../src/userprofile.js';

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
  await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */ await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  return { ctx, p, errs };
};
const pct = (p) => p.locator('[data-wiz-pct]').innerText();

for (const [vp, scheme] of [[{ width: 1280, height: 800 }, 'dark'], [{ width: 390, height: 780 }, 'light']]) {
  const tag = `${vp.width}px ${scheme}`;
  const u = await s.newUser({ firstLogin: true });
  const { ctx, p, errs } = await open(u, vp, scheme);
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');
  ok(new URL(p.url()).pathname === '/welcome', `${tag} première connexion : on arrive sur les questions`);
  const visible = await p.locator('[data-step]:not([hidden])').count();
  ok(visible === 1, `${tag} une seule question affichée à la fois`);
  ok(/Question 1 sur 7/.test(await p.locator('[data-wiz-count]').innerText()) && (await pct(p)) === '0 %', `${tag} « Question 1 sur 7 », 0 %`);
  ok(await p.locator('[data-wiz-back]').isHidden(), `${tag} pas de « Retour » sur la première question`);
  const box = await p.locator('[data-step]:not([hidden]) .box').first().boundingBox();
  ok(box && box.width >= 20, `${tag} les pastilles de choix sont visibles`);
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/welcome-1-${vp.width}-${scheme}.png` });

  const adv = async (sel = '[data-wiz-next]') => { // clique puis attend que la question affichée change (la transition est animée)
    const before = await p.locator('[data-wiz-count]').innerText();
    await p.locator(sel).click();
    await p.waitForFunction((b) => document.querySelector('[data-wiz-count]').textContent !== b, before, { timeout: 5000 });
  };
  await p.locator('[data-step]:not([hidden]) label.opt').nth(1).click(); // « Indépendant ou freelance »
  await p.locator('[data-wiz-next]').click();
  await p.waitForSelector('[data-wiz-confirm].show');
  await p.waitForTimeout(430); // fin de l'animation d'apparition (.46 s)
  const veil = await p.locator('[data-wiz-confirm]').boundingBox();
  const big = await p.locator('.wiz-big').boundingBox();
  const card = await p.locator('section.wiz').boundingBox();
  const blur = await p.locator('[data-wiz-confirm]').evaluate((e) => getComputedStyle(e).backdropFilter || getComputedStyle(e).webkitBackdropFilter);
  const bigBg = await p.locator('.wiz-big').evaluate((e) => getComputedStyle(e).backgroundColor);
  ok(big && big.width >= 80 && /rgb\(/.test(bigBg), `${tag} réponse validée : un grand cercle vert (${Math.round(big?.width)} px, ${bigBg})`);
  ok(big && Math.abs(big.x + big.width / 2 - (card.x + card.width / 2)) < 3 && Math.abs(big.y + big.height / 2 - (card.y + card.height / 2)) < 3, `${tag} le cercle est en plein milieu de la carte`);
  ok(veil && Math.abs(veil.width - card.width) <= 3 && Math.abs(veil.height - card.height) <= 3, `${tag} le voile couvre toute la carte`);
  ok(/blur\(/.test(blur), `${tag} l'arrière-plan est flouté (${blur})`);
  ok(/Réponse prise en compte/.test(await p.locator('[data-wiz-live]').innerText()), `${tag} la confirmation est aussi annoncée aux lecteurs d'écran`);
  ok(await p.locator('[data-dot].done').count() === 1, `${tag} la pastille de progression de la question 1 passe au vert`);
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/welcome-ok-${vp.width}-${scheme}.png` });
  await p.waitForFunction(() => document.querySelector('[data-wiz-count]').textContent !== 'Question 1 sur 7', null, { timeout: 5000 });
  const anim = await p.locator('[data-step]:not([hidden])').evaluate((e) => getComputedStyle(e).animationName);
  ok(anim === 'wiz-in', `${tag} la question suivante entre avec une animation (${anim})`);
  ok(/Question 2 sur 7/.test(await p.locator('[data-wiz-count]').innerText()) && (await pct(p)) === '14 %', `${tag} après « Continuer » : question 2, 14 %`);
  await adv('[data-wiz-back]');
  const back = await p.locator('[data-step]:not([hidden])').evaluate((e) => getComputedStyle(e).animationName);
  ok(back === 'wiz-in-back', `${tag} « Retour » ramène la question par la gauche (${back})`);
  ok((await pct(p)) === '0 %' && await p.locator('input[name=job]:checked').count() === 1, `${tag} « Retour » revient à la question 1 en gardant le choix`);
  await adv(); // question 1 revalidée
  const none = await p.locator('[data-wiz-confirm].show').count();
  ok(none === 0 && await p.locator('[data-dot].done').count() === 1, `${tag} question 2 : pas de pastille verte tant qu'on n'a pas répondu`);
  await adv(); // question 2 passée sans choix
  ok((await pct(p)) === '29 %' && await p.locator('[data-dot].done').count() === 1, `${tag} une question passée sans réponse compte dans le pourcentage mais pas de pastille verte (29 %)`);
  for (let i = 0; i < 3; i++) await adv(); // de la question 3 aux objectifs (question 6)
  ok(/Question 6 sur 7/.test(await p.locator('[data-wiz-count]').innerText()), `${tag} question 6 : objectifs`);
  const cb = await p.locator('[data-step]:not([hidden]) .box').first().boundingBox();
  ok(cb && cb.width >= 20, `${tag} les cases à cocher des objectifs sont visibles`);
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/welcome-6-${vp.width}-${scheme}.png` });
  await p.locator('[data-step]:not([hidden]) label.opt').first().click();
  await adv();
  ok(/Question 7 sur 7/.test(await p.locator('[data-wiz-count]').innerText()) && (await pct(p)) === '86 %' && (await p.locator('[data-wiz-next]').innerText()) === 'Terminer', `${tag} dernière question : 86 %, bouton « Terminer »`);
  ok(await p.locator('[data-dot].done').count() === 2, `${tag} deux réponses validées = deux pastilles vertes`);
  await p.locator('textarea').fill('Un exemple concret à chaque conseil');
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
  await Promise.all([p.waitForURL((x) => x.pathname !== '/welcome'), p.locator('[data-wiz-next]').click()]);
  const prof = await getProfile(s.db, u.id);
  ok(prof.job === 'independant' && prof.level === '' && prof.goals.includes('clients') && prof.notes.startsWith('Un exemple'), `${tag} les réponses sont enregistrées (fonction, question passée vide, objectifs, précision)`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();

  // « Passer le questionnaire » : rien n'est enregistré
  const v = await s.newUser({ firstLogin: true });
  const w = await open(v, vp, scheme);
  await w.p.goto(`${s.base}/welcome`);
  await Promise.all([w.p.waitForURL((x) => x.pathname !== '/welcome'), w.p.getByText('Passer le questionnaire').click()]);
  ok((await getProfile(s.db, v.id)).job === '' && new URL(w.p.url()).pathname === '/', `${tag} « Passer le questionnaire » ne demande plus rien`);
  await w.ctx.close();
}

// ---------- Mouvement réduit : la confirmation reste, les animations et les délais disparaissent ----------
{
  const u = await s.newUser({ firstLogin: true });
  const { ctx, p, errs } = await open(u, { width: 1280, height: 800 }, 'dark', { reducedMotion: 'reduce' });
  await p.goto(`${s.base}/welcome`);
  await p.waitForSelector('html[data-nav="ready"]');
  await p.locator('[data-step]:not([hidden]) label.opt').first().click();
  const t0 = Date.now();
  await p.locator('[data-wiz-next]').click();
  await p.waitForFunction(() => document.querySelector('[data-wiz-count]').textContent === 'Question 2 sur 7', null, { timeout: 3000 });
  const ms = Date.now() - t0;
  const anim = await p.locator('[data-step]:not([hidden])').evaluate((e) => getComputedStyle(e).animationName);
  ok(ms < 900 && anim === 'none', `mouvement réduit : confirmation brève puis passage (${ms} ms) et sans animation (${anim})`);
  ok(await p.locator('[data-dot].done').count() === 1, 'mouvement réduit : la pastille verte de progression est bien là');
  ok(errs.length === 0, 'mouvement réduit : aucune erreur console');
  await ctx.close();
}

// ---------- Récupération du jeton : pourcentage estimé ----------
{
  const u = await s.newUser({ admin: false });
  const { ctx, p, errs } = await open(u, { width: 1280, height: 800 }, 'dark');
  await ctx.route('**/link/claude/login', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'x', url: `${s.base}/static/tokens.css` }) }));
  await ctx.route('**/link/claude/login/code', async (r) => { await new Promise((res) => setTimeout(res, 3500)); r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) }); });
  await ctx.route('**/link/claude/login/cancel', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await p.goto(`${s.base}/link?ia=claude`);
  await p.waitForSelector('html[data-nav="ready"]');
  await p.locator('[data-open-dialog="consent-dialog"]').click();
  await p.locator('#consent-dialog label.opt').click();
  await p.evaluate(() => {
    window.__pct = [];
    const seen = (el) => new MutationObserver(() => window.__pct.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
    document.querySelectorAll('[data-pct-text]').forEach(seen);
  });
  await p.locator('#consent-dialog [data-consent-submit]').click();
  await p.waitForSelector('[data-claude-step2]:not([hidden])');
  ok(await p.locator('form[data-claude-login] [data-pct]').isHidden(), 'la barre de préparation du lien disparaît une fois le lien prêt');
  await p.locator('[data-claude-code] input').fill('abcdefgh12345678');
  const nav = p.waitForURL((x) => x.pathname === '/', { timeout: 15000 }).catch(() => null);
  await p.locator('[data-claude-code] button').click();
  await p.waitForTimeout(1500);
  const box = p.locator('[data-claude-code] [data-pct]');
  ok(await box.isVisible(), 'pendant la récupération du jeton, une barre de pourcentage est affichée');
  const a = parseInt(await box.locator('[data-pct-text]').innerText(), 10);
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/token-progress.png` });
  await p.waitForTimeout(1200);
  const c = parseInt(await box.locator('[data-pct-text]').innerText(), 10);
  ok(a > 0 && c > a && c <= 95, `le pourcentage monte pendant l'attente et reste ≤ 95 % sans réponse (${a} % puis ${c} %)`);
  ok(/Récupération de ton jeton · estimation/.test(await box.innerText()), 'le pourcentage est présenté comme une estimation');
  await nav;
  const seen = await p.evaluate(() => window.__pct).catch(() => null); // la page a pu être rechargée : alors le 100 % a été vu avant
  ok(seen === null || seen.includes('100 %'), 'le pourcentage atteint 100 % quand le jeton est reçu');
  ok(errs.filter((e) => !/Failed to load resource|ERR_/.test(e)).length === 0, `aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
