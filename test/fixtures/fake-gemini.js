#!/usr/bin/env node
// Faux `gemini -p … --output-format stream-json` : émet un flux au format décrit par la documentation de Gemini CLI
// (init, message, tool_use, tool_result, error, result). Le prompt pilote le scénario ; FAKE_DUMP = fichier où noter ce que le CLI a reçu.
import { appendFileSync, readFileSync } from 'node:fs';
const argv = process.argv.slice(2);
const prompt = argv[argv.indexOf('-p') + 1] || '';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const settingsPath = process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
if (process.env.FAKE_DUMP) {
  let settings = null;
  try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { /* absent */ }
  appendFileSync(process.env.FAKE_DUMP, JSON.stringify({ argv, settings, settingsPath, key: process.env.GEMINI_API_KEY ?? null, anthropic: process.env.ANTHROPIC_API_KEY ?? null, home: process.env.HOME, cwd: process.cwd() }) + '\n');
}
const model = argv[argv.indexOf('-m') + 1] || 'gemini-3.5-flash-lite';
out({ type: 'init', session_id: 'sess-1', model });
if (prompt.includes('CRASH')) process.exit(3);
if (prompt.includes('LEAK')) { process.stderr.write('echec avec ' + (process.env.GEMINI_API_KEY || '') + ' fin'); process.exit(3); }
if (prompt.includes('BADKEY') || (process.env.GEMINI_API_KEY || '').includes('REVOKED')) {
  out({ type: 'error', message: 'API key not valid. Please pass a valid API key.' });
  out({ type: 'result', status: 'error', stats: { input_tokens: 0, output_tokens: 0 } });
  process.exit(1);
}
if (prompt.includes('MAXTURNS')) {
  out({ type: 'message', role: 'assistant', content: 'Début de réponse' });
  out({ type: 'result', status: 'error', stats: { input_tokens: 500, output_tokens: 20 } });
  process.exit(53);
}
out({ type: 'message', role: 'user', content: prompt });
if (prompt.includes('TOOLS')) {
  out({ type: 'tool_use', tool_name: 'read_file', tool_id: 't1', parameters: { absolute_path: '/work/src/app.js' } });
  out({ type: 'tool_result', tool_id: 't1', status: 'success', output: 'code' });
  out({ type: 'tool_use', tool_name: 'grep_search', tool_id: 't2', parameters: { pattern: 'TODO' } });
  out({ type: 'tool_result', tool_id: 't2', status: 'success', output: '' });
}
// Chunks d'une réponse JSON (comme une analyse de projet) : le texte final est leur mise bout à bout
const text = prompt.includes('JSON') ? '{"resume":"Cartes de fidélité","cible":{"description":"commerces"}}' : 'Bonjour, voici la réponse.';
for (let i = 0; i < text.length; i += 12) out({ type: 'message', role: 'assistant', content: text.slice(i, i + 12) });
out({ type: 'result', status: 'success', stats: { input_tokens: 1000, output_tokens: 200, cached: 0 } });
