// Vérifie dans un vrai navigateur (Playwright) la page « Aujourd'hui » : la liste « À traiter » (filtres, « Marquer traité », « Annuler », mémorisé côté serveur),
// la bascule graphique / données, l'absence de débordement et d'erreur console à 1280 et 390 px, en thème clair et sombre.
// Nécessite Playwright (PLAYWRIGHT_MODULE=chemin du module, PLAYWRIGHT_CHROMIUM si besoin). SHOT_DIR=dossier : enregistre des captures. Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const s = await startApp();
const u = await s.newUser({ email: 'tony@x.fr' });
const pid = await addProject(s.db, u.id, { name: 'Agenda Kiné', gitUrl: 'https://github.com/u/kine.git' });
const ins = async (sql, ...a) => Number((await s.db.prepare(sql).run(...a)).lastInsertRowid);
const p1 = await ins('INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, ?, ?, ?, ?)', pid, 'Cabinet Le Gall', 'a@legall.fr', 'replied', now());
await ins('INSERT INTO replies(project_id, prospect_id, uid, from_email, subject, body, intent, received_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)', pid, p1, 1, 'a@legall.fr', 'Re', 'Bonjour, ça nous intéresse. Pouvez-vous m\'appeler jeudi après-midi ?', 'interested', now() - 7200);
await ins('INSERT INTO replies(project_id, prospect_id, uid, from_email, subject, body, intent, received_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)', pid, null, 2, 'b@armor.fr', 'Re', 'Est-ce compatible avec Doctolib ?', 'question', now() - 90000);
await ins('INSERT INTO prospects(project_id, company, email, status, created_at, next_action, next_action_at) VALUES(?, ?, ?, ?, ?, ?, ?)', pid, 'Kiné du Port', 'b@port.fr', 'sent', now(), 'Rappeler', now() - 30);
await ins("INSERT INTO jobs(user_id, project_id, type, status, error, created_at, finished_at) VALUES(?, ?, 'audit', 'error', 'Dépôt inaccessible : ajoute un token dans Réglages du projet.', ?, ?)", u.id, pid, now() - 900, now() - 600);
for (let i = 0; i < 12; i++) await ins('INSERT INTO mail_log(project_id, email, sent_at, kind) VALUES(?, ?, ?, ?)', pid, `m${i}@x.fr`, now() - i * 40_000, 'initial');

let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const [name, value] = u.cookie.split('=');

for (const [vp, scheme] of [[{ width: 1280, height: 900 }, 'light'], [{ width: 1280, height: 900 }, 'dark'], [{ width: 390, height: 800 }, 'light']]) {
  const tag = `${vp.width}px ${scheme === 'dark' ? 'sombre' : 'clair'}`;
  const ctx = await b.newContext({ viewport: vp, colorScheme: scheme });
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); /* le serveur de test n'est pas à l'adresse publique : on pose l'Origin attendu */ await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');
  await p.waitForTimeout(300);
  ok(/Bonjour/.test(await p.locator('.td-title').innerText()), `${tag} le titre dit bonjour`);
  const fonts = await p.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
  ok(fonts.includes('Fraunces') && fonts.includes('Instrument Sans'), `${tag} les polices de la charte sont chargées`);
  ok((await p.locator('.pills a.pill[aria-current="page"]').innerText()).includes("Aujourd'hui"), `${tag} l'onglet Aujourd'hui est surligné`);
  const wide = await p.evaluate(() => { const W = document.documentElement.clientWidth; return document.documentElement.scrollWidth > W + 1 ? [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > W + 1).slice(0, 5).map((e) => `${e.tagName}.${e.className} → ${Math.round(e.getBoundingClientRect().right)} px`) : []; });
  ok(!wide.length, `${tag} pas de défilement horizontal${wide.length ? ` : ${wide.join(' ; ')}` : ''}`);
  ok((await p.locator('[data-today-item]:visible').count()) === 4, `${tag} quatre lignes à traiter`);

  // Filtres
  await p.locator('[data-today-filter="rep"]').click();
  ok((await p.locator('[data-today-item]:visible').count()) === 2 && (await p.locator('[data-today-filter="rep"]').getAttribute('aria-selected')) === 'true', `${tag} filtre Réponses : 2 lignes`);
  await p.locator('[data-today-filter="ia"]').click();
  ok((await p.locator('[data-today-item]:visible').count()) === 1, `${tag} filtre IA : 1 ligne`);
  await p.locator('[data-today-filter="all"]').click();

  // Marquer traité, puis annuler, puis marquer et recharger
  const first = p.locator('[data-today-item]').first();
  const key = await first.getAttribute('data-key');
  await first.locator('[data-today-mark]').click();
  await p.waitForFunction((k) => document.querySelector(`[data-key="${k}"] [data-today-done]:not([hidden])`), key);
  ok((await p.locator('[data-today-count]').innerText()) === '3' && (await first.innerText()).includes('Traité'), `${tag} « Marquer traité » : compteur à 3, ligne « Traité »`);
  await first.locator('[data-today-undo]').click();
  await p.waitForFunction((k) => document.querySelector(`[data-key="${k}"] [data-today-open]:not([hidden])`), key);
  ok((await p.locator('[data-today-count]').innerText()) === '4', `${tag} « Annuler » : compteur à 4`);
  await first.locator('[data-today-mark]').click();
  await p.waitForFunction((k) => document.querySelector(`[data-key="${k}"] [data-today-done]:not([hidden])`), key);
  await p.waitForTimeout(300);
  await p.reload();
  await p.waitForSelector('html[data-nav="ready"]');
  ok((await p.locator('[data-today-item]').count()) === 3 && (await p.locator('[data-today-count]').innerText()) === '3', `${tag} après rechargement, la ligne traitée a disparu (mémorisé côté serveur)`);
  await p.evaluate(async (k) => { await fetch('/api/today/done', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: k, done: false }) }); }, key).catch(() => {});

  // Graphique / données
  const weeks = p.locator('[data-today-weeks]');
  ok(await weeks.locator('[data-today-chart]').isVisible() && !(await weeks.locator('[data-today-table]').isVisible()), `${tag} le graphique s'affiche d'abord`);
  await weeks.locator('[data-today-data]').click();
  ok(!(await weeks.locator('[data-today-chart]').isVisible()) && await weeks.locator('[data-today-table]').isVisible() && (await weeks.locator('[data-today-data]').innerText()) === 'Voir le graphique', `${tag} « Voir les données » affiche le tableau`);
  await weeks.locator('[data-today-data]').click();
  ok(await weeks.locator('[data-today-chart]').isVisible(), `${tag} « Voir le graphique » revient au graphique`);
  const bars = await p.evaluate(() => [...document.querySelectorAll('.td-bars rect')].filter((r) => r.getBoundingClientRect().height > 0).length);
  ok(bars >= 1, `${tag} les barres du graphique sont dessinées`);

  // Couleurs : aucune couleur en dur, le fond vient de la charte
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(scheme === 'dark' ? bg !== 'rgb(246, 241, 230)' : bg === 'rgb(246, 241, 230)', `${tag} fond de la charte (${bg})`);
  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/aujourdhui-${vp.width}-${scheme}.png`, fullPage: true });
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
