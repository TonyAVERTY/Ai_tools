// La charte « Lin, Pétrole, Safran » vit dans public/tokens.css, et nulle part ailleurs : aucune couleur en dur dans app.css ni site.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('app.css et site.css : aucune couleur en dur, tout passe par les jetons de tokens.css', () => {
  for (const f of ['public/app.css', 'public/site.css', 'public/responsive.css']) {
    const code = noComments(read(f));
    const bad = [...code.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl|oklch)a?\([^)]*\)/g)].map((m) => m[0]);
    assert.deepEqual(bad, [], `${f} : couleur en dur (ajoute un jeton dans tokens.css) : ${bad.join(', ')}`);
  }
});

test('tokens.css : trois couleurs (Pétrole, Lin, Safran), polices locales, thème sombre, pas de violet', () => {
  const tk = read('public/tokens.css');
  for (const t of ['--pet-700', '--lin-100', '--saf-500', '--bg', '--card', '--text', '--primary', '--accent', '--ok', '--warn', '--err', '--scrim', '--doc-bg']) assert.match(tk, new RegExp(`${t}:`), t);
  assert.match(tk, /--saf-500:\s*#f2b632/i, 'le Safran de la charte');
  assert.match(tk, /prefers-color-scheme: dark/);
  assert.doesNotMatch(noComments(tk), /violet|purple/i);
  // Polices embarquées (CSP : rien d'externe) et fichiers présents
  const files = readdirSync(new URL('../public/fonts/', import.meta.url));
  for (const f of ['fraunces.woff2', 'instrument-sans.woff2', 'LICENSE-fraunces.txt', 'LICENSE-instrument-sans.txt']) assert.ok(files.includes(f), `public/fonts/${f}`);
  assert.doesNotMatch(tk, /https?:\/\//, 'aucune ressource externe');
  for (const m of tk.matchAll(/url\("(\/static\/fonts\/[^"]+)"\)/g)) assert.ok(files.includes(m[1].split('/').pop()), `${m[1]} existe`);
  assert.match(tk, /--display:\s*"Fraunces"/);
  assert.match(tk, /--font:\s*"Instrument Sans"/);
});
