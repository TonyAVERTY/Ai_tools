#!/usr/bin/env node
// Enregistre le modèle demandé (variable MODEL_SPY_FILE), puis délègue à fake-claude.js.
// Sert uniquement à vérifier quel modèle handlers.js choisit réellement.
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const model = process.argv[process.argv.indexOf('--model') + 1] || '';
if (process.env.MODEL_SPY_FILE) appendFileSync(process.env.MODEL_SPY_FILE, model + '\n');

const fakeClaude = resolve(dirname(fileURLToPath(import.meta.url)), 'fake-claude.js');
const out = execFileSync(process.execPath, [fakeClaude, ...process.argv.slice(2)]);
process.stdout.write(out);
