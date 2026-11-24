// Vérifie dans Chromium la liste « Évolution » : Accepter / Refuser (justification obligatoire pour un refus, l'idée refusée quitte la liste), la question posée
// à l'acceptation (Accepter ne demande aucune raison) (oui / non, branche, « Ne plus afficher ce message ») et le lien de correction quand il manque un token Git. Aucun appel réel à l'IA ni à Git : aucun job n'est exécuté.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { testTokenLink } from '../test/helpers/users.js';
import { now, getSetting } from '../src/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const MD = ['Alerte de quota', 'Export CSV', 'Mode sombre', 'Export PDF'].map((t, i) => `### ${i + 1}. ${t}\n- **Pourquoi** : utile\n- **Effort** : S\n`).join('\n');
const s = await startApp();
const u = await s.newUser({ admin: false, link: testTokenLink() });
const t = now();
const pid = Number((await s.db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(u.id, 'P', 'https://github.com/o/r.git', t)).lastInsertRowid);
await s.db.prepare("INSERT INTO jobs(user_id, project_id, type, status, result_json, created_at, finished_at) VALUES(?, ?, 'evolution', 'done', ?, ?, ?)").run(u.id, pid, JSON.stringify({ markdown: MD, sentTo: 'a@b.fr' }), t, t);
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  await s.db.prepare('DELETE FROM evolution_decisions').run();
  await s.db.prepare("DELETE FROM user_settings WHERE `key` IN ('evo_impl_hint', 'evo_impl_choice')").run();
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  // Le serveur de test écoute sur un port libre ; il attend l'origine de l'application : les écritures la portent (jamais de requête vers l'extérieur)
  // (un navigateur ne laisse pas changer « Origin » : les écritures passent par le client de Playwright)
  await p.route('**/api/**', async (route) => (route.request().method() === 'GET' ? route.continue() : route.fulfill({ response: await route.fetch({ headers: { ...route.request().headers(), origin: APP_URL } }) })));
  await p.goto(`${s.base}/p/${pid}/outils`); await p.waitForSelector('.evo-decide', { timeout: 8000 });
  const card = (n) => p.locator(`.evo-decide[data-n="${n}"]`).locator('xpath=ancestor::li');
  ok(await p.locator('.evo-decide').count() === 4, `${tag} 4 idées avec leurs boutons`);
  ok(await p.locator('.evo-decide [data-evo-open="accepted"]').first().isVisible() && await p.locator('.evo-decide [data-evo-open="refused"]').first().isVisible(), `${tag} Accepter et Refuser visibles`);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${tag} pas de débordement horizontal`);
  // Refus : la justification est obligatoire, puis l'idée quitte la liste
  await p.locator('.evo-decide[data-n="1"] [data-evo-open="refused"]').click();
  ok(await p.locator('.evo-decide[data-n="1"] [data-evo-form]').isVisible(), `${tag} Refuser ouvre « Pourquoi tu refuses ? »`);
  await p.locator('.evo-decide[data-n="1"] [data-evo-form] button[type=submit]').click();
  await p.waitForTimeout(500);
  ok(await p.locator('.evo-decide').count() === 4, `${tag} un refus sans raison ne retire rien`);
  await p.locator('.evo-decide[data-n="1"] textarea').fill('Trop cher pour moi');
  await p.locator('.evo-decide[data-n="1"] [data-evo-form] button[type=submit]').click();
  await p.waitForFunction(() => document.querySelectorAll('.evo-decide').length === 3, null, { timeout: 4000 }).catch(() => {});
  ok(await p.locator('.evo-decide').count() === 3, `${tag} l'idée refusée quitte la liste`);
  // Acceptation : aucune raison demandée, puis la question « Veux-tu que l'IA écrive le code ? »
  await p.locator('.evo-decide[data-n="2"] [data-evo-open="accepted"]').click();
  ok(!(await p.locator('.evo-decide[data-n="2"] [data-evo-form]').isVisible()), `${tag} Accepter ne demande aucune raison`);
  const dlg = p.locator('dialog[open]');
  await dlg.waitFor({ timeout: 4000 }).catch(() => {});
  ok(await dlg.count() === 1, `${tag} accepter pose la question`);
  ok((await dlg.textContent()).includes("Veux-tu que l'IA écrive le code de cette idée ?"), `${tag} le titre de la question`);
  ok(await dlg.locator('input[type=radio]').count() === 2 && await dlg.locator('input[type=checkbox]').count() === 1, `${tag} deux branches possibles et « Ne plus afficher ce message »`);
  const box = await dlg.boundingBox();
  ok(box.x >= 0 && box.x + box.width <= vp.width, `${tag} la fenêtre tient dans la largeur`);
  await dlg.locator('input[value=default]').check();
  ok(await dlg.locator('input[type=checkbox]').isDisabled(), `${tag} « Ne plus afficher » est indisponible pour la branche principale`);
  await dlg.locator('input[value=branch]').check();
  ok(await dlg.locator('input[type=checkbox]').isEnabled(), `${tag} « Ne plus afficher » revient pour une nouvelle branche`);
  await dlg.locator('input[type=checkbox]').check();
  await dlg.getByRole('button', { name: "Oui, l'implémenter" }).click();
  // Pas de token Git : l'erreur porte un LIEN souligné (pas un bouton) vers les Réglages
  const fix = p.locator('.toast a.toast-fix');
  await fix.first().waitFor({ timeout: 4000 }).catch(() => {});
  ok(await fix.count() === 1 && (await fix.getAttribute('href')) === '/settings#git', `${tag} l'erreur « Aucun token Git » propose un lien vers Réglages → Dépôts Git`);
  ok(await fix.evaluate((a) => getComputedStyle(a).textDecorationLine === 'underline' && !a.classList.contains('btn')), `${tag} c'est un lien souligné, pas un bouton`);
  const fb = await fix.boundingBox();
  ok(fb && fb.x >= 0 && fb.x + fb.width <= vp.width, `${tag} le lien tient dans l'écran`);
  ok(await p.locator('.evo-decide[data-n="2"] .evo-state').textContent().then((x) => x.includes('Acceptée')), `${tag} l'idée reste acceptée`);
  ok(await getSetting(s.db, u.id, 'evo_impl_choice') === 'yes', `${tag} « Ne plus afficher » retient le choix « oui »`);
  ok(await p.getByRole('button', { name: 'Implémenter' }).count() === 0, `${tag} aucun bouton « Implémenter »`);
  // Choix retenu : l'acceptation suivante ne pose plus la question et tente l'implémentation tout de suite
  await p.locator('.toast-x').first().click().catch(() => {});
  await p.locator('.evo-decide[data-n="3"] [data-evo-open="accepted"]').click();
  await p.waitForTimeout(800);
  ok(await p.locator('dialog[open]').count() === 0, `${tag} plus de question quand le choix est retenu`);
  ok(await p.locator('.toast a.toast-fix').count() >= 1, `${tag} l'échec de l'implémentation automatique propose aussi le lien`);
  // Retenir « non » : plus de question ni d'implémentation
  await s.db.prepare("UPDATE user_settings SET value = 'ask' WHERE user_id = ? AND `key` = 'evo_impl_choice'").run(u.id);
  await p.locator('.evo-decide[data-n="4"] [data-evo-open="accepted"]').click();
  await p.locator('dialog[open]').waitFor({ timeout: 4000 });
  await p.locator('dialog[open] input[type=checkbox]').check();
  await p.locator('dialog[open]').getByRole('button', { name: 'Non' }).click();
  await p.waitForTimeout(500);
  ok(await getSetting(s.db, u.id, 'evo_impl_choice') === 'no', `${tag} « Non » + « Ne plus afficher » retient « non »`);
  await p.locator('.evo-decide[data-n="4"] [data-evo-open="accepted"]').click();
  await p.waitForTimeout(600);
  ok(await p.locator('dialog[open]').count() === 0, `${tag} plus de question après « non » retenu`);
  ok(await s.db.prepare("SELECT COUNT(*) n FROM jobs WHERE type = 'implement'").get().then((r) => Number(r.n)) === 0, `${tag} aucune implémentation lancée`);
  ok(errs.length === 0, `${tag} aucune erreur JavaScript ${errs.join(' | ')}`);
  await ctx.close();
}
await b.close();
await s.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
