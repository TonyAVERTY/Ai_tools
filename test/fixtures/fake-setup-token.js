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
// Comme le vrai CLI : le code et l'Entrée doivent arriver séparément ; un code collé avec son Entrée n'est pas validé
process.stdin.setRawMode?.(false);
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim().startsWith('GOOD')) {
    // Comme le vrai CLI : l'écran est mis à jour par morceaux. Le jeton est d'abord dessiné avec un caractère faux (X), puis le
    // curseur revient et ne réécrit que ce caractère : le flux brut seul est faux, seul l'écran rendu est juste.
    const prefix = 'Your OAuth token (valid for 1 year): ';
    const tok = `sk-ant-oat01-${'L'.repeat(60)}`;
    const wrong = `${tok.slice(0, 20)}X${tok.slice(21)}`;
    process.stdout.write(`\n✓ Long-lived authentication token created successfully!\n${prefix}${wrong}\r${esc}[${prefix.length + 20}CL\r\n\r\nStore${esc}[7Gthis token securely.\n`);
    process.exit(0);
  }
  // Code refusé : même message que le vrai CLI, qui reste en attente d'une nouvelle saisie
  process.stdout.write('\nOAuth error: Request failed with status code 400\nPress Enter to retry.\n');
});
