// Ressources de l'identité d'un projet qui ne sont pas dans son dépôt : une police chez Google Fonts, un logo SVG converti en PNG.
// Les deux sont facultatifs : sans eux, le document garde la police standard ou n'a pas de logo.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findChromium } from './promovideo.js';
import { MAX_FONT_BYTES } from './pdffont.js';

const CSS_URL = 'https://fonts.googleapis.com/css2';
const FONT_HOST = 'fonts.gstatic.com';

/** Police TrueType d'une famille Google Fonts (poids 100 à 900), ou null. Hôtes fixes, taille et durée bornées. */
export async function fetchGoogleFont(family, weight = 400, { fetchImpl = fetch } = {}) {
  const fam = String(family || '').trim();
  if (!/^[A-Za-z0-9 ]{2,40}$/.test(fam)) return null;
  const w = [100, 200, 300, 400, 500, 600, 700, 800, 900].includes(Number(weight)) ? Number(weight) : 400;
  const get = (url, opts = {}) => fetchImpl(url, { ...opts, signal: AbortSignal.timeout(8000), redirect: 'error' });
  // Un navigateur ancien reçoit des fichiers .ttf (les récents reçoivent du WOFF2, que le générateur de PDF ne lit pas)
  const css = await get(`${CSS_URL}?family=${fam.replace(/ /g, '+')}:wght@${w}`, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/49.0 Safari/537.36' } });
  if (!css.ok) return null;
  const m = /url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+\.ttf)\)/.exec(await css.text());
  if (!m || new URL(m[1]).hostname !== FONT_HOST) return null;
  const file = await get(m[1]);
  if (!file.ok) return null;
  const buf = Buffer.from(await file.arrayBuffer());
  return buf.length && buf.length <= MAX_FONT_BYTES ? buf : null;
}

/** Logo SVG → PNG (fond transparent) avec Chromium en ligne de commande ; lève une erreur si Chromium manque ou échoue. */
export async function rasterSvg(svg, cfg = {}, { size = 480 } = {}) {
  const bin = findChromium(cfg);
  if (!bin) throw new Error('Chromium absent');
  const dir = mkdtempSync(join(tmpdir(), 'aitools-logo-'));
  try {
    const html = join(dir, 'logo.html'), out = join(dir, 'logo.png');
    const clean = String(svg).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '');
    writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg,img{display:block}</style><img id="l" src="data:image/svg+xml;base64,${Buffer.from(clean).toString('base64')}" style="max-width:${size}px;max-height:${size}px;width:auto;height:auto">`);
    await new Promise((resolveRun, reject) => {
      const child = spawn(bin, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--default-background-color=00000000', `--window-size=${size},${size}`, `--screenshot=${out}`, `file://${html}`], { stdio: 'ignore' });
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Chromium trop long')); }, 20_000);
      child.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`Chromium a échoué (${code})`)); });
      child.on('error', reject);
    });
    return readFileSync(out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
