// Front vanilla, sans build. Polling léger uniquement sur les projets dépliés.
(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Montée en charge : un conseil (jamais un blocage) pendant la première semaine d'envois d'un projet
  const warmupLine = (w) => (w?.active ? ` · conseil : ${w.perDay / 2} à ${w.perDay} par jour cette première semaine` : '');
  const warmupNotice = (w, count) => (!w?.active || (w.sentToday || 0) + count <= w.perDay ? null
    : `Conseil : ${w.perDay / 2} à ${w.perDay} mails par jour pendant la première semaine protègent la réputation de ton adresse d'envoi (encore ${w.daysLeft} jour${w.daysLeft > 1 ? 's' : ''}). Tu peux quand même envoyer plus.`);

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
    followup_template: 'Modèle de relance', followup: 'Relances', linkedin_post: 'Post LinkedIn', audit: 'Audit', hook: 'Accroche',
  };

  // Champs en lecture seule à copier (lien d'invitation) : un clic sélectionne tout
  $$('input.copy').forEach((i) => i.addEventListener('focus', () => i.select()));

  // ---------- Barre du haut : page courante en surbrillance ----------
  $$('.pills a.pill, .user-pop a').forEach((a) => {
    const here = a.pathname === '/' ? location.pathname === '/' : location.pathname === a.pathname || location.pathname.startsWith(`${a.pathname}/`);
    if (here) a.setAttribute('aria-current', 'page');
  });

  // ---------- Nouveau projet : le formulaire s'ouvre sous le bouton ----------
  const newForm = $('#new-project');
  $$('[data-new-toggle]').forEach((b) => b.addEventListener('click', () => {
    if (!newForm) return;
    newForm.hidden = !newForm.hidden;
    $$('[data-new-toggle][aria-expanded]').forEach((t) => t.setAttribute('aria-expanded', String(!newForm.hidden)));
    if (!newForm.hidden) $('input', newForm)?.focus();
  }));

  // ---------- Menu du compte (avatar) : s'ouvre au survol, se ferme quand on le quitte ----------
  // Avec une souris : survol (le clic sur l'avatar ne le referme pas). Au doigt ou au clavier : clic / Entrée, comme un menu ordinaire.
  const userMenu = $('details.user');
  if (userMenu) {
    const hover = matchMedia('(hover: hover) and (pointer: fine)');
    const summary = $('summary', userMenu);
    let closeTimer;
    const open = (v) => { clearTimeout(closeTimer); userMenu.open = v; };
    userMenu.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && hover.matches) open(true); });
    userMenu.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse' || !hover.matches) return;
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => { userMenu.open = false; }, 220);
    });
    summary.addEventListener('click', (e) => { if (e.detail > 0 && hover.matches) e.preventDefault(); }); // clic souris : le survol l'a déjà ouvert
    document.addEventListener('click', (e) => { if (userMenu.open && !userMenu.contains(e.target)) open(false); });
    userMenu.addEventListener('keydown', (e) => { if (e.key === 'Escape' && userMenu.open) { open(false); summary.focus(); } });
  }

  // ---------- Réglages : le sommaire suit la lecture (la section en cours est surlignée en direct) ----------
  const tocLinks = $$('.settings .toc a[href^="#"]');
  if (tocLinks.length) {
    const sections = tocLinks.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
    let queued = false;
    const mark = (id) => tocLinks.forEach((a) => { if (a.getAttribute('href') === `#${id}`) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    const update = () => {
      queued = false;
      // La ligne de lecture descend du tiers de l'écran (haut de page) jusqu'au bas de l'écran (bas de page) : ainsi les dernières
      // sections, trop courtes pour jamais atteindre le tiers supérieur, sont elles aussi repérées, chacune à son tour.
      const range = document.documentElement.scrollHeight - innerHeight;
      const progress = range > 0 ? Math.min(1, Math.max(0, scrollY / range)) : 0;
      const line = innerHeight * (0.33 + 0.67 * progress);
      let cur = sections[0];
      for (const sec of sections) if (sec.getBoundingClientRect().top <= line) cur = sec;
      mark(cur.id);
    };
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    tocLinks.forEach((a) => a.addEventListener('click', () => mark(a.getAttribute('href').slice(1))));
    update();
  }

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
  // Ce que les jobs lancés PAR AiTools ont consommé (équivalent API). Ce que la personne fait ailleurs avec son Claude n'y est pas :
  // Anthropic ne le communique pas à une application ; le quota réel du compte est la mesure « Claude … » à côté.
  const GAUGE_TIP = "Équivalent API des jobs lancés par AiTools uniquement. Ce que tu fais ailleurs avec Claude n'est pas compté ici : vois le quota « Claude » à côté.";
  function gauge(label, x) {
    const used = `${x.used.toFixed(2)} $`;
    if (!x.limit) return `<span title="${GAUGE_TIP}">IA via AiTools ${label} : ${used}</span>`;
    const r = x.used / x.limit;
    return `<span class="${r >= 1 ? 'error' : r >= 0.8 ? 'warn' : ''}" title="${GAUGE_TIP}">IA via AiTools ${label} : ${used} / ${x.limit} $</span>`;
  }

  // Quota du compte Claude Pro lui-même (session glissante de 5 h + semaine glissante de 7 j),
  // remonté par la CLI à chaque appel. Permet de décider en amont si une tâche vaut le coup.
  function resetLabel(ts) {
    if (!ts) return '';
    return new Date(ts * 1000).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  }
  const WHY = {
    denied: "Anthropic refuse le relevé en direct avec ce jeton (relie-toi avec « Se connecter avec Claude »)",
    rate: 'Anthropic limite les relevés : nouvel essai dans une minute',
    network: 'Anthropic ne répond pas',
    unavailable: 'le relevé en direct est indisponible chez Anthropic',
    format: 'réponse inattendue du relevé en direct',
  };
  // Relevé en direct chez Anthropic : il compte tout l'usage du compte Claude, y compris hors AiTools.
  // Sinon : dernière mesure faite pendant un job, avec son âge et la raison.
  function claudeBit(label, w, rl) {
    if (!w) return '';
    if (w.expired) return `<span class="muted" title="Cette fenêtre a été remise à zéro depuis la dernière mesure">Claude ${label} : – (remise à zéro)</span>`;
    const cls = w.utilization >= 1 ? 'error' : w.utilization >= 0.8 ? 'warn' : '';
    const reset = resetLabel(w.resetsAt);
    const live = rl.source === 'live' && !rl.error;
    const title = `${live ? 'Relevé en direct chez Anthropic, tout ton usage Claude compris (y compris hors AiTools).' : `Dernière mesure ${ago(rl.at)} (pendant un job AiTools)${rl.error ? ` : ${WHY[rl.error] || 'relevé en direct indisponible'}` : ''}.`}${reset ? ` Réinitialisation ${reset}.` : ''}`;
    return `<span class="${cls}" title="${esc(title)}">Claude ${label} : ${pct(w.utilization)}${live ? '' : ` · ${esc(ago(rl.at))}`}</span>`;
  }
  function claudeQuota(rl, mode) {
    // Clé API : pas de quota d'abonnement à afficher
    if (mode === 'api_key') return '';
    if (!rl) return '<span class="muted" title="Le relevé en direct se fait avec ton abonnement Claude">Claude : pas encore mesuré</span>';
    if (!rl.fiveHour && !rl.sevenDay) return `<span class="muted" title="${esc(WHY[rl.error] || 'relevé indisponible')}">Claude : relevé indisponible</span>`;
    const why = rl.error ? ` <span class="warn" title="${esc(WHY[rl.error] || 'relevé indisponible')}">· relevé en direct impossible</span>` : '';
    return `${claudeBit('session 5h', rl.fiveHour, rl)} ${claudeBit('semaine', rl.sevenDay, rl)}${why}`.trim();
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
      if (type === 'audit') {
        const when = job.finishedAt ? new Date(job.finishedAt * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }) : '';
        // r.html est rendu et échappé par le serveur (src/services/markdown.js)
        box.innerHTML = `<div class="evo-done"><p class="ok small">Audit terminé${when ? ` · ${esc(when)}` : ''}</p>
          <button type="button" class="btn small" data-copy-md>Copier le rapport (Markdown)</button></div>
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
    for (const type of ['prospect', 'template', 'send', 'evolution', 'audit', 'followup_template', 'followup', 'linkedin_post']) renderJob($(`[data-job="${type}"]`, el), jobs[type], type);

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
    sendForm.dataset.warmup = JSON.stringify(s.warmup || {});
    if (Number(sendForm.count.value) > s.sendMax && s.sendMax) sendForm.count.value = s.sendMax;
    $('[data-send-info]', sendForm).textContent = blockers.length
      ? `Bloqué : ${blockers.join(', ')}`
      : `${s.stats.new} prospect(s) en attente · max ${s.sendMax} maintenant${warmupLine(s.warmup)}`;
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

    if (s.checklist) setChecklist(id, s.checklist);
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

  // ---------- Mise en route (liste en bas à gauche) ----------
  // Montre ce qui est configuré et ce qui reste à faire sur un projet ; chaque ligne ouvre la bonne section. Recalculée côté
  // serveur à chaque lecture (rien n'est mémorisé ici, sauf « réduite » et « masquée pour ce projet » dans ce navigateur).
  const todo = $('#todo');
  const checklists = new Map();
  let todoFocus = null;
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  const TICK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const DOT = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>';

  function setChecklist(id, c) {
    checklists.set(String(id), c);
    const el = $(`details.project[data-id="${id}"]`);
    if (el) markChecklist(el, c);
    if (String(id) === String(todoFocus)) renderTodo();
  }

  // Pastille « config 5/9 » sur le projet, coche sur chaque section dont toutes les étapes sont faites
  function markChecklist(el, c) {
    const byAcc = {};
    for (const s of c.steps) if (s.acc) (byAcc[s.acc] ||= []).push(s);
    for (const [acc, list] of Object.entries(byAcc)) {
      const sum = $(`details[data-acc="${acc}"] > summary`, el);
      if (sum) sum.classList.toggle('acc-done', list.every((s) => s.done));
    }
    const badge = $('[data-cfg]', el);
    if (!badge) return;
    badge.hidden = false;
    badge.textContent = c.complete ? 'config ✓' : `config ${c.done}/${c.total}`;
    badge.classList.toggle('ok', c.complete);
    badge.classList.toggle('warn', !c.ready);
  }

  function renderTodo() {
    const id = String(todoFocus);
    const c = checklists.get(id);
    if (!todo || !c) return;
    if (c.complete || lsGet(`todo-off-${id}`) === '1') { todo.hidden = true; return; }
    const name = $(`details.project[data-id="${id}"] .pname`)?.textContent || '';
    // Réduite par défaut sur un écran étroit (elle recouvrirait le contenu) ; ensuite le choix de la personne fait foi
    const pref = lsGet('todo-min');
    const min = pref === null ? window.innerWidth < 1700 : pref === '1';
    todo.hidden = false;
    todo.classList.toggle('min', min);
    todo.dataset.project = id;
    todo.innerHTML = `<button type="button" class="todo-head" data-todo-toggle aria-expanded="${!min}">
      <svg class="ring" viewBox="0 0 44 44" role="img" aria-label="${c.done} étapes sur ${c.total}"><circle class="ring-t" cx="22" cy="22" r="18"></circle><circle class="ring-v" cx="22" cy="22" r="18" stroke-dasharray="${((113.1 * c.done) / c.total).toFixed(2)} 113.1" transform="rotate(-90 22 22)"></circle><text class="ring-x" x="22" y="26" text-anchor="middle">${c.done}/${c.total}</text></svg>
      <span class="todo-title"><strong>${c.ready ? 'Prêt à prospecter' : 'Mise en route'}</strong><span class="muted small">${esc(name)}</span></span>
      <span class="chev" aria-hidden="true"></span></button>
    <div class="todo-body">
      <ul>${c.steps.map((s) => `<li class="${s.done ? 'done' : ''}">${s.done ? TICK : DOT}<div>
        <button type="button" class="todo-go" data-todo-go="${esc(s.key)}">${esc(s.label)}</button>${s.optional ? '<span class="todo-opt">facultatif</span>' : ''}
        ${s.done ? '' : `<span class="muted small">${esc(s.hint)}</span>`}</div></li>`).join('')}</ul>
      <button type="button" class="todo-hide muted small" data-todo-hide>Masquer pour ce projet</button>
    </div>`;
  }

  async function loadChecklist(el) {
    try { setChecklist(el.dataset.id, await api(`/api/projects/${el.dataset.id}/checklist`)); } catch { /* la liste est un confort : on se tait */ }
  }

  function focusTodo(el) {
    todoFocus = el.dataset.id;
    if (checklists.has(todoFocus)) renderTodo(); else loadChecklist(el);
  }

  // Ouvre la section de l'étape (et ses parents), y fait défiler la page et la fait clignoter un instant
  function todoGo(el, step) {
    el.open = true;
    const target = (step.acc && $(`details[data-acc="${step.acc}"]`, el)) || (step.sel && $(step.sel, el));
    if (!target) return;
    for (let n = target; n && n !== el; n = n.parentElement) if (n.tagName === 'DETAILS') n.open = true;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
    target.classList.add('flash');
    setTimeout(() => target.classList.remove('flash'), 1800);
  }

  if (todo) {
    const projects = $$('details.project');
    const start = $(`details.project[data-id="${sessionStorageGet('openProject')}"]`) || projects[0];
    if (start) focusTodo(start);
    projects.forEach((el) => el.addEventListener('toggle', () => { if (el.open) focusTodo(el); }));
    // La pastille « config » du projet rappelle la liste, même après l'avoir masquée
    document.addEventListener('click', (e) => {
      const badge = e.target.closest('[data-cfg]');
      const el = badge?.closest('details.project');
      if (!el) return;
      e.preventDefault();
      lsSet(`todo-off-${el.dataset.id}`, '0');
      lsSet('todo-min', '0');
      focusTodo(el);
      renderTodo();
    });
    todo.addEventListener('click', (e) => {
      const id = todo.dataset.project;
      const el = $(`details.project[data-id="${id}"]`);
      if (e.target.closest('[data-todo-toggle]')) { lsSet('todo-min', todo.classList.contains('min') ? '0' : '1'); renderTodo(); return; }
      if (e.target.closest('[data-todo-hide]')) { lsSet(`todo-off-${id}`, '1'); todo.hidden = true; return; }
      const go = e.target.closest('[data-todo-go]');
      const step = go && checklists.get(id)?.steps.find((s) => s.key === go.dataset.todoGo);
      if (step && el) todoGo(el, step);
    });
  }

  // ---------- Réglages : ajouter un serveur Git ----------
  // GitHub est toujours là. Le « + » propose le type de serveur, puis ajoute une ligne URL + token (le formulaire reste un POST classique).
  (() => {
    const list = $('[data-gitlist]');
    const tpl = $('#git-row-tpl');
    if (!list || !tpl) return;
    const add = $('[data-git-add]');
    const pick = $('[data-git-type]');
    const full = $('[data-git-max]');
    let next = Number(list.dataset.next) || 0;
    const rows = () => $$('[data-git-row]', list).length;

    add.addEventListener('click', () => {
      if (rows() >= Number(list.dataset.max)) { full.hidden = false; return; }
      pick.hidden = !pick.hidden;
      add.setAttribute('aria-expanded', String(!pick.hidden));
      if (!pick.hidden) pick.focus();
    });
    pick.addEventListener('change', () => {
      const opt = pick.selectedOptions[0];
      if (!opt?.value) return;
      const html = tpl.innerHTML.replaceAll('__I__', String(next++)).replaceAll('__TYPE__', esc(opt.value)).replaceAll('__LABEL__', esc(opt.dataset.label));
      const row = document.createElement('div');
      row.innerHTML = html;
      const el = row.firstElementChild;
      $('[data-git-hint]', el).textContent = opt.dataset.hint || '';
      list.append(el);
      pick.value = '';
      pick.hidden = true;
      add.setAttribute('aria-expanded', 'false');
      $('input[name^="git_host_"]', el).focus();
    });
    list.addEventListener('click', (e) => {
      if (!e.target.closest('[data-git-cancel]')) return;
      e.target.closest('[data-git-row]').remove();
      full.hidden = true;
    });
  })();

  // ---------- Corbeilles : marquer un élément « à retirer » (annulable), retiré à l'enregistrement ----------
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-trash]');
    if (!btn) return;
    const wrap = btn.closest('.trash-wrap');
    const on = btn.getAttribute('aria-pressed') !== 'true';
    $('[data-trash-input]', wrap).value = on ? '1' : '';
    btn.setAttribute('aria-pressed', String(on));
    $('.trash-note', wrap).hidden = !on;
    // Une ligne entière (serveur Git, webhook) s'estompe tant qu'elle est marquée ; un simple token ne marque que son bouton
    const row = btn.closest('.gitrow');
    if (row && !btn.classList.contains('txt')) row.classList.toggle('to-delete', on);
  });

  // ---------- Développeur : copier le jeton affiché une seule fois ----------
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy-token]');
    if (!b) return;
    const code = $('[data-token]');
    try { await navigator.clipboard.writeText(code.textContent); toast('Jeton copié'); }
    catch { const r = document.createRange(); r.selectNodeContents(code); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Sélectionné : copie-le avec Ctrl+C', 'error'); }
  });

  // ---------- Réglages : revenir au prompt par défaut ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-prompt-reset]');
    if (!b) return;
    const ta = $('[data-prompt-text]', b.closest('.prompt-def'));
    ta.value = b.dataset.default;
    ta.focus();
  });

  // ---------- Réglages : plusieurs webhooks Discord ----------
  // Le « + » ajoute une ligne (adresse + événements reçus) : on sépare ainsi ce qui est dit ou fait, salon par salon.
  (() => {
    const list = $('[data-discordlist]');
    const tpl = $('#discord-row-tpl');
    if (!list || !tpl) return;
    const add = $('[data-discord-add]');
    const full = $('[data-discord-max]');
    let next = Number(list.dataset.next) || 0;
    const rows = () => $$('[data-discord-row]', list);
    const renumber = () => rows().forEach((r, i) => { $('[data-discord-title]', r).textContent = `Webhook ${i + 1}`; });
    add.addEventListener('click', () => {
      if (rows().length >= Number(list.dataset.max)) { full.hidden = false; return; }
      const holder = document.createElement('div');
      holder.innerHTML = tpl.innerHTML.replaceAll('__I__', String(next++));
      const el = holder.firstElementChild;
      list.append(el);
      renumber();
      $('input[name^="discord_url_"]', el).focus();
    });
    list.addEventListener('click', (e) => {
      if (!e.target.closest('[data-discord-cancel]')) return;
      e.target.closest('[data-discord-row]').remove();
      full.hidden = true;
      renumber();
    });
  })();

  // ---------- Réglages : tester le token GitHub ----------
  // Dit à qui appartient le token, à quels dépôts il donne accès, et lesquels de tes projets en font partie. Ne modifie rien.
  (() => {
    const btn = $('[data-github-test]');
    if (!btn) return;
    const out = $('[data-github-result]');
    const field = $('input[name="github_token"]');
    const show = (html, kind) => { out.hidden = false; out.className = `gittest ${kind}`; out.innerHTML = html; };
    const mark = { true: ['ok', '✓', 'accessible avec ce token'], false: ['error', '✗', "pas accessible avec ce token (ajoute ce dépôt à ceux du token)"], null: ['muted', '?', 'non déterminé (liste tronquée)'] };

    btn.addEventListener('click', async () => {
      const spin = $('.spin-inline', btn);
      btn.disabled = true;
      spin.hidden = false;
      try {
        const r = await api('/settings/github/test', { token: field.value });
        if (!r.ok) { show(`<p class="error">${esc(r.message)}</p>`, 'bad'); return; }
        const projects = r.projects.length
          ? `<h5>Tes projets sur GitHub</h5><ul class="gitprojects">${r.projects.map((p) => {
            const [cls, sign, text] = mark[String(p.access)];
            return `<li class="${cls}"><span aria-hidden="true">${sign}</span> <strong>${esc(p.name)}</strong> <span class="muted small">${esc(p.repo)} : ${esc(text)}</span></li>`;
          }).join('')}</ul>`
          : '<p class="muted small">Aucun de tes projets n\'est sur GitHub pour l\'instant.</p>';
        const repos = r.repos.length
          ? `<details><summary>${r.repos.length}${r.truncated ? '+' : ''} dépôt(s) accessible(s)${r.truncated ? ' (les 100 plus récents)' : ''}</summary><ul class="gitrepos">${r.repos.map((x) => `<li>${esc(x.name)} <span class="badge">${x.private ? 'privé' : 'public'}</span></li>`).join('')}</ul></details>`
          : '<p class="warn">Ce token ne donne accès à aucun dépôt : ajoute-en dans les réglages du token sur GitHub.</p>';
        show(`<p class="ok"><strong>Token valide</strong> · compte <strong>@${esc(r.login)}</strong> · token ${esc(r.kind)}${r.expiresAt ? ` · expire le ${esc(r.expiresAt)}` : ''}</p>
          ${r.warning ? `<p class="warn small">${esc(r.warning)}</p>` : ''}${projects}${repos}`, 'good');
      } catch (e) {
        show(`<p class="error">${esc(e.message)}</p>`, 'bad');
      } finally {
        btn.disabled = false;
        spin.hidden = true;
      }
    });
  })();

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
      box.innerHTML = `<p>Relie un compte LinkedIn à ce projet : Claude pourra écrire des posts pour ce compte. AiTools demande seulement le droit de <strong>publier un post ${s.pagesEnabled ? 'sur ton profil ou sur une page que tu administres' : 'sur ton profil'}</strong>, et ne publie jamais sans ton clic.</p>
        ${s.canManage ? `<p><a class="btn primary" href="/linkedin/connect?project=${id}">Connecter LinkedIn</a></p>` : '<p class="muted small">Demande à un administrateur du projet de relier le compte.</p>'}`;
      return;
    }
    const head = `<div class="row li-head"><p><span class="badge ${acc.expired ? 'warn' : 'ok'}">${acc.expired ? 'connexion expirée' : 'connecté'}</span> <strong>${esc(acc.name)}</strong>
        ${acc.expiresAt ? `<span class="muted small">· ${acc.expired ? 'a expiré' : 'valable'} jusqu'au ${esc(liDay(acc.expiresAt))}</span>` : ''}</p>
      ${s.canManage ? `<span>${acc.expired ? `<a class="btn small primary" href="/linkedin/connect?project=${id}">Reconnecter</a> ` : ''}<button type="button" class="btn small danger" data-li-disconnect="${id}">Déconnecter</button></span>` : ''}</div>`;
    // Où partent les posts : une page choisie, sinon le profil. La liste des pages n'est demandée à LinkedIn qu'au clic sur « Changer ».
    const where = acc.target ? acc.target.name : acc.canPersonal ? 'ton profil' : null;
    let targetHtml = '';
    if (s.pagesEnabled && !acc.expired) {
      targetHtml = !acc.canPages
        ? `<p class="muted small">Pour publier sur une page, ${s.canManage ? `<a href="/linkedin/connect?project=${id}">reconnecte LinkedIn</a> (nouvelle autorisation)` : 'un administrateur du projet doit reconnecter LinkedIn'}.</p>`
        : `<div class="li-target" data-li-target-box><p>Publier sur : <strong>${where ? esc(where) : 'aucune page choisie'}</strong>
            ${s.canManage ? `<button type="button" class="btn small" data-li-pages="${id}">${where ? 'Changer' : 'Choisir une page'}</button>` : ''}</p>
            ${where ? '' : '<p class="warn small">Choisis la page où publier : ce compte ne peut pas publier sur ton profil.</p>'}
            <div data-li-pages-list></div></div>`;
    } else if (!s.pagesEnabled && s.canManage) {
      targetHtml = '<p class="muted small">Les posts partent sur ton profil. Publier sur une page demande l\'accès « Community Management API » côté application LinkedIn.</p>';
    }
    const posts = s.posts || [];
    const latest = posts[0];
    const draft = latest && latest.status !== 'published' ? latest : null;
    const direction = latest?.direction || '';
    const gen = !s.hasProfile ? '<p class="muted small">Analyse le projet d\'abord : Claude s\'appuie sur la fiche projet.</p>' : acc.expired ? '' : `<div class="li-gen">
        <label>De quoi doit parler le post ? <span class="muted small">(facultatif)</span>
          <textarea name="direction" rows="3" maxlength="500" data-li-direction placeholder="Ex. : le lancement de la nouvelle offre, un retour d'expérience, un conseil pour mes clients… Laisse vide : Claude choisit le sujet.">${esc(direction)}</textarea></label>
        <button type="button" class="btn primary" data-li-generate="${id}">${draft ? 'Régénérer un autre post' : 'Générer un post'}</button></div>`;
    const liWhen = (ts) => new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' });
    const scheduled = draft?.status === 'scheduled';
    const publishBtn = s.canManage && !acc.expired
      ? `<button type="button" class="btn${scheduled ? '' : ' primary'}" data-li-publish="${id}" data-where="${esc(where || 'LinkedIn')}"${where ? '' : ' disabled'}>${scheduled ? 'Publier maintenant' : `Publier sur ${esc(acc.target ? acc.target.name : 'LinkedIn')}`}</button>` : '<span class="muted small">Un administrateur du projet publie.</span>';
    const scheduleBox = !draft || scheduled || !s.canManage || acc.expired ? '' : `<div class="li-schedule"><label>Programmer la publication
          <input type="datetime-local" data-li-when></label>
        <button type="button" class="btn" data-li-schedule="${id}"${where ? '' : ' disabled'}>Programmer</button></div>`;
    const draftHtml = draft ? `<div class="li-draft"><label>${scheduled ? 'Post programmé (annule la programmation pour le modifier)' : 'Brouillon (modifiable)'}
        <textarea rows="11" maxlength="${s.maxLength}" data-li-body="${draft.id}"${scheduled ? ' readonly' : ''}>${esc(draft.body)}</textarea></label>
        <p class="muted small"><span data-li-count>${draft.body.length}</span> / ${s.maxLength} caractères${draft.direction ? ` · direction : « ${esc(draft.direction)} »` : ' · sujet choisi par Claude'}</p>
        ${scheduled ? `<p class="ok small">Programmé : ${esc(liWhen(draft.scheduledAt))} (heure de Paris). Il part tout seul, dans les 15 minutes qui suivent l'heure choisie.</p>` : ''}
        ${draft.scheduleError ? `<p class="error small">La dernière publication programmée a échoué : ${esc(draft.scheduleError)}</p>` : ''}
        <div class="row-actions">${scheduled ? `<button type="button" class="btn" data-li-unschedule="${id}">Annuler la programmation</button>` : `<button type="button" class="btn" data-li-save="${id}">Enregistrer</button>`}
          <button type="button" class="btn" data-li-copy>Copier</button>
          ${publishBtn}</div>${scheduleBox}</div>` : '';
    const history = posts.filter((x) => x !== draft && x.status === 'published');
    const hist = history.length ? `<details class="li-history"><summary>Posts publiés (${history.length})</summary>${history.map((x) => `<article class="card"><p class="muted small">Publié le ${esc(liDay(x.publishedAt))}${x.publishedOn ? ` sur ${esc(x.publishedOn)}` : ''}</p><p class="li-text">${esc(x.body)}</p></article>`).join('')}</details>` : '';
    box.innerHTML = `${head}${targetHtml}${gen}${draftHtml}${hist}`;
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-li-generate],[data-li-save],[data-li-copy],[data-li-publish],[data-li-schedule],[data-li-unschedule],[data-li-disconnect],[data-li-pages],[data-li-target-save],[data-li-pages-refresh]');
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
      } else if (t.matches('[data-li-schedule]')) {
        const when = $('[data-li-when]', proj).value;
        if (!when) { toast('Choisis la date et l\'heure de publication', 'error'); return; }
        const at = Math.floor(new Date(when).getTime() / 1000); // l'heure saisie est celle de ton navigateur
        if (!confirm(`Programmer la publication le ${new Date(at * 1000).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })} ?\nLe post sera publié automatiquement et sera visible publiquement par tout le monde.`)) return;
        t.disabled = true;
        await api(`/api/projects/${id}/linkedin/schedule`, { postId: Number(body().dataset.liBody), body: body().value, at, confirm: true });
        toast('Publication programmée');
        loadLinkedin(proj);
      } else if (t.matches('[data-li-unschedule]')) {
        t.disabled = true;
        await api(`/api/projects/${id}/linkedin/unschedule`, { postId: Number(body().dataset.liBody) });
        toast('Programmation annulée');
        loadLinkedin(proj);
      } else if (t.matches('[data-li-publish]')) {
        if (!confirm(`Publier ce post sur ${t.dataset.where || 'LinkedIn'} ? Il sera visible publiquement par tout le monde.`)) return;
        t.disabled = true;
        await api(`/api/projects/${id}/linkedin/publish`, { postId: Number(body().dataset.liBody), body: body().value, confirm: true });
        toast('Post publié sur LinkedIn');
        loadLinkedin(proj);
      } else if (t.matches('[data-li-pages],[data-li-pages-refresh]')) {
        // Les pages que ce compte administre, relues chez LinkedIn (en cache côté serveur ; « Actualiser » force un nouvel appel)
        const refresh = t.matches('[data-li-pages-refresh]');
        const list = $('[data-li-pages-list]', proj);
        t.disabled = true;
        const r = await api(`/api/projects/${id}/linkedin/pages${refresh ? '?refresh=1' : ''}`);
        const options = r.pages.map((p) => `<option value="${esc(p.urn)}"${r.target?.urn === p.urn ? ' selected' : ''}>${esc(p.name)}</option>`);
        list.innerHTML = r.pages.length
          ? `<label>Où publier ?<select data-li-target-select>
              <option value="me"${r.target ? '' : ' selected'}>Mon profil</option>${options.join('')}</select></label>
            <div class="row-actions"><button type="button" class="btn small primary" data-li-target-save="${id}">Choisir</button>
              <button type="button" class="btn small" data-li-pages-refresh="${id}">Actualiser la liste</button></div>`
          : `<p class="warn small">LinkedIn ne montre aucune page administrée par ce compte.</p>
            <div class="row-actions"><button type="button" class="btn small" data-li-pages-refresh="${id}">Actualiser la liste</button></div>`;
        t.disabled = false;
      } else if (t.matches('[data-li-target-save]')) {
        const urn = $('[data-li-target-select]', proj).value;
        t.disabled = true;
        const r = await api(`/api/projects/${id}/linkedin/target`, { urn });
        toast(r.target ? `Les posts partiront sur ${r.target.name}` : 'Les posts partiront sur ton profil');
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

    const hookTest = e.target.closest('[data-notify-test]');
    if (hookTest) {
      try {
        await api('/api/notify/test', hookTest.dataset.channel ? { channel: hookTest.dataset.channel } : hookTest.dataset.hook ? { hook: hookTest.dataset.hook } : {});
        toast(hookTest.dataset.channel ? 'Notification de test envoyée' : 'Notification envoyée sur Discord');
      }
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
        case 'audit': {
          if (data.level === 'approfondi' && !confirm('Le niveau approfondi utilise Opus et consomme beaucoup de quota. Continuer ?')) break;
          const r = await api(`/api/projects/${id}/code-review`, data);
          toast(r.budgetBlocked ? `En file, mais ${r.budgetBlocked}` : r.existing ? 'Un audit est déjà prévu ou en cours' : 'Audit lancé', r.budgetBlocked ? 'error' : 'ok');
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
          const advice = warmupNotice(JSON.parse(form.dataset.warmup || '{}'), n);
          if (!confirm(`Envoyer ${n} mail(s) de prospection maintenant ?\nIls partiront espacés de quelques dizaines de secondes.${advice ? `\n\n${advice}` : ''}`)) break;
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
  const STATUS = { new: 'À contacter', sent: 'Contacté', replied: 'A répondu', client: 'Client', refused: 'Refus', bounced: 'Rejeté', invalid: 'Adresse invalide' };
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
      ${(() => {
        const busy = d.hookJob && ['queued', 'running'].includes(d.hookJob.status);
        return `<div class="hook-row">${p.hook ? `<p class="hook">« ${esc(p.hook)} »</p>` : '<p class="muted small">Pas d\'accroche pour ce prospect.</p>'}
          <button type="button" class="btn small" data-regen-hook${busy ? ' disabled' : ''}>${busy ? 'Régénération en cours…' : p.hook ? "Régénérer l'accroche" : 'Générer une accroche'}</button>
          ${d.hookJob?.status === 'error' ? `<p class="error small">Échec : ${esc(d.hookJob.error)}</p>` : ''}</div>`;
      })()}
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
      const regen = e.target.closest('[data-regen-hook]');
      if (regen) {
        regen.disabled = true;
        try {
          await api(`/api/prospects/${id}/hook`, {});
          toast("Accroche en cours de rédaction : Claude lit le site du prospect");
          // La fiche se met à jour toute seule quand le job se termine
          for (let i = 0; i < 60 && dlg.open && dlg.dataset.id === id; i++) {
            await new Promise((r) => setTimeout(r, 3000));
            const d = await api(`/api/prospects/${id}`);
            if (!d.hookJob || !['queued', 'running'].includes(d.hookJob.status)) { if (dlg.open && dlg.dataset.id === id) openProspect(id); refreshOpenLists(); break; }
          }
        } catch (err) { toast(err.message, 'error'); regen.disabled = false; }
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
        ${r.skipped} ignoré(s) (déjà présents ou à ne pas contacter) · ${r.invalid.length} invalide(s)</p>
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
    if (d.dataset.view === 'board') return loadBoard(d, proj, filters, box);
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

  // Kanban : une colonne par statut ; on glisse une fiche pour changer son statut (ou on utilise le menu de la fiche, au clavier)
  async function loadBoard(d, proj, filters, box) {
    try {
      const { status: _ignored, ...f } = filters; // les colonnes sont les statuts
      const r = await api(`/api/projects/${proj.dataset.id}/kanban?${new URLSearchParams(f)}`);
      const card = (x) => `<article class="kcard" draggable="true" data-card="${x.id}">
        <button type="button" class="link" data-open-prospect="${x.id}">${esc(x.company)}</button>
        <div class="small muted">${esc(x.email)}${x.city ? ` · ${esc(x.city)}` : ''}${x.score ? ` · ${x.score}/10` : ''}</div>
        ${x.next_action ? `<div class="small ${x.next_action_at * 1000 <= Date.now() ? 'warn' : 'muted'}">→ ${esc(x.next_action)} (${fmtDay(x.next_action_at)})</div>` : ''}
        <select data-prospect="${x.id}" class="st-${x.status}" aria-label="Statut de ${esc(x.company)}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === x.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </article>`;
      box.innerHTML = `<div class="kanban">${r.columns.map((c) => `<section class="kcol" data-col="${c.status}" aria-label="${esc(c.label)}">
        <h4>${esc(c.label)} <span class="n">${c.total}</span></h4>
        <div class="kcards" data-drop="${c.status}">${c.rows.map(card).join('') || '<p class="muted small">Vide</p>'}
          ${c.total > c.rows.length ? `<p class="muted small">+ ${c.total - c.rows.length} autre(s) : affine avec les filtres ou passe en liste.</p>` : ''}</div>
      </section>`).join('')}</div>`;
      $('[data-pager]', d).innerHTML = '';
    } catch (err) { box.innerHTML = `<p class="error small">${esc(err.message)}</p>`; }
  }
  const moveProspect = async (d, id, status) => {
    if (status === 'refused' && !confirm('Marquer en refus ajoute l\'adresse à la liste d\'opposition. Continuer ?')) return;
    try { await api(`/api/prospects/${id}/status`, { status }); toast('Statut mis à jour'); } catch (err) { toast(err.message, 'error'); }
    loadProspects(d);
  };
  document.addEventListener('dragstart', (e) => {
    const c = e.target.closest?.('[data-card]');
    if (!c) return;
    e.dataTransfer.setData('text/plain', c.dataset.card);
    e.dataTransfer.effectAllowed = 'move';
    c.classList.add('drag');
  });
  document.addEventListener('dragend', (e) => { e.target.closest?.('[data-card]')?.classList.remove('drag'); $$('.kcol.over').forEach((c) => c.classList.remove('over')); });
  document.addEventListener('dragover', (e) => {
    const col = e.target.closest?.('.kcol');
    if (!col) return;
    e.preventDefault();
    $$('.kcol.over').forEach((c) => { if (c !== col) c.classList.remove('over'); });
    col.classList.add('over');
  });
  document.addEventListener('drop', (e) => {
    const col = e.target.closest?.('.kcol');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('over');
    const id = e.dataTransfer.getData('text/plain');
    const card = id && $(`[data-card="${CSS.escape(id)}"]`);
    if (card && card.closest('.kcol') !== col) moveProspect(col.closest('details.prospects'), id, col.dataset.col);
  });

  $$('details.prospects').forEach((d) => {
    d.dataset.view = 'list';
    for (const b of $$('[data-view-mode]', d)) b.addEventListener('click', () => {
      d.dataset.view = b.dataset.viewMode;
      for (const o of $$('[data-view-mode]', d)) { o.classList.toggle('on', o === b); o.setAttribute('aria-pressed', String(o === b)); }
      loadProspects(d);
    });
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
    const d = sel.closest('details.prospects');
    if (d?.dataset.view === 'board') loadProspects(d); // la fiche change de colonne
  });

  // ---------- Réponses des prospects : popup d'arrivée, page « Mails » ----------
  // La popup ne s'affiche que pour les réponses non lues ; tout le texte vient de la base et passe par textContent.
  const popHost = (() => {
    let host = $('.reply-pops');
    if (!host) { host = document.createElement('div'); host.className = 'reply-pops'; host.setAttribute('aria-live', 'polite'); document.body.append(host); }
    return host;
  })();
  const shownReplies = new Set();
  const copyText = async (text, btn) => {
    try { await navigator.clipboard.writeText(text); toast('Réponse copiée'); } catch { const ta = $('textarea', btn.closest('details')); ta?.select(); toast('Sélectionnée : copie-la avec Ctrl+C', 'error'); }
  };
  const markSeen = async (id) => { try { await api(`/api/replies/${id}/seen`, {}); } catch { /* sera réessayé au prochain passage */ } };
  function replyPopup(r) {
    const el = document.createElement('details');
    el.className = 'reply-pop';
    const sum = document.createElement('summary');
    const who = document.createElement('strong'); who.textContent = r.from;
    sum.append(who, ' vous a apporté une réponse');
    const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = r.intentLabel; sum.append(' ', badge);
    const close = document.createElement('button'); close.type = 'button'; close.className = 'reply-x'; close.setAttribute('aria-label', 'Fermer'); close.textContent = '×';
    close.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); markSeen(r.id); el.remove(); });
    sum.append(close);
    const body = document.createElement('div'); body.className = 'reply-body';
    const sub = document.createElement('p'); sub.className = 'muted small'; sub.textContent = `${r.project}${r.subject ? ` · ${r.subject}` : ''}`;
    const txt = document.createElement('p'); txt.className = 'reply-text'; txt.textContent = r.text || '(texte non disponible)';
    const lbl = document.createElement('p'); lbl.className = 'lbl'; lbl.textContent = 'Voici une réponse toute rédigée :';
    const ta = document.createElement('textarea'); ta.readOnly = true; ta.rows = 8; ta.value = r.draft;
    const acts = document.createElement('div'); acts.className = 'row-actions';
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn small'; copy.textContent = 'Copier la réponse';
    copy.addEventListener('click', () => copyText(ta.value, copy));
    const read = document.createElement('button'); read.type = 'button'; read.className = 'btn small'; read.textContent = 'Marquer comme lu';
    read.addEventListener('click', () => { markSeen(r.id); el.remove(); });
    const all = document.createElement('a'); all.className = 'btn small'; all.href = '/mails?v=replies'; all.textContent = 'Toutes les réponses';
    acts.append(copy, read, all);
    body.append(sub, txt, lbl, ta, acts);
    el.append(sum, body);
    popHost.append(el);
  }
  function paintUnseen(n) {
    for (const a of $$('.pill[href="/mails"]')) {
      let b = $('.pill-n', a);
      if (!n) { b?.remove(); continue; }
      if (!b) { b = document.createElement('span'); b.className = 'pill-n'; a.append(b); }
      b.textContent = n > 9 ? '9+' : String(n);
    }
  }
  async function pollReplies() {
    if (document.hidden || !$('.top')) return;
    try {
      const d = await api('/api/replies?unseen=1&limit=5');
      paintUnseen(d.unseen);
      for (const r of d.replies) if (!shownReplies.has(r.id)) { shownReplies.add(r.id); replyPopup(r); }
    } catch { /* hors ligne ou session expirée : la prochaine requête le dira */ }
  }
  if ($('.top')) { pollReplies(); setInterval(pollReplies, 45_000); document.addEventListener('visibilitychange', () => { if (!document.hidden) pollReplies(); }); }
  document.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy-draft]');
    if (c) { copyText($('[data-draft]', c.closest('.reply-body')).value, c); return; }
    const s = e.target.closest('[data-reply-seen]');
    if (s) { await markSeen(s.dataset.replySeen); s.closest('.reply-row')?.classList.remove('unseen'); s.remove(); pollReplies(); }
  });
  document.addEventListener('change', (e) => { if (e.target.matches('[data-autosubmit]')) e.target.form.submit(); });

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
      const n = Math.round(Math.min(110, Math.max(30, (W * H) / 13000)));
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
          ctx.strokeStyle = `rgba(${rgb},${((1 - Math.sqrt(d2) / LINK) * 0.38).toFixed(3)})`;
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
        ctx.fillStyle = `rgba(${rgb},${(0.6 + glow * 0.4).toFixed(3)})`;
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
