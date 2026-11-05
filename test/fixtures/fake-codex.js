#!/usr/bin/env node
// Faux `codex exec --json` : émet un flux au format décrit par la documentation de Codex (thread.started, turn.started, item.*,
// turn.completed / turn.failed, error). Le prompt (dernier argument) pilote le scénario ; FAKE_DUMP = fichier où noter ce que le CLI a reçu.
import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const argv = process.argv.slice(2);
const home = process.env.CODEX_HOME;
// `codex login --device-auth` : affiche un lien et un code, attend un peu (l'utilisateur valide sur le site), écrit auth.json et s'arrête
if (argv[0] === 'login') {
  const mode = process.env.FAKE_LOGIN || '';
  if (mode === 'NOLINK') process.exit(1);
  const url = mode === 'EVIL' ? 'https://evil.example/codex/device' : 'https://auth.openai.com/codex/device';
  process.stdout.write(`\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   ${url}\n\n2. Enter this one-time code (expires in 15 minutes)\n   ABCD-12345\n\n`);
  await new Promise((r) => setTimeout(r, Number(process.env.FAKE_LOGIN_MS || 300)));
  if (mode === 'DENIED') { process.stderr.write('Error: device code expired\n'); process.exit(1); }
  writeFileSync(join(home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: 'id.' + 'I'.repeat(30), access_token: 'acc.' + 'A'.repeat(30), refresh_token: 'ref.' + 'R'.repeat(30) }, last_refresh: '2026-11-04T10:00:00Z' }));
  process.stdout.write('Successfully logged in\n');
  process.exit(0);
}
const prompt = argv[argv.length - 1] || '';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
if (process.env.FAKE_DUMP) {
  let authSeen = null;
  try { authSeen = JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8')); } catch { /* pas de connexion de compte */ }
  appendFileSync(process.env.FAKE_DUMP, JSON.stringify({ argv, codexHome: home ?? null, auth: authSeen, at: Date.now(), key: process.env.CODEX_API_KEY ?? null, openai: process.env.OPENAI_API_KEY ?? null, anthropic: process.env.ANTHROPIC_API_KEY ?? null, gemini: process.env.GEMINI_API_KEY ?? null, home: process.env.HOME, cwd: process.cwd() }) + '\n');
}
// Sert à tester la file d'attente : début et fin de chaque exécution, avec le jeton de rafraîchissement vu
if (process.env.FAKE_LOG) { let rt = ''; try { rt = JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8')).tokens.refresh_token; } catch { /* clé API */ } appendFileSync(process.env.FAKE_LOG, `start ${rt} ${Date.now()}\n`); }
if (process.env.FAKE_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_DELAY_MS)));
// Comme le vrai Codex : le jeton de rafraîchissement est à usage unique, il est remplacé dans auth.json à chaque exécution (REFRESH)
if (home && existsSync(join(home, 'auth.json')) && prompt.includes('REFRESH')) {
  const a = JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8'));
  a.tokens.refresh_token = 'ref.NEW' + String(Date.now()).padStart(26, 'N');
  a.last_refresh = new Date().toISOString();
  writeFileSync(join(home, 'auth.json'), JSON.stringify(a));
}
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `end ${Date.now()}\n`);
out({ type: 'thread.started', thread_id: 'th-1' });
out({ type: 'turn.started' });
if (prompt.includes('CRASH')) process.exit(3);
if (prompt.includes('LEAK')) { process.stderr.write('echec avec ' + (process.env.CODEX_API_KEY || '') + ' fin'); process.exit(3); }
let refreshToken = '';
try { refreshToken = JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8')).tokens.refresh_token; } catch { /* clé API */ }
if (prompt.includes('EXFIL')) { process.stderr.write('echec avec ' + refreshToken + ' fin'); process.exit(3); }
if (prompt.includes('BADKEY') || (process.env.CODEX_API_KEY || '').includes('REVOKED') || refreshToken.includes('REVOKED')) {
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
