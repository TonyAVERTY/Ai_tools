// Parcours réel dans Chromium de la publication Instagram (Communication) : panneau « connecter », compte relié, publier en post, programmer, annuler, story.
// Meta est simulé (app.fetch), la conversion JPEG aussi. Sortie « TOUT EST BON » attendue. Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM).
import { startApp, APP_URL } from '../test/helpers/server.js';
import { addProject } from '../test/helpers/users.js';
import { saveDraft } from '../src/contentdrafts.js';
import { encrypt } from '../src/crypto.js';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const chromium = pw.chromium || pw.default.chromium;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let bad = 0; const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const IG = { appId: 'a', appSecret: 'b', redirectUri: 'https://x.fr/instagram/callback', apiVersion: 'v23.0', publicBase: 'https://x.fr' };
const s = await startApp({ cfg: { instagram: IG } });
s.app.toJpeg = async () => Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
s.app.instagramPollMs = 0;
const sent = [];
s.app.fetch = async (url, init = {}) => {
  const u = String(url); sent.push(u);
  const r = (json) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => json });
  if (/\/media$/.test(u)) return r({ id: '17900000000000001' });
  if (u.includes('/17900000000000001?')) return r({ status_code: 'FINISHED' });
  if (/\/media_publish$/.test(u)) return r({ id: '18000000000000002' });
  if (u.includes('/18000000000000002?')) return r({ permalink: 'https://www.instagram.com/p/ABC/' });
  throw new Error(`appel inattendu : ${u}`);
};
const u = await s.newUser({ email: 'ig@x.fr' });
const pid = await addProject(s.db, u.id, { name: 'Cartes Fidèles' });
const draft = () => saveDraft(s.db, pid, 'instagram', { body: 'Ma légende', extra: { hashtags: ['#a'], format: 'carre', width: 1080, height: 1080 }, image: PNG });
await draft();
const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  await s.db.prepare('DELETE FROM instagram_accounts').run();
  await s.db.prepare("UPDATE content_drafts SET status = 'draft', scheduled_at = NULL, published_at = NULL, permalink = NULL, publish_error = NULL").run();
  const ctx = await b.newContext({ viewport: vp, hasTouch: vp.width < 800 }); const [n, v] = u.cookie.split('=');
  await ctx.addCookies([{ name: n, value: v, url: s.base }]);
  await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/p/${pid}/communication`);
  await p.waitForSelector('[data-content="instagram"] [data-ig-pub]');
  ok(await p.locator('[data-ig-pub] a', { hasText: 'Connecter Instagram' }).getAttribute('href') === `/instagram/connect?project=${pid}`, `${tag} sans compte : « Connecter Instagram » vise la connexion`);
  ok(!(await p.locator('[data-ig-publish]').count()), `${tag} sans compte : pas de bouton Publier`);
  // Compte relié (la connexion OAuth elle-même est testée côté serveur)
  await s.db.prepare('INSERT INTO instagram_accounts(project_id, ig_user_id, username, account_type, token_enc, expires_at, connected_by, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
    .run(pid, '1784140000', 'cafe_bzh', 'BUSINESS', encrypt(s.app.cfg.secretKey, 'tok'), Math.floor(Date.now() / 1000) + 5000000, u.id, Math.floor(Date.now() / 1000));
  await p.reload(); await p.waitForSelector('[data-ig-publish]');
  ok(/@cafe_bzh/.test(await p.locator('[data-ig-pub]').innerText()), `${tag} le compte relié s'affiche`);
  const g = await p.evaluate(() => ({ o: document.documentElement.scrollWidth > innerWidth + 1 }));
  ok(!g.o, `${tag} aucun débordement horizontal`);
  // Programmer puis annuler
  const d = new Date(Date.now() + 2 * 3600 * 1000); const pad = (x) => String(x).padStart(2, '0');
  await p.fill('[data-ig-when]', `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
  await p.selectOption('[data-ig-as]', 'story');
  await p.locator('[data-ig-schedule]').click(); await p.locator('dialog.confirm [data-yes]').click();
  await p.waitForSelector('[data-ig-unschedule]');
  ok(/Programmé en story/.test(await p.locator('[data-ig-pub]').innerText()), `${tag} « Programmer » verrouille le brouillon en story`);
  ok(await p.locator('[data-ct-body]').getAttribute('readonly') !== null, `${tag} la légende n'est plus modifiable`);
  await p.locator('[data-ig-unschedule]').click(); await p.waitForSelector('[data-ig-publish]');
  ok(true, `${tag} « Annuler la programmation » remet le brouillon`);
  // Publier maintenant
  await p.selectOption('[data-ig-as]', 'post');
  await p.locator('[data-ig-publish]').click(); await p.locator('dialog.confirm [data-yes]').click();
  await p.waitForSelector('a:has-text("Voir sur Instagram")');
  ok(/Publié en post/.test(await p.locator('[data-ig-pub]').innerText()), `${tag} « Publier maintenant » publie en post avec un lien vers Instagram`);
  ok(sent.some((x) => /media_publish$/.test(x)), `${tag} l'API de publication a été appelée`);
  ok(errs.length === 0, `${tag} aucune erreur de console${errs[0] ? ` : ${errs[0]}` : ''}`);
  await ctx.close();
}
await b.close(); await s.close(); console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON'); process.exit(bad ? 1 : 0);
