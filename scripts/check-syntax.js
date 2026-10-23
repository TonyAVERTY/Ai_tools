// Vérif syntaxe de tous les .js (zéro dépendance, rapide sur le Pi)
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const roots = ['src', 'scripts', 'test', 'public', 'mcp'];
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
};
for (const r of roots) { try { walk(r); } catch { /* dossier absent */ } }

let failed = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { failed++; console.error(`✗ ${f}\n${e.stderr}`); }
}
// Scripts shell : syntaxe bash, + shellcheck s'il est installé
const shells = ['install.sh', 'deploy/aitools-backup.sh', '.githooks/pre-commit'];
let hasShellcheck = true;
try { execFileSync('shellcheck', ['--version'], { stdio: 'pipe' }); } catch { hasShellcheck = false; }
for (const f of shells) {
  try {
    execFileSync('bash', ['-n', f], { stdio: 'pipe' });
    if (hasShellcheck) execFileSync('shellcheck', ['-S', 'warning', '-x', f], { stdio: 'pipe' });
  } catch (e) { failed++; console.error(`✗ ${f}\n${e.stdout || ''}${e.stderr || ''}`); }
}

const total = files.length + shells.length;
console.log(`${total - failed}/${total} fichiers OK${hasShellcheck ? '' : ' (shellcheck absent, syntaxe bash seulement)'}`);
process.exit(failed ? 1 : 0);
