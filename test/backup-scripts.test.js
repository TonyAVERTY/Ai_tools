import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readdirSync, readFileSync, mkdirSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Logique des scripts de sauvegarde et de restauration (deploy/), avec de FAUX mysqldump / mariadb : chiffrement obligatoire, mot de passe hors de la
// ligne de commande, fichiers chiffrés, rotation, refus de toucher à la base de production. La vraie restauration est rejouée en CI sur MariaDB (job « backup »).

const has = (c) => spawnSync('sh', ['-c', `command -v ${c}`]).status === 0;
const SKIP = !has('age') || !has('gzip') || !has('tar');

function fakeBin() {
  const dir = mkdtempSync(join(tmpdir(), 'bk-bin-'));
  const put = (name, body) => { writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`); chmodSync(join(dir, name), 0o755); };
  // Faux mysqldump : consigne ses arguments, écrit un export SQL qui finit comme un vrai
  put('mysqldump', `echo "$@" >> "$FAKE_LOG"; [ "$1" = "--help" ] && exit 0; for a in "$@"; do case "$a" in --defaults-extra-file=*) cat "\${a#--defaults-extra-file=}" >> "$FAKE_LOG.cnf";; esac; done
printf 'CREATE TABLE users (id INT);\\nINSERT INTO users VALUES (1);\\n'; head -c 3000 /dev/urandom | base64 | sed 's/^/-- /'; echo "-- Dump completed on 2026-11-24"`);
  // Faux client : consigne les requêtes, répond aux comptages
  put('mariadb', `cat >/dev/null 2>&1 </dev/null; echo "$@" >> "$FAKE_LOG"; case "$*" in *information_schema*) echo 36;; *schema_migrations*) echo 39;; *users*) echo 1;; esac; exit 0`);
  return dir;
}
const run = (script, args, env) => spawnSync('sh', [join(process.cwd(), 'deploy', script), ...args], { env: { PATH: `${env.BIN}:/usr/bin:/bin`, ...env }, encoding: 'utf8' });

test('sauvegarde : refuse sans chiffrement, chiffre avec une clé publique, garde le mot de passe hors de la ligne de commande', { skip: SKIP }, () => {
  const bin = fakeBin(); const dest = mkdtempSync(join(tmpdir(), 'bk-dest-')); const data = mkdtempSync(join(tmpdir(), 'bk-data-'));
  writeFileSync(join(data, 'justificatif.pdf'), 'PIECE-COMPTABLE'); mkdirSync(join(data, 'repos')); writeFileSync(join(data, 'repos', 'clone.txt'), 'CLONE');
  const log = join(dest, '..', `fake-${Date.now()}.log`);
  const base = { BIN: bin, FAKE_LOG: log, DB_HOST: '127.0.0.1', DB_PORT: '3306', DB_USER: 'backup', DB_PASSWORD: 'MOT-DE-PASSE-SECRET', DB_NAME: 'aitools', DATA_DIR: data };

  const refused = run('aitools-backup-mysql.sh', [dest], base);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /BACKUP_AGE_RECIPIENT manquant/);
  assert.deepEqual(readdirSync(dest), [], 'rien n\'est écrit sans chiffrement');

  const keys = execFileSync('age-keygen', [], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const recipient = keys.match(/public key: (age1\w+)/)?.[1] || execFileSync('sh', ['-c', `printf '%s' "$K" | age-keygen -y`], { env: { K: keys, PATH: process.env.PATH }, encoding: 'utf8' }).trim();
  const ok = run('aitools-backup-mysql.sh', [dest, '14'], { ...base, BACKUP_AGE_RECIPIENT: recipient });
  assert.equal(ok.status, 0, ok.stderr);
  const files = readdirSync(dest);
  assert.equal(files.length, 2);
  assert.ok(files.every((f) => f.endsWith('.age')), 'tout est chiffré');
  for (const f of files) { const b = readFileSync(join(dest, f)); assert.ok(!b.includes('PIECE-COMPTABLE') && !b.includes('CREATE TABLE'), 'aucun clair dans ' + f); }
  assert.match(ok.stdout, /Sauvegarde OK/);
  const argv = readFileSync(log, 'utf8');
  assert.ok(!argv.includes('MOT-DE-PASSE-SECRET'), 'le mot de passe n\'apparaît dans aucun argument');
  assert.ok(readFileSync(`${log}.cnf`, 'utf8').includes('MOT-DE-PASSE-SECRET'), 'il passe par le fichier de configuration temporaire');
  assert.match(argv, /--single-transaction/);
  assert.ok(!readdirSync(dest).some((f) => f.startsWith('.tmp')), 'aucun fichier temporaire laissé');

  // Rotation : une sauvegarde de plus de 14 jours disparaît, une récente reste
  const old = join(dest, 'aitools-20250101-000000-db.sql.gz.age'); writeFileSync(old, 'x'); const t = new Date(Date.now() - 20 * 86400e3); utimesSync(old, t, t);
  const again = run('aitools-backup-mysql.sh', [dest, '14'], { ...base, BACKUP_AGE_RECIPIENT: recipient });
  assert.equal(again.status, 0, again.stderr);
  assert.ok(!existsSync(old), 'ancienne sauvegarde supprimée');
});

test('restauration : base temporaire (jamais celle de production), contrôle du contenu, nettoyage', { skip: SKIP }, () => {
  const bin = fakeBin(); const dir = mkdtempSync(join(tmpdir(), 'bk-rs-'));
  const dump = join(dir, 'db.sql.gz');
  execFileSync('sh', ['-c', `printf 'CREATE TABLE a (id INT);\\n-- Dump completed\\n' | gzip > "${dump}"`]);
  const log = join(dir, 'fake.log');
  const r = run('aitools-restore-check.sh', [dump], { BIN: bin, FAKE_LOG: log, DB_HOST: 'h', DB_USER: 'u', DB_PASSWORD: 'pw', DB_NAME: 'aitools' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /RESTAURATION VÉRIFIÉE/);
  const calls = readFileSync(log, 'utf8');
  assert.match(calls, /CREATE DATABASE `aitools_restore_check_/);
  assert.match(calls, /DROP DATABASE IF EXISTS `aitools_restore_check_/, 'base temporaire supprimée');
  assert.ok(!/DROP DATABASE[^`]*`aitools`/.test(calls) && !/CREATE DATABASE `aitools`/.test(calls), 'la base de production n\'est jamais créée ni supprimée');
  const noKey = run('aitools-restore-check.sh', [`${dump}.age`], { BIN: bin, FAKE_LOG: log, DB_HOST: 'h', DB_USER: 'u', DB_NAME: 'aitools' });
  assert.notEqual(noKey.status, 0);
});
