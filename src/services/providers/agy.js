// Moteur « Compte Google » du fournisseur Gemini : lance Antigravity CLI (`agy -p … --output-format stream-json`) avec l'ABONNEMENT Google de
// l'utilisateur (Google AI Plus, Pro, Ultra) et traduit son flux vers la forme commune des fournisseurs (voir providers/index.js).
//
// ATTENTION, règle de Google non tranchée : Google interdit explicitement d'atteindre le service de Gemini CLI par un logiciel tiers avec la
// connexion OAuth de ce CLI ; pour Antigravity CLI, aucune réponse claire sur l'orchestration depuis un autre logiciel. Ce mode est donc livré
// DÉSACTIVÉ (GOOGLE_ACCOUNT_ENABLED), derrière un consentement explicite de l'utilisateur (voir claudelink.js, GOOGLE_CONSENT_TEXT).
//
// Ce qui a été observé sur un vrai `agy` 1.5.2 (Linux, 6 novembre 2026) et ce qui en découle :
//  - la connexion est UN FICHIER, ~/.gemini/antigravity-cli/antigravity-oauth-token (563 octets), copiable : avec un dossier maison vide qui le
//    contient, `agy -p` répond ; sans lui, il répond « Authentication required » ;
//  - chaque exécution reçoit donc un dossier maison PROPRE (HOME), jetable, où le fichier est écrit puis relu (s'il a changé, il est rendu à
//    l'appelant : `onAuthFile`) ; les exécutions d'un même compte passent l'une après l'autre (services/userlock.js, appliqué par handlers.js) ;
//  - en mode sans écran, une commande shell est refusée d'office, MAIS l'écriture de fichiers est acceptée : toute la liste des outils dangereux
//    est donc refusée par des règles « deny » passées avec `--settings` (une écriture a bien été refusée : « Matches user-configured deny rule ») ;
//  - le mode `--mode plan` ne convient pas : il répond par un plan écrit dans un fichier, pas par le texte demandé ;
//  - le flux `stream-json` donne : init (outils), step_update (agent_response avec les tokens, tool…), result (réponse, tokens, tours).
// Ce que `agy` ne sait pas faire comme Claude Code : pas d'option « consignes système » (placées devant la demande) ; pas de coût en $ (estimé
// d'après services/pricing.js) ; aucun quota 5 h / 7 j lisible : `rateLimit` reste null.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { prepareLaunch } from '../sandbox.js';
import { estimateCost } from '../pricing.js';

export const TOKEN_FILE = ['.gemini', 'antigravity-cli', 'antigravity-oauth-token'];
export const CATALOG_DEFAULT = 'gemini-3.8-flash-high';
/** Modèles servis par `agy` avec un abonnement Google (`agy models`, 6 novembre 2026) : Gemini 3.8 Flash en trois niveaux de réflexion. */
const AGY_MODELS = ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low'];
/** Niveau du catalogue Gemini de l'application (économe, intermédiaire, plus cher) → niveau de réflexion d'agy. Un identifiant inconnu : le modèle par défaut d'agy. */
const FROM_CATALOG = { 'gemini-3.5-flash-lite': 'gemini-3.8-flash-low', 'gemini-3.1-flash-lite': 'gemini-3.8-flash-low', 'gemini-3.6-flash': 'gemini-3.8-flash-medium', 'gemini-3.8-flash': 'gemini-3.8-flash-high' };
export const agyModel = (id) => (AGY_MODELS.includes(id) ? id : FROM_CATALOG[id] ?? null);

/** Outils d'`agy` (liste annoncée par l'événement `init` d'agy 1.5.2) que l'application accorde, par nom d'outil Claude. */
const TOOL_NAMES = {
  Read: ['view_file', 'list_dir', 'find_by_name', 'grep_search'],
  Glob: ['list_dir', 'find_by_name'],
  Grep: ['grep_search'],
  WebSearch: ['search_web'],
  WebFetch: ['read_url_content'],
};
/** Nom Claude d'un outil `agy`, pour que le journal d'activité des jobs affiche la même chose qu'avec Claude. */
const CLAUDE_NAME = { view_file: 'Read', list_dir: 'Glob', find_by_name: 'Glob', grep_search: 'Grep', search_web: 'WebSearch', read_url_content: 'WebFetch' };
/** Tous les outils connus d'`agy` 1.5.2. Tout ce qui n'est pas accordé est REFUSÉ, y compris un outil ajouté plus tard sous l'un de ces noms. */
export const ALL_TOOLS = [
  'ask_custom_permission', 'ask_permission', 'ask_question', 'browser_click_element', 'browser_drag_pixel_to_pixel', 'browser_get_dom',
  'browser_get_network_request', 'browser_input', 'browser_list_network_requests', 'browser_mouse_down', 'browser_mouse_up', 'browser_move_mouse',
  'browser_press_key', 'browser_refresh_page', 'browser_resize_window', 'browser_scroll', 'browser_scroll_dom', 'browser_select_option',
  'browser_subagent', 'call_mcp_tool', 'capture_browser_console_logs', 'capture_browser_screenshot', 'click_browser_pixel', 'command_status',
  'define_subagent', 'delete_knowledge', 'execute_browser_javascript', 'find_by_name', 'generate_image', 'grep_search', 'invoke_subagent',
  'list_browser_pages', 'list_dir', 'list_permissions', 'list_plugin_accounts', 'list_resources', 'manage_inbox', 'manage_subagents', 'manage_task',
  'multi_replace_file_content', 'notebook_edit', 'notebook_execution', 'open_browser_url', 'read_browser_page', 'read_resource', 'read_url_content',
  'replace_file_content', 'run_command', 'run_workflow', 'schedule', 'search_marketplace', 'search_web', 'sed_file', 'send_command_input',
  'send_message', 'view_file', 'wait', 'wait_5_seconds', 'write_to_file',
];
/** Catégories d'actions de la documentation des permissions d'agy (`command(…)`, `write_file(…)`, `mcp(…)`…), refusées en plus des noms d'outils. */
const DENY_CATEGORIES = ['command', 'write_file', 'edit_file', 'delete_file', 'browser', 'mcp', 'subagent', 'notebook', 'schedule', 'message'];

/** Outils Claude demandés → noms d'outils agy accordés (`finish` termine le tour : toujours accordé). */
export function allowedTools(tools = []) {
  return ['finish', ...new Set(tools.flatMap((t) => TOOL_NAMES[t] || []))];
}

/** Règles « deny » : tout outil non accordé, par nom d'outil et par catégorie d'action. */
export function denyRules(tools = []) {
  const ok = new Set(allowedTools(tools));
  return [...ALL_TOOLS.filter((t) => !ok.has(t)).map((t) => `${t}(*)`), ...DENY_CATEGORIES.map((c) => `${c}(*)`)];
}

/** Réglages de CE lancement (`--settings`, jamais enregistrés par agy). */
export function settingsFor(o) {
  return { permissions: { deny: denyRules(o.tools) } };
}

/** Arguments du CLI. Pas d'option « consignes système » : elles sont placées devant la demande. */
export function buildArgs(o) {
  const prompt = o.system ? `${o.system}\n\n---\n\n${o.prompt}` : o.prompt;
  const args = ['-p', prompt, '--output-format', 'stream-json', '--settings', JSON.stringify(settingsFor(o)), '--disable-slash-commands'];
  const model = agyModel(o.model);
  if (model) args.push('--model', model);
  return args;
}

/** Réponse qui signifie « accès refusé » (connexion absente, expirée, révoquée) : au sens strict, jamais une panne réseau ni un quota épuisé. */
export const isAuthRefusal = (text) => /authentication required|please visit the url to log in|invalid_grant|unauthenticated|token (has )?(expired|been revoked)|not logged in|login required/i.test(String(text ?? ''));

/** Valeurs du fichier de connexion à masquer dans tout ce qui sort : le fichier entier, et chaque texte assez long s'il est en JSON. */
export function tokenSecrets(authFile) {
  const out = new Set();
  const text = String(authFile ?? '').trim();
  if (text.length >= 8) out.add(text);
  const walk = (v) => { if (typeof v === 'string') { if (v.length >= 20) out.add(v); } else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  try { walk(JSON.parse(text)); } catch { /* fichier non JSON : le texte entier suffit */ }
  return [...out];
}

/** Paramètres d'un outil agy → ceux que lit le journal d'activité (noms Claude). */
const toolInput = (p = {}) => ({ ...p, file_path: p.file_path ?? p.AbsolutePath ?? p.absolute_path ?? p.path, pattern: p.pattern ?? p.Query ?? p.query, query: p.query ?? p.Query ?? p.pattern });

/** Lance Antigravity CLI. Mêmes options et même résultat que runClaude (services/claude.js). */
export function runAgy(o) {
  // Dossier maison propre à CETTE exécution (HOME) : le fichier de connexion y est écrit, puis relu à la fin (agy a pu le renouveler).
  // Il n'est pas dans /tmp si `workRoot` est donné (un dossier de l'application, créé en 0700), comme pour Codex.
  if (o.workRoot) mkdirSync(o.workRoot, { recursive: true, mode: 0o700 });
  const home = mkdtempSync(join(o.workRoot || tmpdir(), 'agy-home-'));
  const tokenPath = join(home, ...TOKEN_FILE);
  mkdirSync(dirname(tokenPath), { recursive: true, mode: 0o700 });
  writeFileSync(tokenPath, o.authFile, { mode: 0o600 });
  const cleanHome = () => {
    try {
      const after = readFileSync(tokenPath, 'utf8');
      if (after.trim() && after.trim() !== String(o.authFile).trim()) o.onAuthFile?.(after);
    } catch { /* fichier supprimé par un échec : rien à rendre */ }
    rmSync(home, { recursive: true, force: true });
  };
  let launch;
  try {
    launch = prepareLaunch({
      bin: o.bin || 'agy', args: buildArgs(o), cwd: o.cwd, allowedRoot: o.allowedRoot,
      secretEnv: {}, sandbox: o.sandbox, extraDirs: o.extraDirs, extraRoot: o.extraRoot,
      homeDir: home, rwDirs: [home],
    });
  } catch (e) { cleanHome(); throw e; }
  const secrets = [...(o.secrets || []), ...tokenSecrets(o.authFile)].filter((v) => v && v.length >= 8);
  const redact = (t) => secrets.reduce((acc, s) => acc.split(s).join('***'), String(t ?? ''));
  const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const maxActions = o.maxTurns || 10;

  return new Promise((resolve, reject) => {
    let buf = '', stderr = '';
    let result = null, turns = 0, tooMany = false, needLogin = false;
    const answer = [], errors = [];
    const timer = setTimeout(() => child.kill('SIGTERM'), o.timeoutMs || 30 * 60_000);
    o.signal?.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
    const done = () => { clearTimeout(timer); launch.cleanup(); cleanHome(); };
    // Sans connexion valable, agy affiche un lien et attend un code 60 s : on n'attend pas, c'est un refus d'accès
    const watchLogin = (text) => { if (!needLogin && /authentication required|please visit the url to log in/i.test(text)) { needLogin = true; child.kill('SIGTERM'); } };

    function handle(line) {
      let ev;
      try { ev = JSON.parse(line); } catch { watchLogin(line); return; }
      if (ev.event === 'step_update') {
        const s = ev.step_update || {};
        if (s.step_type === 'agent_response' && s.state === 'DONE' && typeof s.text_delta === 'string' && s.text_delta) {
          answer.push(s.text_delta);
          o.onDelta?.(redact(s.text_delta));
        } else if (s.step_type === 'tool' && s.state === 'ACTIVE' && s.step_index !== undefined && !handle.seen.has(s.step_index)) {
          handle.seen.add(s.step_index);
          turns += 1;
          o.onTurn?.(turns);
          const name = s.tool_name ?? s.tool?.name ?? s.name ?? 'outil';
          o.onTool?.(CLAUDE_NAME[name] || name, toolInput(s.tool_input ?? s.tool?.input ?? s.input ?? s.parameters));
          if (++handle.actions > maxActions && !tooMany) { tooMany = true; child.kill('SIGTERM'); }
        }
      } else if (ev.event === 'result') {
        result = ev.result || {};
      } else if (ev.event === 'error' || ev.error) {
        errors.push(String(ev.message ?? ev.error?.message ?? ev.error ?? ''));
      }
    }
    handle.seen = new Set();
    handle.actions = 0;

    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(line); }
    });
    child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-4000); watchLogin(stderr); });
    child.on('error', (e) => { done(); reject(new Error(redact(`Impossible de lancer Antigravity : ${e.message}`))); });
    child.on('close', (code) => {
      done();
      if (buf.trim()) handle(buf.trim());
      if (needLogin) return reject(new Error('Authentication required : la connexion du compte Google est expirée ou révoquée.'));
      if (!result && !tooMany) return reject(new Error(redact(`Antigravity s'est arrêté sans résultat (code ${code}). ${[...errors, stderr.trim()].filter(Boolean).join(' ')}`)));
      const u = result?.usage || {};
      const tokensIn = (Number(u.input_tokens) || 0) + (Number(u.cache_read_tokens) || 0);
      const tokensOut = (Number(u.output_tokens) || 0) + (Number(u.thinking_tokens) || 0);
      const ok = !!result && result.status === 'SUCCESS' && code === 0 && !tooMany;
      const said = typeof result?.response === 'string' && result.response ? result.response : answer.join('');
      o.onUsage?.({ tokensIn, tokensOut });
      if (said) o.onText?.(redact(said));
      // Un outil refusé par nos règles n'est pas une panne : l'IA le dit dans sa réponse. Un refus qui ne produit RIEN est dit tel quel.
      resolve({
        ok,
        subtype: ok ? 'success' : tooMany ? 'error_max_turns' : 'error',
        text: redact(ok ? said : [said, ...errors, stderr.trim()].filter(Boolean).join('\n')),
        allText: redact(said),
        costUsd: estimateCost(o.model || CATALOG_DEFAULT, { inputTokens: tokensIn, outputTokens: tokensOut, cachedTokens: Number(u.cache_read_tokens) || 0 }),
        tokensIn, tokensOut, turns: Number(result?.num_turns) || turns,
        rateLimit: null,
      });
    });
  });
}
