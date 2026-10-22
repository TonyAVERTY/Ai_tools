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
    // Comme le vrai CLI : le jeton est coupé par un retour à la ligne et un déplacement de curseur, et les mots voisins sont collés
    const tok = `oat01-${'L'.repeat(60)}`;
    process.stdout.write(`\n✓ Long-lived authentication token created successfully!\nYour OAuth token (valid for 1 year): sk-ant-${esc}[1G\r\n${tok.slice(0, 30)}${esc}[3G${tok.slice(30)}\r\n\r\nStore${esc}[7Gthis token securely.\n`);
    process.exit(0);
  }
  // Code refusé : même message que le vrai CLI, qui reste en attente d'une nouvelle saisie
  process.stdout.write('\nOAuth error: Request failed with status code 400\nPress Enter to retry.\n');
});
