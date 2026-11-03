// Vérifie dans un vrai navigateur la boîte de confirmation commune (confirmBox, public/app.js) : une seule boîte par action (supprimer un projet en demandait deux),
// titre = la question, détail = la conséquence, bouton au verbe de l'action et rouge quand on supprime, « Annuler » actif par défaut dans ce cas, clavier (Tab reste
// dans la boîte, Échap annule), clic à côté = annuler, double clic sur le bouton = une seule requête, aucune boîte native. À 1280 et 390 px, clair et sombre.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const waitFor = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
const exists = async (id) => !!(await s.db.prepare('SELECT id FROM projects WHERE id = ?').get(id));

for (const scheme of ['light', 'dark']) {
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const tag = `${scheme} ${vp.width}px`;
    const u = await s.newUser();
    const pid = Number(await addProject(s.db, u.id, { name: `Supprimable ${vp.width}` }));
    const ctx = await b.newContext({ viewport: vp, colorScheme: scheme });
    const [name, value] = u.cookie.split('=');
    await ctx.addCookies([{ name, value, url: s.base }]);
    await ctx.addInitScript(() => { try { localStorage.setItem('todo-min', '1'); } catch { /* ignore */ } });
    let posts = 0;
    await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); if (/\/api\/projects\/\d+\/delete$/.test(r.url()) || /\/delete/.test(r.url())) posts++; await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
    const p = await ctx.newPage();
    const errs = [];
    let native = 0;
    p.on('dialog', async (d) => { native++; await d.dismiss(); }); // une boîte native, quelle qu'elle soit, est une erreur
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${s.base}/`); await p.waitForSelector('html[data-nav="ready"]');
    await p.evaluate(() => { const d = document.querySelector('details[data-acc="config"]'); if (d) d.open = true; });
    const del = p.locator('form[data-action="delete"] button').first();
    const openBox = async () => { await del.scrollIntoViewIfNeeded(); await del.click(); await p.locator('dialog.confirm').waitFor({ timeout: 4000 }); };
    const closed = () => waitFor(async () => (await p.locator('dialog.confirm').count()) === 0, 3000);

    // une seule boîte, titre / détail / bouton
    await openBox();
    ok(await p.locator('dialog.confirm').count() === 1, `${tag} une seule boîte pour une suppression (avant : deux de suite)`);
    const title = (await p.locator('dialog.confirm h2').innerText()).replace(/\u00a0/g, ' ');
    ok(title === `Supprimer ${`Supprimable ${vp.width}`} et tous ses prospects ?`, `${tag} le titre est la question (« ${title} »)`);
    const yes = p.locator('dialog.confirm [data-yes]');
    ok((await yes.innerText()) === 'Supprimer le projet', `${tag} le bouton porte le verbe de l'action (« ${await yes.innerText()} »)`);
    ok(await yes.evaluate((x) => x.classList.contains('danger-fill')), `${tag} le bouton est rouge (action destructive)`);
    ok((await p.evaluate(() => document.activeElement?.textContent.trim())) === 'Annuler', `${tag} « Annuler » a le focus par défaut`);
    const aria = await p.locator('dialog.confirm').evaluate((d) => ({ open: d.open, labelled: document.getElementById(d.getAttribute('aria-labelledby'))?.tagName }));
    ok(aria.open && aria.labelled === 'H2', `${tag} boîte modale, nommée par son titre`);
    const rect = await p.locator('dialog.confirm').evaluate((d) => { const r = d.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
    ok(rect.l >= 0 && rect.r <= vp.width && rect.t >= 0 && rect.b <= vp.height, `${tag} la boîte tient dans l'écran`);
    for (let i = 0; i < 4; i++) await p.keyboard.press('Tab');
    ok(await p.evaluate(() => !!document.activeElement?.closest('dialog.confirm')), `${tag} Tab reste dans la boîte`);

    // trois façons d'annuler : Échap, clic à côté, « Annuler » ; le projet reste
    await p.keyboard.press('Escape');
    ok(await closed() && await exists(pid), `${tag} Échap annule : le projet reste`);
    await openBox(); await p.mouse.click(4, 4);
    ok(await closed() && await exists(pid), `${tag} un clic à côté annule : le projet reste`);
    await openBox(); await p.getByRole('button', { name: 'Annuler' }).click();
    ok(await closed() && await exists(pid), `${tag} « Annuler » : le projet reste`);

    // confirmer, avec un double clic : une seule requête
    await openBox();
    await p.locator('dialog.confirm [data-yes]').dblclick();
    ok(await waitFor(async () => !(await exists(pid)), 8000), `${tag} confirmer supprime le projet`);
    ok(posts === 1, `${tag} un double clic sur le bouton n'envoie qu'une seule requête (${posts})`);
    ok(native === 0, `${tag} aucune boîte native`);
    ok(errs.length === 0, `${tag} aucune erreur JS${errs.length ? ` : ${errs.join(' | ')}` : ''}`);

    // variante non destructive : bouton principal, focus sur l'action, message sans question
    await p.goto(`${s.base}/`); await p.waitForSelector('html[data-nav="ready"]');
    const r1 = p.evaluate(() => window.AiTools.confirmBox('Publier ce post sur LinkedIn ?\nIl sera visible publiquement par tout le monde.', { confirm: 'Publier' }));
    await p.locator('dialog.confirm').waitFor();
    const calm = await p.evaluate(() => ({ cls: document.querySelector('dialog.confirm [data-yes]').className, focus: document.activeElement?.textContent.trim(), detail: document.querySelector('.confirm-d')?.textContent }));
    ok(/\bprimary\b/.test(calm.cls) && !/danger/.test(calm.cls) && calm.focus === 'Publier', `${tag} action non destructive : bouton principal, focus sur l'action`);
    ok(/visible publiquement/.test(calm.detail), `${tag} le détail dit la conséquence`);
    ok(await p.evaluate(() => window.AiTools.confirmBox('Une autre ?')) === false, `${tag} une seule boîte à la fois`);
    await p.locator('dialog.confirm [data-yes]').click();
    ok(await r1 === true, `${tag} la promesse vaut vrai quand on confirme`);
    const r2 = p.evaluate(() => window.AiTools.confirmBox('Sans point d\'interrogation'));
    await p.locator('dialog.confirm').waitFor();
    ok((await p.locator('dialog.confirm h2').innerText()).replace(/\u00a0/g, ' ') === 'Sans point d\'interrogation' && await p.locator('.confirm-d').count() === 0, `${tag} un message sans « ? » devient le titre`);
    await p.keyboard.press('Escape');
    ok(await r2 === false, `${tag} la promesse vaut faux quand on annule`);
    await ctx.unrouteAll({ behavior: 'ignoreErrors' }); await ctx.close();
  }
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
