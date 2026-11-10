// Rend la composition image par image dans Chromium, puis encode avec FFmpeg.
//   node promo-video/render.mjs                    -> instagram-reels.mp4 + tiktok.mp4 (avec son si out/audio.wav existe)
//   node promo-video/render.mjs --only ig          -> une seule version
//   node promo-video/render.mjs --stills 0.1,3,9   -> planche d'images (PNG) pour contrôle, sans encodage
// Prérequis : Node 22, FFmpeg, Playwright (variable PLAYWRIGHT_MODULE si le module n'est pas résolvable).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : null; };
const FPS = 30;
const VERSIONS = { ig: 'instagram-reels.mp4', tt: 'tiktok.mp4' };
const only = arg('only');
const stills = arg('stills');
const audio = join(here, 'out', 'audio.wav');
mkdirSync(join(here, 'out'), { recursive: true });

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});

for (const [p, file] of Object.entries(VERSIONS)) {
  if (only && only !== p) continue;
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const guides = process.argv.includes('--guides') ? '&guides=1' : '';
  await page.goto(pathToFileURL(join(here, 'composition', 'index.html')).href + `?p=${p}${guides}`);
  await page.waitForFunction('window.READY === true');
  const duration = await page.evaluate('window.DURATION');

  if (stills) {
    for (const t of stills.split(',').map(Number)) {
      await page.evaluate((x) => window.render(x), t);
      await page.screenshot({ path: join(here, 'out', `still-${p}-${String(t).replace('.', '_')}.png`) });
    }
    await page.close();
    continue;
  }

  const frames = Math.round(duration * FPS);
  const outFile = join(here, file);
  const hasAudio = existsSync(audio);
  const args = ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-'];
  if (hasAudio) args.push('-i', audio);
  args.push('-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-crf', '16', '-preset', 'slow', '-movflags', '+faststart');
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', String(duration));
  args.push(outFile);
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => { ff.on('exit', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c)))); });
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => window.render(t), i / FPS);
    const buf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
  await page.close();
  console.log('écrit', outFile, hasAudio ? '(avec son)' : '(sans son)');
}
await browser.close();
