#!/usr/bin/env node
// Faux `codex exec --json` : émet un flux au format décrit par la documentation de Codex (thread.started, turn.started, item.*,
// turn.completed / turn.failed, error). Le prompt (dernier argument) pilote le scénario ; FAKE_DUMP = fichier où noter ce que le CLI a reçu.
import { appendFileSync } from 'node:fs';
const argv = process.argv.slice(2);
const prompt = argv[argv.length - 1] || '';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
if (process.env.FAKE_DUMP) {
  appendFileSync(process.env.FAKE_DUMP, JSON.stringify({ argv, key: process.env.CODEX_API_KEY ?? null, openai: process.env.OPENAI_API_KEY ?? null, anthropic: process.env.ANTHROPIC_API_KEY ?? null, gemini: process.env.GEMINI_API_KEY ?? null, home: process.env.HOME, cwd: process.cwd() }) + '\n');
}
out({ type: 'thread.started', thread_id: 'th-1' });
out({ type: 'turn.started' });
if (prompt.includes('CRASH')) process.exit(3);
if (prompt.includes('LEAK')) { process.stderr.write('echec avec ' + (process.env.CODEX_API_KEY || '') + ' fin'); process.exit(3); }
if (prompt.includes('BADKEY') || (process.env.CODEX_API_KEY || '').includes('REVOKED')) {
  out({ type: 'error', message: 'Incorrect API key provided: sk-***. invalid_api_key' });
  out({ type: 'turn.failed', error: { message: 'Incorrect API key provided: sk-***. invalid_api_key' } });
  process.exit(1);
}
const action = (i, type, extra = {}) => { out({ type: 'item.started', item: { id: `item_${i}`, type, status: 'in_progress', ...extra } }); out({ type: 'item.completed', item: { id: `item_${i}`, type, status: 'completed', ...extra } }); };
if (prompt.includes('ACTIONS')) {
  out({ type: 'item.started', item: { id: 'item_0', type: 'reasoning' } });
  action(1, 'command_execution', { command: 'bash -lc ls' });
  action(2, 'web_search', { query: 'boulangeries rennes' });
  action(3, 'command_execution', { command: 'bash -lc "cat src/app.js"' });
}
if (prompt.includes('TOOMANY')) for (let i = 1; i <= 50; i++) { action(i, 'command_execution', { command: 'bash -lc ls' }); await new Promise((r) => setTimeout(r, 20)); }
out({ type: 'item.completed', item: { id: 'item_m', type: 'agent_message', text: 'Je regarde.' } });
const text = prompt.includes('JSON') ? '{"resume":"Cartes de fidélité","cible":{"description":"commerces"}}' : 'Bonjour, voici la réponse.';
out({ type: 'item.completed', item: { id: 'item_f', type: 'agent_message', text } });
out({ type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 200, reasoning_output_tokens: 0 } });
