// Grouper les fragments du flux : une écriture par seconde, sans dupliquer le texte final.
export function createJobStream(log, secrets = []) {
  let buffer = '', timer = null, streamed = false;
  const keys = secrets.filter((s) => typeof s === 'string' && s.length >= 8);
  const redact = (text) => keys.reduce((t, key) => t.split(key).join('[secret masqué]'), text);
  const flush = (final = false) => {
    clearTimeout(timer); timer = null;
    // Retenir tout suffixe qui pourrait être le début d'un secret coupé entre deux fragments.
    let hold = 0;
    if (!final) for (const key of keys) for (let n = 1; n < key.length && n <= buffer.length; n++) {
      if (buffer.endsWith(key.slice(0, n))) hold = Math.max(hold, n);
    }
    const end = buffer.length - hold;
    if (end > 0) { log('delta', redact(buffer.slice(0, end))); buffer = buffer.slice(end); }
  };
  return {
    delta(text) { streamed = true; buffer += text; if (!timer) timer = setTimeout(() => flush(), 700); },
    block(text) { if (streamed) { flush(true); streamed = false; } else log('output', redact(text)); },
    finish() { flush(true); streamed = false; },
  };
}
