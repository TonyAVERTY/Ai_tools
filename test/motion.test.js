// Animations (docs/UX.md, « Animations ») : une animation qui tourne en boucle n'anime que `transform` et `opacity`, jamais `left`, `width`, `height` ni `box-shadow`.
// Ces deux propriétés se calculent sur le processeur graphique ; les autres obligent le navigateur à refaire la mise en page ou à repeindre à chaque image,
// pendant toute la durée d'une tâche (mesuré : 181 mises en page en 3 s avec `left` / `width`, aucune avec `transform`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../public/', import.meta.url);
const css = readdirSync(ROOT).filter((f) => f.endsWith('.css')).map((f) => [f, readFileSync(new URL(f, ROOT), 'utf8')]);

/** Corps du `@keyframes name { … }` (accolades équilibrées) ou null. */
function keyframes(text, name) {
  const at = text.search(new RegExp(`@keyframes\\s+${name}\\s*\\{`));
  if (at < 0) return null;
  let i = text.indexOf('{', at); const start = i; let depth = 0;
  for (; i < text.length; i++) { if (text[i] === '{') depth++; else if (text[i] === '}' && --depth === 0) break; }
  return text.slice(start + 1, i);
}

test('toute animation CSS en boucle (infinite) n\'anime que transform et opacity', () => {
  const all = css.map(([, t]) => t).join('\n');
  const names = new Set();
  for (const m of all.matchAll(/animation\s*:([^;}]*\binfinite\b[^;}]*)[;}]/g)) {
    for (const tok of m[1].split(/\s+/)) if (/^[a-z][\w-]*$/.test(tok) && keyframes(all, tok)) names.add(tok);
  }
  assert.ok(names.size >= 5, `les animations en boucle connues sont trouvées (${[...names].join(', ')})`);
  for (const must of ['indet', 'nav-run', 'ring-pulse', 'spin', 'chat-dot']) assert.ok(names.has(must), `${must} est une animation en boucle`);
  const offenders = [];
  for (const name of names) {
    const props = new Set([...keyframes(all, name).matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]));
    for (const p of props) if (!['transform', 'opacity'].includes(p)) offenders.push(`${name} anime « ${p} »`);
  }
  assert.deepEqual(offenders, [], 'une animation en boucle ne doit animer que transform et opacity (docs/UX.md, « Animations »)');
});
