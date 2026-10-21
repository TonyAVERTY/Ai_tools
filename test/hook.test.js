import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('.gitignore exclut les fichiers sensibles', () => {
  const gi = readFileSync('.gitignore', 'utf8');
  for (const p of ['.env', 'data/', 'node_modules/', '*.sqlite']) assert.ok(gi.includes(p), p);
});
