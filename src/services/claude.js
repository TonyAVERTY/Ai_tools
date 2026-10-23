// Lance Claude Code en headless (`claude -p`) avec un périmètre d'outils restreint,
// et parse le flux stream-json pour remonter la progression en direct.
import { spawn } from 'node:child_process';
import { prepareLaunch } from './sandbox.js';

export const MODELS = { rapide: 'haiku', normal: 'sonnet', approfondi: 'opus' };

/**
 * @param {object} o
 * @param {string} o.prompt
 * @param {string} [o.cwd]          dossier de travail (clone du repo pour l'analyse)
 * @param {string} [o.model]        haiku | sonnet | opus
 * @param {number} [o.maxTurns]     borne dure sur le nombre d'allers-retours (= tokens)
 * @param {string[]} [o.tools]      outils autorisés, tout le reste est refusé
 * @param {string} [o.system]       consignes ajoutées au prompt système
 * @param {(text:string)=>void} [o.onText]  appelé à chaque bloc texte de Claude
 * @param {(n:number)=>void} [o.onTurn]     appelé à chaque message de Claude (sert à estimer l'avancement)
 * @param {boolean} [o.chat]        conversation : AUCUN outil (ni fichiers, ni web, ni commandes), pas de session enregistrée, pas de commandes slash
 * @param {(text:string)=>void} [o.onDelta]  avec `chat` : appelé à chaque morceau de texte au fil de l'écriture
 * @param {AbortSignal} [o.signal]
 * @param {number} [o.timeoutMs]
 * @param {string} [o.bin]
 * @param {object} o.sandbox        cfg.sandbox (obligatoire : voir services/sandbox.js)
 * @param {Record<string,string>} [o.secretEnv]  secret de l'utilisateur du job (ANTHROPIC_API_KEY ou CLAUDE_CODE_OAUTH_TOKEN), transmis au seul processus enfant
 * @param {string} [o.allowedRoot]  dossier des clones de l'utilisateur : `cwd` doit s'y trouver
 */
export function runClaude(o) {
  const args = [
    '-p', o.prompt,
    '--output-format', 'stream-json', '--verbose',
    '--model', o.model || 'haiku',
    '--max-turns', String(o.maxTurns || 10),
    '--allowedTools', (o.tools || []).join(','),
    '--disallowedTools', 'Bash,Edit,Write,MultiEdit,NotebookEdit,Task',
  ];
  if (o.system) args.push('--append-system-prompt', o.system);
  if (o.chat) args.push('--tools', '', '--no-session-persistence', '--disable-slash-commands', '--include-partial-messages');

  const launch = prepareLaunch({
    bin: o.bin || 'claude', args, cwd: o.cwd, allowedRoot: o.allowedRoot,
    secretEnv: o.secretEnv, sandbox: o.sandbox,
  });
  const secrets = Object.values(o.secretEnv || {}).filter((v) => v && v.length >= 8);
  // Aucune trace du secret dans les erreurs, stderr ou textes remontés (journaux, base, réponses HTTP)
  const redact = (t) => secrets.reduce((acc, s) => acc.split(s).join('***'), String(t ?? ''));
  const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, stdio: ['ignore', 'pipe', 'pipe'] });

  return new Promise((resolve, reject) => {
    let buf = '';
    let stderr = '';
    let result = null;
    let rateLimit = null;
    let turns = 0;
    const texts = [];

    const timer = setTimeout(() => child.kill('SIGTERM'), o.timeoutMs || 30 * 60_000);
    o.signal?.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });

    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handle(line);
      }
    });
    child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-4000); });
    const done = () => { clearTimeout(timer); launch.cleanup(); };

    function handle(line) {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'stream_event') {
        // Texte en cours d'écriture (option --include-partial-messages) : transmis tel quel, le texte final vient du résultat
        const d = ev.event?.type === 'content_block_delta' ? ev.event.delta : null;
        if (d?.type === 'text_delta' && d.text) o.onDelta?.(redact(d.text));
      } else if (ev.type === 'assistant') {
        o.onTurn?.(++turns);
        for (const block of ev.message?.content || []) {
          if (block.type === 'text' && block.text) { texts.push(block.text); o.onText?.(redact(block.text)); }
        }
      } else if (ev.type === 'result') {
        result = ev;
      } else if (ev.type === 'rate_limit_event' && ev.rate_limit_info) {
        // Dernier reçu = état le plus à jour (session 5h + semaine), remonté à chaque appel
        rateLimit = ev.rate_limit_info;
      }
    }

    child.on('error', (e) => { done(); reject(new Error(redact(`Impossible de lancer Claude : ${e.message}`))); });
    child.on('close', (code) => {
      done();
      if (buf.trim()) handle(buf.trim());
      if (!result) return reject(new Error(redact(`Claude s'est arrêté sans résultat (code ${code}). ${stderr.trim()}`)));
      const usage = result.usage || {};
      resolve({
        ok: !result.is_error,
        subtype: result.subtype,           // success | error_max_turns | ...
        text: redact(result.result ?? texts.join('\n')),
        allText: redact(texts.join('\n')),
        costUsd: result.total_cost_usd ?? null,
        tokensIn: (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
        tokensOut: usage.output_tokens || 0,
        turns: result.num_turns,
        rateLimit,
      });
    });
  });
}

// Normalise la session (5h glissantes) et la semaine (7j glissants) quel que soit le détail
// exact remonté par la CLI. Pour afficher où en est le quota Pro avant de lancer un job.
export function rateLimitWindows(info) {
  if (!info) return null;
  const w = info.unifiedWindows || {};
  const pick = (k) => (w[k] && typeof w[k].utilization === 'number' ? { utilization: w[k].utilization, resetsAt: w[k].resetsAt ?? null } : null);
  const fiveHour = pick('five_hour');
  const sevenDay = pick('seven_day');
  if (!fiveHour && !sevenDay) return null;
  return { fiveHour, sevenDay };
}

// Extrait le premier objet JSON d'une réponse (Claude entoure parfois de ```json)
export function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const src = fenced ? fenced[1] : text;
  const start = src.search(/[[{]/);
  if (start < 0) throw new Error('Aucun JSON dans la réponse de Claude');
  const open = src[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, escNext = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (escNext) escNext = false;
      else if (c === '\\') escNext = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(src.slice(start, i + 1));
  }
  throw new Error('JSON incomplet dans la réponse de Claude');
}
