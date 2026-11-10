// Parcours réel dans Chromium de l'onglet Communication : générer un post Instagram (le job, l'image qui apparaît sans recharger la page), modifier la
// légende, enregistrer, copier, télécharger, supprimer ; la newsletter de même ; l'ancienne section Instagram a quitté Outils IA.
// Claude est la fixture, l'image est un PNG simulé (le rendu Chromium a son propre test). Sortie « TOUT EST BON » attendue.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM si besoin).
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const chromium = pw.chromium || pw.default.chromium;
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';

// Un vrai PNG 1×1 étiré par le navigateur : il suffit pour vérifier que l'image est servie et affichée
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let failed = 0;
// Le clic envoie la demande ; on attend qu'elle soit en file avant de laisser le worker la traiter
const runJob = async (type) => {
  for (let i = 0; i < 100; i++) { if ((await s.db.prepare("SELECT COUNT(*) n FROM jobs WHERE type = ? AND status = 'queued'").get(type)).n > 0) break; await new Promise((r) => setTimeout(r, 100)); }
  await s.app.worker.tick();
};
const ok = (cond, label) => { console.log(`${cond ? 'ok ' : 'KO '} ${label}`); if (!cond) failed++; };

const s = await startApp({ worker: true, cfg: { claudeBin: resolve('test/fixtures/fake-claude.js') } });
s.app.syncRepo = async (url, dir) => { mkdirSync(dir, { recursive: true }); return 'abc'; };
s.app.stillSupported = () => ({ ok: true });
s.app.renderStill = async () => PNG;
s.app.reviewStill = async () => ({ approved: true, score: 8, issues: [] });
const u = await s.newUser({ email: 'tony@exemple.fr' });
const pid = await addProject(s.db, u.id, { name: 'Cartes Fidèles', gitUrl: 'https://github.com/atelier/cartes.git' });
await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ? WHERE id = ?').run(JSON.stringify({ resume: 'Cartes de fidélité digitales.', proposition_valeur: 'Fidélisez sans carton.', arguments: ['simple'] }), JSON.stringify({ description: 'commerces' }), pid);

const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  const ctx = await b.newContext({ viewport: vp, hasTouch: vp.width < 800, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  // Le serveur refuse une origine inattendue : Chromium ignore un Origin réécrit par continue(), on passe par fetch() (comme prospects-check)
  await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await s.db.prepare('DELETE FROM content_drafts WHERE project_id = ?').run(pid);
  await p.goto(`${s.base}/p/${pid}/communication`);
  await p.waitForSelector('[data-content="instagram"] [data-ct-generate]', { timeout: 10000 });
  ok(await p.locator('[data-content="newsletter"] [data-ct-generate]').count() === 1, `${tag} les sections Instagram et Newsletter sont dans l'onglet Communication`);

  // Instagram : générer. Le job tourne dans le worker ; la page l'affiche sans rechargement
  await p.fill('[data-content="instagram"] [data-ct-direction]', 'le lancement des cartes mobiles');
  await p.selectOption('[data-content="instagram"] [data-ct-format]', 'portrait');
  await p.locator('[data-content="instagram"] [data-ct-generate]').click();
  await runJob('instagram_post');
  await p.waitForSelector('[data-content="instagram"] .ct-img', { timeout: 20000 });
  ok(await p.evaluate(() => { const i = document.querySelector('[data-content="instagram"] .ct-img'); return i.complete && i.naturalWidth > 0; }), `${tag} l'image du post s'affiche`);
  ok(/Premier angle : le lancement des cartes mobiles/.test(await p.inputValue('[data-content="instagram"] [data-ct-body]')), `${tag} la légende reprend la direction donnée`);
  ok(/#fidelite/.test(await p.inputValue('[data-content="instagram"] [data-ct-tags]')), `${tag} les hashtags sont proposés`);
  ok(/Secteur/.test(await p.locator('[data-content="instagram"] .ct-insp').innerText().catch(() => '') + await p.locator('[data-content="instagram"] .ct-insp p').textContent().catch(() => '')), `${tag} ce que l'IA a retenu du secteur est consultable`);

  // Disposition : image à gauche et texte à droite sur grand écran, empilés sur téléphone ; la section Instagram a toute la largeur ; rien ne déborde
  const g = await p.evaluate(() => {
    const r = (q) => document.querySelector(q)?.getBoundingClientRect();
    const f = r('.ct-ig-fig'), t = r('.ct-ig-form'), sec = r('.pj-ig'), grid = r('.pj-grid-c');
    return { fr: f.right, fy: f.y, tx: t.x, ty: t.y, secW: sec.width, gridW: grid.width, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  if (vp.width >= 900) ok(g.fr <= g.tx + 1 && Math.abs(g.fy - g.ty) < 4, `${tag} l'image est à gauche et le texte à droite, côte à côte`);
  else ok(g.ty >= g.fy + 100, `${tag} sur téléphone : l'image puis le texte`);
  ok(Math.abs(g.secW - g.gridW) < 2, `${tag} la section Instagram a toute la largeur de la page`);
  ok(!g.overflow, `${tag} aucun débordement horizontal`);
  ok(!(await p.locator('[data-content="instagram"] [data-ct-alt]').isVisible()), `${tag} le texte alternatif est replié dans « Détails »`);
  await p.locator('[data-content="instagram"] .ct-more > summary').click();
  ok(await p.locator('[data-content="instagram"] [data-ct-alt]').isVisible(), `${tag} « Détails » déplie le texte alternatif`);

  // Modifier, enregistrer, copier
  await p.fill('[data-content="instagram"] [data-ct-body]', 'Ma légende relue, assez longue pour être enregistrée.');
  await p.locator('[data-content="instagram"] [data-ct-save]').click();
  await p.waitForSelector('.toast', { timeout: 5000 });
  const row = await s.db.prepare("SELECT body FROM content_drafts WHERE project_id = ? AND kind = 'instagram'").get(pid);
  ok(row.body === 'Ma légende relue, assez longue pour être enregistrée.', `${tag} « Enregistrer » garde la légende en base`);
  await p.locator('[data-content="instagram"] [data-ct-copy]').click();
  ok((await p.evaluate(() => navigator.clipboard.readText())).includes('Ma légende relue') , `${tag} « Copier la légende » met la légende dans le presse-papiers`);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.locator('[data-content="instagram"] a', { hasText: "Télécharger l'image" }).click()]);
  ok(/^instagram-cartes-fideles-\d+\.png$/.test(dl.suggestedFilename()), `${tag} « Télécharger l'image » envoie un PNG nommé d'après le projet`);

  // Supprimer
  await p.locator('[data-content="instagram"] [data-ct-delete]').click();
  await p.locator('dialog.confirm [data-yes]').click();
  await p.waitForFunction(() => !document.querySelector('[data-content="instagram"] .ct-draft'), null, { timeout: 8000 });
  ok(await s.db.prepare("SELECT COUNT(*) n FROM content_drafts WHERE kind = 'instagram'").get().then((r) => Number(r.n) === 0), `${tag} « Supprimer » retire le post après confirmation`);

  // Newsletter
  await p.fill('[data-content="newsletter"] [data-ct-direction]', 'la version mobile');
  await p.locator('[data-content="newsletter"] [data-ct-generate]').click();
  await runJob('newsletter');
  await p.waitForSelector('[data-content="newsletter"] [data-ct-title]', { timeout: 20000 });
  ok(/Premier sujet : la version mobile/.test(await p.inputValue('[data-content="newsletter"] [data-ct-title]')), `${tag} l'objet de la newsletter apparaît`);
  const href = await p.locator('[data-content="newsletter"] a', { hasText: 'Télécharger en HTML' }).getAttribute('href');
  ok(/\/content\/newsletter\/\d+\/html$/.test(href), `${tag} « Télécharger en HTML » vise la version HTML`);

  // Outils IA : plus de section Instagram ni de tâche newsletter
  await p.goto(`${s.base}/p/${pid}/outils`);
  await p.waitForSelector('.tools-nav', { timeout: 10000 });
  ok(await p.locator('#acc-instagram, #acc-newsletter').count() === 0 && !/Posts pour Instagram/.test(await p.locator('body').innerText()), `${tag} Outils IA ne propose plus Instagram ni la newsletter`);
  ok(errs.length === 0, `${tag} aucune erreur de console${errs.length ? ` : ${errs[0]}` : ''}`);
  await ctx.close();
}
await b.close(); await s.close();
console.log(failed ? `${failed} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(failed ? 1 : 0);
