// Vérifie dans un vrai navigateur que tout contenu qui n'a pas pu se charger propose « Réessayer » : la mise en route, LinkedIn, Promotion et Récapitulatif d'un projet, la liste des
// clients, la liste des projets du chat. Pour chacun : la requête échoue (erreur serveur ou connexion coupée) -> un message lisible annoncé en « alert » et un bouton « Réessayer »
// (jamais « Failed to fetch » ni un cercle qui tourne pour toujours) ; un clic remet le cercle de chargement ; si ça échoue encore le message revient ; quand ça marche le contenu arrive.
// À 1280 et 390 px. Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
const PROFILE = JSON.stringify({ resume: 'Un outil de devis.', proposition_valeur: 'Gagnez du temps.', arguments: ['a'], stack: 'node' });
const TARGET = JSON.stringify({ description: 'TPE', secteurs: ['plomberie'], zone: 'Bretagne', requetes: ['q'] });
// zone -> requête à faire échouer ; « mode » : erreur serveur (500) ou connexion coupée (network)
const ZONES = {
  setup: { re: /\/api\/projects\/\d+\/(checklist|status)$/, mode: '500', sel: '[data-setup]', text: /Erreur interne/ },
  linkedin: { re: /\/api\/projects\/\d+\/linkedin$/, mode: '500', sel: '[data-linkedin]', text: /Erreur interne/ },
  promo: { re: /\/api\/projects\/\d+\/promo$/, mode: '500', sel: '[data-promo]', text: /Erreur interne/ },
  recap: { re: /\/api\/projects\/\d+\/recap(\?|$)/, mode: '500', sel: '[data-recap]', text: /Erreur interne/ },
  history: { re: /\/api\/projects\/\d+\/history\?/, mode: '500', sel: '[data-charts]', text: /Erreur interne/ }, // les courbes du Récap, dans [data-recap] : on ne les fait échouer qu'après lui
  clients: { re: /\/clients\/projet\/\d+\/liste/, mode: 'network', sel: '[data-cl-lists]', text: /Connexion impossible/ },
  chat: { re: /\/api\/chat\/projects$/, mode: '500', sel: '[data-chat-projlist]', text: /Erreur interne/, small: true },
};

for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  const u = await s.newUser();
  const id = Number(await addProject(s.db, u.id, { name: 'Atelier' }));
  await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?').run(PROFILE, TARGET, id);
  await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, 'Boulangerie', 'b@boulangerie.fr', 'new', ?)").run(id, now());
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  const fail = new Set(Object.keys(ZONES).filter((k) => k !== 'history')); // zones dont la requête échoue
  const hold = new Set(); // zones dont la réponse est retenue (pour voir le cercle)
  await ctx.route('**/*', async (route) => {
    const r = route.request();
    const key = r.method() === 'GET' ? Object.keys(ZONES).find((k) => ZONES[k].re.test(r.url())) : null;
    if (!key) return route.continue();
    while (hold.has(key)) await new Promise((x) => setTimeout(x, 50));
    if (!fail.has(key)) return route.continue();
    return ZONES[key].mode === 'network' ? route.abort('failed') : route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  const box = (k) => `${ZONES[k].sel} .load-error`;
  const check = async (k, tag) => {
    const z = ZONES[k];
    ok(await waitFor(async () => (await p.locator(box(k)).count()) === 1), `${tag} ${k} : un bloc d'erreur au lieu d'un cercle qui tourne pour toujours`);
    const e = await p.locator(box(k)).evaluate((el) => ({ role: el.getAttribute('role'), text: el.querySelector('p')?.textContent || '', btn: el.querySelector('button')?.textContent.trim(), type: el.querySelector('button')?.type, small: el.classList.contains('small'), loading: !!el.parentElement.querySelector('.loading') })).catch(() => null);
    ok(e?.role === 'alert', `${tag} ${k} : annoncé aux lecteurs d'écran (role="alert")`);
    ok(z.text.test(e?.text || '') && !/Failed|TypeError|undefined/.test(e?.text || ''), `${tag} ${k} : message lisible « ${e?.text} »`);
    ok(e?.btn === 'Réessayer' && e?.type === 'button', `${tag} ${k} : bouton « Réessayer »`);
    ok(!!e?.small === !!z.small && !e?.loading, `${tag} ${k} : taille cohérente et plus de cercle`);
    // un clic remet le cercle ; si ça échoue encore, l'erreur revient (et on peut recliquer)
    hold.add(k);
    await p.locator(`${box(k)} button`).click();
    ok(await waitFor(async () => (await p.locator(`${z.sel} .loading .spinner, ${z.sel} .loading .spin-inline`).count()) === 1 && (await p.locator(box(k)).count()) === 0), `${tag} ${k} : un clic sur « Réessayer » remet le cercle de chargement`);
    hold.delete(k);
    ok(await waitFor(async () => (await p.locator(box(k)).count()) === 1), `${tag} ${k} : si ça échoue encore, l'erreur revient`);
    // cette fois ça marche
    fail.delete(k); hold.add(k);
    await p.locator(`${box(k)} button`).click();
    await p.waitForTimeout(200);
    hold.delete(k);
    ok(await waitFor(async () => (await p.locator(box(k)).count()) === 0 && (await p.locator(`${z.sel} .loading`).count()) === 0 && (await p.locator(`${z.sel} > *`).count()) > 0), `${tag} ${k} : puis le contenu arrive`);
  };

  // 1) les blocs du projet
  const tag = `${vp.width}px`;
  await p.goto(`${s.base}/projets`); await p.waitForSelector('html[data-nav="ready"]');
  await p.evaluate(() => { const d = document.querySelector('details.project'); if (d) d.open = true; for (const k of ['setup', 'linkedin', 'promo', 'recap']) { const a = document.querySelector(`details[data-acc="${k}"]`); if (a) a.open = true; } });
  for (const k of ['setup', 'linkedin', 'promo', 'recap']) await p.locator(ZONES[k].sel).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal avec les quatre erreurs`);
  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/retry-${vp.width}.png` });
  for (const k of ['setup', 'linkedin', 'promo', 'recap']) await check(k, tag);
  // les courbes d'historique du Récap ont leur propre « Réessayer » (dans [data-charts], à l'intérieur de [data-recap])
  fail.add('history');
  await p.locator('[data-recap-refresh]').click();
  await check('history', tag);
  ok(await p.locator('[data-cfg]:not([hidden])').count() === 1, `${tag} la liste de mise en route rechargée met à jour le badge « config »`);

  // 2) liste des clients
  await p.goto(`${s.base}/clients`); await p.waitForSelector('html[data-nav="ready"]');
  await p.evaluate(() => { const d = document.querySelector('details[data-cl-project]'); if (d) d.open = true; });
  await check('clients', tag);

  // 3) liste des projets du chat : une erreur du serveur n'est plus présentée comme « Aucun projet »
  await p.goto(`${s.base}/chat`); await p.waitForSelector('html[data-nav="ready"]');
  await p.locator('[data-chat-projmenu] > summary').click();
  ok(await waitFor(async () => (await p.locator(box('chat')).count()) === 1) && !/Aucun projet/.test(await p.locator('[data-chat-projlist]').innerText()), `${tag} chat : une erreur du serveur n'est plus présentée comme « Aucun projet »`);
  await check('chat', tag);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} chat : pas de défilement horizontal`);

  ok(errs.length === 0, `${tag} aucune erreur JS${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  hold.clear(); await ctx.unrouteAll({ behavior: 'ignoreErrors' }); await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
