// Vérifie dans un vrai navigateur (public/app-prospects.js) l'ajout manuel d'un prospect, la modification et la suppression depuis la fiche, l'aperçu du mail
// (A/B, texte), la vue tableau (Kanban) avec un vrai glisser-déposer entre deux statuts, et le fonctionnement après une navigation sans rechargement.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { resolve } from 'node:path';
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
// Faux Claude : le contrôle du sens (aperçu) répond tout de suite ; « SENSEBAD » dans le mail le fait juger sans sens, avec un modèle corrigé
const s = await startApp({ cfg: { claudeBin: resolve('test/fixtures/fake-claude.js') } });
const u = await s.newUser();
const pid = await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */ await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/`);
  await p.waitForSelector('html[data-nav="ready"]');
  if (!(await p.locator('details.project').evaluate((d) => d.open))) await p.locator('details.project > summary').click();
  for (const k of ['prospect', 'prospects', 'template']) await p.evaluate((x) => { const d = document.querySelector(`details[data-acc="${x}"]`); if (d) d.open = true; }, k);
  const email = `neuf-${vp.width}@boulangerie.fr`;
  // ajout manuel
  await p.locator('[data-pform-toggle]').click();
  ok(await p.locator('form[data-pform]').isVisible(), `${tag} le formulaire d'ajout s'ouvre`);
  await p.fill('form[data-pform] [name=email]', email);
  await p.fill('form[data-pform] [name=company]', 'Boulangerie Neuve');
  await p.fill('form[data-pform] [name=hook]', 'Votre pain au levain');
  await p.locator('form[data-pform] button.primary').click();
  await p.waitForSelector('[data-prospects] >> text=Boulangerie Neuve');
  if (process.env.DBG) { console.log(await p.evaluate(() => { const b = document.querySelector('[data-open-prospect]'); const r = b.getBoundingClientRect(); const chain = []; for (let e = b; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || e.tagName === 'DETAILS') chain.push(e.tagName + '.' + e.className + ' open=' + e.open + ' disp=' + cs.display); } return JSON.stringify({ r, chain }); })); }
  ok(true, `${tag} le prospect ajouté apparaît dans la liste`);
  // fiche : modification
  await p.locator('[data-prospects] >> text=Boulangerie Neuve').first().click();
  await p.waitForSelector('dialog[open] form[data-dlg="edit"]');
  await p.fill('dialog[open] form[data-dlg="edit"] [name=city]', 'Rennes');
  await p.locator('dialog[open] form[data-dlg="edit"] button.primary, dialog[open] form[data-dlg="edit"] button:not([type=button])').first().click();
  await p.waitForFunction(() => document.querySelector('[data-prospects]')?.textContent.includes('Rennes'));
  ok(true, `${tag} la modification (ville) est enregistrée et visible dans la liste`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal avec la fiche ouverte`);
  // suppression
  await p.locator('dialog[open] [data-del-prospect]').click();
  await p.locator('dialog.confirm [data-yes]').click();
  await p.waitForFunction(() => !document.querySelector('[data-prospects]')?.textContent.includes('Boulangerie Neuve'));
  ok(true, `${tag} le prospect supprimé disparaît de la liste`);
  // aperçu
  const tpl = 'form[data-action=template][data-kind=initial]';
  await p.fill(`${tpl} [name=subject]`, 'Bonjour {{entreprise}}');
  await p.fill(`${tpl} [name=subjectB]`, 'Une idée pour {{entreprise}}');
  await p.fill(`${tpl} [name=body]`, 'Bonjour,\n\n{{accroche}}\n\n{{expediteur}}');
  await p.locator(`${tpl} label.opt:has([name=html])`).click(); // sans cette case le mail part en texte simple : l'aperçu n'a pas d'iframe
  await p.locator(`${tpl} [data-tpl-preview]`).click();
  await p.waitForSelector('dialog.mailprev[open] iframe');
  const sandbox = await p.locator('dialog.mailprev iframe').getAttribute('sandbox');
  ok(sandbox !== null && !/allow-scripts/.test(sandbox), `${tag} l'aperçu est dans une iframe sans scripts (sandbox="${sandbox}")`);
  const frame = await p.locator('dialog.mailprev iframe').elementHandle().then((h) => h.contentFrame());
  await frame.waitForLoadState();
  ok((await frame.locator('body').innerText()).trim().length > 20, `${tag} le mail s'affiche dans l'aperçu`);
  ok(await p.locator('dialog.mailprev').getByText('Objet B').count() > 0, `${tag} bouton Objet B présent`);
  await p.locator('dialog.mailprev').getByText('Version texte').click();
  await p.waitForSelector('dialog.mailprev .pv-text', { timeout: 8000 }).catch(() => {});
  ok(await p.locator('dialog.mailprev .pv-text').isVisible(), `${tag} l'onglet Version texte s'affiche`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal avec l'aperçu ouvert`);
  // Contrôle du sens par l'IA : « Sens vérifié » quand tout va bien
  await p.waitForSelector('dialog.mailprev [data-pv-sense] .badge.ok', { timeout: 15000 }).catch(() => {});
  ok(((await p.locator('dialog.mailprev [data-pv-sense]').innerText()) || '').includes('Sens vérifié'), `${tag} aperçu : « Sens vérifié » quand le mail a un sens`);
  await p.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/preview-${vp.width}.png` : undefined }).catch(() => {});
  await p.keyboard.press('Escape'); // ferme l'aperçu
  // Mail sans sens : l'IA l'explique, propose un modèle corrigé, et le modèle ne change qu'au clic sur « Appliquer la correction au modèle »
  await p.fill(`${tpl} [name=body]`, 'Bonjour SENSEBAD,\n\n{{accroche}}\n\n{{expediteur}}');
  await p.locator(`${tpl} [data-tpl-preview]`).click();
  await p.waitForSelector('dialog.mailprev [data-pv-apply]', { timeout: 15000 });
  const bad = await p.locator('dialog.mailprev [data-pv-sense]').innerText();
  ok(/Ce mail ne veut pas dire grand-chose/.test(bad) && /Version corrigée proposée/.test(bad), `${tag} aperçu : le problème et la version corrigée sont affichés`);
  ok((await p.inputValue(`${tpl} [name=body]`)).includes('SENSEBAD'), `${tag} le modèle n'a pas changé tant qu'on n'a pas cliqué`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal avec la correction proposée`);
  await p.locator('dialog.mailprev [data-pv-apply]').click();
  await p.waitForFunction((sel) => !document.querySelector(sel).value.includes('SENSEBAD'), `${tpl} [name=body]`);
  ok((await p.inputValue(`${tpl} [name=body]`)).startsWith('Bonjour bien,'), `${tag} « Appliquer la correction au modèle » met le texte corrigé dans le modèle`);
  await p.waitForSelector('dialog.mailprev [data-pv-sense] .badge.ok', { timeout: 15000 }).catch(() => {});
  ok(((await p.locator('dialog.mailprev [data-pv-sense]').innerText()) || '').includes('Sens vérifié'), `${tag} après correction : « Sens vérifié »`);
  await p.keyboard.press('Escape');
  // Phrase sélectionnée dans l'aperçu : « Changer | Modifier »
  const SENT = 'Est-ce un sujet chez vous ?';
  const bodyOf = () => p.inputValue(`${tpl} [name=body]`);
  const selectIn = (text) => p.evaluate((t) => {
    const w = document.createTreeWalker(document.querySelector('dialog.mailprev [data-pv-body]'), NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = n.nodeValue.indexOf(t);
      if (i >= 0) {
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + t.length);
        // Comme une personne : la phrase est à l'écran quand elle la sélectionne (cadre du texte, puis fenêtre)
        const pre = n.parentElement, dlg = document.querySelector('dialog.mailprev');
        pre.scrollTop += r.getBoundingClientRect().top - pre.getBoundingClientRect().top - 30;
        const top = r.getBoundingClientRect().top;
        if (top > innerHeight - 90 || top < 90) dlg.scrollTop += top - innerHeight / 2;
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return true;
      }
    }
    return false;
  }, text);
  const openText = async () => {
    await p.locator(`${tpl} [data-tpl-preview]`).click();
    await p.locator('dialog.mailprev').getByText('Version texte').click();
    await p.waitForSelector('dialog.mailprev [data-pv-body]');
  };
  const bar = p.locator('dialog.mailprev [data-pv-sel]:not([hidden])');
  await p.fill(`${tpl} [name=body]`, `Bonjour,\n\nChez {{entreprise}}, une carte dans le téléphone aide les clients à revenir.\n\n${SENT}\n\nBien cordialement,\n{{expediteur}}`);
  await openText();
  ok(await selectIn(SENT), `${tag} (phrase sélectionnée)`);
  await bar.waitFor({ timeout: 5000 }).catch(() => {});
  ok(await bar.count() === 1 && (await bar.innerText()).replace(/\s+/g, ' ').trim() === 'Changer Modifier', `${tag} sélection : la barre « Changer | Modifier » apparaît`);
  const geo = await p.evaluate(() => {
    const b = document.querySelector('dialog.mailprev [data-pv-sel]').getBoundingClientRect(); const r = getSelection().getRangeAt(0).getBoundingClientRect();
    return { above: b.bottom <= r.top + 1, below: b.top >= r.bottom - 1, inside: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight };
  });
  ok((geo.above || geo.below) && geo.inside, `${tag} la barre est au-dessus de la phrase (sinon dessous), sans sortir de l'écran`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal avec la barre`);
  // Une sélection qui contient le nom de l'entreprise est retrouvée dans le modèle ({{entreprise}}) ; le pied de page ne l'est pas
  await selectIn('Chez Boulangerie Le Fournil, une carte dans le téléphone');
  await bar.waitFor({ timeout: 5000 }).catch(() => {});
  ok(await bar.count() === 1, `${tag} une sélection qui contient le nom de l'entreprise donne aussi la barre`);
  await selectIn('Pour ne plus être contacté');
  await p.waitForFunction(() => document.querySelector('dialog.mailprev [data-pv-sel]').hidden, null, { timeout: 5000 }).catch(() => {});
  ok(await bar.count() === 0, `${tag} le pied de page (hors modèle) : pas de barre`);
  // Changer : l'IA propose, « Proposer une autre phrase » en demande une autre, « Utiliser » remplace dans le modèle
  await selectIn(SENT);
  await bar.waitFor({ timeout: 5000 });
  await p.locator('dialog.mailprev [data-pv-change]').click();
  await p.waitForSelector('dialog.mailprev [data-pv-use]', { timeout: 15000 });
  ok(/Autre formulation 1 :/.test(await p.locator('dialog.mailprev .pv-prop-t').innerText()), `${tag} Changer : l'IA propose une autre phrase`);
  ok((await bodyOf()).includes(`\n${SENT}\n`), `${tag} le modèle n'a pas changé tant qu'on n'a pas choisi`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal avec la proposition`);
  await p.locator('dialog.mailprev [data-pv-more]').click();
  await p.waitForFunction(() => /Autre formulation 2 :/.test(document.querySelector('dialog.mailprev .pv-prop-t')?.textContent || ''), null, { timeout: 15000 });
  ok(true, `${tag} « Proposer une autre phrase » : une autre proposition, pas la même`);
  await p.locator('dialog.mailprev [data-pv-use]').click();
  await p.waitForFunction((sel) => document.querySelector(sel).value.includes('Autre formulation 2 :'), `${tpl} [name=body]`);
  const replaced = await bodyOf();
  ok(replaced.includes(`Autre formulation 2 : ${SENT}`) && replaced.split(SENT).length === 2 && replaced.includes('Chez {{entreprise}}, une carte'), `${tag} « Utiliser cette phrase » remplace la phrase dans le modèle, le reste est intact`);
  await p.waitForSelector('dialog.mailprev [data-pv-sense] .badge.ok', { timeout: 15000 }).catch(() => {});
  // Annuler : rien ne change
  await p.locator('dialog.mailprev').getByText('Version texte').click().catch(() => {});
  await p.waitForSelector('dialog.mailprev [data-pv-body]');
  await selectIn('Bien cordialement,');
  await bar.waitFor({ timeout: 5000 });
  const before = await bodyOf();
  await p.locator('dialog.mailprev [data-pv-change]').click();
  await p.waitForSelector('dialog.mailprev [data-pv-cancel]', { timeout: 15000 });
  await p.locator('dialog.mailprev [data-pv-cancel]').click();
  ok((await bodyOf()) === before && await bar.count() === 0, `${tag} Annuler : le modèle ne change pas et la barre disparaît`);
  // Modifier : un champ de consigne facultatif ; vide, l'IA réécrit seule ; rempli, sa proposition en tient compte
  const instr = p.locator('dialog.mailprev [data-pv-instr]');
  await selectIn(SENT);
  await bar.waitFor({ timeout: 5000 });
  await p.locator('dialog.mailprev [data-pv-edit]').click();
  await instr.waitFor({ timeout: 5000 });
  ok((await instr.inputValue()) === '' && await instr.evaluate((e) => e === document.activeElement), `${tag} Modifier : un champ de consigne, vide et prêt à écrire`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal avec le champ de consigne`);
  await p.locator('dialog.mailprev [data-pv-go]').click(); // laissé vide
  await p.waitForSelector('dialog.mailprev [data-pv-use]', { timeout: 15000 });
  const emptyWish = await p.locator('dialog.mailprev .pv-prop-t').innerText();
  ok(/Autre formulation \d :/.test(emptyWish) && !/\(/.test(emptyWish.split(':')[0]), `${tag} consigne laissée vide : l'IA propose seule (${emptyWish.slice(0, 30)}…)`);
  await p.locator('dialog.mailprev [data-pv-cancel]').click();
  await selectIn(SENT);
  await bar.waitFor({ timeout: 5000 });
  await p.locator('dialog.mailprev [data-pv-edit]').click();
  await instr.fill('plus court');
  await instr.press('Enter');
  await p.waitForSelector('dialog.mailprev [data-pv-use]', { timeout: 15000 });
  ok(/\(plus court\)/.test(await p.locator('dialog.mailprev .pv-prop-t').innerText()), `${tag} consigne écrite (touche Entrée) : la proposition en tient compte`);
  await p.locator('dialog.mailprev [data-pv-more]').click();
  await p.waitForFunction(() => /Autre formulation \d+ \(plus court\)/.test(document.querySelector('dialog.mailprev .pv-prop-t')?.textContent || ''), null, { timeout: 15000 });
  ok(true, `${tag} « Proposer une autre phrase » garde la consigne`);
  await p.locator('dialog.mailprev [data-pv-cancel]').click();
  // Modifier à la main : l'aperçu se ferme, la phrase est sélectionnée dans le champ du modèle
  await selectIn('Bien cordialement,');
  await bar.waitFor({ timeout: 5000 });
  await p.locator('dialog.mailprev [data-pv-edit]').click();
  await p.locator('dialog.mailprev [data-pv-hand]').click();
  const edit = await p.evaluate((sel) => { const f = document.querySelector(sel); return { active: document.activeElement === f, text: f.value.slice(f.selectionStart, f.selectionEnd), open: !!document.querySelector('dialog.mailprev[open]') }; }, `${tpl} [name=body]`);
  ok(!edit.open && edit.active && edit.text === 'Bien cordialement,', `${tag} Modifier à la main : l'aperçu se ferme et la phrase est sélectionnée dans le champ du modèle (« ${edit.text} »)`);
  // vue tableau : un prospect glissé d'une colonne à l'autre change de statut côté serveur
  const kanbanEmail = `kanban-${vp.width}@atelier.fr`;
  const kanbanName = `Atelier Kanban ${vp.width}`; // un nom par largeur : le prospect du premier passage reste dans la base
  await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, ?, ?, 'new', ?)").run(pid, kanbanName, kanbanEmail, now());
  await p.locator('[data-view-mode="board"]').click();
  await p.waitForSelector('[data-card]', { timeout: 10000 });
  ok(await p.locator('[data-card]').filter({ hasText: kanbanName }).count() === 1, `${tag} la vue tableau affiche le prospect`);
  await p.locator('[data-card]').filter({ hasText: kanbanName }).dragTo(p.locator('[data-drop="sent"]'));
  let status = '';
  for (let i = 0; i < 40 && status !== 'sent'; i++) { status = (await s.db.prepare('SELECT status FROM prospects WHERE email = ?').get(kanbanEmail)).status; if (status !== 'sent') await new Promise((r) => setTimeout(r, 150)); }
  ok(status === 'sent', `${tag} glisser-déposer : le statut passe de « new » à « ${status} »`);
  await p.locator('[data-view-mode="list"]').click();
  // navigation sans rechargement, puis retour : les écouteurs du fichier doivent être posés de nouveau
  await p.evaluate(() => { window.__marker = 'vivante'; });
  await p.locator('.pills a.pill', { hasText: 'Calendrier' }).click();
  await p.waitForURL(/calendar/);
  await p.waitForSelector('html[data-nav="ready"]');
  await p.locator('.pills a.pill', { hasText: 'Projets' }).click();
  await p.waitForURL((url) => url.pathname === '/');
  await p.waitForSelector('html[data-nav="ready"]');
  ok(await p.evaluate(() => window.__marker) === 'vivante', `${tag} aller-retour sans rechargement de la page`);
  if (!(await p.locator('details.project').evaluate((d) => d.open))) await p.locator('details.project > summary').click();
  for (const k of ['prospect', 'prospects']) await p.evaluate((x) => { const d = document.querySelector(`details[data-acc="${x}"]`); if (d) d.open = true; }, k);
  await p.waitForSelector(`[data-prospects] >> text=${kanbanName}`, { timeout: 10000 });
  await p.locator(`[data-prospects] >> text=${kanbanName}`).first().click();
  await p.waitForSelector('dialog[open] form[data-dlg="edit"]', { timeout: 10000 });
  ok(true, `${tag} après navigation : la liste se recharge et la fiche d'un prospect s'ouvre`);
  await p.keyboard.press('Escape');
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
