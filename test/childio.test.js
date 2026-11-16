import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLines, tailText, guardChild, delayLabel } from '../src/services/providers/childio.js';
import { runClaude } from '../src/services/claude.js';
import { retryReason } from '../src/services/autoretry.js';

// Lecture du flux des CLI d'IA et arrêt du processus : les défauts corrigés ici abîmaient les accents des réponses longues
// et laissaient tourner un job annulé juste avant son lancement.

test('readLines : un caractère accentué coupé entre deux morceaux du tube reste intact', () => {
  const s = new PassThrough();
  const lines = [];
  const flush = readLines(s, (l) => lines.push(l));
  const bytes = Buffer.from('{"t":"déjà prêt 🚀"}\nfin sans retour', 'utf8');
  // Octet par octet : chaque caractère multi-octets est coupé
  for (const b of bytes) s.emit('data', Buffer.from([b]));
  flush();
  assert.deepEqual(lines, ['{"t":"déjà prêt 🚀"}', 'fin sans retour']);
  assert.ok(!lines.join('').includes('�'), 'aucun caractère de remplacement');
});

test('tailText : garde la fin du flux, bornée, sans abîmer les accents', () => {
  const s = new PassThrough();
  const tail = tailText(s, 10);
  const bytes = Buffer.from('erreur : clé refusée', 'utf8');
  s.emit('data', bytes.subarray(0, 11)); // coupe « é » de « clé »
  s.emit('data', bytes.subarray(11));
  assert.equal(tail(), 'lé refusée');
});

test('guardChild : délai dépassé, puis SIGKILL si le processus ignore SIGTERM', async () => {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); console.log('pret')"], { stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise((r) => child.stdout.once('data', r)); // le gestionnaire SIGTERM est installé
  const guard = guardChild(child, { timeoutMs: 50, graceMs: 100 });
  const signal = await new Promise((r) => child.on('close', (_code, sig) => r(sig)));
  guard.clear();
  assert.equal(signal, 'SIGKILL');
  assert.equal(guard.timedOut(), true);
});

test('guardChild : un signal déjà annulé arrête le processus tout de suite, et clear() retire l\'écouteur', async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const guard = guardChild(child, { timeoutMs: 60_000, signal: ctrl.signal });
  const signal = await new Promise((r) => child.on('close', (_code, sig) => r(sig)));
  guard.clear();
  assert.equal(signal, 'SIGTERM');
  assert.equal(guard.timedOut(), false);
});

test('relance automatique : un délai dépassé et une erreur de quota remontée par une tâche sont bien reconnus', () => {
  assert.equal(retryReason("Claude n'a pas répondu dans le délai de 30 minutes : la tâche a été arrêtée. Réessaie"), 'unfinished');
  assert.equal(retryReason('Modèle de mail non rédigé : Claude a répondu par une erreur (Claude usage limit reached)'), 'quota');
  assert.equal(retryReason('Audit interrompu : Claude a répondu par une erreur (Invalid API key)'), null, 'un accès refusé ne se relance pas');
});

test('delayLabel : minutes au-delà de deux minutes, secondes en dessous', () => {
  assert.equal(delayLabel(5 * 60_000), '5 minutes');
  assert.equal(delayLabel(90_000), '90 secondes');
});

const fakeCli = (dir, body) => {
  const file = join(dir, 'cli.js');
  writeFileSync(file, `#!${process.execPath}\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
};
const sandbox = { enabled: false, production: false };

test('runClaude : une réponse dont un accent tombe à cheval sur deux écritures arrive intacte', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aitools-io-'));
  try {
    const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Réponse rédigée à l\'été', usage: {} });
    const cut = Buffer.from(line, 'utf8').indexOf(0xc3) + 1; // au milieu du premier « é »
    const bin = fakeCli(dir, `const b = Buffer.from(${JSON.stringify(line)} + '\\n', 'utf8');
process.stdout.write(b.subarray(0, ${cut}), () => setTimeout(() => process.stdout.write(b.subarray(${cut})), 80));`);
    const r = await runClaude({ bin, prompt: 'x', sandbox });
    assert.equal(r.text, 'Réponse rédigée à l\'été');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('runClaude : délai dépassé = erreur qui le dit (plus « arrêté sans résultat (code null) »)', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aitools-io-'));
  try {
    const bin = fakeCli(dir, 'setInterval(() => {}, 1000);');
    await assert.rejects(runClaude({ bin, prompt: 'x', sandbox, timeoutMs: 300 }), /n'a pas répondu dans le délai de \d+ secondes/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('runClaude : annulé avant le lancement, le CLI est arrêté au lieu de tourner jusqu\'au bout', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aitools-io-'));
  try {
    const bin = fakeCli(dir, 'setInterval(() => {}, 1000);');
    const ctrl = new AbortController();
    ctrl.abort();
    const t0 = Date.now();
    await assert.rejects(runClaude({ bin, prompt: 'x', sandbox, signal: ctrl.signal, timeoutMs: 20_000 }), /sans résultat/);
    assert.ok(Date.now() - t0 < 5000, 'arrêt immédiat');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
