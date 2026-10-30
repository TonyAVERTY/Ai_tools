// Compteurs fournis par Claude, regroupés par message pour éviter les doublons flux/bloc final.
export function createLiveUsage(onUsage = () => {}) {
  const messages = new Map();
  let current = null, sequence = 0, last = '';
  return (ev) => {
    const e = ev.type === 'stream_event' ? ev.event : null;
    let id, usage;
    if (e?.type === 'message_start') { current = e.message?.id || `message-${++sequence}`; id = current; usage = e.message?.usage; }
    else if (e?.type === 'message_delta') { id = current; usage = e.usage; }
    else if (ev.type === 'assistant' && ev.message?.usage) { id = ev.message.id || current || `message-${++sequence}`; usage = ev.message.usage; }
    if (!id || !usage) return;
    const old = messages.get(id) || {};
    const next = { ...old };
    for (const key of ['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens']) {
      if (Number.isFinite(usage[key]) && usage[key] >= 0) next[key] = Math.max(old[key] || 0, usage[key]);
    }
    messages.set(id, next);
    let tokensIn = 0, tokensOut = 0;
    for (const u of messages.values()) { tokensIn += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); tokensOut += u.output_tokens || 0; }
    const signature = `${tokensIn}/${tokensOut}`;
    if (signature !== last) { last = signature; onUsage({ tokensIn, tokensOut }); }
  };
}
