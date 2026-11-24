// Détection de secrets dans les fichiers suivis par Git (et, avec --history, dans tout l'historique). Sortie 1 si un secret a l'air réel.
// Les fausses clés des tests et de la documentation portent un marqueur évident (AbCdEf, SECRETSECRET, aaaa…, hunter2, EXEMPLE) : elles sont ignorées.
// Une vraie clé qui contiendrait par hasard un de ces marqueurs passerait : c'est pourquoi l'audit relit aussi l'historique à la main (docs/security/).
// Ne jamais afficher la valeur trouvée : seulement le fichier, la ligne et le type.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export const PATTERNS = [
  ['clé privée', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['clé AWS', /AKIA[0-9A-Z]{16}/],
  ['clé API Anthropic', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['clé Stripe', /\b(?:sk|rk)_live_[A-Za-z0-9]{10,}/],
  ['secret de webhook Stripe', /whsec_[A-Za-z0-9]{16,}/],
  ['jeton GitHub', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['clé Google', /AIza[0-9A-Za-z_-]{35}/],
  ['jeton Slack', /xox[abp]-[0-9A-Za-z-]{10,}/],
  ['webhook Discord', /discord(?:app)?\.com\/api\/webhooks\/\d{15,}\/[A-Za-z0-9_-]{30,}/],
  ['webhook Slack', /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/],
  ['jeton de bot Telegram', /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/],
  ['jeton d\'API iaboss', /\biaboss_[A-Za-z0-9_-]{30,}/],
  ['URL de base avec mot de passe', /\b(?:mysql|postgres(?:ql)?|mariadb):\/\/[^\s:@/]+:[^\s@/]{6,}@/],
];
const FAKE = /AbCdEf|SECRETSECRET|a{12,}|0{12,}|1234567890|zyxwv|hunter2|autreSecret|whsec_Audit|EXEMPLE|exemple|example|xxxx|\*{6,}|…/;

/** Résultats [{ file, line, kind }] pour un texte ; les valeurs manifestement factices sont ignorées. */
export function scanText(file, text) {
  const out = [];
  text.split('\n').forEach((l, i) => {
    for (const [kind, re] of PATTERNS) {
      const m = l.match(re);
      if (m && !FAKE.test(m[0]) && !FAKE.test(l.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12))) out.push({ file, line: i + 1, kind });
    }
  });
  return out;
}

/** Fichiers sensibles qui ne doivent jamais être suivis par Git. */
export const FORBIDDEN_FILES = /(^|\/)(\.env(\.(?!example$)[^/]+)?|id_rsa[^/]*|id_ed25519[^/]*|[^/]+\.(pem|key|p12|pfx|sqlite3?|db|sql|bundle))$/;

export function scanRepo(cwd = process.cwd()) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd, maxBuffer: 64 * 1024 * 1024 }).toString().split('\0').filter(Boolean);
  const findings = [];
  for (const f of files) {
    if (FORBIDDEN_FILES.test(f)) findings.push({ file: f, line: 0, kind: 'fichier sensible suivi par Git' });
    if (/\.(png|jpe?g|woff2?|ico|mp4|webp|gif)$/i.test(f)) continue;
    let text; try { text = readFileSync(`${cwd}/${f}`, 'utf8'); } catch { continue; }
    findings.push(...scanText(f, text));
  }
  return findings;
}

/** Faux positifs connus de l'historique (scripts/secret-scan-baseline.json) : { commit complet, fichier, raison obligatoire }. */
export function readBaseline(cwd = process.cwd()) {
  const f = `${cwd}/scripts/secret-scan-baseline.json`;
  const list = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).entries || [] : [];
  for (const e of list) if (!/^[0-9a-f]{40}$/.test(e.commit || '') || !e.file || String(e.reason || '').length < 20) throw new Error('secret-scan-baseline.json : commit complet, fichier et raison (20 caractères au moins) obligatoires');
  return list;
}

export function scanHistory(cwd = process.cwd()) {
  const findings = [];
  const baseline = readBaseline(cwd);
  // `git -G` lit une expression POSIX : un préfiltre large (les motifs précis, en JavaScript, tranchent ensuite ligne par ligne)
  const re = 'PRIVATE KEY|AKIA[0-9A-Z]|sk-ant-|_live_|whsec_|gh[pousr]_|github_pat_|AIza|xox[abp]-|webhooks/|hooks.slack.com|iaboss_|(mysql|postgres|mariadb)://[^ ]*:[^ ]*@|:AA[A-Za-z0-9_-]{30}';
  const log = execFileSync('git', ['log', '--all', '-p', '--no-color', '--format=COMMIT %H', '-G' + re], { cwd, maxBuffer: 1024 * 1024 * 1024 }).toString();
  let commit = ''; let file = '';
  for (const l of log.split('\n')) {
    if (l.startsWith('COMMIT ')) { commit = l.slice(7); continue; }
    if (l.startsWith('diff --git ')) { file = l.split(' b/')[1] || ''; continue; }
    if (!l.startsWith('+') || l.startsWith('+++')) continue;
    if (baseline.some((e) => e.commit === commit && e.file === file)) continue;
    for (const f of scanText(`${file} (commit ${commit.slice(0, 7)})`, l.slice(1))) findings.push(f);
  }
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const findings = [...scanRepo(), ...(process.argv.includes('--history') ? scanHistory() : [])];
  for (const f of findings) console.error(`SECRET ? ${f.kind} : ${f.file}${f.line ? `:${f.line}` : ''}`);
  console.log(findings.length ? `${findings.length} secret(s) possible(s) : à révoquer s'ils sont réels` : 'Aucun secret détecté dans les fichiers suivis' + (process.argv.includes('--history') ? ' ni dans l\'historique' : ''));
  process.exit(findings.length ? 1 : 0);
}
