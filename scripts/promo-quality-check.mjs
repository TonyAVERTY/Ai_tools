// Vérifie avec un vrai Chromium le contrôle de qualité des vidéos de promotion : la scène de référence (3 formats) passe ; une scène comme celle d'une
// vidéo ratée (fond blanc, petits éléments collés en haut, rien qui bouge) est refusée avec les bons motifs.
// Usage : CHROMIUM_BIN=... node scripts/promo-quality-check.mjs [scene.html]   Sortie « TOUT EST BON » attendue.
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderPromo, SceneError, FORMATS } from '../src/services/promovideo.js';
import { PROMO_EXAMPLE } from '../src/services/promokit.js';

const tmp = mkdtempSync(join(tmpdir(), 'promo-q-'));
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const cfg = { sandbox: { enabled: false } };
const run = async (html, fmt, quality = 'strict') => {
  const f = FORMATS[fmt];
  try { return await renderPromo({ cfg, html, fps: 10, seconds: 25, width: f.width, height: f.height, out: join(tmp, `${fmt}.mp4`), quality }); }
  catch (e) { if (e instanceof SceneError) return { error: e.message }; throw e; }
};
try {
  for (const fmt of ['vertical', 'paysage', 'carre']) {
    // La scène de référence est refusée telle quelle (textes d'exemple) : on y met un vrai contenu, comme le fait Claude
    const reel = PROMO_EXAMPLE.replaceAll('EXEMPLE · remplace', 'GESTION DE PROJET').replaceAll('adresse-du-site.fr', 'iaboss.fr').replaceAll('Premier bénéfice concret', 'Prospects trouvés pour toi').replaceAll('Deuxième bénéfice concret', 'Mails prêts à envoyer').replaceAll('Troisième bénéfice concret', 'Suivi de chaque réponse').replaceAll('La promesse, en une ligne', 'Ton activité, sur pilote automatique').replaceAll('Le problème, dit avec les mots du public', 'Trop de temps perdu à prospecter ?').replaceAll('ce que c’est, en une phrase', 'Un assistant qui prospecte pour toi');
    const r = await run(reel, fmt);
    ok(!r.error, `scène de référence (${fmt}) acceptée${r.error ? ` : ${r.error}` : ` — ${r.notes?.[0] ?? ''}`}`);
  }
  const badHtml = readFileSync(process.argv[2] || new URL('../test/fixtures/promo-scene-ratee.html', import.meta.url), 'utf8');
  const r = await run(badHtml, 'vertical');
  ok(!!r.error, 'scène ratée refusée');
  for (const [re, what] of [[/Trop de vide/, 'trop de vide'], [/Titres trop petits/, 'titres trop petits'], [/collé en haut/, 'collé en haut'], [/Fond blanc uni/, 'fond blanc'], [/figée/, 'image figée']]) {
    ok(re.test(r.error || ''), `scène ratée : « ${what} » signalé`);
  }
  const w = await run(badHtml, 'vertical', 'warn');
  ok(!w.error && w.notes.some((n) => /À améliorer/.test(n)), 'en mode « warn » : rendue quand même, avec les constats gardés');
} finally { rmSync(tmp, { recursive: true, force: true }); }
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
