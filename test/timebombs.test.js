// Bombes à retardement : un test ou un contrôle qui crée un événement de calendrier avec une date écrite en dur casse dès que cette date est passée
// (« À venir » ne liste que ce qui n'est pas passé). La CI est tombée comme ça le 3 novembre (#91) puis le 4 novembre (scripts/ajax-check.mjs).
// Une date de test se calcule à partir d'aujourd'hui (`Date.now() + 5 jours`) ou d'une horloge de référence figée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const files = [...readdirSync(new URL('scripts/', ROOT)).filter((f) => f.endsWith('.mjs')).map((f) => `scripts/${f}`), ...readdirSync(new URL('test/', ROOT)).filter((f) => f.endsWith('.js')).map((f) => `test/${f}`)];

test('aucune date littérale dans la création d\'un événement de calendrier (scripts et tests)', () => {
  const offenders = [];
  for (const f of files) {
    readFileSync(new URL(f, ROOT), 'utf8').split('\n').forEach((line, i) => {
      if (/\/calendar\/events/.test(line) && /\bdate:\s*(['"])\d{4}-\d{2}-\d{2}\1/.test(line)) offenders.push(`${f}:${i + 1} ${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(offenders, [], 'calcule la date à partir d\'aujourd\'hui : new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)');
});
