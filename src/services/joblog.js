// Journal borné par job, indépendant du dernier message de progression.
export const LOG_LIMIT = 120_000;
export function safeLogText(value) {
  return String(value ?? '').replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,})\b/g, '[secret masqué]')
    .replace(/((?:password|passwd|api[_-]?key|access[_-]?token|authorization|secret)\s*["']?\s*[:=]\s*["']?)[^\s"',;<>]+/gi, '$1[secret masqué]');
}
/**
 * Le journal entier (jusqu'à 120 Ko) est réécrit en base à chaque enregistrement. Les lignes sont donc regroupées : la première part tout de suite,
 * les suivantes au plus une fois par `minIntervalMs` (le rendu d'une vidéo en ajoute une par image : 900 écritures de 25 Mo au total sans cela).
 * `flush()` écrit ce qui reste sans attendre et rend la promesse de la dernière écriture (rejetée si elle a échoué).
 */
export function createJobLog(db, jobId, initial = [], { minIntervalMs = 500 } = {}) {
  let entries = initial, sequence = initial.at(-1)?.id || 0, lastProgress = '';
  let dirty = false, timer = null, lastWrite = 0, writing = Promise.resolve();
  const write = () => {
    clearTimeout(timer); timer = null;
    if (!dirty) return writing;
    dirty = false;
    lastWrite = Date.now();
    const snapshot = JSON.stringify(entries);
    // Une écriture en échec n'empêche pas les suivantes (la plus récente contient tout le journal)
    writing = writing.catch(() => {}).then(() => db.prepare('UPDATE jobs SET log_json = ? WHERE id = ?').run(snapshot, jobId));
    writing.catch(() => {});
    return writing;
  };
  return {
    append(kind, value) {
      let text = safeLogText(value);
      if ((!text.trim() && kind !== 'delta') || !text || (kind === 'progress' && text === lastProgress)) return;
      if (kind === 'progress') lastProgress = text;
      if (text.length > 20_000) text = text.slice(0, 20_000) + '\n[Sortie longue abrégée]';
      entries.push({ id: ++sequence, at: Date.now(), kind, text });
      let size = entries.reduce((n, e) => n + e.text.length, 0);
      while (entries.length > 400 || size > LOG_LIMIT) size -= entries.shift().text.length;
      dirty = true;
      if (timer) return;
      const wait = lastWrite + minIntervalMs - Date.now();
      if (wait <= 0) write();
      else { timer = setTimeout(write, wait); timer.unref?.(); }
    },
    flush: () => write(),
  };
}
