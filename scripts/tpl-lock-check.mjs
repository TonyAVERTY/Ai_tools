// Vérifie dans un vrai navigateur qu'un modèle de mail ou de relance VALIDÉ est un résumé grisé et en lecture seule (public/app.js, styles .tpl-locked) :
// pas d'aide, pas de « Générer avec l'IA », pas d'« Enregistrer » ni de « Valider le modèle », pas de ligne de tâche terminée ; « Modifier » le déverrouille,
// « Annuler » remet le texte validé, « Valider le modèle » reverrouille, « Enregistrer » (brouillon) laisse le modèle modifiable. Un brouillon reste modifiable.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const BODY = 'Bonjour,\n\nUne idée pour {{entreprise}}.\n\nBien cordialement,\n{{expediteur}}';

for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
  await s.db.prepare("INSERT INTO templates(project_id, kind, subject, body, status, updated_at) VALUES(?, 'initial', 'Idée pour {{entreprise}}', ?, 'validated', ?)").run(pid, BODY, now());
  await s.db.prepare("INSERT INTO templates(project_id, kind, subject, body, status, updated_at) VALUES(?, 'followup', '', 'Bonjour,\\n\\nUne relance.\\n\\nBien cordialement,\\n{{expediteur}}', 'draft', ?)").run(pid, now());
  await s.db.prepare("INSERT INTO jobs(project_id, user_id, type, status, tokens_in, tokens_out, created_at, started_at, finished_at) VALUES(?, ?, 'template', 'done', 9000, 3000, ?, ?, ?)").run(pid, u.id, now(), now(), now());
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');
  if (!(await p.locator('details.project').evaluate((d) => d.open))) await p.locator('details.project > summary').click();
  await p.evaluate(() => document.querySelectorAll('details.project details').forEach((d) => { d.open = true; })); // le modèle de relance est dans une autre section que celui du premier mail
  const first = p.locator('form.tpl[data-kind=initial]');
  const second = p.locator('form.tpl[data-kind=followup]');
  const visible = (loc, text) => (text === 'GENERER' ? loc.locator('[data-run]') : loc.getByRole('button', { name: text, exact: true })).isVisible(); // « Générer avec l'IA » : par son attribut, son nom accessible ne s'apparie pas
  await p.waitForSelector('form.tpl[data-kind=initial].tpl-locked');

  // Validé : un résumé grisé, en lecture seule
  ok((await first.locator('[data-tpl-state]').innerText()).includes('validé'), `${tag} validé : le badge « validé »`);
  ok(await first.locator('[name=body]').evaluate((e) => e.readOnly) && await first.locator('[name=subject]').evaluate((e) => e.readOnly), `${tag} validé : l'objet et le corps sont en lecture seule`);
  ok(await visible(first, 'Modifier') && await visible(first, 'Aperçu'), `${tag} validé : « Modifier » et « Aperçu » sont là`);
  ok(!(await visible(first, 'Enregistrer')) && !(await visible(first, 'Valider le modèle')) && !(await visible(first, 'GENERER')), `${tag} validé : ni « Enregistrer », ni « Valider le modèle », ni « Générer avec l'IA »`);
  ok(!(await first.locator('[data-tpl-help]').first().isVisible()), `${tag} validé : l'aide (variables, « vide = Re: ») est masquée`);
  ok((await p.locator('[data-job="template"]').innerText()).trim() === '', `${tag} tâche terminée : plus de « terminé(e) », « Voir » ni tokens sous le modèle`);
  const bg = (loc) => loc.evaluate((e) => getComputedStyle(e).backgroundColor);
  ok((await bg(first.locator('[name=body]'))) !== (await bg(second.locator('[name=body]'))), `${tag} validé : le champ est grisé (autre fond qu'un brouillon)`);
  await first.locator('[name=body]').click();
  await p.keyboard.type('zzz');
  ok((await first.locator('[name=body]').inputValue()) === BODY, `${tag} validé : on ne peut rien taper dans le corps`);
  await first.locator('[name=body]').press('Enter');
  ok(await first.evaluate((f) => f.classList.contains('tpl-locked')), `${tag} validé : Entrée ne soumet rien`);

  // Un brouillon reste modifiable, sans « Modifier »
  ok(!(await second.evaluate((f) => f.classList.contains('tpl-locked'))) && !(await second.locator('[name=body]').evaluate((e) => e.readOnly)), `${tag} brouillon : modifiable`);
  ok(!(await visible(second, 'Modifier')) && await visible(second, 'Enregistrer') && await visible(second, 'Valider le modèle') && await visible(second, 'GENERER'), `${tag} brouillon : « Enregistrer », « Valider le modèle », « Générer avec l'IA », pas de « Modifier »`);

  // Modifier, puis Annuler : le texte validé revient
  await first.getByRole('button', { name: 'Modifier', exact: true }).click();
  ok(!(await first.locator('[name=body]').evaluate((e) => e.readOnly)) && await visible(first, 'Enregistrer') && await visible(first, 'Valider le modèle') && await visible(first, 'Annuler') && !(await visible(first, 'Modifier')), `${tag} Modifier : modifiable, « Enregistrer », « Valider le modèle » et « Annuler » apparaissent`);
  ok(await first.locator('[name=body]').evaluate((e) => e === document.activeElement), `${tag} Modifier : le curseur est dans le corps`);
  await first.locator('[name=body]').fill(`${BODY} BROUILLON`);
  await first.getByRole('button', { name: 'Annuler', exact: true }).click();
  ok((await first.locator('[name=body]').inputValue()) === BODY && await first.evaluate((f) => f.classList.contains('tpl-locked')), `${tag} Annuler : le texte validé est remis, le modèle est reverrouillé`);

  // Modifier puis Valider : reverrouillé avec le nouveau texte, enregistré côté serveur
  await first.getByRole('button', { name: 'Modifier', exact: true }).click();
  await first.locator('[name=body]').fill(`${BODY} ÉDITÉ`);
  await first.getByRole('button', { name: 'Valider le modèle', exact: true }).click();
  await p.waitForFunction(() => document.querySelector('form.tpl[data-kind=initial]').classList.contains('tpl-locked'));
  const saved = await s.db.prepare("SELECT body, status FROM templates WHERE project_id = ? AND kind = 'initial'").get(pid);
  ok(saved.status === 'validated' && saved.body.endsWith('ÉDITÉ') && (await first.locator('[name=body]').inputValue()).endsWith('ÉDITÉ'), `${tag} Valider le modèle : enregistré et reverrouillé avec le nouveau texte`);
  await p.waitForTimeout(3500); // le rafraîchissement automatique du projet ne le déverrouille pas
  ok(await first.evaluate((f) => f.classList.contains('tpl-locked')), `${tag} le rafraîchissement automatique laisse le modèle verrouillé`);

  // Modifier puis Enregistrer (brouillon) : le modèle reste modifiable, badge « brouillon »
  await first.getByRole('button', { name: 'Modifier', exact: true }).click();
  await first.locator('[name=body]').fill(`${BODY} PLUS TARD`);
  await first.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await p.waitForFunction(() => /brouillon/.test(document.querySelector('form.tpl[data-kind=initial] [data-tpl-state]').textContent));
  ok(!(await first.evaluate((f) => f.classList.contains('tpl-locked'))) && !(await visible(first, 'Modifier')) && (await first.locator('[name=body]').inputValue()).endsWith('PLUS TARD'), `${tag} Enregistrer : brouillon, toujours modifiable`);
  if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/tpl-lock-${vp.width}.png` });
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
