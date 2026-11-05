#!/usr/bin/env node
// Banc d'essai de l'intelligence d'iaboss. Deux parties :
//
//  1. HORS LIGNE (par défaut, gratuit, reproductible) : exactitude du profil de dépôt sur des dépôts factices de plusieurs stacks, exactitude de la
//     sélection de l'orchestrateur sur des demandes étiquetées, surcoût en caractères (≈ jetons) de chaque mode, durée du profil à froid et en cache.
//     Cela mesure que les mécanismes font ce qu'ils annoncent. Cela NE mesure PAS que Claude répond mieux.
//
//  2. LIVE (--live, appelle réellement Claude, coûte de l'argent) : mêmes tâches, même modèle, mêmes outils de lecture, deux bras :
//     « base » (Claude seul, comme dans Claude Code standard) et « aitools » (profil du dépôt + méthode choisie). Contrôles objectifs sur la réponse
//     (bench/tasks.js), plus tours, jetons, coût et durée. Il faut ANTHROPIC_API_KEY et le binaire `claude`. Options : --runs N (défaut 1),
//     --model haiku|sonnet|opus (défaut sonnet), --task <id>. Les résultats sont écrits dans le dossier donné par --out (JSON) pour comparaison.
//
//  Usage : node scripts/bench.mjs [--live] [--runs 3] [--model sonnet] [--task bug-panier] [--out resultats.json]
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { REPOS, writeRepo } from '../bench/fixtures.js';
import { REQUESTS } from '../bench/requests.js';
import { scoreProfile, scoreDecision } from '../bench/score.js';
import { TASKS, writeTask, scoreAnswer } from '../bench/tasks.js';
import { profileRepo, renderRepoProfile } from '../src/services/repoprofile.js';
import { plan } from '../src/services/orchestrator.js';
import { runClaude } from '../src/services/claude.js';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : '—');
const est = (chars) => Math.round(chars / 4); // estimation grossière : environ 4 caractères par jeton, pour du français
const root = mkdtempSync(join(tmpdir(), 'aitools-bench-'));
const report = { date: new Date().toISOString(), offline: {}, live: null };

// ---------- 1. hors ligne ----------
console.log('\n=== 1. Profil de dépôt : exactitude contre la vérité terrain ===');
let pp = 0; let pt = 0;
const profiles = {};
for (const [name, def] of Object.entries(REPOS)) {
  const dir = writeRepo(name, root);
  const t0 = performance.now();
  const f = profileRepo(dir);
  const ms = performance.now() - t0;
  profiles[name] = f;
  const r = scoreProfile(f, def.expect);
  pp += r.passed; pt += r.total;
  console.log(`${r.passed === r.total ? 'OK ' : 'KO '} ${name.padEnd(12)} ${String(r.passed).padStart(2)}/${r.total} contrôles  ${ms.toFixed(1)} ms  ${r.checks.filter((c) => !c.ok).map((c) => `[${c.name}]`).join(' ')}`);
}
report.offline.profile = { passed: pp, total: pt };
console.log(`Total : ${pp}/${pt} (${pct(pp, pt)})`);

console.log('\n=== 2. Orchestrateur : sélection contre les demandes étiquetées ===');
let dp = 0; let dt = 0;
const rows = [];
for (const req of REQUESTS) {
  const d = plan(req.text, { hasRepo: !!req.repo, profile: req.repo ? profiles[req.repo] : null });
  const r = scoreDecision(d, req);
  dp += r.passed; dt += r.total;
  rows.push({ id: req.id, mode: d.mode, skills: d.skills, chars: d.block.length });
  console.log(`${r.passed === r.total ? 'OK ' : 'KO '} ${req.id.padEnd(16)} mode=${String(d.mode).padEnd(10)} fiches=${d.skills.length} bloc≈${est(d.block.length)} jetons  ${r.checks.filter((c) => !c.ok).map((c) => `[${c.name}]`).join(' ')}`);
}
report.offline.decisions = { passed: dp, total: dt, rows };
console.log(`Total : ${dp}/${dt} (${pct(dp, dt)})`);

console.log('\n=== 3. Surcoût de contexte par mode (estimation, 4 caractères ≈ 1 jeton) ===');
const byMode = {};
for (const r of rows.filter((x) => x.mode)) (byMode[r.mode] ||= []).push(r.chars);
for (const [m, a] of Object.entries(byMode)) console.log(`${m.padEnd(11)} ${a.length} demandes  moyenne ≈ ${est(a.reduce((s, x) => s + x, 0) / a.length)} jetons  max ≈ ${est(Math.max(...a))}`);
console.log(`Profil du dépôt rendu : ≈ ${est(renderRepoProfile(profiles['web-ts']).length)} jetons (web-ts)`);

// ---------- 2. live ----------
if (flag('live')) {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('\n--live demande ANTHROPIC_API_KEY.'); process.exit(2); }
  const model = opt('model', 'sonnet');
  const runs = Number(opt('runs', '1'));
  const only = opt('task', null);
  console.log(`\n=== 4. LIVE : base contre aitools (modèle ${model}, ${runs} essai(s) par tâche) ===`);
  report.live = { model, runs, tasks: [] };
  for (const task of TASKS.filter((t) => !only || t.id === only)) {
    const dir = writeTask(task, root);
    const profile = profileRepo(dir);
    const treatment = plan(task.question, { hasRepo: true, profile });
    const arms = { base: '', aitools: `\n\n${renderRepoProfile(profile)}${treatment.block}` };
    const out = { id: task.id, label: task.label, mode: treatment.mode, arms: {} };
    for (const [arm, system] of Object.entries(arms)) {
      const res = [];
      for (let i = 0; i < runs; i++) {
        const t0 = Date.now();
        const r = await runClaude({
          prompt: task.question, system: system || undefined, cwd: dir, model, maxTurns: 14, tools: ['Read', 'Glob', 'Grep'], chat: true,
          sandbox: { enabled: false, production: false }, secretEnv: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
        });
        const s = scoreAnswer(task, r.text);
        res.push({ ...s, turns: r.turns, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd, seconds: (Date.now() - t0) / 1000, ok: r.ok, failed: s.checks.filter((c) => !c.ok).map((c) => c.name) });
      }
      out.arms[arm] = res;
    }
    report.live.tasks.push(out);
    const avg = (arm, k) => (out.arms[arm].reduce((s, r) => s + (Number(r[k]) || 0), 0) / runs);
    console.log(`\n${task.label} (mode choisi : ${treatment.mode})`);
    for (const arm of ['base', 'aitools']) console.log(`  ${arm.padEnd(8)} contrôles ${avg(arm, 'passed').toFixed(1)}/${task.checks.length}  tours ${avg(arm, 'turns').toFixed(1)}  jetons ent./sort. ${Math.round(avg(arm, 'tokensIn'))}/${Math.round(avg(arm, 'tokensOut'))}  coût ${avg(arm, 'costUsd').toFixed(4)} $  ${avg(arm, 'seconds').toFixed(0)} s`);
  }
  console.log('\nAvec peu d\'essais, une différence n\'est pas une preuve : augmente --runs et compare les écarts à la variabilité entre essais.');
} else {
  console.log('\n(Partie live non exécutée : ajoute --live avec ANTHROPIC_API_KEY pour comparer Claude seul et Claude avec iaboss. Aucune supériorité n\'est revendiquée sans elle.)');
}

if (opt('out', null)) { writeFileSync(opt('out'), JSON.stringify(report, null, 2)); console.log(`Résultats écrits dans ${opt('out')}`); }
const failed = pp !== pt || dp !== dt;
process.exit(failed ? 1 : 0);
