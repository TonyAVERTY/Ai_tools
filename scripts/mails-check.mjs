// Vérifie dans un vrai navigateur la liste déroulante de la page « Mails » : un clic sur l'objet déplie le contenu (ou la raison d'un rejet ou d'un échec),
// un second clic replie, aucune erreur console, pas de défilement horizontal. Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };

for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
  const prospect = Number((await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, 'Fermé', 'f@ferme.fr', 'bounced', ?, ?)").run(pid, now(), now())).lastInsertRowid);
  const log = (...a) => s.db.prepare('INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, subject, body, note, error) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)').run(pid, ...a);
  await log(prospect, 'f@ferme.fr', now(), 'initial', 'Une idée', 'Bonjour,\n\nTexte <b>complet</b>.\n\nBien cordialement', '550 5.1.1 user unknown', null);
  await log(null, 'x@y.fr', now(), 'initial', 'Autre', null, null, 'Adresse non envoyée : adresse jetable');
  await log(null, 'l@long.fr', now() - 60, 'initial', 'Un objet de mail suffisamment long pour tester le retour à la ligne dans la liste déroulante', null, null, null);
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/mails`);
  await p.waitForSelector('html[data-nav="ready"]');
  const t1 = p.locator('.mail-toggle', { hasText: 'Une idée' });
  const d1 = p.locator(`#${await t1.getAttribute('aria-controls')}`);
  ok(!(await d1.isVisible()), `${tag} replié au départ`);
  await t1.click();
  await p.waitForFunction(() => /Texte/.test(document.body.textContent));
  const text = await d1.innerText();
  ok(await d1.isVisible() && text.includes('Texte <b>complet</b>.') && text.includes('Rejeté') && text.includes('550 5.1.1 user unknown'), `${tag} déplié : texte (échappé) et raison du rejet`);
  ok((await t1.getAttribute('aria-expanded')) === 'true', `${tag} aria-expanded = true`);
  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/mails-${vp.width}.png` });
  await t1.click();
  ok(!(await d1.isVisible()) && (await t1.getAttribute('aria-expanded')) === 'false', `${tag} replié au second clic`);
  const t2 = p.locator('.mail-toggle', { hasText: 'Autre' });
  await t2.click();
  await p.waitForFunction(() => /jetable/.test(document.body.textContent));
  const d2 = p.locator(`#${await t2.getAttribute('aria-controls')}`);
  await d2.waitFor({ state: 'visible' }); // le texte est dans la page avant que le panneau soit déplié : on attend qu'il se voie
  ok((await d2.innerText()).includes('Non envoyé'), `${tag} mail non envoyé : la cause s'affiche`);
  ok(await p.locator('.mail-toggle', { hasText: 'suffisamment long' }).evaluate((e) => e.getBoundingClientRect().right <= innerWidth), `${tag} un objet très long passe à la ligne dans son bouton`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
