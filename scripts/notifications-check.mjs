// Vérifie dans un vrai navigateur le système de notifications et d'erreurs commun (public/app.js, public/ajax.js) :
// toasts empilés (jamais superposés), annoncés (alert / status), fermables, sans doublon, trois au plus, durée selon le niveau ;
// erreurs lisibles (réseau coupé, 403, 404, 429, 500 : jamais « Failed to fetch » ni un code brut) ; session expirée avec explication ;
// notifications conservées pendant une navigation sans rechargement. À 1280 et 390 px.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const waitFor = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 120)); } return false; };

for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  const tag = `${vp.width}px`;
  const u = await s.newUser();
  await addProject(s.db, u.id, { name: 'Atelier' });
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');
  const toast = (msg, kind) => p.evaluate(([m, k]) => window.AiTools.toast(m, k), [msg, kind]);
  const apiError = (path) => p.evaluate(async (x) => { try { await window.AiTools.api(x); return 'aucune erreur'; } catch (e) { return e.message; } }, path);

  // 1) empilement, rôles, fermeture
  await toast('Prospect ajouté'); await toast('Note ajoutée'); await toast('Impossible de joindre le serveur', 'error');
  await p.waitForTimeout(500); // l'animation d'entrée (glissement de 24 px) doit être finie avant de mesurer la position posée
  const info = await p.evaluate(() => [...document.querySelectorAll('.toasts .toast')].map((t) => { const r = t.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), role: t.getAttribute('role'), close: !!t.querySelector('button[aria-label]') }; }));
  ok(info.length === 3, `${tag} trois notifications affichées (${info.length})`);
  const sorted = [...info].sort((x, y) => x.top - y.top);
  ok(sorted.every((t, i) => i === 0 || t.top >= sorted[i - 1].bottom - 1), `${tag} elles sont empilées, aucune ne recouvre l'autre (${info.map((t) => `${t.top}-${t.bottom}`).join(' / ')})`);
  ok(info.every((t) => t.right <= vp.width && t.left >= 0), `${tag} elles tiennent dans l'écran`);
  const texts = await p.evaluate(() => [...document.querySelectorAll('.toasts .toast')].map((t) => ({ kind: t.classList.contains('error') ? 'error' : 'ok', text: t.querySelector('.toast-t').textContent })));
  ok(texts.filter((t) => t.kind === 'error').every((t) => /\.$/.test(t.text)) && texts.some((t) => t.text === 'Impossible de joindre le serveur.'), `${tag} une erreur finit par un point, ajouté à l'affichage (« ${texts.find((t) => t.kind === 'error')?.text} »)`);
  ok(texts.filter((t) => t.kind === 'ok').every((t) => !/[.!]$/.test(t.text)), `${tag} un succès n'a pas de point final (« ${texts.find((t) => t.kind === 'ok')?.text} »)`);
  ok(info[0].role === 'status' && info[2].role === 'alert', `${tag} succès annoncé en « status », erreur en « alert »`);
  ok(info.every((t) => t.close), `${tag} chacune a un bouton de fermeture accessible`);
  await p.locator('.toasts .toast', { hasText: 'Note ajoutée' }).locator('.toast-x').click();
  ok(await waitFor(async () => (await p.locator('.toasts .toast').count()) === 2, 2000), `${tag} la croix ferme la notification`);

  // 2) pas de doublon, trois au plus
  await toast('Prospect ajouté'); await toast('Prospect ajouté');
  ok(await p.locator('.toasts .toast', { hasText: 'Prospect ajouté' }).count() === 1, `${tag} le même message ne s'empile pas`);
  for (const m of ['A', 'B', 'C', 'D']) await toast(`Message ${m}`);
  ok(await p.locator('.toasts .toast').count() === 3, `${tag} trois notifications au plus (${await p.locator('.toasts .toast').count()})`);

  // 3) navigation sans rechargement : les notifications restent
  await p.evaluate(() => { window.__marker = 'vivante'; });
  await p.locator('.pills a.pill', { hasText: 'Agenda' }).click();
  await p.waitForURL(/calendar/); await p.waitForSelector('html[data-nav="ready"]');
  ok(await p.evaluate(() => window.__marker) === 'vivante' && await p.locator('.toasts .toast').count() === 3, `${tag} les notifications survivent à une navigation sans rechargement`);
  ok(await p.locator('.toasts').count() === 1, `${tag} un seul conteneur de notifications`);

  // 4) durée : un succès disparaît vers 4 s, une erreur reste plus longtemps (8 s)
  await p.evaluate(() => { document.querySelector('.toasts')?.remove(); });
  await toast('Succès court'); await toast('Erreur à lire', 'error');
  await p.waitForTimeout(5200);
  ok(await p.locator('.toasts .toast', { hasText: 'Succès court' }).count() === 0, `${tag} un succès disparaît après ~4 s`);
  ok(await p.locator('.toasts .toast', { hasText: 'Erreur à lire' }).count() === 1, `${tag} une erreur reste plus longtemps`);

  // 5) erreurs lisibles
  await ctx.setOffline(true);
  const net = await apiError('/api/projects/1/status');
  await ctx.setOffline(false);
  ok(net === 'Connexion impossible : réessaie dans un instant.', `${tag} réseau coupé : « ${net} » (pas « Failed to fetch »)`);
  for (const [status, expected] of [[403, "Tu n'as pas accès à cette action."], [404, 'Introuvable : recharge la page.'], [429, 'Trop de demandes : attends un instant puis réessaie.'], [500, 'Erreur interne : réessaie dans un instant.']]) {
    await p.route('**/api/probe-status', (route) => route.fulfill({ status, contentType: 'application/json', body: '{}' }));
    const m = await apiError('/api/probe-status');
    await p.unroute('**/api/probe-status');
    ok(m === expected, `${tag} HTTP ${status} sans message du serveur : « ${m} »`);
  }
  await p.route('**/api/probe-status', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: "L'adresse n'est pas valide." }) }));
  ok(await apiError('/api/probe-status') === "L'adresse n'est pas valide.", `${tag} le message du serveur reste prioritaire`);
  await p.unroute('**/api/probe-status');
  // un message du serveur sans point final (la plupart) reçoit son point : tout ce qui affiche err.message en profite
  await p.route('**/api/probe-status', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: "Donne un titre à l'événement" }) }));
  ok(await apiError('/api/probe-status') === "Donne un titre à l'événement.", `${tag} un message du serveur sans point reçoit son point`);
  await p.unroute('**/api/probe-status');
  await p.route('**/api/probe-status', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Vraiment ?' }) }));
  ok(await apiError('/api/probe-status') === 'Vraiment ?', `${tag} jamais de point en double après « ? »`);
  await p.unroute('**/api/probe-status');

  // 6) session expirée : retour à la connexion avec l'explication
  await ctx.clearCookies();
  const nav = p.waitForURL(/\/login/, { timeout: 6000 }).then(() => true).catch(() => false);
  await p.evaluate(() => window.AiTools.api('/api/projects/1/status').catch(() => {}));
  ok(await nav, `${tag} session expirée : retour à la page de connexion`);
  ok(/Ta session a expiré/.test(await p.locator('body').innerText()), `${tag} la page de connexion explique pourquoi`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
