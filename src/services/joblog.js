// Journal borné par job, indépendant du dernier message de progression.
export const LOG_LIMIT = 120_000;
export function safeLogText(value) {
  return String(value ?? '').replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,})\b/g, '[secret masqué]')
    .replace(/((?:password|passwd|api[_-]?key|access[_-]?token|authorization|secret)\s*["']?\s*[:=]\s*["']?)[^\s"',;<>]+/gi, '$1[secret masqué]');
}
export function createJobLog(db, jobId, initial = []) {
  let entries = initial, sequence = initial.at(-1)?.id || 0, chain = Promise.resolve(), lastProgress = '';
  return {
    append(kind, value) {
      let text = safeLogText(value);
      if ((!text.trim() && kind !== 'delta') || !text || (kind === 'progress' && text === lastProgress)) return;
      if (kind === 'progress') lastProgress = text;
      if (text.length > 20_000) text = text.slice(0, 20_000) + '\n[Sortie longue abrégée]';
      entries.push({ id: ++sequence, at: Date.now(), kind, text });
      let size = entries.reduce((n, e) => n + e.text.length, 0);
      while (entries.length > 400 || size > LOG_LIMIT) size -= entries.shift().text.length;
      const snapshot = JSON.stringify(entries);
      chain = chain.then(() => db.prepare('UPDATE jobs SET log_json = ? WHERE id = ?').run(snapshot, jobId));
      chain.catch(() => {});
    },
    flush: () => chain,
  };
}
