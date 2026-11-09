// Rendu réel (Chromium) de l'image d'un post Instagram : un bon document devient un PNG de la taille exacte du format ; un produit rogné par le bord
// (élément qui dépasse le cadre) est ACCEPTÉ ; script, adresse externe, image sans texte ou unie sont refusés. Sortie « TOUT EST BON » attendue.
// Nécessite Playwright n'est pas requis : on pilote Chromium directement (CHROMIUM_BIN ou PLAYWRIGHT_CHROMIUM).
import { renderStill, stillSupported } from '../src/services/stillimage.js';
import { SceneError } from '../src/services/promovideo.js';

const cfg = { chromiumBin: process.env.CHROMIUM_BIN || process.env.PLAYWRIGHT_CHROMIUM, sandbox: { enabled: false } };
let failed = 0;
const ok = (cond, label) => { console.log(`${cond ? 'ok ' : 'KO '} ${label}`); if (!cond) failed++; };
if (!stillSupported(cfg).ok) { console.log('Chromium introuvable (CHROMIUM_BIN ou PLAYWRIGHT_CHROMIUM) : contrôle ignoré'); process.exit(0); }

const size = (png) => ({ w: png.readUInt32BE(16), h: png.readUInt32BE(20) });
const doc = (extra = '', body = '<h1>La fidélité sans carton</h1>') => `<!doctype html><html><head><style>
body{margin:0;width:1080px;height:1080px;overflow:hidden;background:linear-gradient(135deg,#0b3d48,#0f5c6c);font-family:system-ui,sans-serif;color:#f6f1e6}
h1{position:absolute;left:80px;top:200px;width:900px;font-size:96px;line-height:1.05;margin:0}${extra}</style></head><body>${body}</body></html>`;

for (const [name, w, h] of [['carré', 1080, 1080], ['portrait', 1080, 1350], ['story', 1080, 1920]]) {
  const png = await renderStill({ cfg, html: doc().replace('height:1080px', `height:${h}px`), width: w, height: h });
  ok(png.slice(0, 8).toString('hex') === '89504e470d0a1a0a' && size(png).w === w && size(png).h === h, `${name} : PNG de ${w} × ${h} pixels`);
}
// Le cas d'un produit rogné par le bord : un élément de 1160 px de large dans une image de 1080 px (message vu en production : « 1160 × 1080 pour 1080 × 1080 »)
const cropped = doc('.card{position:absolute;left:300px;bottom:-60px;width:860px;height:520px;border-radius:32px;background:#f6f1e6;box-shadow:0 30px 80px #0008}',
  '<h1>La fidélité sans carton</h1><div class="card"></div>');
try {
  const png = await renderStill({ cfg, html: cropped, width: 1080, height: 1080 });
  ok(size(png).w === 1080 && size(png).h === 1080, 'un élément qui dépasse le cadre (produit rogné par le bord) est accepté, la capture reste à la taille du format');
} catch (e) { ok(false, `un élément qui dépasse le cadre est accepté (refusé : ${e.message})`); }
for (const [name, html, re] of [
  ['script', doc().replace('<h1>', '<script>1</script><h1>'), /script/],
  ['adresse externe', doc().replace('<h1>', '<img src="https://exemple.fr/a.png"><h1>'), /http/],
  ['sans texte', doc('', '<div style="width:300px;height:300px;background:#fff"></div>'), /texte/],
  ['unie', '<!doctype html><html><body style="margin:0;width:1080px;height:1080px;background:#fff">petit</body></html>', /vide ou unie|texte/],
]) {
  try { await renderStill({ cfg, html, width: 1080, height: 1080 }); ok(false, `${name} : refusé`); }
  catch (e) { ok(e instanceof SceneError && re.test(e.message), `${name} : refusé avec un message pour l'IA`); }
}
console.log(failed ? `${failed} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(failed ? 1 : 0);
