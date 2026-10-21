// Lance Claude Code en headless (`claude -p`) avec un périmètre d'outils restreint,
// et parse le flux stream-json pour remonter la progression en direct.
import { spawn } from 'node:child_process';

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
 * @param {AbortSignal} [o.signal]
 * @param {number} [o.timeoutMs]
 * @param {string} [o.bin]
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

  // nice : le serveur web reste réactif pendant qu'un job tourne
  const child = spawn('nice', ['-n', '10', o.bin || 'claude', ...args], {
    cwd: o.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    let buf = '';
    let stderr = '';
    let result = null;
    let rateLimit = null;
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

    function handle(line) {
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'assistant') {
        for (const block of ev.message?.content || []) {
          if (block.type === 'text' && block.text) { texts.push(block.text); o.onText?.(block.text); }
        }
      } else if (ev.type === 'result') {
        result = ev;
      } else if (ev.type === 'rate_limit_event' && ev.rate_limit_info) {
        // Dernier reçu = état le plus à jour (session 5h + semaine), remonté à chaque appel
        rateLimit = ev.rate_limit_info;
      }
    }

    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Impossible de lancer Claude : ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf.trim()) handle(buf.trim());
      if (!result) return reject(new Error(`Claude s'est arrêté sans résultat (code ${code}). ${stderr.trim()}`));
      const usage = result.usage || {};
      resolve({
        ok: !result.is_error,
        subtype: result.subtype,           // success | error_max_turns | ...
        text: result.result ?? texts.join('\n'),
        allText: texts.join('\n'),
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
