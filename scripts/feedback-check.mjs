// Vérifie dans un vrai navigateur les retours d'action (docs/UX.md, « Animations ») : un bouton s'enfonce au clic ; le contenu qui arrive à la place du cercle de chargement apparaît en fondu (opacité seule,
// une fois, sans clignoter aux mises à jour suivantes) ; la coche d'une étape de « Mise en route » qui vient d'être faite et le badge « config ✓ » apparaissent d'un petit saut (pas au premier affichage) ;
// la ligne d'un prospect qu'on vient d'ajouter est surlignée puis redevient normale. Avec le mouvement réduit, rien de tout cela ne bouge. À 1280 et 390 px.
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
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
const PROFILE = JSON.stringify({ resume: 'Un outil de devis.', proposition_valeur: 'Gagnez du temps.', arguments: ['a'], stack: 'node' });
const TARGET = JSON.stringify({ description: 'TPE', secteurs: ['plomberie'], zone: 'Bretagne', requetes: ['q'] });

for (const [mode, reduced] of [['normal', 'no-preference'], ['mouvement réduit', 'reduce']]) {
  const calm = reduced === 'reduce';
  for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const tag = `${mode} ${vp.width}px`;
    const u = await s.newUser();
    const id = Number(await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' }));
    await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?').run(PROFILE, TARGET, id);
    for (const [c, e] of [['Boulangerie', 'b@boulangerie.fr'], ['Garage', 'g@garage.fr'], ['Fleuriste', 'f@fleuriste.fr']]) await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, created_at) VALUES(?, ?, ?, 'new', ?)").run(id, c, e, now());
    const ctx = await b.newContext({ viewport: vp, reducedMotion: reduced });
    const [name, value] = u.cookie.split('=');
    await ctx.addCookies([{ name, value, url: s.base }]);
    let hold = false; let doneN = 0; // réponse du récap retenue ; nombre d'étapes de « Mise en route » faites (simulé)
    await ctx.route('**/*', async (route) => {
      const r = route.request();
      if (r.method() === 'GET' && /\/api\/projects\/\d+\/recap(\?|$)/.test(r.url())) { while (hold) await new Promise((x) => setTimeout(x, 50)); return route.continue(); }
      if (r.method() === 'GET' && /\/api\/projects\/\d+\/(status|checklist)$/.test(r.url())) {
        const res = await route.fetch();
        const j = await res.json();
        const mod = (c) => { const steps = c.steps.map((x, i) => ({ ...x, done: x.done || i < doneN })); const done = steps.filter((x) => x.done).length; return { ...c, steps, done, complete: done === c.total }; };
        return route.fulfill({ response: res, json: j.checklist ? { ...j, checklist: mod(j.checklist) } : mod(j) });
      }
      if (r.method() !== 'POST') return route.continue();
      /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */
      return route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) });
    });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    const starts = () => p.evaluate(() => window.__a || []);

    // 1) un bouton s'enfonce au clic (calendrier : le formulaire vide ne part pas, le navigateur le refuse)
    await p.goto(`${s.base}/calendar`); await p.waitForSelector('html[data-nav="ready"]');
    await p.evaluate(() => { document.getElementById('evenements').open = true; });
    const btn = p.locator('.evform button.primary');
    await btn.scrollIntoViewIfNeeded();
    const box = await btn.boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down(); await p.waitForTimeout(250);
    const down = await btn.evaluate((e) => getComputedStyle(e).transform);
    await p.mouse.up(); await p.waitForTimeout(250);
    const up = await btn.evaluate((e) => getComputedStyle(e).transform);
    if (calm) ok(down === 'none', `${tag} le bouton ne bouge pas (« ${down} »)`);
    else {
      const k = Number(/matrix\(([\d.]+)/.exec(down)?.[1]);
      ok(k > 0.9 && k < 1, `${tag} le bouton s'enfonce au clic (échelle ${k})`);
      ok(up === 'none', `${tag} il revient à sa taille au relâchement (« ${up} »)`);
    }

    // 2) l'onglet Récapitulatif d'un projet : la réponse du récap est retenue, puis on suit les animations qui démarrent
    hold = true;
    await p.goto(`${s.base}/p/${id}/recap`); await p.waitForSelector('html[data-nav="ready"]');
    const track = () => p.evaluate(() => { window.__a = []; document.addEventListener('animationstart', (e) => { const t = e.target; window.__a.push({ n: e.animationName, tag: t.tagName, cls: String(t.className?.baseVal ?? t.className), zone: t.matches?.('[data-recap]') || false, props: t.getAnimations().filter((a) => a.animationName === e.animationName).flatMap((a) => a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((x) => !['offset', 'easing', 'composite', 'computedOffset'].includes(x)))) }); }, true); });
    await track();
    // 3) le contenu arrive à la place du cercle : fondu, une seule fois
    ok(await waitFor(async () => (await p.locator('[data-recap] .loading').count()) === 1), `${tag} le récapitulatif montre son cercle`);
    await p.evaluate(() => { window.__a.length = 0; });
    hold = false;
    ok(await waitFor(async () => (await p.locator('[data-recap] .loading').count()) === 0), `${tag} le contenu remplace le cercle`);
    await p.waitForTimeout(300);
    const reveals = (await starts()).filter((x) => x.n === 'reveal' && x.zone);
    if (calm) ok(reveals.length === 0, `${tag} aucun fondu`);
    else {
      ok(reveals.length === 1, `${tag} un fondu au passage du cercle au contenu (${reveals.length})`);
      ok(reveals[0]?.props.every((x) => x === 'opacity') && reveals[0].props.length > 0, `${tag} le fondu n'anime que l'opacité (${reveals[0]?.props.join(', ')})`);
      await p.evaluate(() => { window.__a.length = 0; document.querySelector('[data-recap]').innerHTML = '<p>Chiffres mis à jour</p>'; });
      await p.waitForTimeout(400);
      ok(!(await starts()).some((x) => x.n === 'reveal'), `${tag} une mise à jour de la zone ne refait pas le fondu`);
      ok(!(await p.locator('[data-recap]').evaluate((e) => e.classList.contains('reveal'))), `${tag} la classe de fondu se retire d'elle-même`);
    }

    // 4) (retiré : « Mise en route » est une carte fixe sur la vue d'ensemble, rendue par le serveur ; ses coches et le badge « config ✓ » ne sautent plus)

    // 5) un prospect ajouté : sa ligne est surlignée puis redevient normale
    await p.goto(`${s.base}/p/${id}/prospection`); await p.waitForSelector('html[data-nav="ready"]'); await track();
    await p.evaluate(() => { document.querySelector('details.prospects').open = true; });
    ok(await waitFor(async () => (await p.locator('tr[data-row]').count()) === 3), `${tag} trois prospects listés`);
    await p.locator('[data-pform-toggle]').click();
    await p.fill('form[data-pform] [name=email]', 'nouveau@dupont.fr');
    await p.fill('form[data-pform] [name=company]', 'Dupont SARL');
    await p.evaluate(() => { window.__a.length = 0; });
    await p.locator('form[data-pform] button.primary').click();
    ok(await waitFor(async () => (await p.locator('tr[data-row]').count()) === 4), `${tag} le prospect est ajouté à la liste`);
    await p.waitForTimeout(400);
    const flashes = (await starts()).filter((x) => x.n === 'fx-flash' && x.tag === 'TR');
    if (calm) ok(flashes.length === 0, `${tag} aucun surlignage`);
    else {
      ok(flashes.length === 1, `${tag} une ligne est surlignée (${flashes.length})`);
      ok(await p.locator('tr[data-row]', { hasText: 'Dupont SARL' }).evaluate((e) => e.classList.contains('row-new')), `${tag} c'est celle du prospect ajouté`);
    }
    ok(await waitFor(async () => (await p.locator('tr.row-new').count()) === 0, 3000), `${tag} la ligne redevient normale d'elle-même`);

    ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
    ok(errs.length === 0, `${tag} aucune erreur JS${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
    hold = false; await ctx.unrouteAll({ behavior: 'ignoreErrors' }); await ctx.close();
  }
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
