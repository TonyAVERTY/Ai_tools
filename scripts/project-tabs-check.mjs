// Vérifie dans un vrai navigateur (Playwright) la liste des projets en cartes et la page d'un projet à onglets (une adresse par onglet) :
// cartes et lien vers le projet, formulaire « Nouveau projet » avec le site, neuf onglets, chaque onglet montre ses sections, navigation sans rechargement,
// sélecteur « Section » sur téléphone, sections qui se chargent toutes seules (Communication, Récapitulatif), pas de débordement ni d'erreur console.
// Nécessite Playwright (PLAYWRIGHT_MODULE=chemin du module, PLAYWRIGHT_CHROMIUM si besoin). SHOT_DIR=dossier : enregistre des captures. Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const s = await startApp();
const u = await s.newUser({ email: 'tony@x.fr' });
const a = await addProject(s.db, u.id, { name: 'Agenda Kiné', gitUrl: 'https://github.com/atelier/agenda-kine.git' });
await addProject(s.db, u.id, { name: 'Site Boulangerie', gitUrl: 'https://github.com/atelier/boulangerie.git' });
await s.db.prepare('UPDATE projects SET profile_json = ?, profile_at = ?, profile_commit = ?, target_json = ? WHERE id = ?').run(JSON.stringify({ resume: 'Agenda partagé en ligne pour cabinets de kinésithérapie : prise de rendez-vous, rappels SMS, gestion des remplaçants.', stack: 'Node, SQLite' }), now() - 86400, '8f03cb9aa', JSON.stringify({ description: 'Cabinets de kinésithérapie', zone: 'Bretagne', taille: '1 à 5', decideur: 'Kiné titulaire', secteurs: ['Santé'], requetes: ['cabinet kiné'] }), a);
for (let i = 0; i < 4; i++) await s.db.prepare('INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, ?, ?, ?, ?)').run(a, `Cabinet ${i}`, `c${i}@x.fr`, i === 0 ? 'replied' : 'new', now());

let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const [name, value] = u.cookie.split('=');
const TABS = {
  '': ['#mr-h', '#fp-h', '#pr-h', '#ec-h'], prospection: ['#acc-target', '#acc-search', '#acc-prospects'], envoi: ['#acc-template', '#acc-send', '#acc-followup'],
  clients: ['a[href="/clients"]'], facturation: [`a[href="/facturation/projet/${a}"]`], communication: ['#acc-linkedin', '#acc-promo'],
  outils: ['#acc-evolution', '#acc-audit', '#acc-postes'], recap: ['#acc-recap'], reglages: ['#acc-header', '#acc-config'],
};

for (const [vp, scheme] of [[{ width: 1280, height: 900 }, 'light'], [{ width: 1280, height: 900 }, 'dark'], [{ width: 390, height: 800 }, 'light']]) {
  const tag = `${vp.width}px ${scheme === 'dark' ? 'sombre' : 'clair'}`;
  const ctx = await b.newContext({ viewport: vp, colorScheme: scheme });
  await ctx.addCookies([{ name, value, url: s.base }]);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const overflow = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  // Liste en cartes
  await p.goto(`${s.base}/projets`);
  await p.waitForSelector('html[data-nav="ready"]');
  ok((await p.locator('.pj-card').count()) === 2, `${tag} deux cartes de projet`);
  ok((await p.locator('.pj-card').first().innerText()).includes('Agenda Kiné') && (await p.locator('.pj-card').first().innerText()).includes('github.com/atelier/agenda-kine'), `${tag} la carte dit le nom et le dépôt`);
  ok((await overflow()) <= 1, `${tag} /projets : pas de défilement horizontal`);
  await p.locator('[data-new-toggle]').first().click();
  ok(await p.locator('#new-project input[name="site_url"]').isVisible(), `${tag} « Nouveau projet » demande aussi le site du produit`);
  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/projets-${vp.width}-${scheme}.png`, fullPage: true });
  await p.locator('#new-project [data-new-toggle]').click();

  // Page d'un projet, onglet par onglet
  await p.locator('.pj-card').first().click();
  await p.waitForFunction((id) => location.pathname === `/p/${id}`, a);
  await p.waitForSelector('html[data-nav="ready"]');
  ok((await p.locator('h1').innerText()) === 'Agenda Kiné', `${tag} la page du projet porte son nom`);
  if (vp.width >= 900) {
    ok((await p.locator('.ptabs a').count()) === 9 && (await p.locator('.ptabs a[aria-current="page"]').innerText()).startsWith("Vue d'ensemble"), `${tag} neuf onglets, « Vue d'ensemble » courant`);
  }
  for (const [slug, sels] of Object.entries(TABS)) {
    await p.goto(`${s.base}/p/${a}${slug ? `/${slug}` : ''}`);
    await p.waitForSelector('html[data-nav="ready"]');
    await p.waitForTimeout(250);
    const missing = [];
    for (const sel of sels) if (!(await p.locator(sel).count())) missing.push(sel);
    ok(!missing.length, `${tag} /p/${a}${slug ? `/${slug}` : ''} : ${sels.length} bloc(s) présent(s)${missing.length ? ` (manque ${missing.join(', ')})` : ''}`);
    ok((await overflow()) <= 1, `${tag} onglet « ${slug || 'vue d\'ensemble'} » : pas de défilement horizontal`);
    if (process.env.SHOT_DIR && ['', 'prospection', 'envoi', 'communication', 'outils', 'recap', 'reglages'].includes(slug)) await p.screenshot({ path: `${process.env.SHOT_DIR}/projet-${slug || 'vue'}-${vp.width}-${scheme}.png`, fullPage: true });
  }

  // Fiche contact
  const contact = await s.db.prepare('SELECT id FROM prospects WHERE project_id = ? ORDER BY id LIMIT 1').get(a);
  await p.goto(`${s.base}/p/${a}/contact/${contact.id}`);
  await p.waitForSelector('html[data-nav="ready"]');
  ok((await p.locator('[data-contact] h1').innerText()).startsWith('Cabinet'), `${tag} la fiche contact porte le nom du prospect`);
  ok((await overflow()) <= 1, `${tag} fiche contact : pas de défilement horizontal`);
  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/contact-${vp.width}-${scheme}.png`, fullPage: true });

  // Sections qui se chargent toutes seules
  await p.goto(`${s.base}/p/${a}/recap`);
  await p.waitForSelector('html[data-nav="ready"]');
  await p.waitForFunction(() => { const r = document.querySelector('[data-recap]'); return r && !r.querySelector('.loading') && r.innerText.trim().length > 0; }, null, { timeout: 8000 }).catch(() => {});
  ok(!(await p.locator('[data-recap] .loading').count()), `${tag} le Récapitulatif se charge sans clic`);
  await p.goto(`${s.base}/p/${a}/communication`);
  await p.waitForSelector('html[data-nav="ready"]');
  await p.waitForFunction(() => { const r = document.querySelector('[data-linkedin]'); return r && !r.querySelector('.loading'); }, null, { timeout: 8000 }).catch(() => {});
  ok(!(await p.locator('[data-linkedin] .loading').count()), `${tag} LinkedIn se charge sans clic`);

  // Navigation entre onglets : sans rechargement
  await p.goto(`${s.base}/p/${a}`);
  await p.waitForSelector('html[data-nav="ready"]');
  await p.evaluate(() => { window.__marker = 'vivante'; });
  if (vp.width >= 900) await p.locator('.ptabs a', { hasText: 'Envoi' }).click();
  else await p.locator('[data-psel]').selectOption(`/p/${a}/envoi`);
  await p.waitForFunction((id) => location.pathname === `/p/${id}/envoi`, a);
  await p.waitForSelector('#acc-template');
  ok(await p.evaluate(() => window.__marker) === 'vivante', `${tag} changer d'onglet ne recharge pas la page`);

  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.slice(0, 2).join(' | ')}` : ''}`);
  // Un onglet inconnu : introuvable (la ressource en 404 est voulue, d'où le contrôle des erreurs juste avant) ; l'ancienne adresse redirige
  ok((await p.goto(`${s.base}/p/${a}/nimportequoi`)).status() === 404, `${tag} un onglet inconnu répond 404`);
  ok((await p.goto(`${s.base}/projets/${a}`)).url().endsWith(`/p/${a}`), `${tag} l'ancienne adresse /projets/:id redirige vers /p/:id`);
  await ctx.close();
}
await b.close();
await s.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
