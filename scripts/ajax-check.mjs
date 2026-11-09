// Vérifie dans un vrai navigateur (Playwright) la navigation sans rafraîchissement : aucun rechargement de page, pas d'écouteur ni de minuteur
// en double après plusieurs navigations, défilement et sections conservés, erreurs en notification, retour arrière, repli sur la navigation normale.
// Nécessite Playwright (PLAYWRIGHT_MODULE=chemin du module, PLAYWRIGHT_CHROMIUM=chemin du navigateur si besoin). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { makeClaudeBin } from '../test/helpers/claude-bin.js';
import { addProject } from '../test/helpers/users.js';
import { getSetting } from '../src/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const s = await startApp();
s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'fake-claude.js' });
const u = await s.newUser();
const pid = await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const ctx = await b.newContext({ viewport: { width: 1280, height: 700 } });
const [name, value] = u.cookie.split('=');
await ctx.addCookies([{ name, value, url: s.base }]);
await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */ await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
// Compte les écouteurs encore actifs sur document / window et les intervalles : ils ne doivent pas s'accumuler
await ctx.addInitScript(() => {
  const live = new Map();
  const mine = (type, fn) => !/_hitTargetInterceptor|__playwright/.test(`${type} ${fn}`); // les écouteurs que Playwright pose lui-même ne comptent pas
  const key = (t, type, fn) => `${t === document ? 'doc' : t === window ? 'win' : t?.constructor?.name}|${type}|${String(fn)}`;
  const add = EventTarget.prototype.addEventListener;
  const rem = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, o) { if ((this === document || this === window || this instanceof MediaQueryList) && mine(type, fn)) { const k = key(this, type, fn); live.set(k, (live.get(k) || 0) + 1); } return add.call(this, type, fn, o); };
  EventTarget.prototype.removeEventListener = function (type, fn, o) { if ((this === document || this === window || this instanceof MediaQueryList) && mine(type, fn)) { const k = key(this, type, fn); live.set(k, (live.get(k) || 0) - 1); } return rem.call(this, type, fn, o); };
  const si = window.setInterval; const ci = window.clearInterval; const ivs = new Set();
  window.setInterval = (...a) => { const id = si(...a); ivs.add(id); return id; };
  window.clearInterval = (id) => { ivs.delete(id); return ci(id); };
  window.__live = () => ({ listeners: [...live.values()].reduce((n, v) => n + Math.max(0, v), 0), intervals: ivs.size, keys: Object.fromEntries([...live].filter(([, v]) => v > 0).map(([k, v]) => [k.slice(0, 90).replace(/\s+/g, ' '), v])) });
});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
// (le 400 simulé du test d'erreur n'est pas une erreur du site)
p.on('console', (m) => { if (m.type() === 'error' && !/status of 400/.test(m.text())) errs.push(m.text()); if (m.text().startsWith('[ajax]')) console.log('   ', m.text()); });
const ready = () => p.waitForSelector('html[data-nav="ready"]');
const navs = [];
p.on('load', () => navs.push('load')); // une vraie page chargée (pas un pushState)
const sys = [];
p.on('request', (r) => { if (r.url().endsWith('/api/system')) sys.push(Date.now()); });
const bad = [];
const check = (ok, what) => { if (!ok) bad.push(what); console.log(`${ok ? 'ok ' : 'KO '} ${what}`); };

await p.goto(`${s.base}/`);
await p.waitForTimeout(500);
await p.evaluate(() => { window.__marker = 'vivante'; });
// « Visite guidée » (/?tour=1) est une action : sur l'accueil, il ne doit pas être surligné comme page courante
check(await p.locator('.user-pop a[href="/?tour=1"][aria-current]').count() === 0, 'menu du compte : « Visite guidée » n\'est pas surligné sur l\'accueil');
const base = await p.evaluate(() => window.__live());
const navsAfterLoad = navs.length;

// 1. liens : Mails, Calendrier, Équipe, puis retour au tableau de bord
for (const [label, path] of [['Mails', '/mails'], ['Agenda', '/calendar'], ['Compta', '/compta'], ['Projets', '/projets']]) {
  await p.locator('.pills a.pill', { hasText: label }).click();
  await p.waitForFunction((x) => location.pathname === x, path);
  await ready();
}
check(navs.length === navsAfterLoad, 'liens : aucun rechargement de page (4 navigations)');
check(await p.evaluate(() => window.__marker) === 'vivante', 'liens : la page JavaScript n\'a pas été remplacée');
check((await p.locator('.pills a.pill[aria-current="page"]').innerText()).includes('Projets'), 'liens : la page courante est surlignée dans la barre du haut');
const after = await p.evaluate(() => window.__live());
check(after.listeners <= base.listeners && after.intervals <= base.intervals, `pas d'accumulation après 4 navigations (écouteurs ${base.listeners} → ${after.listeners}, intervalles ${base.intervals} → ${after.intervals})`);
for (const k of Object.keys(after.keys)) if ((after.keys[k] || 0) > (base.keys[k] || 0)) console.log('   +', base.keys[k] || 0, '→', after.keys[k], k);

// 2. précédent / suivant
await p.goBack(); await p.waitForFunction(() => location.pathname === '/compta' && document.title.startsWith('Comptabilité')); await ready();
await p.goBack(); await p.waitForFunction(() => location.pathname === '/calendar' && document.title.startsWith('Agenda')); await ready();
check(/Agenda/.test(await p.title()), 'retour arrière : la bonne page revient');
await p.goForward(); await p.waitForFunction(() => location.pathname === '/compta'); await ready();
check(await p.evaluate(() => window.__marker) === 'vivante' && navs.length === navsAfterLoad, 'précédent / suivant : sans rechargement');

// 3. un seul sondage /api/system après toutes ces navigations (pas de chaînes en double)
sys.length = 0;
await p.waitForTimeout(8000);
check(sys.length <= 3, `pas de sondages en double de l'état du serveur (${sys.length} requêtes en 8 s ; une seule chaîne = 1 toutes les 30 s au repos)`);

// 4. Réglages : défilement, onglet de prompts et sections ouvertes conservés après un enregistrement
await p.locator('.user summary').hover().catch(() => {});
await p.goto(`${s.base}/settings`);
await p.evaluate(() => { window.__marker = 'vivante'; });
const nav0 = navs.length;
await p.locator('#prompts').scrollIntoViewIfNeeded();
await p.locator('[data-pscope-tab="haiku"]').click();
await p.locator('details.prompt-def').nth(2).locator('summary').click();
const ta = p.locator('textarea[name="prompt_haiku_template"]');
await ta.fill('Mon texte Haiku\nsur deux lignes');
await p.evaluate(() => window.scrollBy(0, 40));
const y0 = await p.evaluate(() => Math.round(scrollY));
await Promise.all([p.waitForURL(/settings\?ok/), p.evaluate(() => document.querySelector('.settings-form').requestSubmit())]); // sans cliquer : Playwright ferait défiler la page
await p.waitForTimeout(300); await ready();
check(navs.length === nav0 && await p.evaluate(() => window.__marker) === 'vivante', 'enregistrement des Réglages : sans rechargement de page');
check(Math.abs((await p.evaluate(() => Math.round(scrollY))) - y0) <= 4, `défilement conservé après l'enregistrement (${y0} → ${await p.evaluate(() => Math.round(scrollY))})`);
check(await p.locator('[data-prompts]').getAttribute('data-pscope') === 'haiku', 'onglet de prompts (Haiku) conservé');
check(await p.locator('details.prompt-def').nth(2).evaluate((d) => d.open), 'section de prompt ouverte conservée');
check((await getSetting(s.db, u.id, 'prompts_json')).includes('Mon texte Haiku'), 'le texte est bien enregistré en base');
check(/Réglages/.test(await p.title()) && new URL(p.url()).search === '?ok', 'l\'adresse devient /settings?ok (comme après une redirection normale)');

// 5. erreur de formulaire (réponse 400 du serveur, simulée) : notification, rien n'est perdu
await p.route('**/settings', (r) => (r.request().method() === 'POST'
  ? r.fulfill({ status: 400, contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><body class="app"><main id="contenu"><section class="card"><h1>400</h1><p>Message d\'erreur du serveur</p></section></main></body></html>' })
  : r.continue()));
await p.locator('input[name="notify_email"]').fill('moi@exemple.fr');
await p.evaluate(() => document.querySelector('.settings-form').requestSubmit());
await p.waitForSelector('.toast.error', { timeout: 5000 });
check(/Message d'erreur du serveur/.test(await p.locator('.toast.error').first().innerText()), 'erreur de formulaire : le message du serveur s\'affiche en notification');
check(await p.locator('input[name="notify_email"]').inputValue() === 'moi@exemple.fr' && navs.length === nav0, 'erreur de formulaire : la saisie est conservée, aucune navigation');
await p.unroute('**/settings');
await p.locator('input[name="notify_email"]').fill('');

// 6. page IA après des navigations douces : le script de la page est relancé et marche
await p.locator('details.ia-menu > summary').hover();
await p.locator('details.ia-menu a[href="/chat"]').click();
await p.waitForURL('**/chat'); await ready();
await p.fill('[data-chat-input]', 'ECHO page IA en navigation douce');
await p.keyboard.press('Enter');
await p.waitForSelector('.chat-msg.bot .msg-actions', { timeout: 15000 }).catch(async () => { console.log('   état du fil :', (await p.locator('[data-chat-log]').innerText()).slice(0, 200), '| erreurs :', errs); });
check((await p.locator('.chat-msg.bot .bubble').last().innerText()).includes('Écho'), 'page IA ouverte sans rechargement : envoi et réponse');
await p.locator('.pills a.pill', { hasText: 'Mails' }).click();
await p.waitForURL('**/mails'); await ready();
await p.locator('details.ia-menu > summary').hover();
await p.locator('details.ia-menu a[href="/chat"]').click();
await p.waitForURL('**/chat'); await ready();
await p.fill('[data-chat-input]', 'ECHO deuxième visite');
await p.keyboard.press('Enter');
await p.waitForFunction(() => document.querySelectorAll('.chat-msg.bot .msg-actions').length >= 1, null, { timeout: 15000 });
check((await p.locator('.chat-msg.bot .bubble').last().innerText()).includes('Écho : ECHO deuxième visite'), 'page IA : revenir dessus relance bien son script');

// 7. rechargement doux (remplace location.reload d'app.js) : défilement conservé
await p.goto(`${s.base}/p/${pid}/prospection`); // une page de projet assez longue pour défiler
await p.evaluate(() => { window.__marker = 'vivante'; });
await p.waitForTimeout(400);
await p.evaluate(() => window.scrollBy(0, 120));
const y1 = await p.evaluate(() => Math.round(scrollY));
await p.evaluate(() => window.AiNav.reload());
await p.waitForTimeout(900);
await ready();
check(await p.evaluate(() => window.__marker) === 'vivante' && Math.abs((await p.evaluate(() => Math.round(scrollY))) - y1) <= 4, 'rechargement doux : même page, même défilement');
check(await p.locator('details.project').first().evaluate((d) => d.open), 'rechargement doux : le projet reste ouvert');

// 8. téléchargement (.ics d'un événement) : enregistré sans quitter la page
// Une date relative à aujourd'hui : « À venir » ne liste que ce qui n'est pas passé, une date en dur faisait échouer ce contrôle dès qu'elle était dépassée (la CI est tombée le 4 novembre)
const mk = await u.post('/calendar/events', { title: 'Appel test', date: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10), time: '09:30', minutes: '30' }, { form: true });
console.log('   création événement :', mk.status, mk.headers.get('location'), '| page :', p.url());
await p.locator('.pills a.pill', { hasText: 'Agenda' }).click();
await p.waitForURL('**/calendar**'); await ready();
await p.evaluate(() => { window.__marker = 'vivante'; });
const ics = p.locator('a[href$=".ics"]').first();
const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }).catch(() => null), ics.click()]);
await p.waitForTimeout(400);
check(!!dl && /\.ics$/.test(dl.suggestedFilename()) && await p.evaluate(() => window.__marker) === 'vivante', `téléchargement .ics sans quitter la page${dl ? ` (${dl.suggestedFilename()})` : ' (aucun fichier reçu)'}`);

// 9. déconnexion : la page publique est une autre « coque » : navigation normale
await p.locator('.user summary').click();
await Promise.all([p.waitForFunction(() => document.body.classList.contains('site')), p.locator('.user-pop button').click()]); // « /login?bye » ou la page d'accueil : une page du site public
await p.waitForTimeout(500);
check(await p.evaluate(() => window.__marker) === undefined && await p.evaluate(() => document.body.classList.contains('site')), 'déconnexion : navigation normale vers le site public');

check(errs.length === 0, `aucune erreur JavaScript${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
await b.close(); await s.close();
console.log(bad.length ? `\n${bad.length} PROBLÈME(S)` : '\nTOUT EST BON');
process.exit(bad.length ? 1 : 0);
