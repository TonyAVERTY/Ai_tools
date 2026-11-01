// Lance la suite : les tests ordinaires en parallèle, puis ceux qui démarrent un vrai Chromium un fichier à la fois
// (plusieurs Chromium en même temps rendaient les tests de rendu vidéo instables).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = 'test';
const files = readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => join(dir, f)).sort();
const usesChromium = (f) => /chromiumBin|CHROMIUM_BIN/.test(readFileSync(f, 'utf8'));
const serial = files.filter(usesChromium);
const parallel = files.filter((f) => !serial.includes(f));

const run = (list, extra = []) => (list.length
  ? spawnSync(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', './scripts/test-setup.js', '--test', ...extra, ...list], { stdio: 'inherit' }).status
  : 0);

const first = run(parallel);
const second = run(serial, ['--test-concurrency=1']);
process.exit(first || second ? 1 : 0);
