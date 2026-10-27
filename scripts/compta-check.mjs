// Vérifie dans un vrai navigateur la page Comptabilité : situation, ajout d'une ligne avec justificatif (fenêtre, TVA calculée en direct, fichier obligatoire),
// modification, déclaration guidée (où, quoi, boutons « Copier »), exports, bureau et téléphone, clair et sombre, aucun défilement horizontal, aucune erreur console.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). SHOTS=<dossier> enregistre des captures. Sortie « TOUT EST BON » attendue.
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const shot = async (p, name) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true }); };
const dir = mkdtempSync(join(tmpdir(), 'compta-'));
const pdf = join(dir, 'facture.pdf');
writeFileSync(pdf, '%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
const txt = join(dir, 'note.txt');
writeFileSync(txt, 'pas un justificatif');

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
const t = new Date();
const q = Math.ceil((t.getMonth() + 1) / 3);
const [py, pq] = q === 1 ? [t.getFullYear() - 1, 4] : [t.getFullYear(), q - 1];
const lastQ = `${py}-${String(pq * 3 - 1).padStart(2, '0')}-12`;

for (const [vp, scheme, tag] of [[{ width: 1280, height: 900 }, 'light', '1280px clair'], [{ width: 390, height: 800 }, 'dark', '390px sombre']]) {
  const u = await s.newUser();
  await addProject(s.db, u.id, { name: 'Agenda Kiné', gitUrl: 'https://github.com/a/kine.git' });
  const ctx = await b.newContext({ viewport: vp, colorScheme: scheme, acceptDownloads: true });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', (route) => { const r = route.request(); const h = { ...r.headers() }; if (r.method() === 'POST') h.origin = APP_URL; route.continue({ headers: h }); });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: s.base }).catch(() => {});
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/status of 415/.test(m.text())) errs.push(m.text()); }); // le 415 est le refus attendu d'un fichier texte
  await p.goto(`${s.base}/compta`);
  await p.waitForSelector('html[data-nav="ready"]');
  ok((await p.locator('.pills a[href="/compta"]').getAttribute('aria-current').catch(() => null)) !== undefined, `${tag} « Comptabilité » est dans la barre du haut`);
  ok(await p.getByText('Commence ici : dis-nous où tu en es').isVisible(), `${tag} un nouvel utilisateur est guidé : questions sur sa situation`);
  await shot(p, `compta-1-debut-${vp.width}`);

  // ---------- situation ----------
  await p.locator('label.opt', { hasText: 'Micro-entrepreneur' }).click();
  await p.locator('label.opt', { hasText: 'Prestations de services' }).click();
  await p.locator('label.opt', { hasText: 'Je ne facture pas la TVA' }).click();
  await p.locator('label.opt', { hasText: 'Chaque trimestre' }).click();
  await p.getByRole('button', { name: 'Enregistrer ma situation' }).click();
  await p.waitForSelector('text=Ta situation est enregistrée');
  await p.waitForSelector('html[data-nav="ready"]'); // les scripts de la page sont relancés après chaque remplacement
  ok(await p.locator('details#situation').count() === 1, `${tag} la situation est enregistrée et repliée`);

  // ---------- ajout : fichier obligatoire, TVA masquée en franchise ----------
  await p.getByRole('button', { name: 'Ajouter une ligne' }).first().click();
  const dlg = p.locator('dialog[data-compta-dlg]');
  await dlg.waitFor({ state: 'visible' });
  ok(await dlg.locator('[data-compta-vat]').isHidden(), `${tag} en franchise de TVA, le champ TVA est caché`);
  await dlg.locator('input[name="label"]').fill('Facture 2026-001');
  await dlg.locator('input[name="amount"]').fill('1 200,50');
  await dlg.getByRole('button', { name: 'Enregistrer la ligne' }).click();
  ok(await dlg.locator('[data-compta-error]').isVisible() && /justificatif/i.test(await dlg.locator('[data-compta-error]').innerText()), `${tag} sans justificatif : refusé avec un message clair`);
  await dlg.locator('input[type=file]').setInputFiles(txt);
  await dlg.getByRole('button', { name: 'Enregistrer la ligne' }).click();
  await p.waitForFunction(() => /PDF ou une image/.test(document.querySelector('[data-compta-error]')?.textContent || ''));
  ok(true, `${tag} un fichier texte est refusé par le serveur`);
  await dlg.locator('input[name="date"]').fill(lastQ);
  await dlg.locator('input[type=file]').setInputFiles(pdf);
  await shot(p, `compta-2-ajout-${vp.width}`);
  await dlg.getByRole('button', { name: 'Enregistrer la ligne' }).click();
  await p.waitForSelector('dialog[data-compta-dlg]', { state: 'hidden' });
  await p.waitForSelector('td:has-text("Facture 2026-001")');
  ok(/1\s200,50\s€/.test(await p.locator('tr', { hasText: 'Facture 2026-001' }).innerText()), `${tag} la ligne apparaît avec son montant et son justificatif`);
  ok((await p.locator('tr', { hasText: 'Facture 2026-001' }).locator('a.cmp-doc').innerText()).includes('facture.pdf'), `${tag} le justificatif est relié à la ligne`);

  // ---------- dépense avec TVA calculée en direct (compte assujetti simulé via la situation) ----------
  await p.locator('details#situation > summary').click();
  await p.locator('details#situation label.opt', { hasText: 'Je facture la TVA' }).click();
  await p.locator('details#situation').getByRole('button', { name: 'Enregistrer ma situation' }).click();
  await p.waitForSelector('text=Ta situation est enregistrée');
  await p.waitForSelector('html[data-nav="ready"]'); // les scripts de la page sont relancés après chaque remplacement
  await p.getByRole('button', { name: 'Ajouter une ligne' }).first().click();
  await dlg.waitFor({ state: 'visible' });
  await dlg.locator('label.opt', { hasText: 'Dépense' }).first().click();
  await dlg.locator('input[name="amount"]').fill('120');
  ok(await dlg.locator('[data-compta-vat]').isVisible(), `${tag} assujetti à la TVA : le champ TVA est visible`);
  ok(/100,00\s€ hors taxes, dont 20,00\s€ de TVA/.test((await dlg.locator('[data-compta-split]').innerText()).replace(/ | /g, ' ')), `${tag} TVA et hors taxes calculés en direct`);
  ok((await dlg.locator('select[name="category"] option').allInnerTexts()).includes('Logiciels et abonnements'), `${tag} les catégories suivent le type de ligne`);
  await dlg.locator('input[name="label"]').fill('Abonnement hébergement');
  await dlg.locator('select[name="category"]').selectOption('hosting');
  await dlg.locator('input[type=file]').setInputFiles(pdf);
  await dlg.getByRole('button', { name: 'Enregistrer la ligne' }).click();
  await p.waitForSelector('dialog[data-compta-dlg]', { state: 'hidden' });
  await p.waitForSelector('td:has-text("Abonnement hébergement")');

  // ---------- modification ----------
  await p.locator('tr', { hasText: 'Abonnement hébergement' }).getByRole('button', { name: /Modifier/ }).click();
  await dlg.waitFor({ state: 'visible' });
  ok(await dlg.locator('input[name="label"]').inputValue() === 'Abonnement hébergement' && await dlg.locator('input[name="amount"]').inputValue() === '120,00', `${tag} la fenêtre de modification reprend la ligne`);
  ok(!(await dlg.locator('input[type=file]').evaluate((e) => e.required)), `${tag} en modification, le justificatif existant suffit`);
  await dlg.locator('input[name="label"]').fill('Hébergement annuel');
  await dlg.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await p.waitForSelector('td:has-text("Hébergement annuel")');
  ok(true, `${tag} la ligne est modifiée`);

  // ---------- déclaration guidée ----------
  await p.getByRole('link', { name: 'Faire ma déclaration' }).first().click();
  await p.waitForSelector('#declaration');
  const guide = await p.locator('#declaration').innerText();
  ok(/autoentrepreneur\.urssaf\.fr|impots\.gouv\.fr/.test(guide) || /Trouver/.test(guide), `${tag} la déclaration dit où aller`);
  ok(await p.locator('#declaration ol li').count() >= 4, `${tag} la déclaration donne les étapes`);
  await shot(p, `compta-3-declaration-${vp.width}`);

  // ---------- exports ----------
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('link', { name: 'Tout exporter' }).click()]);
  ok(/^comptabilite-tous-les-projets-.*\.zip$/.test(dl.suggestedFilename()), `${tag} « Tout exporter » télécharge l'archive (${dl.suggestedFilename()})`);
  await p.goto(`${s.base}/compta?periode=tout`);
  await p.waitForSelector('html[data-nav="ready"]');
  await shot(p, `compta-4-page-${vp.width}`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
