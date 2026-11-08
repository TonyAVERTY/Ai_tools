// Vérifie dans un vrai navigateur l'état « occupé » commun des boutons : pendant une action, le bouton cliqué est bloqué (un double clic ne part qu'une fois),
// marqué aria-busy et affiche un anneau devant son libellé (CSS `.btn[aria-busy]`) ; l'anneau disparaît à la fin, y compris sur échec ; il reste visible mais
// immobile quand le mouvement réduit est demandé. Deux chemins : bouton laissé actif (ajout d'un prospect) et bouton désactivé avant l'appel (ajout au calendrier).
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
let uid = 0;

/** Ralentit (et compte) les requêtes POST qui correspondent à l'un des motifs ; `fail` : réponse 500 sans message. Une seule route par contexte. */
async function slowRoute(ctx, rules) {
  const list = rules.map((r) => ({ ms: 1500, fail: false, ...r, hits: { n: 0 } }));
  await ctx.route('**/*', async (route) => {
    const r = route.request();
    if (r.method() !== 'POST') return route.continue();
    const rule = list.find((x) => x.pattern.test(r.url()));
    if (rule) { rule.hits.n++; await new Promise((x) => setTimeout(x, rule.ms)); }
    if (rule?.fail) return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */
    return route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) });
  });
  return list.map((x) => x.hits);
}
const closeCtx = async (ctx) => { await ctx.unrouteAll({ behavior: 'ignoreErrors' }); await ctx.close(); };
const ring = (p, sel) => p.evaluate((q) => { const el = document.querySelector(q); const c = getComputedStyle(el, '::before'); return { busy: el.getAttribute('aria-busy'), disabled: el.disabled, anim: c.animationName, width: c.width, content: c.content, label: el.textContent.trim() }; }, sel);

for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  const tag = `${vp.width}px`;
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: 'Atelier' });
  await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ?, target_validated = 1 WHERE id = ?').run(PROFILE, TARGET, pid);
  const prospect = Number((await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, 'Boulangerie', 'b@boulangerie.fr', 'replied', ?, ?)").run(pid, now() - 3600, now())).lastInsertRowid);
  await s.db.prepare('INSERT INTO replies(project_id, prospect_id, uid, from_email, subject, body, intent, received_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)').run(pid, prospect, ++uid, 'b@boulangerie.fr', 'Re: offre', 'Oui, appelez-moi mardi à 14h30 ça me va', 'interested', now());
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  const [addHits, evHits] = await slowRoute(ctx, [{ pattern: /\/api\/projects\/\d+\/prospects$/ }, { pattern: /\/api\/replies\/\d+\/event$/ }]);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|status of 500/.test(m.text())) errs.push(m.text()); });
  await p.goto(`${s.base}/projets`);
  await p.waitForSelector('html[data-nav="ready"]');
  await p.waitForSelector('[data-pform-toggle]', { state: 'attached' });
  await p.evaluate(() => { for (const k of ['prospect', 'prospects']) { const d = document.querySelector(`details[data-acc="${k}"]`); if (d) d.open = true; } });

  // 1) bouton laissé actif : ajout d'un prospect
  await p.locator('[data-pform-toggle]').click();
  await p.fill('form[data-pform] [name=email]', `nouveau-${vp.width}@atelier.fr`);
  await p.fill('form[data-pform] [name=company]', `Atelier ${vp.width}`);
  const add = 'form[data-pform] button.primary';
  const before = await ring(p, add);
  ok(before.busy === null && before.content === 'none', `${tag} au repos : pas d'anneau`);
  await p.locator(add).dblclick();
  ok(await waitFor(async () => (await ring(p, add)).busy === 'true', 3000), `${tag} pendant l'envoi : le bouton est marqué occupé`);
  const during = await ring(p, add);
  ok(during.disabled && during.anim === 'spin' && during.width === '14px', `${tag} anneau de 14 px qui tourne devant le texte (animation « ${during.anim} », largeur ${during.width})`);
  ok(during.label === before.label, `${tag} le libellé ne change pas (« ${during.label} »)`);
  ok(await waitFor(async () => (await ring(p, add)).busy === null, 8000), `${tag} à la fin : l'état occupé disparaît`);
  ok(addHits.n === 1, `${tag} un double clic n'envoie qu'une seule requête (${addHits.n})`);
  const after = await ring(p, add).catch(() => null);
  ok(!after || (after.content === 'none' && !after.disabled), `${tag} bouton de nouveau normal`);

  // 2) bouton désactivé avant l'appel : ajout au calendrier depuis la popup d'une réponse
  await p.waitForSelector('.reply-pop', { timeout: 10000 });
  await p.locator('.reply-pop summary').first().click();
  const ev = '.reply-pop [data-ev-add]';
  await p.waitForSelector(ev);
  await p.locator(ev).click();
  ok(await waitFor(async () => (await ring(p, ev)).busy === 'true', 3000), `${tag} bouton désactivé d'avance : marqué occupé quand même`);
  const d2 = await ring(p, ev);
  ok(d2.anim === 'spin' && d2.width === '14px', `${tag} même anneau (animation « ${d2.anim} », largeur ${d2.width})`);
  ok(await waitFor(() => p.locator('.reply-pop .suggest.done').count().then((n) => n > 0), 8000), `${tag} l'action aboutit (ajouté au calendrier)`);
  ok(evHits.n === 1, `${tag} une seule requête (${evHits.n})`);

  // 3) échec : l'état occupé disparaît et le bouton redevient utilisable
  const ctxF = await b.newContext({ viewport: vp });
  await ctxF.addCookies([{ name, value, url: s.base }]);
  await slowRoute(ctxF, [{ pattern: /\/api\/projects\/\d+\/prospects$/, ms: 600, fail: true }]);
  const pf = await ctxF.newPage();
  await pf.goto(`${s.base}/projets`); await pf.waitForSelector('[data-pform-toggle]', { state: 'attached' });
  await pf.evaluate(() => { for (const k of ['prospect', 'prospects']) { const d = document.querySelector(`details[data-acc="${k}"]`); if (d) d.open = true; } });
  await pf.locator('[data-pform-toggle]').click();
  await pf.fill('form[data-pform] [name=email]', `echec-${vp.width}@atelier.fr`);
  await pf.locator(add).click();
  ok(await waitFor(async () => (await ring(pf, add)).busy === null && !(await ring(pf, add)).disabled, 8000), `${tag} échec : le bouton est libéré (pas d'anneau bloqué)`);
  ok(await pf.locator('.toast.error').count() === 1, `${tag} échec : l'erreur est dite`);
  await closeCtx(ctxF);

  // 4) mouvement réduit : l'anneau reste visible mais immobile
  const ctxR = await b.newContext({ viewport: vp, reducedMotion: 'reduce' });
  await ctxR.addCookies([{ name, value, url: s.base }]);
  await slowRoute(ctxR, [{ pattern: /\/api\/projects\/\d+\/prospects$/ }]);
  const pr = await ctxR.newPage();
  await pr.goto(`${s.base}/projets`); await pr.waitForSelector('[data-pform-toggle]', { state: 'attached' });
  await pr.evaluate(() => { for (const k of ['prospect', 'prospects']) { const d = document.querySelector(`details[data-acc="${k}"]`); if (d) d.open = true; } });
  await pr.locator('[data-pform-toggle]').click();
  await pr.fill('form[data-pform] [name=email]', `calme-${vp.width}@atelier.fr`);
  await pr.locator(add).click();
  await waitFor(async () => (await ring(pr, add)).busy === 'true', 3000);
  const calm = await ring(pr, add);
  ok(calm.width === '14px' && calm.anim === 'none', `${tag} mouvement réduit : anneau visible (${calm.width}) et immobile (animation « ${calm.anim} »)`);
  await closeCtx(ctxR);

  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await closeCtx(ctx);
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
