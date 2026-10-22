// Front vanilla, sans build. Polling léger uniquement sur les projets dépliés.
(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, body) {
    const r = await fetch(path, body === undefined ? { headers: { Accept: 'application/json' } } : {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
    });
    if (r.status === 401) { location.href = '/login'; throw new Error('Session expirée'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
    return data;
  }

  function toast(msg, kind = 'ok') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    document.body.append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 4200);
  }

  // Barres de progression : la largeur passe par le CSSOM (la CSP interdit les attributs style="").
  // On repart de la dernière valeur connue du job pour que la barre glisse au lieu de repartir de 0 à chaque rafraîchissement.
  const barMem = new Map();
  function paintBars(root) {
    $$('.bar > span[data-pct]', root).forEach((s) => {
      if (s.dataset.pct === '') return;
      const pct = Number(s.dataset.pct);
      const key = s.dataset.key;
      s.style.width = `${barMem.get(key) ?? 0}%`;
      void s.offsetWidth; // force le calcul pour déclencher la transition
      s.style.width = `${pct}%`;
      if (key) barMem.set(key, pct);
    });
  }
  const pctOf = (p) => (typeof p?.pct === 'number' ? Math.max(0, Math.min(100, Math.round(p.pct))) : null);
  const progressBar = (job) => {
    const v = pctOf(job.progress);
    return `<div class="bar${v === null ? ' indet' : ''}"><span data-key="${job.id}" data-pct="${v ?? ''}"></span></div>`;
  };

  const formData = (form) => Object.fromEntries(new FormData(form));
  const ago = (ts) => {
    if (!ts) return 'jamais';
    const m = Math.round((Date.now() / 1000 - ts) / 60);
    return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`;
  };
  const pct = (x) => `${Math.round(x * 100)} %`;
  const ACTIVE = ['queued', 'running'];
  const LABELS = {
    analyze: 'Analyse', prospect: 'Recherche', template: 'Modèle', send: 'Envoi', evolution: 'Évolutions',
    followup_template: 'Modèle de relance', followup: 'Relances', linkedin_post: 'Post LinkedIn',
  };

  // Champs en lecture seule à copier (lien d'invitation) : un clic sélectionne tout
  $$('input.copy').forEach((i) => i.addEventListener('focus', () => i.select()));

  // ---------- Barre du haut : page courante en surbrillance ----------
  $$('.topnav a.navlink').forEach((a) => {
    const here = a.pathname === '/' ? location.pathname === '/' : location.pathname === a.pathname || location.pathname.startsWith(`${a.pathname}/`);
    if (here) a.setAttribute('aria-current', 'page');
  });

  // ---------- Liaison Claude : fenêtre d'avertissement du mode abonnement ----------
  // Le serveur refuse de toute façon (400) une requête sans la case cochée ; ici on évite seulement l'envoi inutile.
  $$('[data-open-dialog]').forEach((b) => b.addEventListener('click', () => $('#' + b.dataset.openDialog)?.showModal()));
  $$('[data-close-dialog]').forEach((b) => b.addEventListener('click', () => b.closest('dialog')?.close()));
  // Un formulaire de liaison par abonnement ne se valide qu'une fois la case du risque cochée
  $$('form[data-consent-form]').forEach((f) => {
    const box = $('[data-consent]', f);
    const btn = $('[data-consent-submit]', f);
    if (box && btn) box.addEventListener('change', () => { btn.disabled = !box.checked; });
  });
  $('dialog[data-autoopen]')?.showModal();

  // Connexion guidée à Claude : 1) le serveur prépare le lien (petit chargement) et il s'ouvre dans une petite fenêtre,
  // 2) l'utilisateur se connecte et copie le code affiché par Claude : dès qu'il revient ici (ou colle), le code est
  // reconnu et envoyé tout seul, 3) le serveur récupère le jeton, la petite fenêtre se ferme et la page se recharge.
  // Fermer la fenêtre de dialogue annule la connexion en cours.
  const loginForm = $('form[data-claude-login]');
  if (loginForm) {
    const dlg = loginForm.closest('dialog');
    const step2 = $('[data-claude-step2]', dlg);
    const codeForm = $('form[data-claude-code]', dlg);
    const codeInput = $('input', codeForm);
    const CODE = /^[A-Za-z0-9_#.~-]{8,400}$/;
    let loginId = null;
    let popup = null;
    let sending = false;
    const busy = (form, on, label) => {
      const btn = $('button:not([type=button])', form);
      $('.spin-inline', btn).hidden = !on;
      $('[data-label]', btn).textContent = label;
      btn.disabled = on || (form === loginForm && !$('[data-consent]', form).checked);
    };
    const fail = (sel, e) => { const p = $(sel, dlg); p.textContent = e.message; p.hidden = false; };
    const closePopup = () => { try { popup?.close(); } catch { /* fenêtre déjà fermée ou inaccessible */ } popup = null; };

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      $('[data-claude-error]', dlg).hidden = true;
      // La fenêtre s'ouvre tout de suite, pendant le clic (sinon le navigateur la bloque), puis reçoit le lien
      popup = window.open('', 'aitools-claude-login', 'popup,width=520,height=760');
      busy(loginForm, true, 'Je prépare ton lien…');
      $('[data-claude-status]', loginForm).textContent = 'Ça prend quelques secondes.';
      try {
        const r = await api('/link/claude/login', { accept: 'on' });
        loginId = r.id;
        $('[data-claude-link]', dlg).href = r.url;
        if (popup) popup.location.href = r.url;
        loginForm.hidden = true;
        step2.hidden = false;
        $('[data-claude-hint-popup]', dlg).hidden = !popup;
        $('[data-claude-hint-link]', dlg).hidden = !!popup;
        codeInput.focus();
      } catch (err) {
        closePopup();
        fail('[data-claude-error]', err);
        busy(loginForm, false, 'Se connecter avec Claude');
      }
      $('[data-claude-status]', loginForm).textContent = '';
    });

    async function sendCode() {
      const code = codeInput.value.trim();
      if (sending || !loginId || !CODE.test(code)) return;
      sending = true;
      $('[data-claude-error2]', dlg).hidden = true;
      busy(codeForm, true, 'Je récupère ton jeton…');
      try {
        await api('/link/claude/login/code', { id: loginId, code });
        loginId = null;
        closePopup();
        location.href = '/';
      } catch (err) {
        // Le serveur a fermé cette connexion (code refusé, expirée) : on repart de l'étape 1 avec le message
        loginId = null; sending = false; closePopup();
        codeForm.reset();
        busy(codeForm, false, 'Terminer la connexion');
        step2.hidden = true;
        loginForm.hidden = false;
        busy(loginForm, false, 'Se connecter avec Claude');
        fail('[data-claude-error]', err);
      }
    }
    codeForm.addEventListener('submit', (e) => { e.preventDefault(); sendCode(); });
    // Code collé dans le champ : envoyé sans autre clic
    codeInput.addEventListener('paste', () => setTimeout(sendCode, 0));
    // Retour sur cette page après avoir copié le code chez Claude : on le lit dans le presse-papiers (le navigateur peut demander l'accord)
    async function fromClipboard() {
      if (step2.hidden || sending || !loginId || codeInput.value) return;
      try {
        const t = (await navigator.clipboard.readText()).trim();
        if (CODE.test(t)) { codeInput.value = t; sendCode(); }
      } catch { /* accès refusé ou non géré : le code se colle à la main */ }
    }
    window.addEventListener('focus', fromClipboard);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) fromClipboard(); });

    dlg.addEventListener('close', () => {
      if (loginId) api('/link/claude/login/cancel', { id: loginId }).catch(() => {});
      loginId = null; sending = false; closePopup();
      loginForm.hidden = false; step2.hidden = true; codeForm.reset();
      busy(loginForm, false, 'Se connecter avec Claude');
    });
  }

  // ---------- Barre système ----------
  // "IA 24 h : 0,42 $ / 2 $" : orange à 80 %, rouge une fois atteint
  function gauge(label, x) {
    const used = `${x.used.toFixed(2)} $`;
    if (!x.limit) return `<span title="Équivalent API, consommé sur ton quota Pro">IA ${label} : ${used}</span>`;
    const r = x.used / x.limit;
    return `<span class="${r >= 1 ? 'error' : r >= 0.8 ? 'warn' : ''}" title="Équivalent API, consommé sur ton quota Pro">IA ${label} : ${used} / ${x.limit} $</span>`;
  }

  // Quota du compte Claude Pro lui-même (session glissante de 5 h + semaine glissante de 7 j),
  // remonté par la CLI à chaque appel. Permet de décider en amont si une tâche vaut le coup.
  function resetLabel(ts) {
    if (!ts) return '';
    return new Date(ts * 1000).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  }
  function claudeBit(label, w) {
    if (!w) return '';
    const cls = w.utilization >= 1 ? 'error' : w.utilization >= 0.8 ? 'warn' : '';
    const reset = resetLabel(w.resetsAt);
    return `<span class="${cls}"${reset ? ` title="Réinitialisation ${esc(reset)}"` : ''}>Claude ${label} : ${pct(w.utilization)}</span>`;
  }
  function claudeQuota(rl, mode) {
    // Clé API : pas de quota d'abonnement à afficher
    if (mode === 'api_key') return '';
    if (!rl) return '<span class="muted" title="Mesuré après le premier job IA">Claude : pas encore mesuré</span>';
    return `${claudeBit('session 5h', rl.fiveHour)} ${claudeBit('semaine', rl.sevenDay)}`.trim();
  }

  // ---------- Menu « jobs » : détail de ce qui tourne, avec l'avancement ----------
  const jobsBox = $('#jobs');
  const jobsBtn = jobsBox && $('.jobs-btn', jobsBox);
  const jobsPop = jobsBox && $('.jobs-pop', jobsBox);
  const jobsOpen = () => jobsBtn?.getAttribute('aria-expanded') === 'true';
  const fmtWhen = (ts) => new Date(ts * 1000).toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

  function jobItem(j) {
    const p = j.progress || {};
    const scheduled = j.status === 'queued' && j.runAfter && j.runAfter * 1000 > Date.now();
    const running = j.status === 'running';
    const v = running ? pctOf(p) : null;
    const state = scheduled ? `Programmé ${fmtWhen(j.runAfter)}` : running ? `Démarré ${ago(j.startedAt)}` : 'En file d\'attente';
    const msg = p.message || (running ? 'En cours…' : '');
    return `<div class="jitem j-${scheduled ? 'scheduled' : j.status}">
      <div class="jrow">${scheduled ? '<span class="moon" aria-hidden="true"></span>' : running ? '<span class="pulse" aria-hidden="true"></span>' : '<span class="dot-wait" aria-hidden="true"></span>'}
        <strong>${esc(LABELS[j.type] || j.type)}</strong><span class="jproj">${j.project ? esc(j.project) : ''}</span>${v !== null ? `<span class="jpct">${v} %</span>` : ''}</div>
      ${msg ? `<div class="jmsg small muted">${esc(msg)}</div>` : ''}
      ${running ? progressBar(j) : ''}
      <div class="jmeta small muted"><span>${esc(state)}</span>
        <span>${j.projectId ? `<button type="button" class="link small" data-goto="${j.projectId}">Voir</button> · ` : ''}<button type="button" class="link small" data-cancel="${j.id}">Annuler</button></span></div>
    </div>`;
  }

  function renderJobsMenu(s) {
    if (!jobsBox) return;
    const list = s.jobs || [];
    jobsBox.hidden = !list.length;
    if (!list.length) { if (jobsOpen()) toggleJobs(false); return; }
    $('.spin-inline', jobsBtn).hidden = !s.queue;
    $('[data-jobs-count]', jobsBtn).textContent = s.queue
      ? `${plural(s.queue, 'job')}${s.scheduled ? ` · ${s.scheduled} cette nuit` : ''}`
      : `${plural(s.scheduled, 'programmé')} cette nuit`;
    const running = list.filter((j) => j.status === 'running').length;
    $('[data-jobs-sub]', jobsPop).textContent = `${running} en cours · ${list.length - running} en attente`;
    // Redessine seulement si le contenu change : sinon l'animation d'apparition rejouerait à chaque poll
    const html = list.map(jobItem).join('');
    const box = $('[data-jobs-list]', jobsPop);
    if (box._html === html) return;
    box._html = html;
    box.innerHTML = html;
    paintBars(jobsPop);
  }

  function toggleJobs(open = !jobsOpen()) {
    if (!jobsBtn) return;
    jobsBtn.setAttribute('aria-expanded', String(open));
    jobsPop.hidden = !open;
    if (open) {
      // Les lignes n'apparaissent en fondu qu'à l'ouverture, pas à chaque mise à jour
      jobsPop.classList.add('fresh');
      setTimeout(() => jobsPop.classList.remove('fresh'), 600);
      refreshSys();
    }
  }
  jobsBtn?.addEventListener('click', () => toggleJobs());
  document.addEventListener('click', (e) => {
    if (jobsOpen() && !e.target.closest('#jobs')) toggleJobs(false);
    const go = e.target.closest('[data-goto]');
    if (!go) return;
    sessionStorageSet('openProject', go.dataset.goto);
    const d = $(`details.project[data-id="${go.dataset.goto}"]`);
    if (!d) { location.href = '/'; return; }
    toggleJobs(false);
    d.open = true;
    d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && jobsOpen()) { toggleJobs(false); jobsBtn.focus(); } });

  let sysTimer;
  async function refreshSys() {
    clearTimeout(sysTimer);
    const el = $('#sys');
    if (!el) return;
    let busy = false;
    try {
      const s = await api('/api/system');
      const hot = s.temp !== null && s.temp >= 70;
      el.innerHTML = `${s.temp !== null ? `<span class="${hot ? 'warn' : ''}">${s.temp} °C</span>` : ''}
        ${claudeQuota(s.claudeRateLimit, s.linkMode)}
        ${gauge('24 h', s.budget.day)} ${gauge('30 j', s.budget.month)}
        ${s.budget.blocked ? '<span class="error">Budget IA atteint : jobs IA en attente</span>' : ''}`;
      renderJobsMenu(s);
      busy = s.queue > 0;
    } catch { /* silencieux */ }
    // Plus réactif quand quelque chose tourne ou que le menu est ouvert
    sysTimer = setTimeout(refreshSys, jobsOpen() ? 3000 : busy ? 6000 : 30_000);
  }
  refreshSys();

  // ---------- Rendu d'un job ----------
  function renderJob(box, job, type) {
    if (!box) return;
    if (!job) { box.innerHTML = ''; box._sig = ''; return; }
    const p = job.progress || {};
    const later = job.status === 'queued' && job.runAfter && job.runAfter * 1000 > Date.now();
    // Rien n'a changé : on ne touche pas au DOM (sinon les animations d'apparition rejoueraient à chaque poll)
    const sig = `${job.id}|${job.status}|${later}|${JSON.stringify(p)}`;
    if (box._sig === sig) return;
    box._sig = sig;
    if (later) {
      const at = new Date(job.runAfter * 1000).toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
      box.innerHTML = `<div class="running scheduled"><span class="moon" aria-hidden="true"></span>
        <div><div>${LABELS[type]} programmé(e) : ${esc(at)}</div><div class="small muted">Démarrage la nuit, quand ton quota Claude est libre.</div></div>
        <button class="btn small" data-cancel="${job.id}">Annuler</button></div>`;
      return;
    }
    if (ACTIVE.includes(job.status)) {
      const extra = type === 'prospect' && p.found !== undefined
        ? `<strong>${p.found}</strong> prospect(s) trouvé(s) sur ${p.target}` : '';
      const running = job.status === 'running';
      const v = running ? pctOf(p) : null;
      box.innerHTML = `<div class="running"><span class="spinner"></span>
        <div><div class="run-head"><span>${esc(p.message || (running ? 'En cours…' : 'En file d\'attente…'))}</span>${v !== null ? `<strong class="jpct">${v} %</strong>` : ''}</div>
          ${extra ? `<div class="small">${extra}</div>` : ''}${running ? progressBar(job) : ''}</div>
        <button class="btn small" data-cancel="${job.id}">Annuler</button></div>`;
      paintBars(box);
    } else if (job.status === 'error') {
      box.innerHTML = `<p class="error small">${LABELS[type]} en échec : ${esc(job.error)}</p>`;
    } else if (job.status === 'cancelled') {
      box.innerHTML = `<p class="muted small">${LABELS[type]} annulé(e).</p>`;
    } else if (job.status === 'done') {
      const r = job.result || {};
      let txt = `${LABELS[type]} terminé(e).`;
      if (type === 'prospect') txt = `Recherche terminée : ${r.found} nouveau(x) prospect(s) sur ${r.requested} demandés.`;
      if (type === 'send') txt = `Envoi terminé : ${r.sent} envoyé(s), ${r.failed} échec(s).`;
      if (type === 'followup') txt = r.postponed ? 'Relances reportées au prochain créneau (lun-ven 9h-18h).' : `Relances terminées : ${r.sent} envoyée(s), ${r.failed} échec(s).`;
      if (type === 'evolution') {
        const when = job.finishedAt ? new Date(job.finishedAt * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }) : '';
        // r.html est rendu et échappé par le serveur (src/services/markdown.js)
        box.innerHTML = `<div class="evo-done"><p class="ok small">Envoyé à ${esc(r.sentTo)}${when ? ` · ${esc(when)}` : ''}</p>
          <button type="button" class="btn small" data-copy-md>Copier le Markdown</button></div>
          ${r.html || `<pre class="md">${esc(r.markdown)}</pre>`}`;
        box._markdown = r.markdown;
        return;
      }
      box.innerHTML = `<p class="ok small">${esc(txt)}</p>`;
    }
  }

  // ---------- État d'un projet ----------
  const state = new Map(); // id -> { timer, tplStamp, analyzing }

  async function refreshProject(el) {
    const id = el.dataset.id;
    let s;
    try { s = await api(`/api/projects/${id}/status`); } catch (e) { return schedule(el, 30_000); }
    const st = state.get(id) || {};
    const jobs = s.jobs;
    for (const type of ['prospect', 'template', 'send', 'evolution', 'followup_template', 'followup', 'linkedin_post']) renderJob($(`[data-job="${type}"]`, el), jobs[type], type);

    const running = Object.entries(jobs).filter(([, j]) => ACTIVE.includes(j.status)).map(([t]) => LABELS[t]);
    $('[data-state]', el).innerHTML = running.length
      ? `<span class="spin-inline"></span>${esc(running.join(', '))}`
      : `<span class="muted small">${s.stats.total || 0} prospect(s)</span>`;

    // Fin d'un post LinkedIn → on recharge la zone pour afficher le brouillon
    const li = jobs.linkedin_post;
    if (li && ACTIVE.includes(li.status)) st.liRunning = true;
    else if (st.liRunning && li) { st.liRunning = false; loadLinkedin(el); }

    // Fin d'analyse → recharge la page pour afficher fiche + cible
    const an = jobs.analyze;
    if (an && ACTIVE.includes(an.status)) st.analyzing = true;
    else if (st.analyzing && an) {
      st.analyzing = false;
      if (an.status === 'done') { toast('Analyse terminée'); location.reload(); return; }
      if (an.status === 'error') toast(`Analyse en échec : ${an.error}`, 'error');
    }
    if (an?.status === 'error' && !s.hasProfile) $('.profile p', el).outerHTML = `<p class="error small">${esc(an.error)}</p>`;

    // Modèle de mail : on ne remplace le formulaire que s'il a changé côté serveur
    st.tplStamp ||= {};
    for (const kind of ['initial', 'followup']) {
      const t = s.templates[kind];
      const form = $(`form[data-action="template"][data-kind="${kind}"]`, el);
      if (t && st.tplStamp[kind] !== t.updated_at) {
        st.tplStamp[kind] = t.updated_at;
        form.subject.value = t.subject;
        if (form.subjectB) form.subjectB.value = t.subjectB || '';
        form.body.value = t.body;
      }
      $('[data-tpl-state]', form).innerHTML = t
        ? (t.status === 'validated' ? '<span class="badge ok">validé</span>' : '<span class="badge warn">brouillon</span>') : '';
    }

    // Relance automatique : ce qui est prévu, ou ce qui bloque
    const f = s.followup;
    $('[data-followup-info]', el).innerHTML = !f.enabled
      ? 'Désactivée.'
      : f.blockers.length
        ? `<span class="warn">En attente : ${esc(f.blockers.join(', '))}.</span> ${f.due} relance(s) due(s).`
        : f.due
          ? `${f.due} relance(s) due(s) : ${f.inHours ? 'envoi au prochain passage (≤ 15 min)' : 'envoi aux heures ouvrées (lun-ven 9h-18h)'}.`
          : `Active : les prospects sans réponse après ${f.days} jours seront relancés une fois.`;

    // Bouton Envoyer : recherche finie + modèle validé + SMTP + quota dispo
    const prospecting = jobs.prospect && ACTIVE.includes(jobs.prospect.status);
    const sending = jobs.send && ACTIVE.includes(jobs.send.status);
    const sendForm = $('form[data-action="send"]', el);
    const blockers = [];
    if (prospecting) blockers.push('recherche en cours');
    if (sending) blockers.push('envoi en cours');
    if (s.templates.initial?.status !== 'validated') blockers.push('modèle à valider');
    if (!s.hasSmtp) blockers.push('SMTP à configurer');
    if (!s.sendMax) blockers.push(s.stats.new ? 'plafond du jour atteint' : 'aucun prospect à contacter');
    $('button', sendForm).disabled = blockers.length > 0;
    sendForm.count.max = s.sendMax || 1;
    if (Number(sendForm.count.value) > s.sendMax && s.sendMax) sendForm.count.value = s.sendMax;
    $('[data-send-info]', sendForm).textContent = blockers.length
      ? `Bloqué : ${blockers.join(', ')}`
      : `${s.stats.new} prospect(s) en attente · max ${s.sendMax} maintenant`;
    $('[data-count]', el).textContent = `(${s.stats.total || 0})`;

    // Boîte de réception + test A/B
    const ib = $('[data-inbox]', el);
    const ab = s.ab.length > 1
      ? `<br>Test A/B : ${s.ab.map((v) => `<strong>${v.variant}</strong> ${v.replied}/${v.sent} réponses (${pct(v.rate)})`).join(' · ')}` : '';
    if (!s.hasImap) {
      ib.innerHTML = `<span class="muted">Boîte non connectée : configure l'IMAP (Configuration du projet) pour détecter les réponses.</span>${ab}`;
    } else {
      const i = s.inbox || {};
      const head = i.lastError ? `<span class="error">Boîte en erreur : ${esc(i.lastError)}</span>` : `Boîte vérifiée ${ago(i.lastOk)}`;
      ib.innerHTML = `${head} · ${i.replies || 0} réponse(s) · ${i.bounces || 0} adresse(s) invalide(s)
        <button class="btn small" data-inbox-check="${id}">Vérifier maintenant</button>${ab}`;
    }

    state.set(id, st);
    schedule(el, running.length ? 4000 : 30_000);
  }

  function schedule(el, ms) {
    const st = state.get(el.dataset.id) || {};
    clearTimeout(st.timer);
    st.timer = el.open ? setTimeout(() => refreshProject(el), ms) : null;
    state.set(el.dataset.id, st);
  }

  $$('details.project').forEach((el) => {
    el.addEventListener('toggle', () => { if (el.open) refreshProject(el); else schedule(el, 0); });
  });
  // Rouvre le dernier projet consulté après un reload
  const last = sessionStorageGet('openProject');
  if (last) { const el = $(`details.project[data-id="${last}"]`); if (el) el.open = true; }
  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }
  $$('details.project').forEach((el) => el.addEventListener('toggle', () => { if (el.open) sessionStorageSet('openProject', el.dataset.id); }));

  // ---------- LinkedIn ----------
  // Section d'un projet : relier un compte, donner une direction (facultative), générer / régénérer un post, le relire et le publier.
  const liDay = (ts) => new Date(ts * 1000).toLocaleDateString('fr-FR', { dateStyle: 'medium', timeZone: 'Europe/Paris' });

  async function loadLinkedin(proj) {
    const box = $('[data-linkedin]', proj);
    if (!box) return;
    try { renderLinkedin(box, await api(`/api/projects/${proj.dataset.id}/linkedin`), proj.dataset.id); }
    catch (e) { box.innerHTML = `<p class="error small">${esc(e.message)}</p>`; }
  }

  function renderLinkedin(box, s, id) {
    // Ne pas écraser ce que l'utilisateur est en train d'écrire
    if (box.contains(document.activeElement) && document.activeElement.matches('textarea')) return;
    if (!s.configured) {
      box.innerHTML = '<p class="muted">LinkedIn n\'est pas activé sur ce service : l\'administrateur doit renseigner les clés de l\'application LinkedIn.</p>';
      return;
    }
    const acc = s.account;
    if (!acc) {
      box.innerHTML = `<p>Relie un compte LinkedIn à ce projet : Claude pourra écrire des posts pour ce compte. AiTools demande seulement le droit de <strong>publier un post sur ton profil</strong>, et ne publie jamais sans ton clic.</p>
        ${s.canManage ? `<p><a class="btn primary" href="/linkedin/connect?project=${id}">Connecter LinkedIn</a></p>` : '<p class="muted small">Demande à un administrateur du projet de relier le compte.</p>'}`;
      return;
    }
    const head = `<div class="row li-head"><p><span class="badge ${acc.expired ? 'warn' : 'ok'}">${acc.expired ? 'connexion expirée' : 'connecté'}</span> <strong>${esc(acc.name)}</strong>
        ${acc.expiresAt ? `<span class="muted small">· ${acc.expired ? 'a expiré' : 'valable'} jusqu'au ${esc(liDay(acc.expiresAt))}</span>` : ''}</p>
      ${s.canManage ? `<span>${acc.expired ? `<a class="btn small primary" href="/linkedin/connect?project=${id}">Reconnecter</a> ` : ''}<button type="button" class="btn small danger" data-li-disconnect="${id}">Déconnecter</button></span>` : ''}</div>`;
    const posts = s.posts || [];
    const latest = posts[0];
    const draft = latest && latest.status !== 'published' ? latest : null;
    const direction = latest?.direction || '';
    const gen = !s.hasProfile ? '<p class="muted small">Analyse le projet d\'abord : Claude s\'appuie sur la fiche projet.</p>' : acc.expired ? '' : `<div class="li-gen">
        <label>De quoi doit parler le post ? <span class="muted small">(facultatif)</span>
          <textarea name="direction" rows="3" maxlength="500" data-li-direction placeholder="Ex. : le lancement de la nouvelle offre, un retour d'expérience, un conseil pour mes clients… Laisse vide : Claude choisit le sujet.">${esc(direction)}</textarea></label>
        <button type="button" class="btn primary" data-li-generate="${id}">${draft ? 'Régénérer un autre post' : 'Générer un post'}</button></div>`;
    const draftHtml = draft ? `<div class="li-draft"><label>Brouillon (modifiable)
        <textarea rows="11" maxlength="${s.maxLength}" data-li-body="${draft.id}">${esc(draft.body)}</textarea></label>
        <p class="muted small"><span data-li-count>${draft.body.length}</span> / ${s.maxLength} caractères${draft.direction ? ` · direction : « ${esc(draft.direction)} »` : ' · sujet choisi par Claude'}</p>
        <div class="row-actions"><button type="button" class="btn" data-li-save="${id}">Enregistrer</button>
          <button type="button" class="btn" data-li-copy>Copier</button>
          ${s.canManage && !acc.expired ? `<button type="button" class="btn primary" data-li-publish="${id}">Publier sur LinkedIn</button>` : '<span class="muted small">Un administrateur du projet publie.</span>'}</div></div>` : '';
    const history = posts.filter((x) => x !== draft && x.status === 'published');
    const hist = history.length ? `<details class="li-history"><summary>Posts publiés (${history.length})</summary>${history.map((x) => `<article class="card"><p class="muted small">Publié le ${esc(liDay(x.publishedAt))}</p><p class="li-text">${esc(x.body)}</p></article>`).join('')}</details>` : '';
    box.innerHTML = `${head}${gen}${draftHtml}${hist}`;
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-li-generate],[data-li-save],[data-li-copy],[data-li-publish],[data-li-disconnect]');
    if (!t) return;
    const proj = t.closest('.project');
    const id = proj?.dataset.id;
    const body = () => $('[data-li-body]', proj);
    try {
      if (t.matches('[data-li-generate]')) {
        t.disabled = true;
        const r = await api(`/api/projects/${id}/linkedin/generate`, { direction: $('[data-li-direction]', proj)?.value || '' });
        toast(r.budgetBlocked ? `En file, mais ${r.budgetBlocked}` : r.existing ? 'Un post est déjà en cours de rédaction' : 'Claude rédige le post…', r.budgetBlocked ? 'error' : 'ok');
        refreshProject(proj);
      } else if (t.matches('[data-li-save]')) {
        await api(`/api/projects/${id}/linkedin/post`, { postId: Number(body().dataset.liBody), body: body().value });
        toast('Brouillon enregistré');
      } else if (t.matches('[data-li-copy]')) {
        await navigator.clipboard.writeText(body().value);
        toast('Post copié');
      } else if (t.matches('[data-li-publish]')) {
        if (!confirm('Publier ce post sur LinkedIn ? Il sera visible publiquement par tout le monde.')) return;
        t.disabled = true;
        await api(`/api/projects/${id}/linkedin/publish`, { postId: Number(body().dataset.liBody), body: body().value, confirm: true });
        toast('Post publié sur LinkedIn');
        loadLinkedin(proj);
      } else if (t.matches('[data-li-disconnect]')) {
        if (!confirm('Déconnecter le compte LinkedIn de ce projet ? Les brouillons sont conservés.')) return;
        await api(`/api/projects/${id}/linkedin/disconnect`, {});
        loadLinkedin(proj);
      }
    } catch (err) { toast(err.message, 'error'); t.disabled = false; }
  });
  document.addEventListener('input', (e) => {
    const area = e.target.closest('[data-li-body]');
    if (area) $('[data-li-count]', area.closest('.project')).textContent = area.value.length;
  });
  $$('details[data-acc="linkedin"]').forEach((d) => d.addEventListener('toggle', () => { if (d.open) loadLinkedin(d.closest('.project')); }));

  // Retour de LinkedIn : message, puis on rouvre le projet concerné
  (() => {
    const q = new URLSearchParams(location.search);
    if (!q.has('li')) return;
    history.replaceState(null, '', location.pathname);
    if (q.get('li') === 'ok') toast('Compte LinkedIn relié au projet');
    else toast(q.get('m') || 'Connexion LinkedIn impossible', 'error');
    const proj = $(`details.project[data-id="${q.get('p')}"]`);
    if (proj) { proj.open = true; const acc = $('details[data-acc="linkedin"]', proj); if (acc) { acc.open = true; loadLinkedin(proj); } }
  })();

  // ---------- Sections dépliables animées ----------
  // <details class="anim"> : la hauteur du bloc qui suit le <summary> glisse à l'ouverture et à la fermeture.
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  document.addEventListener('click', (e) => {
    const sum = e.target.closest('summary');
    const d = sum?.parentElement;
    const body = sum?.nextElementSibling;
    if (!d?.matches('details.anim') || !body || reduceMotion.matches) return;
    e.preventDefault();
    d._anim?.cancel();
    const opening = !d.open || d.classList.contains('closing');
    const from = d.open ? body.getBoundingClientRect().height : 0;
    d.classList.remove('closing');
    if (opening) d.open = true;
    else d.classList.add('closing');
    const to = opening ? body.scrollHeight : 0;
    body.style.overflow = 'hidden';
    const anim = body.animate(
      [{ height: `${from}px`, opacity: opening ? 0 : 1 }, { height: `${to}px`, opacity: opening ? 1 : 0 }],
      { duration: Math.min(450, 200 + Math.abs(to - from) * 0.2), easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
    d._anim = anim;
    anim.oncancel = () => { body.style.overflow = ''; };
    anim.onfinish = () => {
      d._anim = null;
      body.style.overflow = '';
      if (!opening) { d.open = false; d.classList.remove('closing'); }
    };
  });

  // Le récap se charge à l'ouverture de sa section
  $$('details[data-acc="recap"]').forEach((d) => d.addEventListener('toggle', () => { if (d.open) loadRecap(d.closest('.project')); }));

  document.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy-md]');
    if (copy) {
      const md = copy.closest('.job')?._markdown || '';
      try { await navigator.clipboard.writeText(md); toast('Markdown copié'); } catch { toast('Copie impossible dans ce navigateur', 'error'); }
      return;
    }

    const runBtn = e.target.closest('[data-run]');
    if (runBtn) {
      const { run, id } = runBtn.dataset;
      if (run === 'analyze' && !confirm('Relancer l\'analyse complète du repo ? (consomme du quota Claude)')) return;
      try {
        const r = await api(`/api/projects/${id}/${run}`, {});
        toast(r.existing ? 'Déjà en cours' : 'Lancé');
        refreshProject(runBtn.closest('.project'));
      } catch (err) { toast(err.message, 'error'); }
      return;
    }

    const cancel = e.target.closest('[data-cancel]');
    if (cancel) {
      await api(`/api/jobs/${cancel.dataset.cancel}/cancel`, {}).catch((err) => toast(err.message, 'error'));
      // Depuis le menu du haut, le bouton n'est dans aucun projet : on rafraîchit tout ce qui est ouvert
      const proj = cancel.closest('.project');
      if (proj) refreshProject(proj);
      else $$('details.project[open]').forEach((el) => refreshProject(el));
      refreshSys();
      return;
    }

    if (e.target.matches('[data-recap-refresh]')) loadRecap(e.target.closest('.project'), true);

    if (e.target.closest('[data-report-send]')) {
      try { const r = await api('/api/report/send', {}); toast(`Rapport envoyé (${r.channels.join(' + ')})`); }
      catch (err) { toast(err.message, 'error'); }
      return;
    }

    if (e.target.closest('[data-notify-test]')) {
      try { await api('/api/notify/test', {}); toast('Notification envoyée sur Discord'); }
      catch (err) { toast(err.message, 'error'); }
      return;
    }

    const inboxBtn = e.target.closest('[data-inbox-check]');
    if (inboxBtn) {
      inboxBtn.disabled = true;
      try {
        const r = await api(`/api/projects/${inboxBtn.dataset.inboxCheck}/inbox/check`, {});
        toast(`Boîte lue : ${r.check.replies} nouvelle(s) réponse(s), ${r.check.bounces} rejet(s)`);
      } catch (err) { toast(err.message, 'error'); }
      refreshProject(inboxBtn.closest('.project'));
    }
  });

  // ---------- Formulaires ----------
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-action]');
    if (!form) return;
    e.preventDefault();
    const { action, id, confirm: question } = form.dataset;
    if (question && !confirm(question)) return;
    const data = formData(form);
    if (e.submitter?.name) data[e.submitter.name] = e.submitter.value;
    const proj = form.closest('.project');
    const btns = $$('button', form);
    btns.forEach((b) => { b.disabled = true; });
    try {
      switch (action) {
        case 'create': {
          const r = await api('/api/projects', data);
          toast('Projet créé, analyse lancée');
          setTimeout(() => location.reload(), 600);
          break;
        }
        case 'target': await api(`/api/projects/${id}/target`, data); toast('Cible validée'); setTimeout(() => location.reload(), 500); break;
        case 'prospect': {
          const r = await api(`/api/projects/${id}/prospect`, data);
          toast(r.budgetBlocked ? `En file, mais ${r.budgetBlocked}` : r.existing ? 'Une recherche est déjà prévue ou en cours' : data.when === 'night' ? 'Recherche programmée cette nuit' : 'Recherche lancée en arrière-plan', r.budgetBlocked ? 'error' : 'ok');
          break;
        }
        case 'evolution': {
          if (data.level === 'approfondi' && !confirm('Le niveau approfondi utilise Opus et consomme beaucoup de quota. Continuer ?')) break;
          const r = await api(`/api/projects/${id}/evolution`, data);
          toast(r.budgetBlocked ? `En file, mais ${r.budgetBlocked}` : r.existing ? 'Une recherche est déjà prévue ou en cours' : data.when === 'night' ? 'Évolutions programmées cette nuit' : 'Recherche d\'évolutions lancée', r.budgetBlocked ? 'error' : 'ok');
          break;
        }
        case 'template': {
          data.kind = form.dataset.kind;
          const r = await api(`/api/projects/${id}/template/save`, data);
          toast(r.status === 'validated' ? 'Modèle validé' : 'Brouillon enregistré');
          break;
        }
        case 'send': {
          const n = Number(data.count);
          if (!confirm(`Envoyer ${n} mail(s) de prospection maintenant ?\nIls partiront espacés de quelques dizaines de secondes.`)) break;
          await api(`/api/projects/${id}/send`, { count: n, confirm: true });
          toast('Envoi lancé');
          break;
        }
        case 'smtp': data.pass ||= ''; await api(`/api/projects/${id}/smtp`, data); toast('SMTP enregistré'); form.pass.value = ''; break;
        case 'imap': {
          const r = await api(`/api/projects/${id}/imap`, data);
          form.pass.value = '';
          if (r.disabled) toast('Détection des réponses désactivée');
          else if (r.ok) toast(`Boîte connectée : ${r.check.replies} réponse(s) trouvée(s)`);
          else toast(r.error, 'error');
          break;
        }
        case 'followup': {
          data.enabled = form.enabled.checked;
          await api(`/api/projects/${id}/followup`, data);
          toast(data.enabled ? 'Relance automatique activée' : 'Relance automatique désactivée');
          break;
        }
        case 'db': data.ssl = form.ssl.checked; await api(`/api/projects/${id}/db`, data); toast('Accès BDD enregistré'); form.password.value = ''; break;
        case 'delete': await api(`/api/projects/${id}/delete`, {}); location.reload(); break;
      }
      if (proj) refreshProject(proj);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btns.forEach((b) => { b.disabled = false; });
      if (proj && action !== 'send') refreshProject(proj);
    }
  });

  // ---------- Courbes (SVG maison : pas de lib externe, CSP stricte) ----------
  // Dessinées à la largeur réelle du conteneur (1 unité = 1 px) pour que les textes restent lisibles sur mobile.
  const M = { l: 46, r: 56, t: 12, b: 24, h: 150 };
  const niceMax = (v) => { if (!(v > 0)) return 1; const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
  const fmtVal = (v, unit) => (unit === '€'
    ? v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
    : v.toLocaleString('fr-FR', { maximumFractionDigits: 1 }));
  const shortDay = (d) => { const [, m, dd] = d.split('-'); return `${dd}/${m}`; };
  const yGrid = (w, max, unit, Y) => [0, 0.5, 1].map((f) => `<line class="grid" x1="${M.l}" x2="${w - M.r}" y1="${Y(max * f)}" y2="${Y(max * f)}"/>
    <text class="axis" x="${M.l - 6}" y="${Y(max * f) + 4}" text-anchor="end">${esc(fmtVal(max * f, unit))}</text>`).join('');

  function drawLine(fig, w) {
    const { unit, xs, ys } = JSON.parse(fig.dataset.series);
    const max = niceMax(Math.max(...ys));
    const step = (w - M.l - M.r) / (xs.length - 1);
    const X = (i) => M.l + i * step;
    const Y = (v) => M.t + (M.h - M.t - M.b) * (1 - v / max);
    const d = ys.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    const n = xs.length - 1;
    fig.querySelector('.plot').innerHTML = `<svg width="${w}" height="${M.h}" role="img" aria-label="${esc(fig.dataset.title)}">
      ${yGrid(w, max, unit, Y)}
      <text class="axis" x="${M.l}" y="${M.h - 6}">${shortDay(xs[0])}</text>
      <text class="axis" x="${w - M.r}" y="${M.h - 6}" text-anchor="end">${shortDay(xs[n])}</text>
      <path class="line" d="${d}"/>
      <circle class="dot" cx="${X(n)}" cy="${Y(ys[n])}" r="4"/>
      <text class="end" x="${X(n) + 8}" y="${Y(ys[n]) + 4}">${esc(fmtVal(ys[n], unit))}</text>
      <line class="cross" x1="0" x2="0" y1="${M.t}" y2="${M.h - M.b}"/>
      <circle class="dot hover" r="5"/>
      <rect class="hit" x="${M.l - step / 2}" y="0" width="${w - M.l - M.r + step}" height="${M.h}"/>
    </svg>`;
    fig._hover = (vx) => {
      const i = Math.max(0, Math.min(n, Math.round((vx - M.l) / step)));
      return { x: X(i), y: Y(ys[i]), html: `<strong>${esc(fmtVal(ys[i], unit))}</strong> · ${shortDay(xs[i])}` };
    };
  }

  // Barres arrondies en haut (4 px), à plat sur la ligne de base
  const bar = (x, y, bw, base) => {
    const r = Math.min(4, bw / 2, base - y);
    return base - y < 1 ? '' : `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${base}Z`;
  };

  function drawBars(fig, w) {
    const { weeks } = JSON.parse(fig.dataset.series);
    const max = niceMax(Math.max(1, ...weeks.flatMap((x) => [x.sent, x.replies])));
    const base = M.h - M.b;
    const Y = (v) => M.t + (base - M.t) * (1 - v / max);
    const gw = (w - M.l - M.r) / weeks.length;
    const bw = Math.max(3, Math.min(18, (gw - 8) / 2));
    // Une étiquette de date tous les ~56 px au minimum, quelle que soit la largeur
    const every = Math.max(1, Math.ceil(weeks.length / Math.max(1, Math.floor((w - M.l - M.r) / 56))));
    const marks = weeks.map((x, i) => {
      const x0 = M.l + i * gw + (gw - (2 * bw + 2)) / 2;
      const last = i === weeks.length - 1;
      return `<path class="b1" d="${bar(x0, Y(x.sent), bw, base)}"/><path class="b2" d="${bar(x0 + bw + 2, Y(x.replies), bw, base)}"/>
        ${(weeks.length - 1 - i) % every === 0 ? `<text class="axis" x="${x0 + bw + 1}" y="${M.h - 6}" text-anchor="middle">${shortDay(x.start)}</text>` : ''}
        ${last ? `<text class="end" x="${x0 + bw / 2}" y="${Y(x.sent) - 5}" text-anchor="middle">${x.sent}</text>
                  <text class="end" x="${x0 + bw * 1.5 + 2}" y="${Y(x.replies) - 5}" text-anchor="middle">${x.replies}</text>` : ''}`;
    }).join('');
    fig.querySelector('.plot').innerHTML = `<svg width="${w}" height="${M.h}" role="img" aria-label="${esc(fig.dataset.title)}">
      ${yGrid(w, max, '', Y)}<line class="base" x1="${M.l}" x2="${w - M.r}" y1="${base}" y2="${base}"/>${marks}
      <rect class="hit" x="${M.l}" y="0" width="${w - M.l - M.r}" height="${M.h}"/></svg>`;
    fig._hover = (vx) => {
      const i = Math.max(0, Math.min(weeks.length - 1, Math.floor((vx - M.l) / gw)));
      const x = weeks[i];
      const rate = x.sent ? ` (${Math.round((x.replies / x.sent) * 100)} %)` : '';
      return { x: M.l + (i + 0.5) * gw, y: Y(Math.max(x.sent, x.replies)), band: true,
        html: `Semaine du ${shortDay(x.start)}<br><strong>${x.sent}</strong> envoyé(s) · <strong>${x.replies}</strong> réponse(s)${rate}` };
    };
  }

  function drawChart(fig) {
    const w = Math.max(240, Math.floor(fig.querySelector('.plot').clientWidth));
    (fig.dataset.kind === 'bars' ? drawBars : drawLine)(fig, w);
  }

  // Survol : réticule + infobulle (souris et tactile)
  document.addEventListener('pointermove', (e) => {
    const svg = e.target.closest?.('.chart svg');
    const fig = svg?.closest('.chart');
    // L'attribut hidden n'agit pas sur les éléments SVG : on passe par une classe
    $$('.chart.hovering').forEach((c) => { if (c !== fig) { c.classList.remove('hovering'); c.querySelector('.tip').hidden = true; } });
    if (!svg) return;
    fig.classList.add('hovering');
    if (!fig._hover) return;
    const box = svg.getBoundingClientRect();
    const h = fig._hover(e.clientX - box.left);
    const cross = svg.querySelector('.cross');
    const dot = svg.querySelector('.dot.hover');
    if (cross) { cross.setAttribute('x1', h.x); cross.setAttribute('x2', h.x); }
    if (dot) { dot.setAttribute('cx', h.x); dot.setAttribute('cy', h.y); }
    const tip = fig.querySelector('.tip');
    tip.innerHTML = h.html;
    tip.hidden = false;
    tip.style.left = `${Math.min(box.width - 70, Math.max(70, h.x))}px`;
    tip.style.top = `${h.y + fig.querySelector('.plot').offsetTop - 8}px`;
  });

  function figure(kind, title, series, empty) {
    return `<figure class="chart" data-kind="${kind}" data-title="${esc(title)}" data-series="${esc(JSON.stringify(series))}">
      <figcaption>${esc(title)}</figcaption>
      ${kind === 'bars' ? '<p class="legend small"><span class="sw s1"></span>Mails envoyés <span class="sw s2"></span>Réponses</p>' : ''}${empty ? `<p class="muted small">${empty}</p>` : '<div class="plot"></div><div class="tip" hidden></div>'}</figure>`;
  }

  async function loadHistory(proj, days = 30) {
    const box = $('[data-charts]', proj);
    if (!box) return;
    let h;
    try { h = await api(`/api/projects/${proj.dataset.id}/history?days=${days}`); }
    catch (err) { box.innerHTML = `<p class="error small">${esc(err.message)}</p>`; return; }
    const kpi = (key, title, unit) => {
      const pts = h.daily.filter((d) => d[key] != null);
      return figure('line', title, { unit, xs: pts.map((d) => d.day), ys: pts.map((d) => d[key]) },
        pts.length < 2 ? 'Pas encore assez de données : une photo est prise chaque jour (et à chaque ouverture du récap).' : '');
    };
    box.innerHTML = `
      <div class="row chart-head"><h4>Évolution</h4>
        <div class="seg" role="group" aria-label="Période">${[30, 90].map((d) => `<button type="button" class="btn small" data-days="${d}" aria-pressed="${d === days}">${d} jours</button>`).join('')}</div>
      </div>
      <div class="charts">
        ${kpi('users', 'Utilisateurs', '')}${kpi('clients', 'Clients payants', '')}${kpi('revenue', 'Revenu total', '€')}
        ${figure('bars', 'Prospection par semaine', { weeks: h.weeks })}
      </div>
      <details class="small"><summary>Voir les données</summary>
        <div class="table-wrap"><table><thead><tr><th>Jour</th><th>Utilisateurs</th><th>Clients</th><th>Revenu</th></tr></thead><tbody>
          ${h.daily.map((d) => `<tr><td>${shortDay(d.day)}</td><td>${d.users ?? '–'}</td><td>${d.clients ?? '–'}</td><td>${d.revenue != null ? esc(fmtVal(d.revenue, '€')) : '–'}</td></tr>`).join('') || '<tr><td colspan="4">Aucune photo pour l\'instant.</td></tr>'}
        </tbody></table>
        <table><thead><tr><th>Semaine du</th><th>Envoyés</th><th>Réponses</th></tr></thead><tbody>
          ${h.weeks.map((x) => `<tr><td>${shortDay(x.start)}</td><td>${x.sent}</td><td>${x.replies}</td></tr>`).join('')}
        </tbody></table></div>
      </details>`;
    $$('.chart', box).forEach((fig) => { if (fig.querySelector('.plot')) drawChart(fig); });
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-days]');
    if (b) loadHistory(b.closest('.project'), Number(b.dataset.days));
  });
  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => $$('.chart .plot').forEach((p) => drawChart(p.closest('.chart'))), 150);
  });

  // ---------- Récap ----------
  async function loadRecap(proj, force = false) {
    const box = $('[data-recap]', proj);
    box.innerHTML = '<p class="muted"><span class="spin-inline"></span>Chargement…</p>';
    try {
      const r = await api(`/api/projects/${proj.dataset.id}/recap${force ? '?force' : ''}`);
      const b = r.business;
      const s = r.stats;
      const eur = (v) => (typeof v === 'number' ? v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : esc(v ?? '—'));
      box.innerHTML = `
        <div class="kpis">
          <div class="kpi"><span>Utilisateurs</span><strong>${b?.users ?? '—'}</strong></div>
          <div class="kpi"><span>Clients payants</span><strong>${b?.clients ?? '—'}</strong></div>
          <div class="kpi"><span>Revenu total</span><strong>${b ? eur(b.revenue) : '—'}</strong></div>
        </div>
        ${r.error ? `<p class="muted small">BDD : ${esc(r.error)}</p>` : ''}
        <h4>Prospection</h4>
        <div class="kpis">
          <div class="kpi"><span>Trouvés</span><strong>${s.total || 0}</strong></div>
          <div class="kpi"><span>Contactés</span><strong>${(s.sent || 0) + (s.replied || 0) + (s.client || 0) + (s.refused || 0)}</strong></div>
          <div class="kpi"><span>Réponses</span><strong>${(s.replied || 0) + (s.client || 0)}</strong></div>
          <div class="kpi"><span>Convertis</span><strong>${s.client || 0}</strong></div>
        </div>
        <p class="muted small">Coût IA du projet (équivalent API) : $${r.aiCostUsd.toFixed(2)}${b?.cached ? ' · chiffres en cache (10 min)' : ''}
        <button class="btn small" data-recap-refresh>Rafraîchir</button></p>
        <div data-charts></div>`;
      loadHistory(proj);
    } catch (err) { box.innerHTML = `<p class="error small">${esc(err.message)}</p>`; }
  }

  // ---------- Liste des prospects (mini CRM) ----------
  const STATUS = { new: 'À contacter', sent: 'Contacté', replied: 'A répondu', client: 'Client', refused: 'Refus', bounced: 'Rejeté' };
  // Seuls les liens http(s) sont cliquables : un "javascript:" venu d'une page web scrapée ne doit jamais s'exécuter ici
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
  const fmtDate = (ts) => new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });
  const isoDay = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }) : '');

  // ---------- Fiche prospect ----------
  const dlg = $('#prospect-dialog');

  async function openProspect(id) {
    let d;
    try { d = await api(`/api/prospects/${id}`); } catch (err) { toast(err.message, 'error'); return; }
    const p = d.prospect;
    const site = safeUrl(p.website);
    const source = safeUrl(p.source);
    const events = [
      ...d.mails.map((m) => ({
        at: m.sent_at,
        html: `<strong>${m.kind === 'followup' ? 'Relance' : 'Premier mail'}</strong>${m.variant ? ` <span class="muted">(objet ${esc(m.variant)})</span>` : ''} : ${esc(m.subject || '')}
          ${m.error ? `<span class="error"> · échec : ${esc(m.error)}</span>` : ''}`,
      })),
      ...(p.replied_at ? [{ at: p.replied_at, html: `<strong class="ok">Réponse reçue</strong> : ${esc(p.reply_subject || 'sans objet')}` }] : []),
    ].sort((a, b) => a.at - b.at);

    $('[data-dialog-body]', dlg).innerHTML = `
      <div class="row dlg-head">
        <div>
          <h3>${site ? `<a href="${esc(site)}" target="_blank" rel="noopener noreferrer">${esc(p.company)}</a>` : esc(p.company)}</h3>
          <div class="small muted"><a href="mailto:${esc(p.email)}">${esc(p.email)}</a>${p.city ? ` · ${esc(p.city)}` : ''}${p.sector ? ` · ${esc(p.sector)}` : ''}${p.score ? ` · score ${p.score}/10` : ''} · ${esc(STATUS[p.status] || p.status)}</div>
        </div>
        <button type="button" class="btn small" data-close>Fermer</button>
      </div>
      ${d.optOut ? `<p class="error small">Sur la liste d'opposition (${d.optOut.reason === 'bounce' ? 'adresse invalide' : d.optOut.reason === 'refused' ? 'refus' : 'désinscription'}) : ne plus contacter.</p>` : ''}
      ${p.hook ? `<p class="hook">« ${esc(p.hook)} »</p>` : ''}
      ${source ? `<p class="small muted">Email trouvé sur : <a href="${esc(source)}" target="_blank" rel="noopener noreferrer">${esc(source)}</a></p>` : ''}

      <h4>Historique</h4>
      ${events.length ? `<ol class="timeline">${events.map((e) => `<li><time>${fmtDate(e.at)}</time><div>${e.html}</div></li>`).join('')}</ol>` : '<p class="muted small">Pas encore contacté.</p>'}

      <h4>Prochaine action</h4>
      <form data-dlg="next" class="inline">
        <label>Quoi<input name="action" value="${esc(p.next_action || '')}" placeholder="ex. Rappeler après les vacances" maxlength="200"></label>
        <label>Quand<input type="date" name="day" value="${isoDay(p.next_action_at)}"></label>
        <button class="btn">Enregistrer</button>
        ${p.next_action ? '<button type="button" class="btn small" data-clear-next>Effacer</button>' : ''}
      </form>

      <h4>Notes</h4>
      <form data-dlg="note">
        <textarea name="body" rows="3" maxlength="2000" placeholder="Ce qu'il a dit, le contexte, ce qu'il faut retenir…"></textarea>
        <button class="btn">Ajouter la note</button>
      </form>
      <ul class="notes">${d.notes.map((n) => `<li><div class="small muted">${fmtDate(n.created_at)} · <button type="button" class="link small" data-del-note="${n.id}">supprimer</button></div><div class="note-body">${esc(n.body)}</div></li>`).join('')}</ul>`;
    dlg.dataset.id = id;
    if (!dlg.open) dlg.showModal();
  }

  function refreshOpenLists() { $$('details.prospects[open]').forEach((d) => loadProspects(d, Number(d.dataset.page) || 1)); }

  if (dlg) {
    dlg.addEventListener('click', async (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
      const id = dlg.dataset.id;
      const del = e.target.closest('[data-del-note]');
      if (del && confirm('Supprimer cette note ?')) {
        await api(`/api/prospects/${id}/notes/${del.dataset.delNote}/delete`, {}).catch((err) => toast(err.message, 'error'));
        openProspect(id);
      }
      if (e.target.closest('[data-clear-next]')) {
        await api(`/api/prospects/${id}/next`, { action: '' }).catch((err) => toast(err.message, 'error'));
        openProspect(id); refreshOpenLists();
      }
    });
    dlg.addEventListener('submit', async (e) => {
      const form = e.target.closest('form[data-dlg]');
      if (!form) return;
      e.preventDefault();
      const id = dlg.dataset.id;
      try {
        if (form.dataset.dlg === 'note') { await api(`/api/prospects/${id}/notes`, formData(form)); toast('Note ajoutée'); }
        else { await api(`/api/prospects/${id}/next`, formData(form)); toast('Prochaine action enregistrée'); refreshOpenLists(); }
        openProspect(id);
      } catch (err) { toast(err.message, 'error'); }
    });
  }
  // Import CSV : Excel enregistre souvent en Windows-1252, on détecte pour ne pas abîmer les accents
  document.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-import]');
    if (!input?.files?.length) return;
    const file = input.files[0];
    input.value = '';
    const d = input.closest('details.prospects');
    const report = $('[data-import-report]', d);
    if (file.size > 1024 * 1024) { toast('Fichier trop gros (1 Mo max, environ 2000 lignes)', 'error'); return; }
    const buf = await file.arrayBuffer();
    let csv;
    try { csv = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { csv = new TextDecoder('windows-1252').decode(buf); }
    try {
      const r = await api(`/api/projects/${input.dataset.import}/prospects/import`, { csv });
      report.innerHTML = `<p class="small"><span class="ok">${r.imported} importé(s)</span> sur ${r.total} ·
        ${r.duplicates} déjà présent(s) · ${r.blacklisted} sur liste d'opposition · ${r.invalid.length} invalide(s)</p>
        ${r.invalid.length ? `<details class="small"><summary>Lignes ignorées</summary><ul>${r.invalid.map((x) => `<li>Ligne ${x.line} : ${esc(x.reason)}</li>`).join('')}</ul></details>` : ''}`;
      toast(`${r.imported} prospect(s) importé(s)`);
      loadProspects(d);
    } catch (err) { report.innerHTML = ''; toast(err.message, 'error'); }
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-open-prospect]');
    if (b) openProspect(b.dataset.openProspect);
  });

  const fmtDay = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' }) : '');

  async function loadProspects(d, page = 1) {
    const proj = d.closest('.project');
    const box = $('[data-prospects]', d);
    const filters = formData($('[data-filters]', d));
    const qs = new URLSearchParams({ ...filters, page });
    // L'export suit les filtres affichés
    $('[data-export]', d).href = `/api/projects/${proj.dataset.id}/prospects.csv?${new URLSearchParams(filters)}`;
    try {
      const r = await api(`/api/projects/${proj.dataset.id}/prospects?${qs}`);
      d.dataset.page = r.page;
      box.innerHTML = r.rows.length ? `<div class="table-wrap"><table><thead><tr><th>Entreprise</th><th>Email</th><th>Ville</th><th>Score</th><th>Contacté</th><th>Statut</th></tr></thead><tbody>
        ${r.rows.map((x) => `<tr data-row="${x.id}"><td><button type="button" class="link" data-open-prospect="${x.id}">${esc(x.company)}</button>
            ${x.next_action ? `<div class="small ${x.next_action_at * 1000 <= Date.now() ? 'warn' : 'muted'}">→ ${esc(x.next_action)} (${fmtDay(x.next_action_at)})</div>` : ''}</td>
          <td>${esc(x.email)}</td><td>${esc(x.city)}</td><td>${x.score ?? ''}</td>
          <td>${fmtDay(x.sent_at)}${x.followup_at ? ' <span class="muted small">+ relance</span>' : ''}</td>
          <td><select data-prospect="${x.id}" class="st-${x.status}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === x.status ? 'selected' : ''}>${v}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted small">Aucun prospect ne correspond.</p>';
      $('[data-pager]', d).innerHTML = r.pages > 1
        ? `<button type="button" class="btn small" data-page="${r.page - 1}" ${r.page <= 1 ? 'disabled' : ''}>←</button>
           <span class="small muted">Page ${r.page} / ${r.pages} · ${r.total} prospect(s)</span>
           <button type="button" class="btn small" data-page="${r.page + 1}" ${r.page >= r.pages ? 'disabled' : ''}>→</button>`
        : `<span class="small muted">${r.total} prospect(s)</span>`;
    } catch (err) { box.innerHTML = `<p class="error small">${esc(err.message)}</p>`; }
  }

  $$('details.prospects').forEach((d) => {
    d.addEventListener('toggle', () => { if (d.open) loadProspects(d); });
    const form = $('[data-filters]', d);
    let t;
    form.addEventListener('input', (e) => { if (e.target.name === 'q') { clearTimeout(t); t = setTimeout(() => loadProspects(d), 300); } });
    form.addEventListener('change', (e) => { if (e.target.name !== 'q') loadProspects(d); });
    form.addEventListener('submit', (e) => { e.preventDefault(); loadProspects(d); });
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-page]');
      if (b) loadProspects(d, Number(b.dataset.page));
    });
  });
  document.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-prospect]');
    if (!sel) return;
    if (sel.value === 'refused' && !confirm('Marquer en refus ajoute l\'adresse à la liste d\'opposition. Continuer ?')) return;
    try { await api(`/api/prospects/${sel.dataset.prospect}/status`, { status: sel.value }); sel.className = `st-${sel.value}`; toast('Statut mis à jour'); }
    catch (err) { toast(err.message, 'error'); }
  });

  // ---------- Fond : constellation de particules qui fuient la souris ----------
  // Canvas 2D, ~90 points max : léger. Coupé quand l'onglet est caché, figé si l'OS demande moins d'animations.
  (function particles() {
    const cv = $('#bg');
    const ctx = cv?.getContext?.('2d');
    if (!ctx) return;
    const LINK = 120;   // distance max d'un trait entre deux points
    const R = 170;      // rayon d'influence de la souris
    const mouse = { x: -1e4, y: -1e4 };
    let W = 0, H = 0, pts = [], raf = 0, rgb = '47,91,234';

    const readColor = () => {
      const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
      if (m) rgb = m.slice(1).map((h) => parseInt(h, 16)).join(',');
    };
    const spawn = () => {
      const a = Math.random() * Math.PI * 2, s = 0.12 + Math.random() * 0.25;
      const bvx = Math.cos(a) * s, bvy = Math.sin(a) * s;
      return { x: Math.random() * W, y: Math.random() * H, vx: bvx, vy: bvy, bvx, bvy, r: 1 + Math.random() * 1.6 };
    };
    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = window.innerWidth; H = window.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(90, Math.max(24, (W * H) / 16000)));
      while (pts.length < n) pts.push(spawn());
      pts.length = n;
    }
    function step() {
      for (const p of pts) {
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy);
        if (d < R && d > 0.5) { const f = (1 - d / R) * 0.45; p.vx += (dx / d) * f; p.vy += (dy / d) * f; }
        // Revient doucement à sa dérive de base après une poussée
        p.vx += (p.bvx - p.vx) * 0.03; p.vy += (p.bvy - p.vy) * 0.03;
        p.x += p.vx; p.y += p.vy;
        if (p.x < -12) p.x = W + 12; else if (p.x > W + 12) p.x = -12;
        if (p.y < -12) p.y = H + 12; else if (p.y > H + 12) p.y = -12;
      }
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 > LINK * LINK) continue;
          ctx.strokeStyle = `rgba(${rgb},${((1 - Math.sqrt(d2) / LINK) * 0.2).toFixed(3)})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        const md = Math.hypot(a.x - mouse.x, a.y - mouse.y);
        if (md < R) {
          ctx.strokeStyle = `rgba(${rgb},${((1 - md / R) * 0.45).toFixed(3)})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
        }
      }
      for (const p of pts) {
        const glow = Math.max(0, 1 - Math.hypot(p.x - mouse.x, p.y - mouse.y) / R);
        ctx.fillStyle = `rgba(${rgb},${(0.45 + glow * 0.5).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r + glow * 1.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    const loop = () => { step(); draw(); raf = requestAnimationFrame(loop); };
    const start = () => { cancelAnimationFrame(raf); if (reduceMotion.matches) draw(); else raf = requestAnimationFrame(loop); };

    window.addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
    document.addEventListener('pointerleave', () => { mouse.x = mouse.y = -1e4; });
    window.addEventListener('blur', () => { mouse.x = mouse.y = -1e4; });
    // Un clic souffle les particules alentour
    window.addEventListener('pointerdown', (e) => {
      for (const p of pts) {
        const dx = p.x - e.clientX, dy = p.y - e.clientY, d = Math.hypot(dx, dy);
        if (d < 240 && d > 0.5) { const f = (1 - d / 240) * 5; p.vx += (dx / d) * f; p.vy += (dy / d) * f; }
      }
    }, { passive: true });
    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { resize(); start(); }, 120); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(raf); else start(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColor);
    reduceMotion.addEventListener('change', start);
    readColor(); resize(); start();
  })();
})();
