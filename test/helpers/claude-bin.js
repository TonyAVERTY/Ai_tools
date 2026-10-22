// Faux exécutable `claude` pour un test : script sh qui fixe des variables d'environnement puis lance une fixture.
// Nécessaire parce que l'environnement du processus enfant est assaini (liste blanche) : un test ne peut plus
// piloter la fixture en modifiant process.env.
import { chmodSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const posix = (p) => p.split('\\').join('/');
const q = (s) => `'${String(s).split("'").join("'\\''")}'`;

/** @returns {string} chemin du script ; `fixture` : nom dans test/fixtures, `env` : variables à fixer */
export function makeClaudeBin(dir, { fixture = 'fake-claude.js', env = {}, name = 'claude-test', logVars = [], logFile } = {}) {
  const file = join(dir, name);
  const vars = Object.entries(env).map(([k, v]) => `${k}=${q(v)}`).join(' ');
  // logVars : variables reçues par le processus, ajoutées (une ligne par appel) à logFile avant de lancer la fixture
  const log = logVars.length ? `echo "${logVars.map((v) => '${' + v + '}').join(' ')}" >> ${q(posix(logFile))}\n` : '';
  writeFileSync(file, `#!/bin/sh\n${log}${vars} exec ${q(posix(process.execPath))} ${q(posix(resolve('test/fixtures', fixture)))} "$@"\n`);
  chmodSync(file, 0o755);
  return file;
}
