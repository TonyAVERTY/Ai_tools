// Lance toutes les vérifications d'interface (Playwright + Chromium) l'une après l'autre : scripts/*-check.mjs puis responsive-audit.
// Variables : PLAYWRIGHT_MODULE (chemin du module, sinon `playwright-core` du projet), PLAYWRIGHT_CHROMIUM (navigateur), CHROMIUM_BIN.
// Un script réussit s'il se termine avec le code 0. Usage : node scripts/run-ui-checks.js [filtre]   (ex. « promo » ne lance que promo-check…)
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const filter = process.argv[2] || '';
const names = readdirSync('scripts').filter((f) => /-check\.mjs$/.test(f) || f === 'responsive-audit.mjs').sort();
// Vérifications à lancer à la main, sur une machine qui a le vrai outil et une vraie connexion (elles consomment l'abonnement de la personne) :
// la série automatique et la CI les ignorent et le disent ; « npm run ui:check -- agy » les lance, et échoue si la connexion manque.
const MANUAL = ['agy-check.mjs'];
const run = names.filter((f) => f.includes(filter) && (filter || !MANUAL.includes(f)));
const skipped = filter ? [] : names.filter((f) => MANUAL.includes(f));
const failed = [];
for (const f of run) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--no-warnings=ExperimentalWarning', '--import', './scripts/test-setup.js', `scripts/${f}`], {
    encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 64 << 20, env: { ...process.env, CHROMIUM_BIN: process.env.CHROMIUM_BIN || process.env.PLAYWRIGHT_CHROMIUM || '' },
  });
  const ok = r.status === 0;
  console.log(`${ok ? 'OK ' : 'KO '} ${f} (${Math.round((Date.now() - t0) / 1000)} s)`);
  if (!ok) { failed.push(f); console.log(`${r.stdout || ''}${r.stderr || ''}`.split('\n').slice(-40).join('\n')); }
}
if (skipped.length) console.log(`\nNon lancé (à la main, vrai outil et vraie connexion requis) : ${skipped.join(', ')}`);
console.log(failed.length ? `\n${failed.length} échec(s) : ${failed.join(', ')}` : `\nTOUT EST BON (${run.length} vérifications)`);
process.exit(failed.length ? 1 : 0);
