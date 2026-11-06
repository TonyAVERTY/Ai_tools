#!/usr/bin/env node
// Faux `agy -p … --output-format stream-json` : émet un flux au format observé sur un vrai agy 1.5.2 (6 novembre 2026) : init, step_update
// (user_input, tool, agent_response), result. Le prompt (valeur de `-p`) pilote le scénario ; FAKE_DUMP = fichier où noter ce que le CLI a reçu.
// Comme le vrai agy : sans fichier de connexion dans son dossier maison (HOME), il affiche « Authentication required … » et attend un code.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const prompt = arg('-p') ?? '';
const settings = (() => { try { return JSON.parse(arg('--settings') || '{}'); } catch { return {}; } })();
const deny = settings.permissions?.deny ?? [];
const home = process.env.HOME;
const tokenPath = join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token');
const token = existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8') : null;
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

if (process.env.FAKE_DUMP) {
  appendFileSync(process.env.FAKE_DUMP, JSON.stringify({ argv, home, token, cwd: process.cwd(), deny, at: Date.now(), env: Object.keys(process.env) }) + '\n');
}
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `start ${Date.now()} ${token ?? ''}\n`);
if (process.env.FAKE_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_DELAY_MS)));
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `end ${Date.now()}\n`);

// Pas de connexion, ou connexion révoquée : comme le vrai agy, un lien et l'attente d'un code
if (!token || token.includes('EXPIRED')) {
  process.stdout.write('Authentication required. Please visit the URL to log in:\n  https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=x\n\nWaiting for authentication (timeout 60s)...\n');
  await new Promise((r) => setTimeout(r, 30_000));
  process.exit(1);
}
// Comme le vrai agy : le fichier peut être renouvelé pendant l'exécution
if (prompt.includes('REFRESH')) writeFileSync(tokenPath, token.replace(/"refresh_token":"[^"]*"/, `"refresh_token":"NEW${'N'.repeat(30)}"`));
if (prompt.includes('CRASH')) process.exit(3);
if (prompt.includes('LEAK')) { process.stderr.write(`echec avec ${token} fin`); process.exit(3); }

const cid = 'conv-1';
out({ event: 'init', conversation_id: cid, init: { cwd: process.cwd(), tools: ['view_file', 'write_to_file', 'run_command', 'finish'], permission_mode: 'request-review' } });
out({ event: 'step_update', step_update: { conversation_id: cid, step_index: 0, state: 'DONE', step_type: 'user_input' } });
let n = 1;
const tool = (name, input) => {
  out({ event: 'step_update', step_update: { conversation_id: cid, step_index: n, state: 'ACTIVE', step_type: 'tool', tool_name: name, tool_input: input } });
  out({ event: 'step_update', step_update: { conversation_id: cid, step_index: n, state: 'DONE', step_type: 'tool' } });
  n += 1;
};
if (prompt.includes('ACTIONS')) { tool('view_file', { AbsolutePath: '/repo/src/app.js' }); tool('grep_search', { Query: 'boulangerie' }); tool('search_web', { query: 'boulangeries rennes' }); }
if (prompt.includes('TOOMANY')) for (let i = 0; i < 50; i++) { tool('view_file', {}); await new Promise((r) => setTimeout(r, 20)); }
// Ecriture demandée : refusée si les règles « deny » ont été transmises, sinon le faux agy écrit (c'est ce que les tests veulent voir impossible)
let said = prompt.includes('JSON') ? '{"resume":"Cartes de fidélité","cible":{"description":"commerces"}}' : 'Bonjour ! Comment puis-je vous aider aujourd\'hui ?\n';
if (prompt.includes('WRITEFILE')) {
  if (deny.some((r) => r.startsWith('write_to_file'))) { tool('write_to_file', { path: 'a.txt' }); said = 'La création du fichier a échoué : Permission denied: Matches user-configured deny rule'; }
  else { writeFileSync('a.txt', 'ok'); tool('write_to_file', { path: 'a.txt' }); said = 'Fichier créé'; }
}
const usage = { input_tokens: 6873, output_tokens: 111, thinking_tokens: 99, cache_read_tokens: 0, total_tokens: 7083 };
out({ event: 'step_update', step_update: { conversation_id: cid, step_index: n, state: 'DONE', step_type: 'agent_response', text_delta: said, duration_seconds: 2.4, usage } });
const status = prompt.includes('BADSTATUS') ? 'ERROR' : 'SUCCESS';
out({ event: 'result', result: { conversation_id: cid, status, response: said, duration_seconds: 2.5, num_turns: 1, usage } });
process.exit(status === 'SUCCESS' ? 0 : 1);
