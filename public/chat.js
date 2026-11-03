// Page IA : envoi des messages à Claude et affichage de la réponse au fil de l'écriture (flux de lignes JSON, voir src/chat.js),
// pièces jointes (photos, vidéos, PDF, fichiers texte, projet AiTools) téléversées avant l'envoi (voir src/chatfiles.js).
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
  const tray = $('[data-chat-tray]');
  const fileInput = $('[data-chat-file]');
  const mode = root.dataset.mode === 'support' ? 'support' : 'claude';
  const base = mode === 'support' ? '/support' : '/chat';
  const projMenu = $('[data-chat-projmenu]'); // absent en mode Support
  const projList = $('[data-chat-projlist]');
  const MAX_FILES = Number(root.dataset.files) || 6;
  const MAX_MB = JSON.parse(root.dataset.mb || '{}');
  let ctrl = null;
  let busy = false;
  let seq = 0;
  const staged = []; // pièces jointes en préparation : { key, name, size, kind, id, status: 'up' | 'ok' | 'err', error }
  let project = root.dataset.project ? { id: Number(root.dataset.project), name: root.dataset.projectName } : null; // reste d'un message à l'autre

  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  const toBottom = () => log.scrollTo({ top: log.scrollHeight, behavior: 'instant' });
  const showError = (msg) => { errBox.textContent = msg; errBox.hidden = !msg; };
  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 200)}px`; };
  const mo = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
  const icon = (name) => `<svg class="ic" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${name}"></use></svg>`;
  const setBusy = (on) => {
    busy = on;
    sendBtn.disabled = on;
    stopBtn.hidden = !on;
    sendBtn.hidden = on;
    input.readOnly = on;
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // ---------- Pièces jointes ----------
  // Une pièce jointe dans le fil (même rendu que le serveur, src/chatviews.js) : aperçu pour une image ou une vidéo, pastille pour le reste
  function attNode(a) {
    if (a.kind === 'image') {
      const l = el('a', 'att att-img'); l.href = `/api/chat/files/${a.id}`; l.target = '_blank'; l.rel = 'noopener'; l.dataset.noajax = '';
      const i = el('img'); i.src = `/api/chat/files/${a.id}`; i.alt = a.name; l.append(i);
      return l;
    }
    if (a.kind === 'video') {
      const v = el('video', 'att att-video'); v.controls = true; v.preload = 'metadata'; v.src = `/api/chat/files/${a.id}`; v.setAttribute('aria-label', a.name);
      return v;
    }
    if (a.kind === 'project') { const s = el('span', 'att att-chip att-project'); s.innerHTML = icon('folder'); s.append(el('span', '', a.name)); return s; }
    const l = el('a', 'att att-chip'); l.href = `/api/chat/files/${a.id}`; l.target = '_blank'; l.rel = 'noopener'; l.dataset.noajax = '';
    l.innerHTML = icon(a.kind === 'video' ? 'film' : 'file');
    l.append(el('span', '', a.name), el('small', '', mo(a.size)));
    return l;
  }

  const limitMb = (file) => {
    const t = file.type || '';
    if (t.startsWith('image/')) return MAX_MB.image;
    if (t.startsWith('video/')) return MAX_MB.video;
    if (t === 'application/pdf') return MAX_MB.pdf;
    return MAX_MB.text;
  };

  function renderTray() {
    tray.replaceChildren();
    if (project) {
      const c = el('div', 'tray-chip tray-project');
      c.innerHTML = icon('folder');
      c.append(el('span', '', `Projet « ${project.name} »`));
      const x = el('button', 'tray-x'); x.type = 'button'; x.dataset.projectOff = ''; x.setAttribute('aria-label', 'Détacher le projet'); x.innerHTML = icon('x');
      c.append(x);
      tray.append(c);
    }
    for (const f of staged) {
      const c = el('div', `tray-chip${f.status === 'err' ? ' bad' : ''}`);
      if (f.status === 'ok' && f.kind === 'image') { const i = el('img'); i.src = `/api/chat/files/${f.id}`; i.alt = ''; c.append(i); }
      else if (f.status === 'up') c.append(el('span', 'spin-inline'));
      else c.innerHTML = icon(f.kind === 'video' ? 'film' : 'file');
      const label = el('span', 'tray-n', f.name);
      c.append(label, el('small', '', f.status === 'err' ? f.error : f.status === 'up' ? (f.kind === 'video' ? 'préparation…' : 'envoi…') : mo(f.size)));
      const x = el('button', 'tray-x'); x.type = 'button'; x.dataset.fileOff = f.key; x.setAttribute('aria-label', `Retirer ${f.name}`); x.innerHTML = icon('x');
      c.append(x);
      tray.append(c);
    }
    tray.hidden = !tray.children.length;
    const pending = staged.some((f) => f.status === 'up');
    sendBtn.disabled = busy || pending;
  }

  async function upload(file) {
    if (staged.length >= MAX_FILES) { showError(`${MAX_FILES} pièces jointes au plus par message.`); return; }
    const f = { key: ++seq, name: file.name || 'fichier', size: file.size, kind: 'file', id: null, status: 'up', error: '' };
    const cap = limitMb(file);
    if (cap && file.size > cap * 1048576) { f.status = 'err'; f.error = `plus de ${cap} Mo`; staged.push(f); renderTray(); return; }
    staged.push(f);
    renderTray();
    try {
      const r = await fetch('/api/chat/upload', {
        method: 'POST', body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name), Accept: 'application/json' },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Erreur ${r.status}`);
      Object.assign(f, { id: d.attachment.id, kind: d.attachment.kind, size: d.attachment.size, status: 'ok' });
    } catch (e) {
      f.status = 'err';
      f.error = e.message;
      showError(`${f.name} : ${e.message}`);
    }
    renderTray();
  }
  const addFiles = (files) => { showError(''); for (const file of files) upload(file); };

  $('[data-chat-attach]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { addFiles([...fileInput.files]); fileInput.value = ''; });
  // Glisser-déposer sur la conversation, et coller une image (capture d'écran) dans le champ
  const drop = $('.chat-main');
  for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); drop.classList.add('dragging'); } });
  for (const t of ['dragleave', 'drop']) drop.addEventListener(t, () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles([...e.dataTransfer.files]); } });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  tray.addEventListener('click', (e) => {
    const off = e.target.closest('[data-file-off]');
    if (off) {
      const i = staged.findIndex((f) => String(f.key) === off.dataset.fileOff);
      const [f] = staged.splice(i, 1);
      if (f?.id) fetch(`/api/chat/attachments/${f.id}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
      renderTray();
      return;
    }
    if (e.target.closest('[data-project-off]')) { project = null; renderTray(); }
  });

  // Projets dont on peut joindre le code (liste chargée à la première ouverture)
  let projectsLoaded = false;
  projMenu?.addEventListener('toggle', async () => {
    if (!projMenu.open || projectsLoaded) return;
    projList.innerHTML = window.AiTools.loadingHtml('Chargement…', { small: true });
    try {
      const r = await fetch('/api/chat/projects', { headers: { Accept: 'application/json' } });
      const d = await r.json();
      projectsLoaded = true;
      projList.replaceChildren();
      if (!d.projects?.length) projList.append(el('p', 'muted small', 'Aucun projet dont tu puisses joindre le code.'));
      for (const p of d.projects || []) {
        const b = el('button'); b.type = 'button'; b.role = 'menuitem'; b.dataset.projectPick = String(p.id); b.dataset.name = p.name;
        b.innerHTML = icon('folder');
        b.append(el('span', '', p.name));
        if (!p.analyzed) b.append(el('small', 'muted', 'pas encore analysé'));
        projList.append(b);
      }
    } catch { projList.replaceChildren(el('p', 'muted small', 'Impossible de charger les projets.')); }
  });
  projList?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-project-pick]');
    if (!b) return;
    project = { id: Number(b.dataset.projectPick), name: b.dataset.name };
    projMenu.open = false;
    renderTray();
    input.focus();
  });

  // ---------- Fil ----------
  function userBubble(text, atts) {
    const a = el('article', 'chat-msg user');
    if (atts.length) { const box = el('div', 'atts'); for (const x of atts) box.append(attNode(x)); a.append(box); }
    a.append(el('div', 'bubble', text));
    return a;
  }
  function botBubble() {
    const a = el('article', 'chat-msg bot');
    a.innerHTML = '<div class="bubble md streaming"><span class="typing" aria-label="Claude écrit"><i></i><i></i><i></i></span></div><div class="msg-status muted small" data-status hidden></div>';
    return a;
  }
  function addCopy(article, markdown) {
    const row = el('div', 'msg-actions');
    const b = el('button', 'link small');
    b.type = 'button';
    b.dataset.chatCopy = '';
    b.dataset.md = markdown;
    b.innerHTML = `${icon('copy')}Copier`;
    row.append(b);
    article.append(row);
  }

  // Nouvelle conversation : elle apparaît en tête de la liste et l'adresse devient /chat/<id> (sans recharger la page)
  function registerConversation(id, title) {
    root.dataset.conv = String(id);
    history.replaceState(null, '', `${base}/${id}`);
    for (const li of list.children) li.classList.remove('on');
    const li = el('li', 'on');
    li.dataset.conv = String(id);
    const a = el('a', '', title);
    a.href = `${base}/${id}`;
    a.setAttribute('aria-current', 'page');
    const del = el('button', 'chat-del');
    del.type = 'button';
    del.dataset.chatDel = String(id);
    del.setAttribute('aria-label', `Supprimer la conversation « ${title} »`);
    del.innerHTML = icon('trash');
    li.append(a, del);
    list.prepend(li);
    none.hidden = true;
  }

  async function send(text) {
    text = text.trim();
    const ready = staged.filter((f) => f.status === 'ok');
    if ((!text && !ready.length && !project) || busy || staged.some((f) => f.status === 'up')) return;
    showError('');
    setBusy(true);
    $('[data-chat-empty]')?.remove();
    const sentAtts = [...ready.map((f) => ({ id: f.id, kind: f.kind, name: f.name, size: f.size })), ...(project ? [{ kind: 'project', name: project.name }] : [])];
    const mine = userBubble(text || 'Voici les pièces jointes.', sentAtts);
    const bot = botBubble();
    log.append(mine, bot);
    toBottom();
    const keepStaged = [...staged];
    staged.length = 0;
    renderTray();
    input.value = '';
    grow();
    const bubble = $('.bubble', bot);
    const status = $('[data-status]', bot);
    let raw = '';
    let started = false;
    ctrl = new AbortController();
    try {
      const r = await fetch('/api/chat/send', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify({ message: text, conversationId: root.dataset.conv || null, model: modelSel?.value, projectId: mode === 'support' ? null : project?.id ?? null, mode, attachments: ready.map((f) => f.id) }),
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
            if (!root.dataset.conv) registerConversation(ev.conversationId, ev.title);
            else root.dataset.conv = String(ev.conversationId);
          } else if (ev.type === 'status') {
            status.hidden = false;
            status.textContent = ev.text;
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
            status.remove();
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
        status.remove();
        if (!raw) bot.remove(); else { bubble.append(document.createTextNode('\n(interrompu)')); }
      } else {
        bot.remove();
        if (e.notStored) {
          // Le message n'a pas été enregistré : on remet le texte et les pièces jointes pour réessayer
          mine.remove();
          input.value = text;
          grow();
          staged.push(...keepStaged);
          renderTray();
        }
        showError(e.message || 'Erreur');
      }
    } finally {
      ctrl = null;
      setBusy(false);
      renderTray();
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
      if (!(await window.AiTools.confirmBox('Supprimer cette conversation ?\nSes pièces jointes seront supprimées aussi.'))) return;
      const id = del.dataset.chatDel;
      try {
        const r = await fetch(`/api/chat/conversations/${id}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Erreur ${r.status}`);
      } catch (err) { showError(err.message); return; }
      del.closest('li').remove();
      none.hidden = list.children.length > 0;
      if (root.dataset.conv === id) { if (window.AiNav) window.AiNav.go(base); else location.href = base; }
    }
  });

  renderTray();
  grow();
  toBottom();
  if (!log.querySelector('.chat-msg')) input.focus();
})();
