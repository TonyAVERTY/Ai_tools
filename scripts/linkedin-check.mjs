// Vérifie dans un vrai navigateur la section « LinkedIn » d'un projet (public/app-linkedin.js) avec un compte relié (OAuth et API LinkedIn simulés) :
// le brouillon s'affiche et se modifie (compteur, enregistrement), le choix de la page de publication, la génération d'un post par le worker
// (le cœur recharge alors la section), et le fonctionnement après une navigation sans rechargement (ajax.js relance les scripts).
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { makeClaudeBin } from '../test/helpers/claude-bin.js';
import { addProject } from '../test/helpers/users.js';
import { saveDraft } from '../src/linkedin.js';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const chromium = pw.chromium || pw.default.chromium;
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const LI = { clientId: 'li-client', clientSecret: 'li-secret', redirectUri: `${APP_URL}/linkedin/callback`, apiVersion: '202604', scopes: ['openid', 'profile', 'w_member_social', 'w_organization_social', 'rw_organization_admin'], pages: true };
const s = await startApp({ worker: true, cfg: { linkedin: LI } });
s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'fake-claude.js' });
// LinkedIn simulé : jeton, profil, deux pages administrées
const reply = (o) => ({ ok: (o.status ?? 200) < 400, status: o.status ?? 200, headers: { get: (k) => o.headers?.[k.toLowerCase()] ?? null }, json: async () => o.json ?? {} });
s.app.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.pathname === '/oauth/v2/accessToken') return reply({ json: { access_token: 'AQV-token-0123456789', expires_in: 5183999, scope: LI.scopes.join(',') } });
  if (u.pathname === '/v2/userinfo') return reply({ json: { sub: 'abc123', name: 'Tony Averty' } });
  if (u.pathname === '/rest/organizationAcls') return reply({ json: { elements: [
    { organizationTarget: 'urn:li:organization:111', roleAssignee: 'urn:li:person:abc123', role: 'ADMINISTRATOR', state: 'APPROVED' },
    { organizationTarget: 'urn:li:organization:222', roleAssignee: 'urn:li:person:abc123', role: 'ADMINISTRATOR', state: 'APPROVED' }] } });
  const org = /^\/rest\/organizations\/(\d+)$/.exec(u.pathname);
  if (org) return reply({ json: { localizedName: { 111: 'Acme Bzh', 222: 'AI_Tools' }[org[1]] } });
  throw new Error(`appel inattendu : ${url}`);
};
const u = await s.newUser();
const pid = await addProject(s.db, u.id, { name: 'Atelier' });
await s.db.prepare('UPDATE projects SET profile_json = ? WHERE id = ?').run(JSON.stringify({ resume: 'Atelier de menuiserie.', proposition_valeur: 'Du sur-mesure.', arguments: ['simple'], ton: 'direct' }), pid);
// Compte LinkedIn relié par le vrai parcours OAuth (sans navigateur)
const start = await fetch(`${s.base}/linkedin/connect?project=${pid}`, { redirect: 'manual', headers: { cookie: u.cookie, accept: 'text/html' } });
const jar = start.headers.getSetCookie().find((c) => c.startsWith('li_oauth_b='))?.split(';')[0];
const state = new URL(start.headers.get('location')).searchParams.get('state');
const back = await fetch(`${s.base}/linkedin/callback?${new URLSearchParams({ code: 'c', state })}`, { redirect: 'manual', headers: { cookie: [u.cookie, jar].join('; '), accept: 'text/html' } });
if (back.status !== 303) throw new Error(`liaison LinkedIn simulée refusée (${back.status})`);
await saveDraft(s.db, pid, { body: 'Un premier brouillon de post.' });

const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const [name, value] = u.cookie.split('=');
await ctx.addCookies([{ name, value, url: s.base }]);
await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */ await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const tabOf = async (t) => { if (new URL(p.url()).pathname !== `/p/${pid}/${t}`) { await p.evaluate(([id, x]) => window.AiNav.go(`/p/${id}/${x}`), [pid, t]); await p.waitForURL((u) => u.pathname === `/p/${pid}/${t}`); } await p.waitForSelector('html[data-nav="ready"]'); }; // aller sur l'onglet d'un projet sans recharger

async function openLinkedin(tag, expected) {
  await p.waitForSelector('html[data-nav="ready"]');
  await tabOf('communication');
  await p.waitForSelector('[data-li-body]', { timeout: 15000 });
  ok((await p.locator('[data-linkedin]').innerText()).includes('Tony Averty'), `${tag} le compte relié est affiché`);
  ok((await p.locator('[data-li-body]').inputValue()) === expected, `${tag} le brouillon s'affiche : « ${expected} »`);
}

await p.goto(`${s.base}/projets`);
await openLinkedin('1re page :', 'Un premier brouillon de post.');
// Édition : le compteur suit la frappe, l'enregistrement est gardé côté serveur
await p.locator('[data-li-body]').fill('Brouillon modifié à la main.');
ok((await p.locator('[data-li-count]').innerText()) === String('Brouillon modifié à la main.'.length), 'le compteur de caractères suit la frappe');
await p.locator('[data-li-save]').click();
for (let i = 0; i < 30; i++) { const r = await s.db.prepare("SELECT body FROM linkedin_posts WHERE project_id = ? ORDER BY id DESC LIMIT 1").get(pid); if (r.body === 'Brouillon modifié à la main.') break; await new Promise((r) => setTimeout(r, 200)); }
ok((await s.db.prepare("SELECT body FROM linkedin_posts WHERE project_id = ? ORDER BY id DESC LIMIT 1").get(pid)).body === 'Brouillon modifié à la main.', 'l\'enregistrement du brouillon est gardé côté serveur');
// Choix de la page de publication
await p.locator('[data-li-pages]').click();
await p.waitForSelector('[data-li-pages-list] option', { state: 'attached', timeout: 15000 });
const pages = await p.locator('[data-li-pages-list] option').allTextContents();
ok(pages.some((t) => t.includes('Acme Bzh')) && pages.some((t) => t.includes('AI_Tools')), `les deux pages administrées sont proposées (${pages.map((t) => t.trim()).join(', ')})`);
// Génération d'un post : le worker (faux Claude) écrit, la fin de la tâche recharge la section
const before = await s.db.prepare('SELECT COUNT(*) n FROM linkedin_posts WHERE project_id = ?').get(pid);
await p.locator('[data-li-direction]').fill('Le lancement de la nouvelle offre');
await p.locator('[data-li-generate]').click();
let created = false;
for (let i = 0; i < 100 && !created; i++) { created = Number((await s.db.prepare('SELECT COUNT(*) n FROM linkedin_posts WHERE project_id = ?').get(pid)).n) > Number(before.n); if (!created) await new Promise((r) => setTimeout(r, 300)); }
ok(created, 'le worker a écrit un nouveau post');
if (created) {
  const fresh = (await s.db.prepare('SELECT body FROM linkedin_posts WHERE project_id = ? ORDER BY id DESC LIMIT 1').get(pid)).body;
  await p.waitForFunction((t) => document.querySelector('[data-li-body]')?.value === t, fresh, { timeout: 20000 });
  ok(true, 'la fin de la tâche recharge la section : le nouveau post est affiché (le cœur appelle app-linkedin.js)');
}
const shown = await p.locator('[data-li-body]').inputValue();

// Navigation sans rechargement, puis retour : la section marche avec les scripts relancés
await p.evaluate(() => { window.__marker = 'vivante'; });
await p.locator('.pills a.pill', { hasText: 'Agenda' }).click();
await p.waitForURL(/calendar/);
await p.waitForSelector('html[data-nav="ready"]');
await p.locator('.pills a.pill', { hasText: 'Projets' }).click();
await p.waitForURL((url) => url.pathname === '/projets');
await p.waitForSelector('html[data-nav="ready"]');
ok(await p.evaluate(() => window.__marker) === 'vivante', 'aller-retour sans rechargement de la page');
ok(await p.evaluate(() => typeof window.AiTools?.loadLinkedin) === 'function', 'app-linkedin.js a été relancé : window.AiTools.loadLinkedin existe');
await openLinkedin('après navigation :', shown);
ok(errs.length === 0, `aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
await b.close(); await s.close();
console.log(bad ? `\n${bad} échec(s)` : '\nTOUT EST BON');
process.exit(bad ? 1 : 0);
