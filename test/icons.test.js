// Icônes : chaque section dépliable du tableau de bord doit avoir une icône réellement définie (sinon la case reste vide).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SPRITE } from '../src/icons.js';

const views = readFileSync(new URL('../src/views.js', import.meta.url), 'utf8');

test('sections dépliables : chaque icône demandée existe dans la table SECTION_ICONS et dans le sprite', () => {
  const table = Object.fromEntries([...views.match(/const SECTION_ICONS = \{([^}]*)\}/)[1].matchAll(/(\w+): '(\w+)'/g)].map((m) => [m[1], m[2]]));
  const asked = [...views.matchAll(/\bacc\('(\w+)', '(\w+)'/g)].map((m) => m[2]);
  assert.ok(asked.length >= 10);
  for (const icon of new Set(asked)) {
    assert.ok(table[icon], `acc(..., '${icon}') : icône absente de SECTION_ICONS (case vide à l'écran)`);
    assert.match(SPRITE, new RegExp(`<symbol id="i-${table[icon]}"`), `symbole ${table[icon]} absent du sprite`);
  }
  assert.equal(table.computer, 'computer', 'l\'audit du projet a son icône d\'ordinateur');
});
