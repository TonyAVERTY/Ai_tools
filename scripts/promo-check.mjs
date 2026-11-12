// Vérifie dans un vrai navigateur l'onglet Promotion : formulaire, limite d'images, production d'une vidéo (faux Claude, vrai rendu), lecture, suppression.
// Nécessite Playwright (PLAYWRIGHT_MODULE, PLAYWRIGHT_CHROMIUM) ; le même Chromium sert au rendu des vidéos. Sortie « TOUT EST BON » attendue.
import { spawnSync } from 'node:child_process';
import { startApp, APP_URL } from '../test/helpers/server.js';
import { renderPromo } from '../src/services/promovideo.js';
import { makeClaudeBin } from '../test/helpers/claude-bin.js';
import { addProject } from '../test/helpers/users.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const s = await startApp({ cfg: { chromiumBin: exe }, worker: true });
s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'fake-claude.js' });
// Les agents de contrôle de l'image ont leur propre vérification (promo-quality-check.mjs) : ici on contrôle l'interface, pas leur verdict
s.app.reviewPromo = async () => ({ reviews: [] });
// La scène factice du faux Claude est volontairement minimale : le contrôle de qualité du rendu (promo-quality-check.mjs) est coupé ici
s.app.renderPromo = (options) => renderPromo({ ...options, quality: 'off' });
// Extrait d'écoute : un vrai MP3 d'une seconde (le service de voix n'est jamais appelé)
const sample = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', 'mp3', '-'], { maxBuffer: 1 << 20 }).stdout;
s.app.sampleVoice = async () => sample;
s.app.localStatus = () => ({ piper: { ok: false, voices: [] }, espeak: { ok: true, voices: [{ id: 'fr', label: 'Français · voix masculine', lang: 'fr' }, { id: 'fr+f3', label: 'Français · voix féminine', lang: 'fr' }] } });
s.app.listVoices = async () => [{ id: 'abcDEF123', label: 'Bella · féminine', lang: 'fr' }, { id: 'zzz999', label: 'Adam · masculine', lang: 'fr' }];
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
  await ctx.route('**/*', async (route) => { const r = route.request(); if (r.method() !== 'POST') return route.continue(); /* Chromium ignore un Origin réécrit par continue() : on passe par fetch() */ await route.fulfill({ response: await route.fetch({ headers: { ...r.headers(), origin: APP_URL }, maxRedirects: 0 }) }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${s.base}/p/${pid}/communication`);
  await p.waitForSelector('[data-promo-form]', { timeout: 8000 });
  ok(await p.locator('[data-promo-form] input[name="fps"]').inputValue() === '30', `${tag} 30 images/s par défaut`);
  ok(await p.locator('[data-promo-form] input[name="seconds"]').inputValue() === '15', `${tag} 15 s par défaut`);
  ok((await p.locator('[data-promo-count]').textContent()).includes('450 images'), `${tag} nombre d'images affiché`);
  await p.fill('[data-promo-form] input[name="fps"]', '60'); await p.fill('[data-promo-form] input[name="seconds"]', '60');
  ok(await p.locator('[data-promo-go]').isDisabled() && /Trop d'images/.test(await p.locator('[data-promo-count]').textContent()), `${tag} trop d'images : bouton bloqué et message`);
  // Plateforme cible : une seule case à la fois, le préréglage remplit les champs, ils restent modifiables, la limite d'images reste contrôlée
  const plat = '[data-promo-form] input[data-promo-platform]';
  ok(await p.locator(plat).count() === 4 && await p.locator(`${plat}:checked`).count() === 0, `${tag} plateformes : quatre cases, aucune cochée au départ`);
  await p.fill('[data-promo-form] input[name="fps"]', '30'); await p.fill('[data-promo-form] input[name="seconds"]', '15');
  await p.check(`${plat}[value="tiktok"]`);
  ok(await p.locator('[data-promo-form] select[name="format"]').inputValue() === 'vertical' && await p.locator('[data-promo-form] input[name="seconds"]').inputValue() === '15' && await p.locator('[data-promo-form] input[name="fps"]').inputValue() === '30', `${tag} TikTok : vertical, 30 images/s, 15 s`);
  ok(/^TikTok : vertical.*30 images\/s, 15 s/.test(await p.locator('[data-promo-platform-hint]').textContent()), `${tag} plateforme : la phrase sous les cases donne le préréglage`);
  await p.check(`${plat}[value="linkedin"]`);
  ok(await p.locator(`${plat}:checked`).count() === 1 && await p.locator(`${plat}[value="tiktok"]`).isChecked() === false, `${tag} plateformes : une seule case à la fois`);
  ok(await p.locator('[data-promo-form] select[name="format"]').inputValue() === 'carre' && await p.locator('[data-promo-form] input[name="seconds"]').inputValue() === '20', `${tag} LinkedIn : carré, 20 s`);
  ok((await p.locator('[data-promo-count]').textContent()).includes('600 images'), `${tag} plateforme : le nombre d'images suit le préréglage`);
  await p.fill('[data-promo-form] input[name="seconds"]', '60');
  ok(await p.locator(`${plat}[value="linkedin"]`).isChecked() && await p.locator('[data-promo-go]').isDisabled() === false, `${tag} plateforme : champs modifiables, la case reste cochée`);
  await p.uncheck(`${plat}[value="linkedin"]`);
  ok(await p.locator('[data-promo-form] input[name="seconds"]').inputValue() === '60' && /Coche une plateforme/.test(await p.locator('[data-promo-platform-hint]').textContent()), `${tag} plateforme : décocher garde les champs et rend la phrase d'aide`);
  await p.fill('[data-promo-form] input[name="fps"]', '30'); await p.fill('[data-promo-form] input[name="seconds"]', '15');
  await p.selectOption('[data-promo-form] select[name="format"]', 'paysage');
  if (process.env.SHOTS) { await p.check(`${plat}[value="tiktok"]`); await p.locator('details[data-acc="promo"]').screenshot({ path: `${process.env.SHOTS}/promo-platform-${vp.width}.png` }); await p.uncheck(`${plat}[value="tiktok"]`); }
  // Voix : la case montre les choix ; changer de fournisseur change les voix ; l'extrait se joue depuis le serveur
  ok(await p.locator('[data-promo-voice]').isHidden(), `${tag} voix : choix masqués tant que la case n'est pas cochée`);
  await p.check('[data-promo-voice-toggle]');
  ok(await p.locator('[data-promo-voice]').isVisible(), `${tag} voix : choix affichés`);
  ok(await p.locator('select[name="voiceProvider"]').inputValue() === 'google' && await p.locator('select[name="voiceName"] option').count() === 6, `${tag} voix : Google Traduction par défaut (6 voix), sans clé à saisir`);
  ok(await p.locator('[data-promo-key]').isHidden() && await p.locator('[data-promo-lang]').isHidden(), `${tag} voix : ni clé ni langue à choisir pour ce fournisseur`);
  await p.selectOption('select[name="voiceName"]', 'fr');
  const sampled = p.waitForResponse((r) => r.url().includes('/api/promo/voice-sample'), { timeout: 8000 });
  await p.locator('[data-promo-sample]').click();
  ok((await sampled).status() === 200, `${tag} voix : extrait servi`);
  await p.waitForFunction(() => { const a = document.querySelector('[data-promo-audio]'); return a && (a.currentTime > 0 || a.ended || a.readyState >= 2 || a.error); }, null, { timeout: 5000 }).catch(() => {});
  ok(await p.locator('[data-promo-audio]').evaluate((a) => !a.error), `${tag} voix : l'élément audio lit l'extrait sans erreur (CSP comprise)`);
  // Voix locales : Piper non installé (message pour l'administrateur, pas d'extrait), eSpeak NG disponible
  await p.selectOption('select[name="voiceProvider"]', 'piper');
  ok(/administrateur/.test(await p.locator('[data-promo-local]').textContent()) && await p.locator('[data-promo-local]').isVisible() && await p.locator('[data-promo-sample]').isDisabled(), `${tag} Piper non installé : message et pas d'extrait`);
  ok(await p.locator('[data-promo-key]').isHidden(), `${tag} voix locale : aucune clé demandée`);
  await p.selectOption('select[name="voiceProvider"]', 'espeak');
  ok(await p.locator('[data-promo-local]').isHidden() && await p.locator('select[name="voiceName"] option').count() === 2 && await p.locator('[data-promo-sample]').isEnabled(), `${tag} eSpeak NG disponible : 2 voix, extrait possible`);
  // Fournisseur à clé : panneau de clé, enregistrement, voix de l'API, langue
  await p.selectOption('select[name="voiceProvider"]', 'elevenlabs');
  ok(await p.locator('[data-promo-key]').isVisible() && await p.locator('[data-promo-key-new]').isVisible() && await p.locator('[data-promo-key-set]').isHidden(), `${tag} clé : champ affiché tant qu'aucune clé n'est enregistrée`);
  ok(await p.locator('[data-promo-lang]').isVisible(), `${tag} clé : choix de la langue (voix multilingue)`);
  ok(await p.locator('[data-promo-sample]').isDisabled(), `${tag} clé : pas d'extrait sans voix`);
  ok(await p.locator('input[name="voiceRegion"]').isHidden(), `${tag} clé : pas de région pour ElevenLabs`);
  await p.fill('input[name="voiceKey"]', 'sk_test_1234567890abcdefghij');
  await p.locator('input[name="voiceKey"]').press('Enter');
  await p.waitForFunction(() => document.querySelectorAll('select[name="voiceName"] option').length === 2, null, { timeout: 5000 });
  ok(/se termine par ghij/.test(await p.locator('[data-promo-key-last4]').textContent()) && await p.locator('[data-promo-key-new]').isHidden(), `${tag} clé : enregistrée, seuls les 4 derniers caractères s'affichent`);
  ok(await p.locator('input[name="voiceKey"]').inputValue() === '', `${tag} clé : champ vidé après l'enregistrement`);
  ok(!(await p.content()).includes('sk_test_1234567890abcdefghij'), `${tag} clé : jamais réaffichée dans la page`);
  ok(await p.locator('[data-promo-form]').count() === 1 && await p.locator('.pv').count() === 0, `${tag} clé : Entrée n'a pas lancé la vidéo`);
  if (process.env.SHOTS) await p.locator('details[data-acc="promo"]').screenshot({ path: `${process.env.SHOTS}/promo-key-${vp.width}.png` });
  await p.locator('[data-promo-key-remove]').click();
  await p.locator('dialog.confirm [data-yes]').click();
  await p.waitForFunction(() => !document.querySelector('[data-promo-key-new]').hidden, null, { timeout: 5000 });
  ok(true, `${tag} clé : retirée`);
  await p.selectOption('select[name="voiceProvider"]', 'azure');
  ok(await p.locator('input[name="voiceRegion"]').isVisible() && await p.locator('[data-promo-lang]').isHidden(), `${tag} Azure : champ région affiché, pas de choix de langue (la voix la porte)`);
  await p.selectOption('select[name="voiceProvider"]', 'google');
  if (process.env.SHOTS) await p.locator('details[data-acc="promo"]').screenshot({ path: `${process.env.SHOTS}/promo-voice-${vp.width}.png` });
  await p.uncheck('[data-promo-voice-toggle]');
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
  await p.locator('[data-pv-delete]').click();
  await p.locator('dialog.confirm [data-yes]').click();
  await p.waitForFunction(() => !document.querySelector('.pv'), null, { timeout: 8000 });
  ok(true, `${tag} suppression`);
  ok(errs.length === 0, `${tag} aucune erreur console ${errs.join(' | ')}`);
  await ctx.close();
  if (vp.width === 1280) await s.db.prepare('DELETE FROM jobs').run();
}
await b.close(); await s.close();
console.log(bad ? `\n${bad} PROBLÈME(S)` : '\nTOUT EST BON');
process.exit(bad ? 1 : 0);
