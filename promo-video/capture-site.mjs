// Recapture les éléments réels du site MonEspacePro (rendu mobile, Chromium) dans assets/capture/.
//   git clone https://git.tony-averty.dev/Tony/MonEspacePro.git /tmp/mep
//   node promo-video/capture-site.mjs /tmp/mep
// La capture de l'app Pro (stats-app-crop.jpg) vient de docs/app-ios/captures/statistiques.jpg du même dépôt :
//   ffmpeg -i /tmp/mep/docs/app-ios/captures/statistiques.jpg -vf crop=1179:1730:0:0 promo-video/assets/capture/stats-app-crop.jpg
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const repo = process.argv[2];
if (!repo) { console.error('usage : node capture-site.mjs <dossier du dépôt MonEspacePro>'); process.exit(1); }
const site = join(repo, 'site');
const out = join(here, 'assets', 'capture');
mkdirSync(out, { recursive: true });

const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain', '.mp4': 'video/mp4' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  try { const b = await readFile(join(site, p)); res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 4 });
await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
// pas de bandeau cookies ni d'animation dans les captures ; la police Figtree vient du site
await page.addStyleTag({ content: '.cookie{display:none!important} .wk-f > div:first-child b{white-space:nowrap} *{animation:none!important;transition:none!important}' });
const shot = async (sel, nth, name) => { const l = page.locator(sel).nth(nth); await l.scrollIntoViewIfNeeded(); await l.screenshot({ path: join(out, name), omitBackground: true }); };

// éléments tels que le site les affiche
await shot('.scene .iph', 0, 'hero-phone.png');
await shot('.scene .poster', 0, 'poster.png');
await shot('.kraft', 0, 'kraft-0.png');
await shot('.art', 1, 'art-1.png');
await shot('.art', 2, 'art-2.png');
await shot('.iph', 1, 'iph-1.png');
await shot('.iph', 2, 'iph-2.png');
// la carte Wallet du site avec 6 à 10 tampons (même CSS, on change seulement les pastilles et le compteur)
const wk = page.locator('.scene .wk');
for (let n = 6; n <= 10; n++) {
  await wk.evaluate((el, n) => {
    el.querySelectorAll('.wk-d i').forEach((d, i) => d.classList.toggle('on', i < n));
    el.querySelector('.wk-f b').textContent = n + ' / 10';
  }, n);
  await wk.screenshot({ path: join(out, `wk-${n}.png`), omitBackground: true });
}
await browser.close();
server.close();
console.log('captures écrites dans', out);
