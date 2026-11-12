// Génère cover-instagram.png (1080 × 1920) à partir de composition/cover.html.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
await p.goto(pathToFileURL(join(here, 'composition', 'cover.html')).href);
await p.evaluate(() => document.fonts.ready);
await Promise.all((await p.$$('img')).map((i) => i.evaluate((e) => e.decode())));
await p.screenshot({ path: join(here, 'cover-instagram.png') });
await b.close();
console.log('écrit cover-instagram.png');
