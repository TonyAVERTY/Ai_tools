// Vérifie dans un vrai navigateur la page Clients : projets en déroulants, liste chargée à l'ouverture, recherche à la frappe, fiche client (modification, documents,
// échanges), fiche prospect et passage en client, bureau et téléphone, clair et sombre, aucun défilement horizontal, aucune erreur console.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). SHOTS=<dossier> enregistre des captures. Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { now } from '../src/db.js';

const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const chromium = pw.chromium || pw.default.chromium;
const s = await startApp();
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const shot = async (p, name) => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true }); };

for (const [vp, scheme, tag] of [[{ width: 1280, height: 900 }, 'light', '1280px clair'], [{ width: 390, height: 800 }, 'dark', '390px sombre']]) {
  const u = await s.newUser();
  const pid = await addProject(s.db, u.id, { name: 'Agenda Kiné', gitUrl: 'https://github.com/a/kine.git' });
  await addProject(s.db, u.id, { name: 'Autre projet', gitUrl: 'https://github.com/a/autre.git' });
  const t = now();
  const prospect = async (company, email, status, city) => Number((await s.db.prepare("INSERT INTO prospects(project_id, company, email, city, sector, status, created_at, sent_at, source) VALUES(?, ?, ?, ?, 'Santé', ?, ?, ?, 'test')").run(pid, company, email, city, status, t, t - 86400)).lastInsertRowid);
  const x = await prospect('Cabinet Dupont', 'dupont@cabinet.fr', 'replied', 'Rennes');
  await prospect('Kiné du Port', 'port@kine.fr', 'sent', 'Nantes');
  await s.db.prepare("INSERT INTO mail_log(project_id, prospect_id, email, sent_at, kind, subject) VALUES(?, ?, 'dupont@cabinet.fr', ?, 'initial', 'Gagnez du temps sur vos rendez-vous')").run(pid, x, t - 90000);
  await s.db.prepare("INSERT INTO replies(project_id, prospect_id, uid, from_email, subject, body, intent, received_at) VALUES(?, ?, 7, 'dupont@cabinet.fr', 'Re: Gagnez du temps', 'Intéressé, appelez-moi jeudi.', 'interested', ?)").run(pid, x, t - 80000);
  await u.post(`/clients/projet/${pid}/ajouter`, { name: 'Atelier Martin', email: 'martin@atelier.fr', contact: 'Paul Martin', address: '1 quai, 44000 Nantes' }, { form: true });

  const ctx = await b.newContext({ viewport: vp, colorScheme: scheme });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', (route) => { const r = route.request(); const h = { ...r.headers() }; if (r.method() === 'POST') h.origin = APP_URL; route.continue({ headers: h }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const wait = () => p.waitForTimeout(700);
  const noScroll = async (label) => ok(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${tag} ${label} : aucun défilement horizontal`);

  await p.goto(`${s.base}/clients`); await wait();
  ok(await p.getByRole('heading', { name: 'Clients', level: 1 }).isVisible(), `${tag} la page s'ouvre`);
  const det = p.locator('details.cl-proj', { hasText: 'Agenda Kiné' });
  ok(await det.evaluate((e) => !e.open), `${tag} les projets sont repliés`);
  ok(/1 client/.test(await det.locator(':scope > summary').innerText()) && /2 prospects/.test(await det.locator(':scope > summary').innerText()), `${tag} compteurs dans la ligne du projet`);
  await noScroll('liste repliée'); await shot(p, `clients-1-repli-${vp.width}`);
  await det.locator(':scope > summary').click(); await wait();
  ok(await det.getByText('Atelier Martin').isVisible() && await det.getByText('Cabinet Dupont').isVisible(), `${tag} le projet déroulé affiche clients et prospects`);
  await noScroll('projet déroulé'); await shot(p, `clients-2-deroule-${vp.width}`);
  // Recherche
  await det.locator('[data-cl-search]').fill('nantes'); await wait();
  ok(await det.getByText('Kiné du Port').isVisible() && await det.getByText('Cabinet Dupont').count() === 0, `${tag} la recherche filtre à la frappe (ville)`);
  await det.locator('[data-cl-search]').fill('zzz'); await wait();
  ok(await det.getByText(/Aucun client pour « zzz »/).isVisible(), `${tag} message clair sans résultat`);
  await det.locator('[data-cl-search]').fill(''); await wait();
  // Fiche client
  await det.getByRole('link', { name: /Atelier Martin/ }).click(); await wait();
  ok(await p.getByRole('heading', { name: 'Atelier Martin', level: 1 }).isVisible(), `${tag} fiche client`);
  await p.locator('[name="phone"]').fill('06 12 34 56 78'); await p.locator('[name="notes"]').fill('Paie à 15 jours');
  await p.getByRole('button', { name: 'Enregistrer' }).click(); await wait();
  ok(/enregistrées/.test(await p.locator('body').innerText()) && await p.locator('[name="phone"]').inputValue() === '06 12 34 56 78', `${tag} modification enregistrée`);
  ok(await p.getByText(/Aucun document pour ce client/).isVisible(), `${tag} documents : état vide explicite`);
  await noScroll('fiche client'); await shot(p, `clients-3-fiche-${vp.width}`);
  // Fiche prospect : échanges et passage en client
  await p.goto(`${s.base}/clients/p/${x}`); await wait();
  ok(await p.locator('.cl-quote', { hasText: 'Intéressé, appelez-moi jeudi.' }).isVisible() && await p.locator('.cl-tl p', { hasText: 'Gagnez du temps sur vos rendez-vous' }).isVisible(), `${tag} échanges du prospect (mail envoyé, réponse)`);
  await p.locator('[name="body"]').fill('Appel prévu jeudi'); await p.getByRole('button', { name: 'Ajouter la note' }).click(); await wait();
  ok(await p.locator('.cl-tl p', { hasText: 'Appel prévu jeudi' }).isVisible(), `${tag} note ajoutée`);
  await noScroll('fiche prospect'); await shot(p, `clients-4-prospect-${vp.width}`);
  p.once('dialog', (d) => d.accept());
  await p.getByRole('button', { name: 'Passer en client' }).click(); await wait();
  ok(await p.getByRole('heading', { name: 'Cabinet Dupont', level: 1 }).isVisible() && /maintenant un client/.test(await p.locator('body').innerText()), `${tag} le prospect devient client`);
  ok(await p.locator('.cl-quote', { hasText: 'Intéressé, appelez-moi jeudi.' }).isVisible(), `${tag} ses échanges sont sur la fiche client`);
  await noScroll('fiche client issue du prospect'); await shot(p, `clients-5-converti-${vp.width}`);
  ok(errs.length === 0, `${tag} aucune erreur console${errs.length ? ` : ${errs.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}
await b.close(); await s.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
