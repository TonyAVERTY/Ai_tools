// Vérifie dans un vrai navigateur l'onglet Promotion : formulaire, limite d'images, production d'une vidéo (faux Claude, vrai rendu), lecture, suppression.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM) ; le même Chromium sert au rendu des vidéos. Sortie « TOUT EST BON » attendue.
import { startApp, APP_URL } from '../test/helpers/server.js';
import { makeClaudeBin } from '../test/helpers/claude-bin.js';
import { addProject } from '../test/helpers/users.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp({ cfg: { chromiumBin: exe }, worker: true });
s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'fake-claude.js' });
const u = await s.newUser();
const pid = await addProject(s.db, u.id, { name: 'Fidélio', gitUrl: 'https://github.com/u/fidelio.git' });
await s.db.prepare('UPDATE projects SET profile_json = ? WHERE id = ?').run(JSON.stringify({ resume: 'Cartes de fidélité digitales.', proposition_valeur: 'Fidélisez sans carton.', arguments: ['simple'], ton: 'direct' }), pid);
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  await ctx.route('**/*', (route) => { const r = route.request(); const h = { ...r.headers() }; if (r.method() === 'POST') h.origin = APP_URL; route.continue({ headers: h }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/`);
  await p.evaluate(() => { document.querySelector('details.project')?.setAttribute('open', ''); });
  await p.locator('details[data-acc="promo"] > summary').click();
  await p.waitForSelector('[data-promo-form]', { timeout: 8000 });
  ok(await p.locator('[data-promo-form] input[name="fps"]').inputValue() === '30', `${tag} 30 images/s par défaut`);
  ok(await p.locator('[data-promo-form] input[name="seconds"]').inputValue() === '15', `${tag} 15 s par défaut`);
  ok((await p.locator('[data-promo-count]').textContent()).includes('450 images'), `${tag} nombre d'images affiché`);
  await p.fill('[data-promo-form] input[name="fps"]', '60'); await p.fill('[data-promo-form] input[name="seconds"]', '60');
  ok(await p.locator('[data-promo-go]').isDisabled() && /Trop d'images/.test(await p.locator('[data-promo-count]').textContent()), `${tag} trop d'images : bouton bloqué et message`);
  await p.fill('[data-promo-form] input[name="fps"]', '10'); await p.fill('[data-promo-form] input[name="seconds"]', '3');
  await p.fill('[data-promo-form] input[name="subject"]', 'Les cartes de fidélité');
  await p.selectOption('[data-promo-form] select[name="format"]', 'carre');
  ok(await p.locator('[data-promo-go]').isEnabled(), `${tag} bouton actif`);
  await p.locator('[data-promo-go]').click();
  const served = p.waitForResponse((r) => /\/api\/promo\/\d+\/file$/.test(r.url()), { timeout: 30000 }).catch(() => null);
  await p.waitForSelector('.pv video', { timeout: 60000 });
  // Le Chromium de Playwright (build libre) n'embarque pas H.264 : dans ce cas on vérifie que le fichier est bien servi (son contenu est validé par ffprobe dans les tests)
  const canH264 = await p.evaluate(() => !!document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"'));
  if (canH264) {
    const meta = await p.locator('.pv video').evaluate((v) => new Promise((res) => { if (v.readyState >= 1) res([v.videoWidth, v.videoHeight, Math.round(v.duration)]); else v.addEventListener('loadedmetadata', () => res([v.videoWidth, v.videoHeight, Math.round(v.duration)]), { once: true }); setTimeout(() => res(null), 8000); }));
    ok(JSON.stringify(meta) === '[720,720,3]', `${tag} la vidéo se lit dans la page (${JSON.stringify(meta)})`);
  } else {
    const r = await served;
    ok(!!r && [200, 206].includes(r.status()) && /video\/mp4/.test(r.headers()['content-type'] || ''), `${tag} la vidéo est servie en MP4 (ce navigateur de test ne lit pas H.264)`);
  }
  ok((await p.locator('.pv-title').first().textContent()).includes('Les cartes de fidélité'), `${tag} sujet affiché`);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag} pas de défilement horizontal`);
  ok(await p.locator('.pv a[download]').count() === 1, `${tag} lien de téléchargement`);
  if (process.env.SHOTS) await p.locator('details[data-acc="promo"]').screenshot({ path: `${process.env.SHOTS}/promo-${vp.width}.png` });
  p.once('dialog', (d) => d.accept());
  await p.locator('[data-pv-delete]').click();
  await p.waitForFunction(() => !document.querySelector('.pv'), null, { timeout: 8000 });
  ok(true, `${tag} suppression`);
  ok(errs.length === 0, `${tag} aucune erreur console ${errs.join(' | ')}`);
  await ctx.close();
  if (vp.width === 1280) await s.db.prepare('DELETE FROM jobs').run();
}
await b.close(); await s.close();
console.log(bad ? `\n${bad} PROBLÈME(S)` : '\nTOUT EST BON');
process.exit(bad ? 1 : 0);
