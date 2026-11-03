// Vérifie dans un vrai navigateur, sur une VRAIE base MySQL / MariaDB, le choix des tables du Récapitulatif sans écrire de SQL : « Se connecter et analyser » remplit les listes
// avec les vraies tables, présélectionne la bonne et la marque « (recommandé) », chiffre un aperçu, relance l'aperçu quand on change de table, enregistre, garde le choix
// après rechargement, alimente le Récapitulatif, et dit clairement une erreur de connexion. À 1280 et 390 px.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM) et une base : BDD_CHECK_DB_HOST / _PORT / _USER / _PASSWORD (sinon le script s'ignore). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { getProject } from '../src/projects.js';

const env = process.env;
if (!env.BDD_CHECK_DB_HOST) { console.log('IGNORÉ : pas de base MySQL / MariaDB (BDD_CHECK_DB_HOST).'); process.exit(0); }
const { chromium } = await import(env.PLAYWRIGHT_MODULE || 'playwright-core');
const mysql = await import('mysql2/promise');
const conn = { host: env.BDD_CHECK_DB_HOST, port: Number(env.BDD_CHECK_DB_PORT || 3306), user: env.BDD_CHECK_DB_USER || 'root', password: env.BDD_CHECK_DB_PASSWORD || '' };
const dbName = `aitools_bddui_${process.pid}`;
const admin = await mysql.createConnection({ ...conn, multipleStatements: true });
await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\`; CREATE DATABASE \`${dbName}\`; USE \`${dbName}\`;
  CREATE TABLE sessions_log (id INT PRIMARY KEY AUTO_INCREMENT, payload TEXT);
  CREATE TABLE users (id INT PRIMARY KEY AUTO_INCREMENT, email VARCHAR(100));
  CREATE TABLE subscriptions (id INT PRIMARY KEY AUTO_INCREMENT, status VARCHAR(20));
  CREATE TABLE payments (id INT PRIMARY KEY AUTO_INCREMENT, amount INT, currency CHAR(3), status VARCHAR(20), tax_amount INT);
  INSERT INTO users(email) VALUES ('a@x.fr'),('b@x.fr'),('c@x.fr'),('d@x.fr'),('e@x.fr');
  INSERT INTO subscriptions(status) VALUES ('active'),('active'),('canceled');
  INSERT INTO payments(amount, currency, status, tax_amount) VALUES (4900,'eur','succeeded',800),(4900,'eur','succeeded',800),(9900,'eur','succeeded',1600),(1000,'eur','failed',0);`);
await admin.query('ANALYZE TABLE users, subscriptions, payments').catch(() => {});

const s = await startApp({ cfg: { allowPrivateHosts: true } });
const b = await chromium.launch(env.PLAYWRIGHT_CHROMIUM ? { executablePath: env.PLAYWRIGHT_CHROMIUM } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 120)); } return false; };
const flat = (t) => String(t).replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();

try {
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const tag = `${vp.width}px`;
    const u = await s.newUser();
    const id = Number(await addProject(s.db, u.id, { name: `Saas ${vp.width}` }));
    const ctx = await b.newContext({ viewport: vp });
    const [name, value] = u.cookie.split('=');
    await ctx.addCookies([{ name, value, url: s.base }]);
    await ctx.addInitScript(() => { try { localStorage.setItem('todo-min', '1'); } catch { /* ignore */ } });
    await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|status of (4|5)\d\d/.test(m.text())) errs.push(m.text()); });
    await p.goto(`${s.base}/`); await p.waitForSelector('html[data-nav="ready"]');
    await p.evaluate(() => { const d = document.querySelector('details[data-acc="config"]'); if (d) d.open = true; });
    const f = 'form[data-action="db"]';
    ok(await p.locator(`${f} input[name^="sql_"]`).count() === 0 && !/SELECT/.test(await p.locator(f).innerText()), `${tag} aucun champ où écrire du SQL`);

    await p.selectOption(`${f} select[name=type]`, 'mysql');
    await p.fill(`${f} input[name=host]`, conn.host); await p.fill(`${f} input[name=port]`, String(conn.port));
    await p.fill(`${f} input[name=database]`, dbName); await p.fill(`${f} input[name=user]`, conn.user); await p.fill(`${f} input[name=password]`, conn.password);

    // 1) mauvais mot de passe : l'erreur est dite, rien ne change
    await p.fill(`${f} input[name=password]`, 'mauvais-mot-de-passe');
    await p.locator('[data-bdd-analyze]').click();
    ok(await waitFor(async () => /Identifiants refusés/.test(await p.locator('[data-bdd-state]').innerText())), `${tag} mot de passe refusé : « ${flat(await p.locator('[data-bdd-state]').innerText())} »`);
    ok(!/ER_ACCESS|mysql2|Access denied/i.test(await p.locator('[data-bdd-state]').innerText()), `${tag} pas de message brut du pilote`);
    await p.fill(`${f} input[name=password]`, conn.password);

    // 2) analyse : listes remplies, recommandation présélectionnée et marquée
    await p.locator('[data-bdd-analyze]').click();
    ok(await waitFor(async () => /Aperçu/.test(await p.locator('[data-bdd-preview]').innerText())), `${tag} l'analyse se termine`);
    const opts = await p.locator(`${f} select[name=users_table] option`).allInnerTexts();
    ok(opts.length === 5 && opts[0] === 'Ne pas suivre', `${tag} la liste propose toutes les tables (${opts.length - 1}) et « Ne pas suivre »`);
    ok(/users \(recommandé\)/.test(opts[1]), `${tag} la table recommandée est en tête et marquée (« ${opts[1]} »)`);
    ok(opts.filter((o) => /recommandé/.test(o)).length === 1, `${tag} une seule table recommandée par liste`);
    const sel = async (n) => p.locator(`${f} select[name=${n}]`).inputValue();
    ok(await sel('users_table') === 'users' && await sel('clients_table') === 'subscriptions' && await sel('revenue_table') === 'payments', `${tag} les bonnes tables sont présélectionnées`);
    ok(await sel('revenue_column') === 'amount' && await sel('revenue_unit') === 'cents', `${tag} colonne « amount » et montants en centimes détectés`);
    ok(/Compte les lignes de « subscriptions » dont « status » vaut « active »/.test(await p.locator('[data-bdd-rule="clients"]').innerText()), `${tag} la règle appliquée est dite en clair`);
    const preview = flat(await p.locator('[data-bdd-preview]').innerText());
    ok(preview === 'Aperçu : 5 utilisateurs · 2 clients payants · 197,00 € de revenu', `${tag} aperçu chiffré juste (« ${preview} »)`);
    ok(await p.locator(`${f} input[name^="sql_"]`).count() === 0, `${tag} toujours aucun SQL après l'analyse`);

    // 3) changer de table relance l'aperçu, la recommandation reste affichée
    await p.selectOption(`${f} select[name=users_table]`, 'sessions_log');
    ok(await waitFor(async () => /0 utilisateurs/.test(await p.locator('[data-bdd-preview]').innerText())), `${tag} changer de table relance l'aperçu`);
    ok((await p.locator(`${f} select[name=users_table] option`).allInnerTexts()).some((o) => /users \(recommandé\)/.test(o)), `${tag} « (recommandé) » reste sur la bonne table`);
    await p.selectOption(`${f} select[name=users_table]`, 'users');
    ok(await waitFor(async () => /5 utilisateurs/.test(await p.locator('[data-bdd-preview]').innerText())), `${tag} retour à la table recommandée`);
    ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);

    // 4) enregistrer, recharger : le choix est gardé ; le Récapitulatif affiche les chiffres
    await p.locator(`${f} button:not([type=button])`).click();
    ok(await waitFor(async () => !!(await getProject(s.app, id, { userId: u.id, secrets: true })).dbCfg?.kpi?.users, 8000), `${tag} le choix est enregistré`);
    const saved = (await getProject(s.app, id, { userId: u.id, secrets: true })).dbCfg;
    ok(saved.kpi.revenue.amountColumn === 'amount' && saved.kpi.revenue.cents === true && saved.kpi.clients.statusValues[0] === 'active', `${tag} stocké : tables, colonne, unité et filtre (${JSON.stringify(saved.kpi.clients)})`);
    ok(!('sql_users' in saved) || !saved.sql_users, `${tag} aucune requête SQL stockée`);
    await p.reload(); await p.waitForSelector('html[data-nav="ready"]');
    await p.evaluate(() => { const d = document.querySelector('details[data-acc="config"]'); if (d) d.open = true; });
    ok(await p.locator(`${f} select[name=revenue_table]`).inputValue() === 'payments', `${tag} après rechargement, la table choisie est présélectionnée`);
    ok(/Additionne « amount » dans « payments »/.test(await p.locator('[data-bdd-rule="revenue"]').innerText()), `${tag} la règle est réaffichée`);
    const recap = await p.evaluate((pid) => fetch(`/api/projects/${pid}/recap`).then((r) => r.json()), id);
    ok(recap.business?.users === 5 && recap.business?.clients === 2 && recap.business?.revenue === 197, `${tag} le Récapitulatif lit les tables choisies (${JSON.stringify(recap.business)})`);
    ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
    await ctx.unrouteAll({ behavior: 'ignoreErrors' }); await ctx.close();
  }
} finally {
  await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``).catch(() => {}); await admin.end().catch(() => {});
  await b.close(); await s.close?.();
}
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
