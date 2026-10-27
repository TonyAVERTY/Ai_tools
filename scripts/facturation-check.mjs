// Vérifie dans un vrai navigateur la page Facturation : récapitulatif, informations légales, trois exemples (aperçus isolés), choix, affinage,
// validation, quatre documents puis « Tes documents sont prêts », bureau et téléphone, clair et sombre, aucun défilement horizontal, aucune erreur console.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). SHOTS=<dossier> enregistre des captures. Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { makeClaudeBin } from '../test/helpers/claude-bin.js';
import { addProject } from '../test/helpers/users.js';
import { Worker } from '../src/services/jobs.js';
import { makeHandlers } from '../src/handlers.js';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const chromium = pw.chromium || pw.default.chromium;
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'fake-claude.js' });
const worker = new Worker(s.db, makeHandlers(s.app), { log: { error: () => {} } });
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const shot = async (p, name) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true }); };
const LEGAL = { legal_form: 'micro', legal_name: 'Tony Averty', siret: '12345678900012', address: '12 rue des Lilas', postal_code: '35000', city: 'Rennes', vat_mode: 'franchise',
  email: 'tony@exemple.fr', activity_label: 'Développement web', offer_description: 'Des applications web sur mesure.' };

for (const [vp, scheme, tag] of [[{ width: 1280, height: 900 }, 'light', '1280px clair'], [{ width: 390, height: 800 }, 'dark', '390px sombre']]) {
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: 'Agenda Kiné', gitUrl: 'https://github.com/a/kine.git' });
  await s.db.prepare('UPDATE projects SET profile_json = ? WHERE id = ?').run(JSON.stringify({ resume: 'Agenda pour kinés.', proposition_valeur: 'Moins de rendez-vous manqués.' }), pid);
  const ctx = await b.newContext({ viewport: vp, colorScheme: scheme });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', (route) => { const r = route.request(); const h = { ...r.headers() }; if (r.method() === 'POST') h.origin = APP_URL; route.continue({ headers: h }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const ready = async () => { await p.waitForTimeout(350); await p.waitForSelector('html[data-nav="ready"]'); };
  const noScroll = async (label) => ok(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${tag} ${label} : aucun défilement horizontal`);
  const tick = async () => { await worker.tick(); await p.evaluate(() => window.AiNav?.reload?.()); await p.waitForTimeout(400); await ready(); };

  await p.goto(`${s.base}/facturation`); await ready();
  ok(await p.getByRole('heading', { name: 'Facturation', level: 1 }).isVisible(), `${tag} la page s'ouvre sur le récapitulatif`);
  ok(await p.getByText('Agenda Kiné').first().isVisible() && await p.getByRole('link', { name: 'Compléter les informations' }).isVisible(), `${tag} le projet et son bouton « Compléter les informations »`);
  await noScroll('récapitulatif'); await shot(p, `fact-1-recap-${vp.width}`);

  await p.getByRole('link', { name: 'Compléter les informations' }).click(); await ready();
  ok(await p.getByRole('button', { name: 'Générer un modèle de document' }).count() === 0, `${tag} pas de génération tant que le projet est incomplet`);
  for (const [k, v] of Object.entries(LEGAL)) {
    const el = p.locator(`[name="${k}"]`);
    if (await el.evaluate((n) => n.tagName) === 'SELECT') await el.selectOption(v); else await el.fill(v);
  }
  await noScroll('informations légales'); await shot(p, `fact-2-legal-${vp.width}`);
  await p.getByRole('button', { name: 'Enregistrer les informations' }).click(); await ready();
  ok(await p.getByRole('button', { name: 'Générer un modèle de document' }).isVisible(), `${tag} tout est rempli : le bouton apparaît`);

  await p.getByRole('button', { name: 'Générer un modèle de document' }).click(); await ready();
  ok(await p.getByText('Claude travaille…').first().isVisible(), `${tag} génération en cours annoncée`);
  await tick();
  ok(await p.locator('.bill-frame').count() === 3, `${tag} trois exemples en aperçu`);
  const frame = p.frameLocator('.bill-frame').first();
  ok(await frame.getByText('Tony Averty').first().isVisible(), `${tag} l'aperçu affiche l'identité fixée par le code`);
  await noScroll('exemples'); await shot(p, `fact-3-exemples-${vp.width}`);

  await p.getByRole('button', { name: 'Choisir cet exemple' }).nth(1).click(); await ready();
  ok(await p.getByRole('heading', { name: /Ton devis : exemple 2/ }).isVisible(), `${tag} exemple choisi`);
  await p.getByText('Affiner avec Claude').first().click();
  await p.locator('textarea[name="request"]').first().fill('Une remise de 10 % sur le cadrage');
  await p.getByRole('button', { name: 'Affiner ce devis' }).click(); await ready(); await tick();
  await p.getByRole('button', { name: 'Valider ce devis' }).click(); await ready(); await tick();
  for (const t of ['Devis', 'Acompte', 'Facture finale', 'Avoir']) ok(await p.getByRole('heading', { name: t, exact: true, level: 3 }).isVisible(), `${tag} document « ${t} »`);
  await noScroll('documents'); await shot(p, `fact-4-documents-${vp.width}`);

  for (let i = 0; i < 4; i++) { await p.getByRole('button', { name: 'Valider ce document' }).first().click(); await ready(); }
  ok(await p.getByRole('heading', { name: 'Tes documents sont prêts' }).isVisible(), `${tag} quatre documents validés : « Tes documents sont prêts »`);
  await noScroll('fin'); await shot(p, `fact-5-pret-${vp.width}`);
  await p.goto(`${s.base}/facturation`); await ready();
  ok(await p.getByText('Documents prêts à l\'emploi').first().isVisible(), `${tag} le récapitulatif affiche « Documents prêts à l'emploi »`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close(); await s.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
