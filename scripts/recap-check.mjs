// Vérifie dans un vrai navigateur les sections d'un projet qui vivent dans leur propre fichier (public/app-recap.js, app-promo.js, app-linkedin.js) :
// le « Récapitulatif » se charge à l'ouverture, affiche les indicateurs et dessine les courbes (SVG), bascule 30 / 90 jours, se rafraîchit ;
// la « Promotion » affiche son formulaire ; « LinkedIn » charge son contenu ; et — point clé du découpage de app.js — les deux fonctionnent encore après une navigation sans
// rechargement (ajax.js relance app.js puis chaque fichier).
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const chromium = pw.chromium || pw.default.chromium;
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp({ cfg: { chromiumBin: exe } }); // la Promotion n'affiche son formulaire qu'avec Chromium et ffmpeg
const u = await s.newUser();
const pid = await addProject(s.db, u.id, { name: 'Atelier' });
await s.db.prepare('UPDATE projects SET profile_json = ? WHERE id = ?').run(JSON.stringify({ resume: 'Atelier de menuiserie.', proposition_valeur: 'Du sur-mesure.', arguments: ['simple'], ton: 'direct' }), pid);
// Trois semaines d'envois, dont une réponse : de quoi dessiner les barres
const t = now();
for (let i = 0; i < 6; i++) {
  const sentAt = t - (i % 3) * 7 * 86400 - 3600 * i;
  const prospect = Number((await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, ?, ?, 'sent', ?, ?)").run(pid, `Société ${i}`, `contact${i}@societe${i}.fr`, sentAt, sentAt)).lastInsertRowid);
  await s.db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, message_id) VALUES(?, ?, ?, ?, 'initial', ?)").run(pid, prospect, `contact${i}@societe${i}.fr`, sentAt, `<m${i}@test>`);
}
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

async function openRecap(tag) {
  await p.waitForSelector('html[data-nav="ready"]');
  const project = p.locator('details.project').first();
  if (!(await project.evaluate((d) => d.open))) await project.locator('summary').first().click();
  await p.locator('details[data-acc="recap"] > summary').click();
  await p.waitForSelector('[data-recap] .kpis', { timeout: 15000 });
  ok(await p.locator('[data-recap] .kpi').count() >= 3, `${tag} les indicateurs s'affichent`);
  await p.waitForSelector('[data-charts] .chart svg', { timeout: 15000 });
  ok(await p.locator('[data-charts] .chart').count() === 4, `${tag} quatre graphiques (3 courbes + les barres) : ${await p.locator('[data-charts] .chart').count()}`);
  ok(await p.locator('[data-charts] .chart:last-child .bars rect, [data-charts] .chart:last-child rect.bar, [data-charts] .chart:last-child path').count() > 0, `${tag} les barres de prospection sont dessinées`);
}

async function openPromo(tag) {
  await p.waitForSelector('html[data-nav="ready"]');
  const project = p.locator('details.project').first();
  if (!(await project.evaluate((d) => d.open))) await project.locator('summary').first().click();
  await p.locator('details[data-acc="promo"] > summary').click();
  await p.waitForSelector('[data-promo-form]', { timeout: 15000 });
  ok(await p.locator('[data-promo-form] input[name="fps"]').inputValue() === '30', `${tag} le formulaire de la Promotion s'affiche (30 images/s par défaut)`);
}

async function openLinkedin(tag) {
  await p.waitForSelector('html[data-nav="ready"]');
  const project = p.locator('details.project').first();
  if (!(await project.evaluate((d) => d.open))) await project.locator('summary').first().click();
  await p.locator('details[data-acc="linkedin"] > summary').click();
  // « Chargement… » est remplacé par le contenu de la section (compte à relier, ou message d'absence de configuration)
  await p.waitForFunction(() => { const b = document.querySelector('[data-linkedin]'); return b && b.textContent.trim().length > 0 && !/^Chargement…$/.test(b.textContent.trim()); }, null, { timeout: 15000 });
  ok(true, `${tag} la section LinkedIn s'est chargée : « ${(await p.locator('[data-linkedin]').innerText()).trim().replace(/\s+/g, ' ').slice(0, 60)}… »`);
}

await p.goto(`${s.base}/projets`);
await openRecap('1re page :');
await openPromo('1re page :');
await openLinkedin('1re page :');
// 30 → 90 jours
await p.locator('[data-days="90"]').click();
await p.waitForSelector('[data-days="90"][aria-pressed="true"]');
ok(true, 'bascule sur 90 jours');
await p.waitForSelector('[data-charts] .chart svg');
// Rafraîchir
await p.locator('[data-recap-refresh]').click();
await p.waitForSelector('[data-recap] .kpis', { timeout: 15000 });
ok(true, 'Rafraîchir recharge le récapitulatif');

// Navigation sans rechargement vers une autre page, puis retour : le récapitulatif doit marcher avec les scripts relancés
await p.evaluate(() => { window.__marker = 'vivante'; });
await p.locator('.pills a.pill', { hasText: 'Agenda' }).click();
await p.waitForURL(/calendar/);
await p.waitForSelector('html[data-nav="ready"]');
await p.locator('.pills a.pill', { hasText: 'Projets' }).click();
await p.waitForURL((url) => url.pathname === '/projets');
await p.waitForSelector('html[data-nav="ready"]');
ok(await p.evaluate(() => window.__marker) === 'vivante', 'aller-retour sans rechargement de la page');
ok(await p.evaluate(() => typeof window.AiTools?.loadRecap) === 'function', 'app-recap.js a été relancé : window.AiTools.loadRecap existe');
ok(await p.evaluate(() => typeof window.AiTools?.loadPromo) === 'function', 'app-promo.js a été relancé : window.AiTools.loadPromo existe');
ok(await p.evaluate(() => typeof window.AiTools?.loadLinkedin) === 'function', 'app-linkedin.js a été relancé : window.AiTools.loadLinkedin existe');
await openRecap('après navigation :');
await openPromo('après navigation :');
await openLinkedin('après navigation :');
ok(errs.length === 0, `aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
await b.close(); await s.close();
console.log(bad ? `\n${bad} échec(s)` : '\nTOUT EST BON');
process.exit(bad ? 1 : 0);
