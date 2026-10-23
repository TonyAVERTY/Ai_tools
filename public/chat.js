// Page IA : envoi des messages à Claude et affichage de la réponse au fil de l'écriture (flux de lignes JSON, voir src/chat.js).
(() => {
  const root = document.getElementById('chat');
  if (!root) return;
  const $ = (sel, el = root) => el.querySelector(sel);
  const log = $('[data-chat-log]');
  const form = $('[data-chat-form]');
  const input = $('[data-chat-input]');
  const sendBtn = $('[data-chat-send]');
  const stopBtn = $('[data-chat-stop]');
  const errBox = $('[data-chat-error]');
  const list = $('[data-chat-list]');
  const none = $('[data-chat-none]');
  const modelSel = $('[data-chat-model]');
  let ctrl = null;
  let busy = false;

  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  const toBottom = () => log.scrollTo({ top: log.scrollHeight, behavior: 'instant' });
  const showError = (msg) => { errBox.textContent = msg; errBox.hidden = !msg; };
  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 200)}px`; };
  const setBusy = (on) => {
    busy = on;
    sendBtn.disabled = on;
    stopBtn.hidden = !on;
    sendBtn.hidden = on;
    input.readOnly = on;
  };

  function userBubble(text) {
    const a = document.createElement('article');
    a.className = 'msg user';
    const b = document.createElement('div');
    b.className = 'bubble';
    b.textContent = text;
    a.append(b);
    return a;
  }
  function botBubble() {
    const a = document.createElement('article');
    a.className = 'msg bot';
    a.innerHTML = '<div class="bubble md streaming"><span class="typing" aria-label="Claude écrit"><i></i><i></i><i></i></span></div>';
    return a;
  }
  function addCopy(article, markdown) {
    const row = document.createElement('div');
    row.className = 'msg-actions';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link small';
    b.dataset.chatCopy = '';
    b.dataset.md = markdown;
    b.innerHTML = '<svg class="ic" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-copy"></use></svg>Copier';
    row.append(b);
    article.append(row);
  }

  // Nouvelle conversation : elle apparaît en tête de la liste et l'adresse devient /chat/<id> (sans recharger la page)
  function registerConversation(id, title) {
    root.dataset.conv = String(id);
    history.replaceState(null, '', `/chat/${id}`);
    for (const li of list.children) li.classList.remove('on');
    const li = document.createElement('li');
    li.className = 'on';
    li.dataset.conv = String(id);
    const a = document.createElement('a');
    a.href = `/chat/${id}`;
    a.textContent = title;
    a.setAttribute('aria-current', 'page');
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'chat-del';
    del.dataset.chatDel = String(id);
    del.setAttribute('aria-label', `Supprimer la conversation « ${title} »`);
    del.innerHTML = '<svg class="ic" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-trash"></use></svg>';
    li.append(a, del);
    list.prepend(li);
    none.hidden = true;
  }

  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    showError('');
    setBusy(true);
    $('[data-chat-empty]')?.remove();
    const mine = userBubble(text);
    const bot = botBubble();
    log.append(mine, bot);
    toBottom();
    input.value = '';
    grow();
    const bubble = $('.bubble', bot);
    let raw = '';
    let started = false;
    ctrl = new AbortController();
    let stored = false; // le serveur a enregistré mon message (sinon je le remets dans le champ en cas d'erreur)
    try {
      const r = await fetch('/api/chat/send', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify({ message: text, conversationId: root.dataset.conv || null, model: modelSel?.value }),
      });
      if (r.status === 401) { location.href = '/login'; return; }
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        if (d.code === 'link_required') { location.href = '/link'; return; }
        throw Object.assign(new Error(d.error || `Erreur ${r.status}`), { notStored: true });
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          let ev;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'meta') {
            stored = true;
            if (!root.dataset.conv) registerConversation(ev.conversationId, ev.title);
            else root.dataset.conv = String(ev.conversationId);
          } else if (ev.type === 'delta') {
            const stick = nearBottom();
            if (!started) { started = true; bubble.textContent = ''; }
            raw += ev.text;
            bubble.textContent = raw;
            if (stick) toBottom();
          } else if (ev.type === 'done') {
            bubble.classList.remove('streaming');
            bubble.innerHTML = ev.message.html;
            bot.dataset.id = String(ev.message.id);
            addCopy(bot, ev.message.content);
            toBottom();
            raw = null;
          } else if (ev.type === 'error') {
            throw new Error(ev.error);
          }
        }
      }
      if (raw !== null) throw new Error('La réponse a été interrompue : réessaie.');
    } catch (e) {
      if (e.name === 'AbortError') {
        // « Arrêter » : on garde ce qui est déjà écrit, sans l'enregistrer
        bubble.classList.remove('streaming');
        if (!raw) bot.remove(); else { bubble.append(document.createTextNode('\n(interrompu)')); }
      } else {
        bot.remove();
        if (e.notStored) { mine.remove(); input.value = text; grow(); }
        showError(e.message || 'Erreur');
      }
    } finally {
      ctrl = null;
      setBusy(false);
      input.focus();
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  stopBtn.addEventListener('click', () => ctrl?.abort());
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
  });

  root.addEventListener('click', async (e) => {
    const idea = e.target.closest('[data-chat-idea]');
    if (idea) { send(idea.textContent); return; }

    const copy = e.target.closest('[data-chat-copy]');
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.md); copy.lastChild.textContent = 'Copié'; }
      catch { copy.lastChild.textContent = 'Sélectionne et copie'; }
      setTimeout(() => { copy.lastChild.textContent = 'Copier'; }, 1800);
      return;
    }

    const del = e.target.closest('[data-chat-del]');
    if (del) {
      if (!confirm('Supprimer cette conversation ?')) return;
      const id = del.dataset.chatDel;
      try {
        const r = await fetch(`/api/chat/conversations/${id}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Erreur ${r.status}`);
      } catch (err) { showError(err.message); return; }
      del.closest('li').remove();
      none.hidden = list.children.length > 0;
      if (root.dataset.conv === id) { if (window.AiNav) window.AiNav.go('/chat'); else location.href = '/chat'; }
    }
  });

  grow();
  toBottom();
  if (!log.querySelector('.msg')) input.focus();
})();
