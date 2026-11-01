import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { installCrashGuards } from '../src/crashguard.js';

const silent = { error() {} };

test('promesse rejetée oubliée : journalisée et signalée, le processus continue', async () => {
  const proc = new EventEmitter();
  const reports = [];
  const exits = [];
  installCrashGuards({}, { proc, log: silent, exit: (c) => exits.push(c), report: async (app, err, where) => { reports.push([err.message, where]); } });
  proc.emit('unhandledRejection', new Error('oubliée'));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(reports, [['oubliée', { method: 'PROCESS', path: 'unhandledRejection' }]]);
  assert.deepEqual(exits, [], 'aucun arrêt');
});

test('exception non attrapée : signalée puis arrêt avec le code 1, une seule fois', async () => {
  const proc = new EventEmitter();
  const reports = [];
  const exits = [];
  installCrashGuards({}, { proc, log: silent, graceMs: 50, exit: (c) => exits.push(c), report: async (app, err) => { reports.push(err.message); } });
  proc.emit('uncaughtException', new Error('boum'));
  proc.emit('uncaughtException', new Error('boum 2'));
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(reports, ['boum']);
  assert.deepEqual(exits, [1]);
});

test('alerte qui ne répond pas : l\'arrêt a lieu quand même après le délai de grâce ; alerte qui plante : aucun effet', async () => {
  const proc = new EventEmitter();
  const exits = [];
  installCrashGuards({}, { proc, log: silent, graceMs: 40, exit: (c) => exits.push(c), report: () => new Promise(() => {}) });
  proc.emit('uncaughtException', new Error('muette'));
  await new Promise((r) => setTimeout(r, 120));
  assert.deepEqual(exits, [1]);
  const p2 = new EventEmitter();
  installCrashGuards({}, { proc: p2, log: silent, exit: () => {}, report: async () => { throw new Error('mail en panne'); } });
  p2.emit('unhandledRejection', new Error('x')); // ne doit lever aucune rejection supplémentaire
  await new Promise((r) => setImmediate(r));
});
