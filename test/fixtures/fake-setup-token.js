#!/usr/bin/env node
// Faux `claude setup-token` : affiche un lien cliquable (OSC 8), attend le code collé, puis affiche le jeton.
// Le code « GOOD… » est accepté ; tout autre code est refusé ; NOLINK = aucun lien affiché ; EVIL = lien hors Anthropic.
import { createInterface } from 'node:readline';
const mode = process.env.FAKE_MODE || '';
const esc = String.fromCharCode(27);
const bel = String.fromCharCode(7);
if (mode !== 'NOLINK') {
  const url = mode === 'EVIL' ? 'https://evil.example/oauth?x=1' : 'https://claude.com/cai/oauth/authorize?code=true&state=abc';
  process.stdout.write(`Browser didn't open? Use the url below\n${esc}]8;id=1;${url}${bel}${url.slice(0, 30)}${esc}]8;;${bel}\nPaste code here if prompted > `);
}
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim().startsWith('GOOD')) {
    process.stdout.write(`\nLong-lived token created\nsk-ant-oat01-${'L'.repeat(60)}\nStore it securely.\n`);
    process.exit(0);
  }
  process.stdout.write('\nInvalid code\n');
  process.exit(1);
});
