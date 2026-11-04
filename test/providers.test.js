import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProvider, listProviders, hasProvider, DEFAULT_PROVIDER } from '../src/services/providers/index.js';
import { SECRET_ENV_NAMES, buildChildEnv } from '../src/services/sandbox.js';
import { publicLink } from '../src/claudelink.js';

// Socle « plusieurs IA » : le registre, la forme commune d'un fournisseur, et la compatibilité avec les liaisons existantes.
const SHAPE = ['id', 'label', 'company', 'modes', 'bin', 'run', 'rateLimitWindows', 'isAuthRefusal'];

test('chaque fournisseur expose la forme commune', () => {
  assert.ok(listProviders().length >= 1);
  for (const p of listProviders()) {
    for (const k of SHAPE) assert.ok(p[k] !== undefined, `${p.id} : « ${k} » manque`);
    assert.ok(Object.keys(p.modes).length >= 1);
    for (const m of Object.values(p.modes)) assert.match(m.env, /^[A-Z][A-Z0-9_]+$/);
    assert.equal(typeof p.bin({ claudeBin: 'x' }) === 'string' || p.bin({}) === undefined, true);
  }
});

test('le secret de chaque mode est autorisé dans le processus enfant, et rien d\'autre', () => {
  for (const p of listProviders()) for (const m of Object.values(p.modes)) assert.ok(SECRET_ENV_NAMES.has(m.env), `${m.env} absent de la liste blanche`);
  assert.throws(() => buildChildEnv({}, { secretEnv: { SECRET_KEY: 'x'.repeat(20) }, home: '/h' }), /non autorisée/);
});

test('une liaison créée avant les autres IA est une liaison Claude', () => {
  assert.equal(DEFAULT_PROVIDER, 'claude');
  assert.equal(getProvider().id, 'claude');
  assert.equal(getProvider(null).id, 'claude');
  const old = publicLink({ mode: 'api_key', valid: true, last4: 'ab12' });
  assert.equal(old.provider, 'claude');
  assert.equal(old.providerLabel, 'Claude');
});

test('fournisseur inconnu : erreur franche, et la liaison compte comme absente', () => {
  assert.equal(hasProvider('nope'), false);
  assert.throws(() => getProvider('nope'), /inconnu/);
  assert.equal(publicLink({ provider: 'nope', mode: 'api_key', valid: true }), null);
});

test('la détection de refus d\'accès de Claude reste celle d\'avant', () => {
  const { isAuthRefusal } = getProvider('claude');
  assert.ok(isAuthRefusal('Invalid API key'));
  assert.ok(isAuthRefusal('OAuth token has expired'));
  assert.equal(isAuthRefusal('connect ETIMEDOUT'), false);
});
