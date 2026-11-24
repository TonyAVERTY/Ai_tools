// Vérifie dans Chromium les champs de code (A2F) : jamais plus de 6 caractères en mode « application », uniquement des chiffres (frappe, collage, lettres),
// bascule vers le code de secours (11 caractères : chiffres et a-f), retour au mode application ; sur la page de connexion et dans la carte de Mon compte,
// à 1280 et 390 px. Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM). Sortie « TOUT EST BON » attendue.
import { startApp } from '../test/helpers/server.js';
import { testTokenLink } from '../test/helpers/users.js';
import { decrypt, hashSid } from '../src/crypto.js';
import { codeAt } from '../src/totp.js';
import { now } from '../src/db.js';

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

async function exercise(p, scope, tag) {
  const input = p.locator(`${scope} [data-code-input]`);
  const link = p.locator(`${scope} [data-code-toggle]`);
  const type = async (v) => { await input.fill(''); await input.pressSequentially(v, { delay: 5 }); return input.inputValue(); };
  ok(await input.getAttribute('maxlength') === '6', `${tag} limite de 6 caractères posée dans la page`);
  ok(await type('85526888888888888') === '855268', `${tag} 17 chiffres tapés : seuls 6 restent (855268)`);
  ok(await type('12ab34') === '1234', `${tag} les lettres sont refusées en mode application (1234)`);
  await input.fill('');
  const paste = (text) => p.evaluate((t) => { const i = document.querySelector('[data-code-input]'); i.focus(); const dt = new DataTransfer(); dt.setData('text', t); i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, text);
  await paste('123 456');
  ok(await input.inputValue() === '123456', `${tag} collage « 123 456 » (copié depuis l'application) : 123456`);
  await paste('9876543210 et du texte');
  ok(await input.inputValue() === '987654', `${tag} collage d'un long texte : 6 chiffres seulement (987654)`);
  await link.click();
  ok(await input.getAttribute('maxlength') === '11' && await input.getAttribute('data-mode') === 'secours', `${tag} bascule vers le code de secours (11)`);
  ok(await type('ab12c-d3e4f-zzzz999') === 'ab12c-d3e4f', `${tag} secours : 11 caractères au plus, chiffres et a-f seulement (ab12c-d3e4f)`);
  ok((await p.locator(`${scope} [data-code-label]`).textContent()).includes('secours'), `${tag} le libellé annonce le code de secours`);
  await link.click();
  ok(await input.getAttribute('maxlength') === '6' && (await input.inputValue()) === '', `${tag} retour au mode application : 6 caractères, champ vidé`);
}

for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
  const tag = `${vp.width}px`;
  const errs = [];
  // Page de connexion (session « en attente »)
  const sid = `chk-${vp.width}-${Date.now()}`;
  await s.db.prepare('INSERT INTO sessions(id, user_id, created_at, expires_at, mfa_pending) VALUES(?, ?, ?, ?, 1)').run(hashSid(sid), u.id, now(), now() + 600);
  const ctx1 = await b.newContext({ viewport: vp });
  await ctx1.addCookies([{ name: 'sid', value: sid, url: s.base }]);
  const p1 = await ctx1.newPage(); p1.on('pageerror', (e) => errs.push(e.message));
  await p1.goto(`${s.base}/login/2fa`);
  await exercise(p1, 'form.auth-f', `${tag} connexion :`);
  ok(!(await p1.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} connexion : pas de défilement horizontal`);
  await ctx1.close();
  // Carte de Mon compte
  const ctx2 = await b.newContext({ viewport: vp });
  const [name, value] = u.cookie.split('=');
  await ctx2.addCookies([{ name, value, url: s.base }]);
  const p2 = await ctx2.newPage(); p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto(`${s.base}/account`); await p2.waitForSelector('html[data-nav="ready"]');
  await exercise(p2, '#securite', `${tag} carte A2F :`);
  ok(errs.length === 0, `${tag} aucune erreur JavaScript ${errs.join(' | ')}`);
  await ctx2.close();
}
await b.close();
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
