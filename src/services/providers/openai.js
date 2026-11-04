// Fournisseur d'IA « ChatGPT » (OpenAI) : lance Codex CLI en headless (`codex exec --json`) et traduit son flux vers la forme commune
// des fournisseurs (voir providers/index.js).
//
// Connexion : CLÉ API OPENAI SEULEMENT (variable CODEX_API_KEY, lue par `codex exec`). La connexion par compte ChatGPT repose sur un
// fichier auth.json que Codex renouvelle lui-même (jeton de rafraîchissement à usage unique, un seul flux de jobs à la fois) : elle
// demande un traitement à part, qui n'est pas dans ce fournisseur.
//
// Ce que Codex ne sait pas faire comme Claude Code, et ce qu'on en fait :
//  - il LIT le dépôt avec une commande shell, il n'a pas d'outil « Read » : une tâche qui lit le dépôt garde donc le shell, dans le bac à
//    sable de Codex en LECTURE SEULE (sans réseau), lui-même dans notre bac à sable bubblewrap ; toute autre tâche (texte seul, web) a le
//    shell COUPÉ (`features.shell_tool=false`) ;
//  - le shell ne reçoit aucune variable dont le nom contient KEY, SECRET ou TOKEN (la clé de l'utilisateur n'y est donc pas) ;
//  - l'AGENTS.md du dépôt n'est jamais lu (`project_doc_max_bytes=0`) : un dépôt n'écrit pas les consignes de l'IA ;
//  - pas d'option « consignes système » : elles sont placées devant la demande ;
//  - pas de limite de tours : on compte les actions (commandes, recherches web) et on arrête Codex au-delà de `maxTurns` ;
//  - pas de coût en $ dans le flux : il est estimé d'après services/pricing.js ; pas de quota 5 h / 7 j ;
//  - le texte n'arrive pas au fil de l'écriture : la réponse finale est transmise d'un bloc.
import { spawn } from 'node:child_process';
import { prepareLaunch } from '../sandbox.js';
import { estimateCost } from '../pricing.js';
import { HttpError } from '../../http.js';
import { SECRET_ENV } from './secretenv.js';

const MODELS_URL = 'https://api.openai.com/v1/models';

/** Réponse qui signifie « accès refusé » (clé invalide, révoquée) : au sens strict, jamais une panne réseau ni un quota épuisé. */
export const isAuthRefusal = (text) => /invalid_api_key|incorrect api key|invalid api key|authentication[_ ]?(error|failed)|unauthori[sz]ed|\b401\b/i.test(String(text ?? ''));

/**
 * Réglages de Codex pour les outils demandés (noms Claude : l'application ne parle qu'en noms Claude).
 * Lecture du dépôt → shell gardé (lecture seule) ; sinon shell coupé. Web → recherche en direct ; sinon désactivée.
 */
export function toolConfig(tools = []) {
  const reads = tools.some((t) => ['Read', 'Glob', 'Grep'].includes(t));
  const web = tools.some((t) => ['WebSearch', 'WebFetch'].includes(t));
  return { shell: reads, web: web ? 'live' : 'disabled' };
}

/** Arguments du CLI (`-c` : valeurs TOML). */
export function buildArgs(o) {
  const { shell, web } = toolConfig(o.tools);
  const prompt = o.system ? `${o.system}\n\n---\n\n${o.prompt}` : o.prompt;
  const args = [
    'exec', '--json', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules',
    '--sandbox', 'read-only',
    '-c', `features.shell_tool=${shell}`,
    '-c', `web_search="${web}"`,
    '-c', 'project_doc_max_bytes=0',
    '-c', 'shell_environment_policy.inherit="core"',
    '-c', 'shell_environment_policy.ignore_default_excludes=false',
    '-c', 'analytics.enabled=false',
    '-c', 'feedback.enabled=false',
    '-c', 'check_for_update_on_startup=false',
    '-c', 'history.persistence="none"',
  ];
  if (o.model) args.push('--model', o.model);
  args.push(prompt);
  return args;
}

/** Lance Codex CLI. Mêmes options et même résultat que runClaude (services/claude.js). */
export function runCodex(o) {
  const launch = prepareLaunch({
    bin: o.bin || 'codex', args: buildArgs(o), cwd: o.cwd, allowedRoot: o.allowedRoot,
    secretEnv: o.secretEnv, sandbox: o.sandbox, extraDirs: o.extraDirs, extraRoot: o.extraRoot,
  });
  const secrets = Object.values(o.secretEnv || {}).filter((v) => v && v.length >= 8);
  const redact = (t) => secrets.reduce((acc, s) => acc.split(s).join('***'), String(t ?? ''));
  const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const maxActions = o.maxTurns || 10;

  return new Promise((resolve, reject) => {
    let buf = '', stderr = '';
    let usage = null, completed = false, failed = null, actions = 0, tooMany = false, turns = 0;
    let final = '';
    const errors = [];
    const timer = setTimeout(() => child.kill('SIGTERM'), o.timeoutMs || 30 * 60_000);
    o.signal?.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
    const done = () => { clearTimeout(timer); launch.cleanup(); };

    function handle(line) {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      const item = ev.item || {};
      if (ev.type === 'item.started' && ['command_execution', 'web_search', 'mcp_tool_call'].includes(item.type)) {
        turns += 1;
        o.onTurn?.(turns);
        // Le journal d'activité parle comme avec Claude : une commande = une recherche dans le code
        if (item.type === 'web_search') o.onTool?.('WebSearch', { query: item.query });
        else o.onTool?.('Grep', {});
        if (++actions > maxActions && !tooMany) { tooMany = true; child.kill('SIGTERM'); }
      } else if (ev.type === 'item.started' && item.type === 'reasoning') {
        o.onActivity?.('ChatGPT réfléchit à la prochaine étape…');
      } else if (ev.type === 'item.completed' && item.type === 'agent_message' && typeof item.text === 'string') {
        final = item.text; // la réponse finale est le dernier message de l'IA
      } else if (ev.type === 'turn.completed') {
        completed = true;
        usage = ev.usage || usage;
      } else if (ev.type === 'turn.failed') {
        failed = ev.error?.message || 'échec';
      } else if (ev.type === 'error' && ev.message) {
        errors.push(String(ev.message));
      }
    }

    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(line); }
    });
    child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-4000); });
    child.on('error', (e) => { done(); reject(new Error(redact(`Impossible de lancer Codex : ${e.message}`))); });
    child.on('close', (code) => {
      done();
      if (buf.trim()) handle(buf.trim());
      if (!completed && !failed && !tooMany) return reject(new Error(redact(`Codex s'est arrêté sans résultat (code ${code}). ${[...errors, stderr.trim()].filter(Boolean).join(' ')}`)));
      const tokensIn = Number(usage?.input_tokens) || 0;
      const tokensOut = Number(usage?.output_tokens) || 0;
      const cachedTokens = Number(usage?.cached_input_tokens) || 0;
      const ok = completed && !failed && !tooMany && code === 0;
      o.onUsage?.({ tokensIn, tokensOut });
      if (final) { o.onDelta?.(redact(final)); o.onText?.(redact(final)); }
      resolve({
        ok,
        subtype: ok ? 'success' : tooMany ? 'error_max_turns' : 'error',
        text: redact(ok ? final : [final, failed, ...errors, stderr.trim()].filter(Boolean).join('\n')),
        allText: redact(final),
        costUsd: estimateCost(o.model, { inputTokens: tokensIn, outputTokens: tokensOut, cachedTokens }),
        tokensIn, tokensOut, turns,
        rateLimit: null,
      });
    });
  });
}

/**
 * Valide une clé API par un appel qui ne consomme aucun token : liste des modèles.
 * Une clé invalide répond HTTP 401 (`invalid_api_key`), vérifié sur l'API le 4 novembre 2026 ; 403 aussi est un refus.
 * Erreur réseau ou réponse inattendue : message distinct (la clé n'est pas jugée).
 */
export async function validateApiKey(key, fetchFn = fetch) {
  let r;
  try {
    r = await fetchFn(MODELS_URL, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new HttpError(502, "Impossible de joindre OpenAI pour vérifier la clé (réseau). Réessaie dans un instant.", { expose: true });
  }
  if (r.status === 401 || r.status === 403) throw new HttpError(400, 'Clé API refusée par OpenAI');
  if (!r.ok) throw new HttpError(502, `OpenAI ne répond pas normalement (HTTP ${r.status}) : la clé n'a pas pu être vérifiée. Réessaie plus tard.`, { expose: true });
}

export const openaiProvider = {
  id: 'openai',
  label: 'ChatGPT',
  company: 'OpenAI',
  modes: { api_key: { env: SECRET_ENV.openai.api_key, label: 'Clé API OpenAI' } },
  apiKey: { pattern: /^sk-[A-Za-z0-9_-]{20,300}$/, invalidFormat: 'Clé API invalide (elle commence par sk-)', validate: validateApiKey },
  bin: (cfg) => cfg.codexBin,
  run: runCodex,
  rateLimitWindows: () => null,
  isAuthRefusal,
};
