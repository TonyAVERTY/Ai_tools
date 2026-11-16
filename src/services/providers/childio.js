// Outils communs aux lanceurs de CLI d'IA (Claude Code, Codex, Gemini CLI, Antigravity) : lecture du flux et arrêt du processus.
import { StringDecoder } from 'node:string_decoder';

/**
 * Lit un flux ligne par ligne. Le décodage UTF-8 garde son état d'un morceau à l'autre : un caractère accentué coupé entre deux lectures
 * du tube (64 Ko) n'est pas remplacé par « � ». Renvoie `flush()`, à appeler à la fermeture pour traiter la dernière ligne sans retour chariot.
 */
export function readLines(stream, onLine) {
  const dec = new StringDecoder('utf8');
  let buf = '';
  stream.on('data', (chunk) => {
    buf += typeof chunk === 'string' ? chunk : dec.write(chunk);
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  });
  return () => {
    const rest = (buf + dec.end()).trim();
    buf = '';
    if (rest) onLine(rest);
  };
}

/** Garde la fin d'un flux d'erreurs (bornée). Renvoie une fonction qui donne le texte reçu. */
export function tailText(stream, max = 4000) {
  const dec = new StringDecoder('utf8');
  let text = '';
  stream.on('data', (chunk) => { text = (text + (typeof chunk === 'string' ? chunk : dec.write(chunk))).slice(-max); });
  return () => text;
}

/**
 * Délai maximal et annulation d'un processus enfant. L'arrêt est demandé poliment (SIGTERM) puis imposé (SIGKILL) après `graceMs` :
 * un CLI qui ignore SIGTERM ne garde jamais un job « en cours » indéfiniment. Un signal déjà annulé au lancement arrête tout de suite.
 * @returns {{stop: () => void, timedOut: () => boolean, clear: () => void}}  `clear()` à la fermeture du processus
 */
export function guardChild(child, { timeoutMs, signal, graceMs = 5000 } = {}) {
  let timedOut = false;
  let killTimer = null;
  const stop = () => {
    try { child.kill('SIGTERM'); } catch { /* déjà terminé */ }
    killTimer ??= setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* déjà terminé */ } }, graceMs);
  };
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, { once: true });
  return {
    stop,
    timedOut: () => timedOut,
    clear: () => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', stop); },
  };
}

/** « 5 minutes », « 90 secondes » : durée d'un délai dépassé, pour le message d'erreur. */
export const delayLabel = (ms) => (ms >= 120_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 1000)} secondes`);
