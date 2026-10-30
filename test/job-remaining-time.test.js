import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('  const remainingTime ='), app.indexOf('  const progressBar ='));
const remaining = vm.runInNewContext(source + '\nremainingTime');
const job = { status: 'running', startedAt: 100, progress: { pct: 50 } };
test('estimates from elapsed execution time and progress', () => {
 assert.equal(remaining(job, 220000), 'Temps restant estimé : environ 2 min');
 assert.equal(remaining({...job, progress: {pct: 75}}, 220000), 'Temps restant estimé : moins d’une minute');
 assert.equal(remaining({...job, progress: {pct: 50}}, 3700000), 'Temps restant estimé : environ 1 h');
});
test('does not estimate queued, scheduled or completed jobs', () => {
 for (const status of ['queued', 'done', 'error', 'cancelled']) assert.equal(remaining({...job, status}, 220000), '');
});
test('handles missing progress, invalid timestamps and startup without inventing a duration', () => {
 for (const changes of [{startedAt: null}, {startedAt: 300}, {progress: {}}, {progress: {pct: NaN}}, {progress: {pct: 0}}, {progress: {pct: '50'}}]) {
 assert.equal(remaining({...job, ...changes}, 220000), 'Temps restant : estimation en cours…');
 }
 assert.equal(remaining(job, 105000), 'Temps restant : estimation en cours…');
 assert.equal(remaining({...job, progress: {pct: 100}}, 220000), 'Finalisation en cours…');
});
