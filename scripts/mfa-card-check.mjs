// Vérifie dans Chromium la carte « Sécurité : A2F » d'un compte protégé : UN seul champ « code » pour les deux actions ; « Désactiver l'A2F » demande une
// confirmation (annuler n'envoie rien) ; « Régénérer » et « Désactiver » envoient le même champ vers leur propre adresse. Aucun envoi réel (requêtes interceptées).
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
import { testTokenLink } from '../test/helpers/users.js';
import { decrypt } from '../src/crypto.js';
import { codeAt } from '../src/totp.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp();
const u = await s.newUser({ admin: false, link: testTokenLink() });
await u.post('/account/2fa/start', {}, { form: true });
const sec = decrypt(s.app.cfg.secretKey, (await s.db.prepare('SELECT totp_secret_enc e FROM users WHERE id = ?').get(u.id)).e);
await u.post('/account/2fa/enable', { code: codeAt(sec, Math.floor(Date.now() / 30000)) }, { form: true });
const b = await chromium.launch(exe ? { executablePath: exe } : {});
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  const ctx = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx.addCookies([{ name, value, url: s.base }]);
  const p = await ctx.newPage();
  const errs = []; const sent = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/account/2fa/**', (route) => { const r = route.request(); sent.push({ url: new URL(r.url()).pathname, body: r.postData() || '' }); return route.fulfill({ status: 204 }); });
  await p.goto(`${s.base}/account`); await p.waitForSelector('html[data-nav="ready"]');
  const card = p.locator('#securite');
  ok(await card.locator('input[name="code"]').count() === 1, `${tag} un seul champ « code » dans la carte`);
  ok(await card.locator('input:not([type=hidden]):not([type=checkbox])').count() === 1, `${tag} aucun autre champ de saisie dans la carte`);
  const regen = card.getByRole('button', { name: 'Régénérer les codes de secours' });
  const off = card.getByRole('button', { name: "Désactiver l'A2F" });
  ok(await regen.isVisible() && await off.isVisible(), `${tag} les deux boutons sont visibles`);
  const rb = await regen.boundingBox(); const ob = await off.boundingBox(); const ib = await card.locator('input[name="code"]').boundingBox();
  ok(rb.y > ib.y && ob.y > ib.y, `${tag} les boutons sont sous le champ`);
  ok(Math.max(rb.x + rb.width, ob.x + ob.width) <= vp.width, `${tag} les boutons tiennent dans la largeur`);
  // « Désactiver » : confirmation d'abord ; annuler n'envoie rien
  await card.locator('input[name="code"]').fill('123456');
  await off.click();
  await p.waitForSelector('dialog[open], .confirm-box, [data-confirm-box]', { timeout: 3000 }).catch(() => {});
  const dialog = p.locator('dialog[open]');
  ok(await dialog.count() === 1, `${tag} « Désactiver » ouvre une confirmation`);
  if (await dialog.count()) {
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await p.waitForTimeout(300);
    ok(sent.length === 0, `${tag} annuler n'envoie rien`);
    await off.click();
    await p.locator('dialog[open]').getByRole('button', { name: "Désactiver l'A2F" }).click();
    await p.waitForTimeout(400);
    ok(sent.length === 1 && sent[0].url === '/account/2fa/disable' && sent[0].body.includes('code=123456'), `${tag} confirmer envoie le code à /account/2fa/disable (${JSON.stringify(sent[0] || null)})`);
  }
  // « Régénérer » : envoi direct vers sa propre adresse, avec le même champ
  sent.length = 0;
  await p.goto(`${s.base}/account`); await p.waitForSelector('html[data-nav="ready"]');
  await card.locator('input[name="code"]').fill('654321');
  await regen.click();
  await p.waitForTimeout(400);
  ok(sent.length === 1 && sent[0].url === '/account/2fa/recovery' && sent[0].body.includes('code=654321'), `${tag} « Régénérer » envoie le même champ à /account/2fa/recovery (${JSON.stringify(sent[0] || null)})`);
  ok(errs.length === 0, `${tag} aucune erreur JavaScript ${errs.join(' | ')}`);
  await ctx.close();
}
await b.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
