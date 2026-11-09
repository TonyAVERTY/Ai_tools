// Vérifie dans un vrai navigateur qu'un formulaire que le serveur refuse (erreur de saisie renvoyée par une redirection « ?e=… ») ne perd rien de ce que l'utilisateur a saisi :
// on reste sur la page, l'erreur s'affiche en notification, les champs gardent leur valeur, le bouton se réactive, l'adresse ne change pas. Formulaires essayés : « Ajouter un client »
// (SIRET invalide) et « Ajouter un événement » du calendrier (date trop lointaine). Un envoi valide marche toujours (le formulaire est alors vidé par la page rechargée).
// À 1280 et 390 px. Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
const toastText = (p) => p.locator('.toasts .toast.error .toast-t').allInnerTexts().then((a) => a.join(' | '));

for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  const tag = `${vp.width}px`;
  const u = await s.newUser();
  await addProject(s.db, u.id, { name: 'Atelier', gitUrl: 'https://github.com/u/atelier.git' });
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', async (route) => {
    const r = route.request();
    if (r.method() !== 'POST') return route.continue();
    /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */
    return route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  const values = (form, names) => p.evaluate(([f, ns]) => Object.fromEntries(ns.map((n) => [n, document.querySelector(f)?.elements[n]?.value])), [form, names]);

  // 1) Clients : « Ajouter un client » avec un SIRET de 3 chiffres (le serveur en veut 14)
  await p.goto(`${s.base}/clients`); await p.waitForSelector('html[data-nav="ready"]');
  await p.evaluate(() => { document.querySelector('details[data-cl-project]').open = true; document.querySelector('details.cl-add').open = true; });
  const F1 = '.cl-add-f';
  await p.fill(`${F1} [name=name]`, 'Dupont SARL'); await p.fill(`${F1} [name=contact]`, 'Paul Dupont'); await p.fill(`${F1} [name=email]`, 'paul@dupont.fr'); await p.fill(`${F1} [name=siret]`, '123');
  await p.evaluate((f) => { document.querySelector(f).__mark = 1; }, F1); // disparaît si la page est remplacée
  const url1 = p.url();
  await p.click(`${F1} button.primary`);
  ok(await waitFor(async () => /SIRET/.test(await toastText(p))), `${tag} clients : l'erreur du serveur s'affiche en notification (« ${await toastText(p)} »)`);
  ok(await p.evaluate((f) => document.querySelector(f)?.__mark === 1, F1), `${tag} clients : la page n'a pas été remplacée`);
  ok(p.url() === url1 && !/[?&]e=/.test(p.url()), `${tag} clients : l'adresse n'a pas changé (pas de « ?e= »)`);
  const v1 = await values(F1, ['name', 'contact', 'email', 'siret']);
  ok(v1.name === 'Dupont SARL' && v1.contact === 'Paul Dupont' && v1.email === 'paul@dupont.fr' && v1.siret === '123', `${tag} clients : ce qui était saisi est conservé (${JSON.stringify(v1)})`);
  ok(await p.evaluate(() => document.querySelector('details.cl-add')?.open === true), `${tag} clients : le formulaire reste ouvert`);
  ok(await p.locator(`${F1} button.primary`).isEnabled(), `${tag} clients : le bouton est de nouveau utilisable`);
  // on corrige le SIRET et ça passe : le client est créé
  await p.fill(`${F1} [name=siret]`, '12345678901234');
  await p.click(`${F1} button.primary`);
  // succès : le serveur redirige vers la fiche du client (une autre page : navigation normale, pas une erreur)
  ok(await waitFor(() => /\/clients\/c\/\d+/.test(p.url())), `${tag} clients : après correction, on arrive sur la fiche du client (${p.url().replace(s.base, '')})`);
  ok(!!(await s.db.prepare("SELECT id FROM billing_clients WHERE user_id = ? AND name = 'Dupont SARL' AND siret = '12345678901234'").get(u.id)), `${tag} clients : le client est bien enregistré (nom et SIRET corrigé)`);

  // 2) Calendrier : « Ajouter un événement » avec une date dans dix ans (le serveur accepte jusqu'à trois ans)
  await p.goto(`${s.base}/calendar`); await p.waitForSelector('html[data-nav="ready"]');
  const F2 = '.evform';
  await p.evaluate(() => { document.getElementById('evenements').open = true; });
  await p.fill(`${F2} [name=title]`, 'Appel avec Boulangerie Dupont'); await p.fill(`${F2} [name=date]`, '2036-05-12'); await p.fill(`${F2} [name=time]`, '14:30');
  await p.selectOption(`${F2} [name=minutes]`, '60'); await p.fill(`${F2} [name=notes]`, 'Parler du devis');
  await p.evaluate((f) => { document.querySelector(f).__mark = 1; }, F2);
  const url2 = p.url();
  await p.click(`${F2} button.primary`);
  ok(await waitFor(async () => /date entre hier et dans trois ans/.test(await toastText(p))), `${tag} calendrier : l'erreur s'affiche en notification (« ${await toastText(p)} »)`);
  ok(await p.evaluate((f) => document.querySelector(f)?.__mark === 1, F2), `${tag} calendrier : la page n'a pas été remplacée`);
  ok(p.url() === url2 && !/[?&]e=/.test(p.url()), `${tag} calendrier : l'adresse n'a pas changé`);
  const v2 = await values(F2, ['title', 'date', 'time', 'minutes', 'notes']);
  ok(v2.title === 'Appel avec Boulangerie Dupont' && v2.date === '2036-05-12' && v2.time === '14:30' && v2.minutes === '60' && v2.notes === 'Parler du devis', `${tag} calendrier : tout est conservé (${JSON.stringify(v2)})`);
  ok(await p.locator(`${F2} button.primary`).isEnabled(), `${tag} calendrier : le bouton est de nouveau utilisable`);
  // date valide : l'événement est créé, on est ramené à la page à jour et le formulaire est neuf
  const d = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  await p.fill(`${F2} [name=date]`, d);
  await p.click(`${F2} button.primary`);
  ok(await waitFor(async () => /Appel avec Boulangerie Dupont/.test(await p.locator('.agenda').innerText().catch(() => ''))), `${tag} calendrier : après correction, l'événement apparaît dans l'agenda`);
  ok((await values(F2, ['title'])).title === '', `${tag} calendrier : le formulaire est vide après un envoi réussi`);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} pas de défilement horizontal`);
  ok(errs.length === 0, `${tag} aucune erreur JS${errs.length ? ` : ${errs.join(' | ')}` : ''}`);
  await ctx.unrouteAll({ behavior: 'ignoreErrors' }); await ctx.close();
}
await b.close();
await s.close?.();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
