// Vérifie dans un vrai navigateur (public/app-replies.js) les réponses des prospects : popups d'arrivée (deux au plus, le reste résumé), pastille de
// l'onglet « Mails », texte affiché sans exécuter de HTML, fermeture qui marque la réponse comme lue, ajout au calendrier depuis la proposition,
// bouton « Marquer comme lu » de la page « Mails », et le même fonctionnement après une navigation sans rechargement.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const u = await s.newUser();
const pid = await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
const prospect = Number((await s.db.prepare("INSERT INTO prospects(project_id, company, email, status, sent_at, created_at) VALUES(?, 'Boulangerie Dupont', 'c@dupont.fr', 'replied', ?, ?)").run(pid, now() - 3600, now())).lastInsertRowid);
let uid = 0;
const addReply = async (subject, body, intent = 'interested', ago = 0) => Number((await s.db.prepare('INSERT INTO replies(project_id, prospect_id, uid, from_email, subject, body, intent, received_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
  .run(pid, prospect, ++uid, 'c@dupont.fr', subject, body, intent, now() - ago)).lastInsertRowid);
const unseen = async () => Number((await s.db.prepare('SELECT COUNT(*) n FROM replies WHERE project_id = ? AND seen_at IS NULL').get(pid)).n);
const waitFor = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 120)); } return false; };

const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  await s.db.prepare('UPDATE replies SET seen_at = ? WHERE seen_at IS NULL').run(now());
  // la liste est triée de la plus récente à la plus ancienne : la réponse piégée arrive en dernier, donc s'affiche en premier
  await addReply('Re: encore', 'Merci, pas pour le moment', 'refusal', 120);
  await addReply('Re: autre', 'Envoyez-moi plus de détails svp', 'question', 60);
  const piege = await addReply('Re: offre', 'Oui, appelez-moi mardi à 14h30 ça me va <img src=x onerror="window.__xss=1"> <b>gras</b>');
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

  // arrivée : deux popups au plus, le reste en une ligne, pastille sur l'onglet Mails
  await p.waitForSelector('.reply-pop', { timeout: 10000 });
  ok(await p.locator('.reply-pop').count() === 2, `${tag} deux popups au plus pour trois réponses non lues (${await p.locator('.reply-pop').count()})`);
  ok((await p.locator('.reply-more').textContent().catch(() => '')).includes('+ 1 autre réponse non lue'), `${tag} la troisième est résumée en une ligne`);
  ok((await p.locator('.pill[href="/mails"] .pill-n').first().textContent().catch(() => '')) === '3', `${tag} la pastille de l'onglet Mails affiche 3`);

  // le texte venu de la base ne doit jamais devenir du HTML
  await p.locator('.reply-pop summary').first().click();
  ok(await p.locator('.reply-pop img').count() === 0 && await p.evaluate(() => window.__xss === undefined), `${tag} le texte de la réponse reste du texte (aucun HTML exécuté)`);
  ok((await p.locator('.reply-pop .reply-text').first().textContent()).includes('<img src=x'), `${tag} la balise saisie s'affiche telle quelle`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal avec une popup ouverte`);

  // ajout au calendrier depuis la proposition
  const sg = p.locator(`.reply-pop [data-suggest="${piege}"]`);
  ok(await sg.count() === 1, `${tag} la réponse qui parle de « mardi à 14h30 » propose l'ajout au calendrier`);
  const before = Number((await s.db.prepare('SELECT COUNT(*) n FROM calendar_events WHERE reply_id = ?').get(piege)).n);
  await sg.locator('[data-ev-add]').click();
  await p.waitForSelector(`.reply-pop [data-suggest="${piege}"].done`, { timeout: 10000 });
  const after = Number((await s.db.prepare('SELECT COUNT(*) n FROM calendar_events WHERE reply_id = ?').get(piege)).n);
  ok(before === 0 && after === 1, `${tag} l'événement est créé une seule fois (${before} → ${after})`);
  ok(await sg.locator('a', { hasText: 'Google Agenda' }).count() === 1 && await sg.locator('a', { hasText: 'Fichier .ics' }).count() === 1, `${tag} les liens Google Agenda et .ics apparaissent`);

  // fermer une popup (×) : la réponse est marquée lue en base, la suivante prend la place
  const unseenBefore = await unseen();
  await p.locator('.reply-pop .reply-x').first().click();
  ok(await waitFor(async () => (await unseen()) === unseenBefore - 1), `${tag} la croix marque la réponse comme lue (${unseenBefore} → ${await unseen()})`);
  ok(await waitFor(async () => (await p.locator('.reply-pop').count()) === 2), `${tag} la réponse suivante remplace la popup fermée`);

  // page « Mails » : marquer comme lu
  await p.goto(`${s.base}/mails?v=replies`);
  await p.waitForSelector('html[data-nav="ready"]');
  const rows = await p.locator('.reply-row.unseen').count();
  if (rows > 0) {
    const before2 = await unseen();
    await p.locator('.reply-row.unseen > summary').first().click(); // la ligne est repliée : on l'ouvre comme l'utilisateur
    await p.locator('.reply-row.unseen [data-reply-seen]').first().click();
    ok(await waitFor(async () => (await unseen()) === before2 - 1), `${tag} « Marquer comme lu » de la page Mails met à jour la base`);
  } else ok(false, `${tag} la page Mails liste des réponses non lues`);

  // navigation sans rechargement : une réponse arrivée entre-temps doit apparaître, et les écouteurs doivent être posés de nouveau
  await p.evaluate(() => { window.__marker = 'vivante'; });
  await p.locator('.pills a.pill', { hasText: 'Calendrier' }).click();
  await p.waitForURL(/calendar/);
  await p.waitForSelector('html[data-nav="ready"]');
  const fresh = await addReply('Re: nouvelle', `Réponse tardive ${vp.width}`);
  await p.locator('.pills a.pill', { hasText: 'Projets' }).click();
  await p.waitForURL((url) => url.pathname === '/');
  await p.waitForSelector('html[data-nav="ready"]');
  ok(await p.evaluate(() => window.__marker) === 'vivante', `${tag} aller-retour sans rechargement de la page`);
  ok(await waitFor(async () => (await p.locator('.reply-pop, .reply-more').count()) > 0), `${tag} après navigation : les popups des réponses non lues reviennent`);
  ok(await p.locator('.reply-pops').count() === 1, `${tag} un seul conteneur de popups après navigation`);
  void fresh;
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
