import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText, scanRepo, FORBIDDEN_FILES } from '../scripts/secret-scan.js';
import { isAllowed, readLicenses } from '../scripts/license-check.js';

// Les contrôles automatiques de la CI (secrets, licences) sont eux-mêmes testés : un contrôle qui ne détecte rien ne protège rien.

// Les fausses clés sont assemblées ici : ce fichier ne contient lui-même aucune chaîne qui ressemble à un secret
const live = ['sk', 'live', 'Zq8Lm3Rt7Vw1Xy5Bn2Kd'].join('_');
const anthropic = ['sk-ant', 'api03', 'Zq8Lm3Rt7Vw1Xy5Bn2KdPq9'].join('-');
const hook = `https://discord.com/api/webhooks/${'9'.repeat(18)}/${'Zq8Lm3Rt7Vw1Xy5Bn2KdPq9Hs4Jf6Gc'}`;
const pem = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ');

test('un secret qui a l\'air réel est détecté, avec son type mais sans sa valeur', () => {
  const found = scanText('src/x.js', [`const a = '${live}';`, `const b = '${anthropic}';`, `const h = '${hook}';`, pem, "const dsn = 'mysql://app:Zq8Lm3Rt7Vw@db/x';"].join('\n'));
  assert.deepEqual(found.map((f) => f.kind), ['clé Stripe', 'clé API Anthropic', 'webhook Discord', 'clé privée', 'URL de base avec mot de passe']);
  for (const f of found) assert.deepEqual(Object.keys(f).sort(), ['file', 'kind', 'line'], 'jamais la valeur trouvée');
});

test('les fausses valeurs évidentes (tests, documentation) et les motifs incomplets sont ignorés', () => {
  assert.deepEqual(scanText('t.js', "const WH = 'whsec_AbCdEfGhIjKlMnOpQrStUv12345'; const p = 'mysql://root:hunter2@db/x'; sk_live_… ; sk_live_"), []);
});

test('fichiers sensibles : .env, clés, bases et sauvegardes ne doivent jamais être suivis ; .env.example oui', () => {
  for (const f of ['.env', '.env.production', 'config/.env.local', 'id_rsa', 'cert/server.pem', 'a/b.key', 'data/app.sqlite', 'dump.sql', 'repo.bundle']) assert.ok(FORBIDDEN_FILES.test(f), f);
  for (const f of ['.env.example', 'src/env.js', 'docs/key-management.md', 'public/fonts/a.woff2']) assert.ok(!FORBIDDEN_FILES.test(f), f);
});

test('le dépôt actuel ne contient aucun secret ni fichier sensible suivi par Git', () => {
  assert.deepEqual(scanRepo(), []);
});

test('licences : seules celles compatibles avec un usage commercial fermé passent ; « A OR B » passe si l\'une est autorisée', () => {
  for (const l of ['MIT', 'ISC', 'Apache-2.0', 'MIT-0', 'BSD-3-Clause', '(MIT OR EUPL-1.1+)']) assert.ok(isAllowed(l), l);
  for (const l of ['GPL-3.0', 'AGPL-3.0-only', 'LGPL-2.1', 'SSPL-1.0', 'UNLICENSED', '', undefined, 'GPL-2.0 OR GPL-3.0']) assert.ok(!isAllowed(l), String(l));
});

test('toutes les dépendances de production ont une licence autorisée', () => {
  const all = readLicenses();
  assert.ok(all.length >= 40);
  assert.deepEqual(all.filter((p) => !isAllowed(p.license)).map((p) => `${p.name}: ${p.license}`), []);
});
