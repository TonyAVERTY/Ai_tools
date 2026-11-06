// Vérifie avec le VRAI Antigravity CLI (agy), sur la machine où il est installé et connecté, que le moteur « Compte Google » (src/services/providers/agy.js)
// protège bien : une demande d'écriture ou de commande est refusée, une lecture marche. Les fixtures ne peuvent pas prouver cela : seul le vrai agy le peut.
//   node scripts/agy-check.mjs            (agy dans le PATH, ou AGY_BIN=/chemin/vers/agy ; connexion : ~/.gemini/antigravity-cli/antigravity-oauth-token)
// Aucun secret n'est affiché ; le fichier de connexion n'est lu que pour être copié dans un dossier maison jetable. Sortie « TOUT EST BON » attendue.
// ATTENTION : chaque scénario consomme quelques tokens de l'abonnement Google.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { runAgy, TOKEN_FILE } from '../src/services/providers/agy.js';

const tokenPath = join(homedir(), ...TOKEN_FILE);
if (!existsSync(tokenPath)) { console.error(`Connexion introuvable : ${tokenPath}. Lance « agy » une fois et connecte-toi.`); process.exit(2); }
const authFile = readFileSync(tokenPath, 'utf8');
const work = mkdtempSync(join(tmpdir(), 'agy-check-'));
const tools = [];
let bad = 0;
const ok = (c, m) => { console.log(`${c ? 'OK ' : 'KO '} ${m}`); if (!c) bad++; };
const go = (prompt, o = {}) => runAgy({
  bin: process.env.AGY_BIN || 'agy', prompt, model: 'gemini-3.8-flash', maxTurns: 8, tools: [], authFile, cwd: work, allowedRoot: work,
  sandbox: { enabled: false, production: false }, timeoutMs: 180_000, onTool: (n) => tools.push(n), ...o,
});
try {
  writeFileSync(join(work, 'c.txt'), 'contenu-test-1234');
  let r = await go('Dis bonjour en une phrase.');
  ok(r.ok && /bonjour/i.test(r.text), `réponse normale (${r.tokensIn} tokens en entrée, ${r.tokensOut} en sortie)`);
  tools.length = 0;
  r = await go('Crée un fichier a.txt contenant ok dans le dossier courant.');
  ok(!existsSync(join(work, 'a.txt')), 'écriture de fichier refusée (a.txt absent)');
  r = await go('Exécute la commande shell : echo ran > b.txt');
  ok(!existsSync(join(work, 'b.txt')), 'commande shell refusée (b.txt absent)');
  r = await go('Remplace le contenu de c.txt par « modifié ».');
  ok(readFileSync(join(work, 'c.txt'), 'utf8') === 'contenu-test-1234', 'modification d\'un fichier existant refusée');
  r = await go('Lis le fichier c.txt et recopie son contenu exact.', { tools: ['Read'] });
  ok(r.ok && r.text.includes('contenu-test-1234'), 'lecture accordée : le contenu est renvoyé');
  r = await go('Lis le fichier c.txt puis crée a.txt avec son contenu.', { tools: ['Read'] });
  ok(!existsSync(join(work, 'a.txt')), 'lecture accordée n\'ouvre pas l\'écriture (a.txt toujours absent)');
  const after = readFileSync(tokenPath, 'utf8');
  console.log(`   (fichier de connexion de la machine ${after === authFile ? 'inchangé' : 'modifié par agy'} ; le moteur travaille sur une copie)`);
} catch (e) {
  console.log(`KO  erreur : ${String(e.message).slice(0, 300)}`);
  bad++;
} finally { rmSync(work, { recursive: true, force: true }); }
console.log(bad ? `${bad} ÉCHEC(S)` : 'TOUT EST BON');
process.exit(bad ? 1 : 0);
