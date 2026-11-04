import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('  const remainingTime ='), app.indexOf('  const progressBar ='));
const remaining = vm.runInNewContext(source + '\nremainingTime');
const job = { status: 'running', startedAt: 100, progress: { pct: 50 }, eta:{remainingSeconds:120,estimatedAt:220,source:'history'} };
test('compte à rebours en secondes, indépendant du pourcentage animé', () => {
 assert.equal(remaining(job, 220000), 'Temps restant estimé : 2 min 00 s');
 assert.equal(remaining({...job, progress: {pct: 75}}, 250000), 'Temps restant estimé : 1 min 30 s');
 assert.equal(remaining(job, 280000), 'Temps restant estimé : 1 min 00 s');
});
test('does not estimate queued, scheduled or completed jobs', () => {
 for (const status of ['queued', 'done', 'error', 'cancelled']) assert.equal(remaining({...job, status}, 220000), '');
});
test('origine et réajustement explicites, jamais zéro avant la fin', () => {
 assert.equal(remaining({...job,eta:null},220000), 'Temps restant : estimation en cours…');
 assert.match(remaining({...job,eta:{...job.eta,source:'initial'}},220000),/estimation initiale/);
 assert.match(remaining({...job,eta:{...job.eta,revised:true}},220000),/réajusté/);
 assert.equal(remaining(job,999000), 'Temps restant estimé : 1 s');
});
