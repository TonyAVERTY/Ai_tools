// Fournisseur d'IA « Gemini » (Google) : lance Gemini CLI en headless (`gemini -p … --output-format stream-json`) et traduit son flux
// vers la forme commune des fournisseurs (voir providers/index.js).
//
// Connexion : CLÉ API SEULEMENT. Gemini CLI ne sert plus les comptes Google (AI Pro, Ultra, gratuit) depuis le 18 juin 2026 et sa
// documentation ne prévoit, en headless, que la clé API ou Vertex AI (annonce Google du 19 mai 2026).
// Différences avec Claude Code, toutes traitées ici :
//  - pas d'option « consignes système » : elles sont placées devant la demande ;
//  - les outils et la limite de tours se règlent dans un fichier de réglages « système » (GEMINI_CLI_SYSTEM_SETTINGS_PATH), écrit pour
//    CE lancement et monté en lecture seule dans le bac à sable ;
//  - aucun coût en $ dans le flux : il est estimé d'après la grille de services/pricing.js ;
//  - aucun quota 5 h / 7 j : `rateLimit` reste null.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareLaunch } from '../sandbox.js';
import { estimateCost } from '../pricing.js';
import { HttpError } from '../../http.js';
import { SECRET_ENV } from './secretenv.js';
import { runAgy, isAuthRefusal as isAgyRefusal } from './agy.js';

const MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1';

/** Outils de lecture que l'application accorde, par nom d'outil Claude (l'application ne parle qu'en noms Claude). */
const TOOL_NAMES = {
  Read: ['read_file', 'read_many_files', 'list_directory'],
  Glob: ['glob', 'list_directory'],
  Grep: ['grep_search'],
  WebSearch: ['google_web_search'],
  WebFetch: ['web_fetch'],
};
/** Nom Claude d'un outil Gemini, pour que le journal d'activité des jobs affiche la même chose qu'avec Claude. */
const CLAUDE_NAME = { read_file: 'Read', read_many_files: 'Read', list_directory: 'Glob', glob: 'Glob', grep_search: 'Grep', google_web_search: 'WebSearch', web_fetch: 'WebFetch' };
/** Quand aucun outil n'est accordé (conversation, rédaction) : une liste blanche vide pourrait vouloir dire « tous », on liste donc un outil qui n'existe pas. */
const NO_TOOL = '__aucun_outil__';

/** Réponse qui signifie « accès refusé » (clé invalide, révoquée, sans droit) : au sens strict, jamais une panne réseau. */
export const isAuthRefusal = (text) => /api[ _-]?key (not valid|invalid|expired)|API_KEY_INVALID|invalid api key|UNAUTHENTICATED|PERMISSION_DENIED|permission denied|\b40[13]\b/i.test(String(text ?? ''));

/** Outils Claude demandés → liste blanche de Gemini CLI. */
export function allowedTools(tools = []) {
  const names = [...new Set(tools.flatMap((t) => TOOL_NAMES[t] || []))];
  return names.length ? names : [NO_TOOL];
}

/** Réglages « système » de ce lancement (priment sur tous les autres fichiers de réglages). */
export function settingsFor(o) {
  return {
    tools: { core: allowedTools(o.tools) },
    model: { maxSessionTurns: o.maxTurns || 10 },
    privacy: { usageStatisticsEnabled: false },
    telemetry: { enabled: false },
    general: { enableAutoUpdate: false, enableAutoUpdateNotification: false },
    ui: { hideBanner: true },
  };
}

/** Arguments du CLI. */
export function buildArgs(o) {
  const prompt = o.system ? `${o.system}\n\n---\n\n${o.prompt}` : o.prompt;
  const args = ['--skip-trust', '-p', prompt, '--output-format', 'stream-json'];
  if (o.model) args.push('-m', o.model);
  if (o.extraDirs?.length) args.push('--include-directories', o.extraDirs.join(','));
  return args;
}

/** Paramètres d'un outil Gemini → ceux que lit le journal d'activité (noms Claude). */
const toolInput = (p = {}) => ({ ...p, file_path: p.file_path ?? p.absolute_path ?? p.path, pattern: p.pattern ?? p.query, query: p.query ?? p.pattern });

/** Lance Gemini CLI. Mêmes options et même résultat que runClaude (services/claude.js). */
export function runGemini(o) {
  const dir = mkdtempSync(join(tmpdir(), 'aitools-gemini-'));
  const settings = join(dir, 'settings.json');
  writeFileSync(settings, JSON.stringify(settingsFor(o)), { mode: 0o444 });
  let launch;
  try {
    launch = prepareLaunch({
      bin: o.bin || 'gemini', args: buildArgs(o), cwd: o.cwd, allowedRoot: o.allowedRoot,
      secretEnv: o.secretEnv, sandbox: o.sandbox, extraDirs: o.extraDirs, extraRoot: o.extraRoot,
      extraEnv: { GEMINI_CLI_SYSTEM_SETTINGS_PATH: settings }, roFiles: [settings],
    });
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
  const secrets = Object.values(o.secretEnv || {}).filter((v) => v && v.length >= 8);
  const redact = (t) => secrets.reduce((acc, s) => acc.split(s).join('***'), String(t ?? ''));
  const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, stdio: ['ignore', 'pipe', 'pipe'] });

  return new Promise((resolve, reject) => {
    let buf = '', stderr = '';
    let result = null, turns = 0, model = o.model;
    const answer = [], errors = [];
    const timer = setTimeout(() => child.kill('SIGTERM'), o.timeoutMs || 30 * 60_000);
    o.signal?.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
    const done = () => { clearTimeout(timer); launch.cleanup(); rmSync(dir, { recursive: true, force: true }); };

    function handle(line) {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'init') { if (ev.model) model = ev.model; }
      else if (ev.type === 'message') {
        // Tout rôle autre que « user » est du texte de l'IA (le CLI écrit « model » ou « assistant » selon les versions)
        if (ev.role !== 'user' && typeof ev.content === 'string' && ev.content) { answer.push(ev.content); o.onDelta?.(redact(ev.content)); }
      } else if (ev.type === 'tool_use') {
        turns += 1;
        o.onTurn?.(turns);
        o.onTool?.(CLAUDE_NAME[ev.tool_name] || ev.tool_name, toolInput(ev.parameters));
      } else if (ev.type === 'error') {
        if (ev.message) errors.push(String(ev.message));
      } else if (ev.type === 'result') {
        result = ev;
      }
    }

    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(line); }
    });
    child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-4000); });
    child.on('error', (e) => { done(); reject(new Error(redact(`Impossible de lancer Gemini : ${e.message}`))); });
    child.on('close', (code) => {
      done();
      if (buf.trim()) handle(buf.trim());
      if (!result) return reject(new Error(redact(`Gemini s'est arrêté sans résultat (code ${code}). ${[...errors, stderr.trim()].filter(Boolean).join(' ')}`)));
      const stats = result.stats || {};
      const tokensIn = Number(stats.input_tokens ?? stats.input ?? 0) || 0;
      const tokensOut = Number(stats.output_tokens ?? stats.output ?? 0) || 0;
      const cachedTokens = Number(stats.cached ?? stats.cached_input_tokens ?? 0) || 0;
      const ok = result.status === 'success' && code === 0;
      const said = answer.join('');
      o.onUsage?.({ tokensIn, tokensOut });
      if (said) o.onText?.(redact(said));
      resolve({
        ok,
        // 53 : limite de tours dépassée (même sens que « error_max_turns » de Claude : une analyse tronquée n'est pas un refus d'accès)
        subtype: ok ? 'success' : code === 53 ? 'error_max_turns' : 'error',
        text: redact(ok ? said : [said, ...errors, stderr.trim()].filter(Boolean).join('\n')),
        allText: redact(said),
        costUsd: estimateCost(model, { inputTokens: tokensIn, outputTokens: tokensOut, cachedTokens }),
        tokensIn, tokensOut, turns,
        rateLimit: null,
      });
    });
  });
}

/**
 * Valide une clé API par un appel qui ne consomme aucun token : liste des modèles.
 * Une clé invalide répond HTTP 400 (« API key not valid », raison API_KEY_INVALID), vérifié sur l'API le 4 novembre 2026 ;
 * 401 et 403 sont aussi des refus. Erreur réseau ou réponse inattendue : message distinct (la clé n'est pas jugée).
 */
export async function validateApiKey(key, fetchFn = fetch) {
  let r;
  try {
    r = await fetchFn(MODELS_URL, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new HttpError(502, 'Impossible de joindre Google pour vérifier la clé (réseau). Réessaie dans un instant.', { expose: true });
  }
  if ([400, 401, 403].includes(r.status)) throw new HttpError(400, 'Clé API refusée par Google');
  if (!r.ok) throw new HttpError(502, `Google ne répond pas normalement (HTTP ${r.status}) : la clé n'a pas pu être vérifiée. Réessaie plus tard.`, { expose: true });
}

export const geminiProvider = {
  id: 'gemini',
  label: 'Gemini',
  company: 'Google',
  modes: {
    api_key: { env: SECRET_ENV.gemini.api_key, label: 'Clé API Google AI Studio' },
    // Pas de variable d'environnement : le secret est le fichier de connexion d'Antigravity CLI (`file`), un abonnement Google (`subscription`)
    google_account: { file: true, subscription: true, label: 'Compte Google' },
  },
  apiKey: { pattern: /^[A-Za-z0-9_.-]{20,200}$/, invalidFormat: 'Clé API invalide : copie-la en entier depuis Google AI Studio', validate: validateApiKey },
  bin: (cfg, mode) => (mode === 'google_account' ? cfg.agyBin : cfg.geminiBin),
  // Avec un compte Google (fichier de connexion), c'est Antigravity CLI ; avec une clé API, Gemini CLI
  run: (o) => (o.authFile ? runAgy(o) : runGemini(o)),
  rateLimitWindows: () => null,
  isAuthRefusal: (text) => isAuthRefusal(text) || isAgyRefusal(text),
};
