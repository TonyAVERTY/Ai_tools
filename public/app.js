// Front vanilla, sans build. Polling léger uniquement sur les projets dépliés.
(() => {
  // Ce script peut être relancé sans recharger la page (public/ajax.js remplace le contenu, puis le ré-exécute) : la précédente exécution
  // est d'abord arrêtée. Tout ce qui est branché sur document, window ou un minuteur passe par listen / every / later, pour pouvoir être retiré.
  window.AiTools?.dispose?.();
  let disposed = false;
  const cleanups = [];
  const timers = new Set();
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };
  const every = (fn, ms) => { const id = setInterval(fn, ms); cleanups.push(() => clearInterval(id)); return id; };
  // Minuteur de rafraîchissement : ne part plus une fois cette exécution arrêtée, et s'annule avec elle
  const later = (fn, ms) => {
    if (disposed) return 0;
    const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms);
    timers.add(id);
    return id;
  };
  window.AiTools = {
    toast: (...a) => toast(...a),
    dispose() { disposed = true; for (const f of cleanups.splice(0)) f(); for (const t of timers) clearTimeout(t); timers.clear(); },
  };
  // Rechargement et navigation sans quitter la page quand public/ajax.js est là ; navigation classique sinon
  // Un rechargement voulu par l'application (fin d'analyse, cible validée…) garde le projet ouvert ; l'arrivée sur la page, elle, ne rouvre rien
  const rememberOpen = () => { try { const d = document.querySelector('details.project[open]'); if (d) sessionStorage.setItem('reopenProject', d.dataset.id); } catch { /* stockage indisponible */ } };
  const reload = () => { rememberOpen(); if (window.AiNav) window.AiNav.reload(); else location.reload(); };
  const go = (url) => (window.AiNav ? window.AiNav.go(url) : (location.href = url));

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Montée en charge : un conseil (jamais un blocage) pendant la première semaine d'envois d'un projet
  const warmupLine = (w) => (w?.active ? ` · conseil : ${w.perDay / 2} à ${w.perDay} par jour cette première semaine` : '');
  const warmupNotice = (w, count) => (!w?.active || (w.sentToday || 0) + count <= w.perDay ? null
    : `Conseil : ${w.perDay / 2} à ${w.perDay} mails par jour pendant la première semaine protègent la réputation de ton adresse d'envoi (encore ${w.daysLeft} jour${w.daysLeft > 1 ? 's' : ''}). Tu peux quand même envoyer plus.`);

  // Lancement d'une tâche (analyse, recherche, envoi, audit…) : le bouton s'enfonce, puis un petit agent apporte la tâche au menu « Activité »
  // (public/fx.js). Un seul point d'accroche, ici : toute route qui met un job en file passe par api().
  const LAUNCH = /^\/api\/(projects\/\d+\/(analyze|template|followup_template|prospect|evolution|code-review|send|linkedin\/generate|promo\/generate|poste\/\w+)|prospects\/\d+\/hook)$/;
  let lastTrigger = null; // le bouton cliqué (ou validé au clavier) juste avant
  listen(document, 'click', (e) => { const t = e.target.closest?.('button, a.btn, label.btn'); if (t) lastTrigger = t; }, true);
  listen(document, 'submit', (e) => { lastTrigger = e.submitter || $('button:not([type=button])', e.target) || lastTrigger; }, true);

  // Anti-double-clic : un clic répété sur un bouton (2e, 3e clic d'une série rapide) est ignoré, sauf bouton marqué data-repeat
  listen(document, 'click', (e) => {
    const t = e.target.closest?.('button');
    if (t && e.detail > 1 && !t.hasAttribute('data-repeat')) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  async function api(path, body) {
    const launching = body !== undefined && LAUNCH.test(path);
    if (launching) window.AiFx?.press(lastTrigger);
    // Le bouton cliqué reste bloqué le temps de l'envoi (les formulaires qui bloquent déjà leurs boutons ne sont pas touchés)
    const btn = body !== undefined && lastTrigger?.tagName === 'BUTTON' && !lastTrigger.disabled ? lastTrigger : null;
    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
    try {
      const data = await call(path, body);
      if (launching && !data.existing) launched(lastTrigger);
      return data;
    } finally {
      if (btn) { btn.removeAttribute('aria-busy'); btn.disabled = false; }
    }
  }

  async function call(path, body) {
    const r = await fetch(path, body === undefined ? { headers: { Accept: 'application/json' } } : {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
    });
    if (r.status === 401) { location.href = '/login'; throw new Error('Session expirée'); }
    const data = await r.json().catch(() => ({}));
    if (r.status === 403 && data.code === 'link_required') showReconnect();
    if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
    return data;
  }

  // Accès Claude refusé ou perdu (jeton expiré, révoqué) : une fenêtre propose de se reconnecter, une seule fois par page
  function showReconnect() {
    if ($('dialog.reconnect') || /^\/(link|account)(\/|$)/.test(location.pathname)) return;
    const dlg = document.createElement('dialog');
    dlg.className = 'prospect-dialog modal reconnect';
    dlg.setAttribute('aria-labelledby', 'reconnect-title');
    dlg.innerHTML = `<h2 id="reconnect-title"><svg class="ic" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-alert"></use></svg>Claude est déconnecté</h2>
      <p>Ton accès Claude n'est plus valide (jeton expiré ou révoqué). Tant qu'il n'est pas relié de nouveau, les tâches IA sont à l'arrêt.</p>
      <div class="row"><a class="btn primary" href="/link">Reconnecter Claude</a><button type="button" class="btn" data-close>Plus tard</button></div>`;
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg || ev.target.closest('[data-close]')) dlg.close(); });
    document.body.append(dlg);
    dlg.showModal();
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
  // Compte à rebours à partir de la prévision des étapes calculée par le serveur.
  const remainingTime = (job, nowMs = Date.now()) => {
    if (job.status !== 'running') return '';
    const eta = job.eta;
    if (!eta || !Number.isFinite(eta.remainingSeconds)) return 'Temps restant : estimation en cours…';
    const seconds = Math.max(1, Math.ceil(eta.remainingSeconds - Math.max(0, nowMs / 1000 - eta.estimatedAt)));
    const minutes = Math.floor(seconds / 60), rest = seconds % 60;
    const duration = minutes >= 60 ? Math.floor(minutes / 60) + ' h ' + String(minutes % 60).padStart(2,'0') + ' min' : minutes ? minutes + ' min ' + String(rest).padStart(2,'0') + ' s' : seconds + ' s';
    return 'Temps restant estimé : ' + duration + (eta.revised ? ' · réajusté' : eta.source === 'initial' ? ' · estimation initiale' : '');
  };

  const progressBar = (job) => {
    // En file ou programmé : 0 % (barre vide, pas d'animation « indéterminée ») ; seul un job qui tourne sans mesure reste indéterminé
    const v = pctOf(job.progress) ?? (job.status === 'running' ? null : 0);
    return `<div class="bar${v === null ? ' indet' : ''}"><span data-key="${job.id}" data-pct="${v ?? ''}"></span></div>`;
  };

  const formData = (form) => Object.fromEntries(new FormData(form));
  const ago = (ts) => {
    if (!ts) return 'jamais';
    const m = Math.round((Date.now() / 1000 - ts) / 60);
    return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`;
  };
  const pct = (x) => `${Math.round(x * 100)} %`;
  const tokenText = (value) => `${Math.max(0, Number(value) || 0).toLocaleString('fr-FR')} tokens`;
  const ACTIVE = ['queued', 'running'];
  const LABELS = {
    analyze: 'Analyse', prospect: 'Recherche', template: 'Modèle', send: 'Envoi', evolution: 'Évolutions',
    followup_template: 'Modèle de relance', followup: 'Relances', linkedin_post: 'Post LinkedIn', promo_video: 'Vidéo de promotion', audit: 'Audit', hook: 'Accroche',
    billing_quotes: 'Facturation : exemples de devis', billing_refine: 'Facturation : affinage', billing_docs: 'Facturation : documents',
  };

  // Champs en lecture seule à copier (lien d'invitation) : un clic sélectionne tout
  $$('input.copy').forEach((i) => i.addEventListener('focus', () => i.select()));

  // ---------- Barre du haut : page courante en surbrillance ----------
  $$('.pills a.pill, .user-pop a, .ia-link').forEach((a) => {
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

  // ---------- Menus de la barre (avatar du compte, bouton IA) : s'ouvrent au survol, se ferment quand on les quitte ----------
  // Avec une souris : survol (le clic sur le bouton ne le referme pas). Au doigt ou au clavier : clic / Entrée, comme un menu ordinaire.
  const hover = matchMedia('(hover: hover) and (pointer: fine)');
  $$('details.user, details.ia-menu').forEach((menu) => {
    const summary = $('summary', menu);
    let closeTimer;
    const open = (v) => { clearTimeout(closeTimer); menu.open = v; };
    menu.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && hover.matches) { $$('details.user[open], details.ia-menu[open]').forEach((o) => { if (o !== menu) o.open = false; }); open(true); } });
    menu.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse' || !hover.matches) return;
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => { menu.open = false; }, 220);
    });
    summary.addEventListener('click', (e) => { if (e.detail > 0 && hover.matches) e.preventDefault(); }); // clic souris : le survol l'a déjà ouvert
    listen(document, 'click', (e) => { if (menu.open && !menu.contains(e.target)) open(false); });
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.open) { open(false); summary.focus(); } });
  });

  // ---------- Réglages : le sommaire suit la lecture (la section en cours est surlignée en direct) ----------
  const tocLinks = $$('.settings .toc a[href^="#"]');
  if (tocLinks.length) {
    const sections = tocLinks.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
    let queued = false;
    const mark = (id) => tocLinks.forEach((a) => { if (a.getAttribute('href') === `#${id}`) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    // Une section est « en cours » dès que son haut passe sous la ligne de lecture, fixée près du haut de l'écran : c'est la position où atterrit un clic
    // sur le sommaire, donc la section cliquée est bien celle qui s'allume (même courte, avec la suivante déjà visible plus bas). Tout en bas de la page,
    // la dernière section s'allume, puisqu'elle ne peut plus monter jusqu'à la ligne.
    let lockUntil = 0;
    const update = () => {
      queued = false;
      if (Date.now() < lockUntil) return; // défilement déclenché par un clic : on garde la section cliquée
      const line = 140;
      const atEnd = document.documentElement.scrollHeight - innerHeight - scrollY < 4;
      let cur = sections[0];
      if (atEnd) cur = sections[sections.length - 1];
      else for (const sec of sections) if (sec.getBoundingClientRect().top <= line) cur = sec;
      mark(cur.id);
    };
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    listen(window, 'scroll', schedule, { passive: true });
    listen(window, 'resize', schedule);
    tocLinks.forEach((a) => a.addEventListener('click', () => { lockUntil = Date.now() + 900; mark(a.getAttribute('href').slice(1)); setTimeout(schedule, 950); }));
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

  // Questionnaire de première connexion : une question à la fois, « Continuer » pour passer à la suivante (sans choix = question passée),
  // « Retour » pour revenir, et le pourcentage de questions déjà passées. La dernière question envoie le formulaire.
  const wiz = $('form[data-wizard]');
  if (wiz) {
    const steps = $$('[data-step]', wiz);
    const back = $('[data-wiz-back]', wiz);
    const next = $('[data-wiz-next]', wiz);
    const barBox = $('[role=progressbar]', wiz);
    const dots = $$('[data-dot]', wiz);
    const veil = $('[data-wiz-confirm]', wiz);
    const validated = new Set(); // questions auxquelles une réponse a été validée (pastille verte)
    let at = 0;
    let moving = false;
    const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wait = (ms) => new Promise((r) => setTimeout(r, calm() ? 0 : ms));
    const setBar = (p) => { $('[data-wiz-bar]', wiz).className = `w-${Math.floor(p / 5) * 5}`; $('[data-wiz-pct]', wiz).textContent = `${p} %`; barBox.setAttribute('aria-valuenow', String(p)); };
    // Une réponse = un choix coché, ou un texte écrit
    const answered = (i) => !!$('input:checked', steps[i]) || ($('textarea', steps[i])?.value.trim() ?? '') !== '';
    const paint = () => dots.forEach((d, k) => { d.classList.toggle('on', k === at); d.classList.toggle('done', validated.has(k)); });
    const show = (i, { focus = true, dir = 0 } = {}) => {
      at = i;
      steps.forEach((s, k) => {
        s.hidden = k !== i;
        s.classList.remove('wiz-out', 'wiz-out-back', 'wiz-in', 'wiz-in-back');
        if (k === i && dir) s.classList.add(dir > 0 ? 'wiz-in' : 'wiz-in-back');
      });
      $('[data-wiz-count]', wiz).textContent = `Question ${i + 1} sur ${steps.length}`;
      setBar(Math.round((100 * i) / steps.length)); // questions déjà passées
      back.hidden = i === 0;
      next.textContent = i === steps.length - 1 ? 'Terminer' : 'Continuer';
      paint();
      if (focus) ($('input:checked, input, textarea', steps[i]))?.focus({ preventScroll: true });
    };
    // Avancer : si une réponse est donnée, la pastille verte « Pris en compte » la confirme un instant, puis la question sort et la suivante entre
    async function forward() {
      if (moving) return;
      const here = steps[at];
      // Une question marquée data-required attend une réponse (les autres peuvent être passées)
      if (here.hasAttribute('data-required') && !answered(at)) {
        const err = $('[data-wiz-error]', here);
        if (err) { err.hidden = false; }
        $('input', here)?.focus({ preventScroll: true });
        return;
      }
      moving = true;
      if (answered(at)) {
        validated.add(at);
        veil.classList.add('show'); // grand cercle vert au milieu, arrière-plan flouté
        $('[data-wiz-live]', wiz).textContent = 'Réponse prise en compte';
        paint();
        await new Promise((r) => setTimeout(r, calm() ? 350 : 750)); // même avec « réduire les animations », la confirmation reste visible un instant
      } else validated.delete(at);
      if (at === steps.length - 1) { setBar(100); paint(); await finishWizard(); return; }
      veil.classList.remove('show');
      here.classList.add('wiz-out');
      await wait(190);
      show(at + 1, { dir: 1 });
      moving = false;
    }
    // Fin : une scène plein écran apparaît en fondu (« Merci, ton espace est prêt »), le profil s'enregistre en arrière-plan, puis le tableau de bord
    // prend la place sans coupure. Si l'enregistrement échoue, on retombe sur l'envoi classique du formulaire.
    async function finishWizard() {
      // Destination et textes de la scène de fin : propres à chaque assistant (profil de bienvenue, situation de la comptabilité…)
      const cfg = { json: wiz.dataset.wizJson, go: wiz.dataset.wizGo || '/', title: wiz.dataset.wizEndTitle || 'Merci, ton espace est prêt', text: wiz.dataset.wizEndText || '' };
      const end = document.createElement('div');
      end.className = 'wiz-end';
      end.setAttribute('role', 'status');
      end.innerHTML = '<div class="wiz-end-in"></div>';
      const inner = $('.wiz-end-in', end);
      inner.append($('.wiz-big', wiz).cloneNode(true));
      inner.insertAdjacentHTML('beforeend', `<h2>${esc(cfg.title)}</h2>${cfg.text ? `<p>${esc(cfg.text)}</p>` : ''}<div class="bar indet" aria-hidden="true"><span></span></div>`);
      document.body.append(end);
      void end.offsetWidth;
      end.classList.add('show');
      let ok = true;
      const saved = api(cfg.json, Object.fromEntries(new FormData(wiz))).catch(() => { ok = false; });
      await Promise.all([saved, new Promise((r) => setTimeout(r, calm() ? 500 : 1600))]);
      if (!ok) { wiz.submit(); return; } // submit() n'émet pas l'événement « submit » : pas de boucle
      go(cfg.go);
    }
    async function previous() {
      if (moving || at === 0) return;
      moving = true;
      steps[at].classList.add('wiz-out-back');
      await wait(190);
      show(at - 1, { dir: -1 });
      moving = false;
    }
    back.addEventListener('click', previous);
    wiz.addEventListener('change', () => { for (const e of $$('[data-wiz-error]', wiz)) e.hidden = true; });
    // « Passer le questionnaire » (formaction) part tel quel ; « Continuer » avance tant qu'il reste des questions
    wiz.addEventListener('submit', (e) => {
      if (e.submitter?.hasAttribute('formaction')) return;
      e.preventDefault();
      forward();
    });
    show(0, { focus: false });
  }

  // Visite guidée du tableau de bord (public/tour.js) : démarre toute seule une fois après les questions de bienvenue, ou à la demande (« Visite guidée »)
  const tourData = $('#tour-data');
  if (tourData && window.AiTour) {
    const mode = tourData.dataset.mode;
    cleanups.push(() => window.AiTour.stop());
    later(() => window.AiTour.start(JSON.parse(tourData.textContent), {
      onClose: (state) => {
        if (mode === 'auto') api('/tour/complete', { state }).catch(() => {}); // une visite relancée à la main ne change rien : l'automatique ne revient plus
        if (mode === 'replay') history.replaceState(null, '', '/');
      },
    }), 900);
  }

  // Attente dont la durée dépend d'un tiers (Claude) : un pourcentage ESTIMÉ monte vers 95 % selon la durée habituelle et ne passe à 100 % qu'avec la
  // réponse. Il ne prétend pas mesurer l'avancement réel : le CLI de Claude n'en donne pas.
  function track(box, typicalMs) {
    const bar = $('[data-pct-bar]', box);
    const text = $('[data-pct-text]', box);
    const host = $('[role=progressbar]', box);
    const set = (p) => { p = Math.max(0, Math.min(100, Math.round(p))); bar.className = `w-${Math.floor(p / 5) * 5}`; text.textContent = `${p} %`; host.setAttribute('aria-valuenow', String(p)); };
    const t0 = performance.now();
    box.hidden = false;
    set(0);
    const id = every(() => set(95 * (1 - Math.exp((-3 * (performance.now() - t0)) / typicalMs))), 200);
    return async (ok) => { clearInterval(id); if (ok) { set(100); await new Promise((r) => setTimeout(r, 350)); } box.hidden = true; };
  }

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
      const stop = track($('[data-pct]', loginForm), 10_000);
      try {
        const r = await api('/link/claude/login', { accept: 'on' });
        await stop(true);
        loginId = r.id;
        $('[data-claude-link]', dlg).href = r.url;
        if (popup) popup.location.href = r.url;
        loginForm.hidden = true;
        step2.hidden = false;
        $('[data-claude-hint-popup]', dlg).hidden = !popup;
        $('[data-claude-hint-link]', dlg).hidden = !!popup;
        codeInput.focus();
      } catch (err) {
        await stop(false);
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
      const stop = track($('[data-pct]', codeForm), 12_000);
      try {
        await api('/link/claude/login/code', { id: loginId, code });
        await stop(true);
        loginId = null;
        closePopup();
        go('/');
      } catch (err) {
        // Le serveur a fermé cette connexion (code refusé, expirée) : on repart de l'étape 1 avec le message
        await stop(false);
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
    listen(window, 'focus', fromClipboard);
    listen(document, 'visibilitychange', () => { if (!document.hidden) fromClipboard(); });

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
  // ---------- Menu « jobs » : détail de ce qui tourne, avec l'avancement ----------
  const jobsBox = $('#jobs');
  const jobsBtn = jobsBox && $('.jobs-btn', jobsBox);
  const jobsPop = jobsBox && $('.jobs-pop', jobsBox);
  const jobsOpen = () => jobsBtn?.getAttribute('aria-expanded') === 'true';
  const fmtWhen = (ts) => new Date(ts * 1000).toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

  function jobItem(j, isNew = false) {
    const p = j.progress || {};
    const scheduled = j.status === 'queued' && j.runAfter && j.runAfter * 1000 > Date.now();
    const running = j.status === 'running';
    const v = pctOf(p) ?? (running ? null : 0); // le pourcentage s'affiche aussi pour une tâche en attente (0 %)
    const state = j.status === 'error' ? 'En échec' : scheduled ? `Programmé ${fmtWhen(j.runAfter)}` : running ? `Démarré ${ago(j.startedAt)}` : 'En file d\'attente';
    const msg = j.status === 'error' ? j.error || 'La tâche a échoué' : p.message || (running ? 'En cours…' : '');
    return `<div class="jitem j-${scheduled ? 'scheduled' : j.status}${isNew ? ' new' : ''}">
      <div class="jrow">${scheduled ? '<span class="moon" aria-hidden="true"></span>' : running ? '<span class="pulse" aria-hidden="true"></span>' : '<span class="dot-wait" aria-hidden="true"></span>'}
        <strong>${esc(LABELS[j.type] || j.label || j.type)}</strong>${p.model ? `<span class="jmodel" title="Modèle utilisé">${esc(p.model)}</span>` : ''}<span class="jproj">${j.project ? esc(j.project) : ''}</span>${v !== null ? `<span class="jpct">${v} %</span>` : ''}</div>
      ${msg ? `<div class="jmsg small muted">${esc(msg)}</div>` : ''}
      ${progressBar(j)}
      ${remainingTime(j) ? `<div class="small muted">${esc(remainingTime(j))}</div>` : ''}
      <div class="small muted">${tokenText(j.tokensUsed)}</div>
      <div class="jmeta small muted"><span>${esc(state)}</span>
        <span>${j.canViewLogs !== false ? `<a class="link small" href="/jobs/${j.id}">Voir</a> · ${j.status === 'error' ? `<button type="button" class="link small" data-retry="${j.id}">Réessayer</button>` : ''}` : ''}${ACTIVE.includes(j.status) ? `<button type="button" class="link small" data-cancel="${j.id}">Annuler</button>` : ''}</span></div>
    </div>`;
  }

  let jobsSeen = null; // jobs déjà vus dans le menu : un job qui apparaît ensuite est mis en évidence un instant
  const jobsFresh = new Map(); // job → fin de sa mise en évidence
  function renderJobsMenu(s) {
    if (!jobsBox) return;
    const list = s.jobs || [];
    const ids = list.map((j) => j.id);
    if (jobsSeen) for (const id of ids) if (!jobsSeen.has(id)) jobsFresh.set(id, Date.now() + 3500);
    const fresh = new Set(ids.filter((id) => (jobsFresh.get(id) ?? 0) > Date.now()));
    jobsSeen = new Set([...(jobsSeen || []), ...ids]);
    jobsBox.hidden = !list.length;
    if (!list.length) { if (jobsOpen()) toggleJobs(false); return; }
    $('.spin-inline', jobsBtn).hidden = !s.queue;
    const failed = list.filter((j) => j.status === 'error').length;
    $('[data-jobs-count]', jobsBtn).textContent = s.queue
      ? `${plural(s.queue, 'job')}${s.scheduled ? ` · ${s.scheduled} cette nuit` : ''}`
      : s.scheduled ? `${plural(s.scheduled, 'programmé')} cette nuit` : `${plural(failed, 'échec')}`;
    const running = list.filter((j) => j.status === 'running').length;
    $('[data-jobs-sub]', jobsPop).textContent = `${running} en cours · ${list.filter((j) => j.status === 'queued').length} en attente${failed ? ` · ${plural(failed, 'échec')}` : ''}`;
    // Redessine seulement si le contenu change : sinon l'animation d'apparition rejouerait à chaque poll
    const html = list.map((j) => jobItem(j, fresh.has(j.id))).join('');
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
      refreshActivity();
    }
  }
  jobsBtn?.addEventListener('click', () => toggleJobs());
  // Barre du haut hors de l'écran (page défilée) : le bouton « Activité » reste épinglé en haut à droite, avec son menu et la destination de l'agent
  const topBar = $('.top');
  if (jobsBox && topBar && 'IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => document.body.classList.toggle('hdr-off', !en.isIntersecting)).observe(topBar);
  }
  listen(document, 'click', (e) => {
    if (jobsOpen() && !e.target.closest('#jobs')) toggleJobs(false);
    const link = e.target.closest('[data-goto]');
    if (!link) return;
    const d = $(`details.project[data-id="${link.dataset.goto}"]`);
    if (!d) { sessionStorageSet('reopenProject', link.dataset.goto); go('/'); return; } // pas sur la page Projets : elle ouvrira ce projet à l'arrivée
    toggleJobs(false);
    d.open = true;
    d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  listen(document, 'keydown', (e) => { if (e.key === 'Escape' && jobsOpen()) { toggleJobs(false); jobsBtn.focus(); } });

  // Carte « Usage du mois » : le quota Claude (session 5 h, semaine) et ce que les jobs d'AiTools ont consommé, mêmes données que la barre du haut
  // « Remise à zéro aujourd'hui à 18:42 » / « demain à 09:00 » / « lundi à 09:00 » (heure de Paris)
  function resetNote(ts) {
    if (!ts) return '';
    const day = (t) => new Date(t).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
    const at = new Date(ts * 1000);
    const hm = at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
    const d = day(at) === day(Date.now()) ? "aujourd'hui" : day(at) === day(Date.now() + 864e5) ? 'demain' : at.toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });
    return `Remise à zéro ${d} à ${hm}`;
  }
  function usageRow(label, value, { ratio = null, tip = '', cls = '', note = '' } = {}) {
    const w = ratio == null ? '' : `<div class="bar usage${ratio >= 1 ? ' full' : ''}" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(ratio * 100))}"><span class="w-${Math.min(100, Math.round(ratio * 20) * 5)}"></span></div>`;
    return `<li class="g"><div class="g-h" title="${esc(tip)}"><span>${esc(label)}</span><span class="g-v ${cls}">${value}</span></div>${w}${note ? `<p class="g-r">${esc(note)}</p>` : ''}</li>`;
  }
  function usageClaude(s) {
    const rows = [];
    const rl = s.claudeRateLimit;
    if (s.linkMode !== 'api_key') {
      if (!rl || (!rl.fiveHour && !rl.sevenDay)) {
        const why = !rl ? 'pas encore mesuré' : 'relevé indisponible';
        // Pas de mesure : la barre du haut le dit déjà, la carte « Consommation Claude » de la page Projets reste masquée (elle n'apparaît que pour de vraies valeurs)
        if (!document.querySelector('[data-claude-card]')) rows.push(usageRow('Quota Claude', why, { tip: rl ? (WHY[rl.error] || 'relevé indisponible') : 'Le relevé en direct se fait avec ton abonnement Claude', cls: 'muted' }));
      }
      for (const [label, w] of [['Claude session 5 h', rl?.fiveHour], ['Claude semaine', rl?.sevenDay]]) {
        if (!w) continue;
        const reset = resetLabel(w.resetsAt);
        const live = rl.source === 'live' && !rl.error;
        const tip = `${live ? 'Relevé en direct chez Anthropic, tout ton usage Claude compris (y compris hors AiTools).' : `Dernière mesure ${ago(rl.at)} (pendant un job AiTools).`}${reset ? ` Réinitialisation ${reset}.` : ''}`;
        rows.push(w.expired ? usageRow(label, '– (remise à zéro)', { tip, cls: 'muted' })
          : usageRow(label, pct(w.utilization), { ratio: w.utilization, tip, note: resetNote(w.resetsAt), cls: w.utilization >= 1 ? 'error' : w.utilization >= 0.8 ? 'warn' : '' }));
      }
    }
    // Montants en $ : seulement avec une clé API (c'est elle qui est facturée à l'usage). Avec un abonnement, rien n'est facturé en plus : on n'affiche aucun prix.
    for (const [label, x] of s.linkMode === 'api_key' ? [['IA via AiTools 24 h', s.budget.day], ['IA via AiTools 30 j', s.budget.month]] : []) {
      const r = x.limit ? x.used / x.limit : null;
      rows.push(usageRow(label, `${x.used.toFixed(2)} $${x.limit ? ` / ${x.limit} $` : ''}`, { ratio: r, tip: GAUGE_TIP, cls: r >= 1 ? 'error' : r >= 0.8 ? 'warn' : '' }));
    }
    return rows.join('');
  }

  let sysTimer;
  // Page « Relier Claude » sans accès utilisable : le serveur refuse ces relevés (403). On ne les demande pas, et on réessaie vite (la page change une fois Claude relié).
  const unlinked = () => !!document.querySelector('[data-nolink]');
  let activityTimerId, activityRequest = null, activityBusy = false;
  function refreshActivity() {
    clearTimeout(activityTimerId);
    if (!jobsBox || disposed || document.hidden) return Promise.resolve();
    if (unlinked()) { activityTimerId = later(refreshActivity, 4000); return Promise.resolve(); }
    if (activityRequest) return activityRequest;
    activityRequest = (async () => {
      try {
        const response = await fetch('/api/jobs/activity', { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (response.status === 401) { location.href = '/login'; return; }
        if (!response.ok) throw new Error('Relevé indisponible');
        const snapshot = await response.json();
        if (disposed) return;
        activityBusy = snapshot.queue > 0;
        renderJobsMenu(snapshot);
      } catch { /* garder la dernière mesure, puis retenter automatiquement */ }
      finally {
        activityRequest = null;
        if (!disposed) activityTimerId = later(refreshActivity, jobsOpen() ? 1000 : activityBusy ? 2000 : 10_000);
      }
    })();
    return activityRequest;
  }
  refreshActivity();
  listen(document, 'visibilitychange', () => { if (!document.hidden) refreshActivity(); });
  async function refreshSys() {
    clearTimeout(sysTimer);
    if (unlinked()) { sysTimer = later(refreshSys, 4000); return; }
    let busy = false;
    try {
      const s = await api('/api/system');
      for (const box of $$('[data-usage-claude]')) { box.innerHTML = usageClaude(s); box.hidden = false; const card = box.closest('[data-claude-card]'); if (card) card.hidden = !box.innerHTML.trim(); }
      busy = s.queue > 0;
    } catch { /* silencieux */ }
    // Plus réactif quand quelque chose tourne ou que le menu est ouvert
    sysTimer = later(refreshSys, jobsOpen() ? 3000 : busy ? 6000 : 30_000);
  }
  refreshSys();

  // Une tâche vient d'être mise en file : le menu « Activité » se met à jour, l'agent y arrive avec sa brouette, puis le menu s'ouvre
  // quelques secondes sur la liste des tâches en cours et à venir (comme la bulle de téléchargement de Chrome).
  let activityTimer;
  function showActivity() {
    if (!jobsBox || jobsBox.hidden) return;
    toggleJobs(true);
    clearTimeout(activityTimer);
    activityTimer = setTimeout(() => { if (jobsOpen() && !jobsPop.matches(':hover') && !jobsPop.contains(document.activeElement)) toggleJobs(false); }, 7500);
  }
  // Le menu s'ouvre d'abord : les traits pointillés et l'agent vont jusqu'à la ligne de la nouvelle tâche, dans la liste
  function launched(trigger) {
    refreshActivity()
      .then(() => { showActivity(); return new Promise((r) => setTimeout(r, 240)); })
      .then(() => window.AiFx?.launch(trigger, $('.jitem.new', jobsPop) || $('.jitem', jobsPop)))
      .catch(() => {});
  }

  // Console : conserver les lignes et la sélection pendant les rafraîchissements.
  const consoleBox = $('[data-job-console]');
  if (consoleBox) {
    const output = $('[data-console-output]', consoleBox);
    const status = $('[data-console-status]', consoleBox);
    const labels = { queued: 'En attente', running: 'En cours', done: 'Terminée', error: 'En échec', cancelled: 'Annulée' };
    let cursor = 0, busy = false, terminal = false;
    let lastDelta = null;
    const setText = (selector, text) => { const node = $(selector, consoleBox); if (node) node.textContent = text; };
    const addEntry = (entry) => {
      $('[data-console-empty]', consoleBox)?.remove();
      if (entry.kind === 'delta' && lastDelta?.isConnected) { lastDelta.textContent += entry.text; return; }
      const types = { output: 'Sortie de Claude', delta: 'Claude écrit', tool: 'Outil utilisé', turn: 'Nouvelle étape', model: 'Modèle', status: 'État de la tâche', progress: 'Progression', error: 'Erreur', activity: 'Activité de réflexion' };
      const article = document.createElement('article');
      article.className = 'console-entry';
      article.dataset.kind = Object.hasOwn(types, entry.kind) ? entry.kind : 'status';
      const head = document.createElement('div'); head.className = 'console-entry-head';
      const label = document.createElement('strong'); label.textContent = types[entry.kind] || 'Activité';
      const time = document.createElement('time'); time.textContent = new Date(entry.at).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' });
      head.append(label, time); article.append(head);
      const text = document.createElement(['delta', 'output'].includes(entry.kind) ? 'pre' : 'p'); text.textContent = entry.text;
      if (entry.kind === 'output' && entry.text.length > 1200) {
        const detail = document.createElement('details'), summary = document.createElement('summary');
        summary.textContent = 'Afficher la sortie complète'; detail.append(summary, text); article.append(detail);
      } else article.append(text);
      output.append(article); lastDelta = entry.kind === 'delta' ? text : null;
    };
    const pollConsole = async () => {
      if (busy || terminal || disposed) return;
      busy = true;
      try {
        const r = await api(`/api/jobs/${consoleBox.dataset.jobConsole}/log?after=${cursor}`);
        if (disposed) return;
        status.textContent = `${labels[r.status] || r.status}${r.progress?.message && ACTIVE.includes(r.status) ? ' · ' + r.progress.message : ''}`;
        setText('[data-console-title]', LABELS[r.type] || 'Suivi de la tâche');
        setText('[data-console-live]', ACTIVE.includes(r.status) ? '● En direct' : labels[r.status] || r.status);
        setText('[data-console-model]', r.progress?.model || '—');
        const elapsed = r.startedAt ? Math.max(0, Math.floor(((r.finishedAt || Date.now() / 1000) - r.startedAt))) : 0;
        setText('[data-console-elapsed]', r.startedAt ? `${Math.floor(elapsed / 60)} min ${String(elapsed % 60).padStart(2, '0')} s` : 'En attente');
        setText('[data-console-updated]', 'Actualisé à ' + new Date().toLocaleTimeString('fr-FR'));
        const meter = $('[data-console-progress]', consoleBox);
        if (meter) { if (typeof r.progress?.pct === 'number') meter.value = Math.max(0, Math.min(100, r.progress.pct)); else if (r.status === 'done') meter.value = 100; else meter.removeAttribute('value'); }
        consoleBox.dataset.status = r.status;
        setText('[data-console-tokens]', tokenText(r.tokensUsed));
        setText('[data-console-remaining]', remainingTime(r));
        // Vidéo livrée avec les avertissements des agents : elle se relance ou se corrige comme une scène refusée
        const warned = r.type === 'promo_video' && r.status === 'done' && r.qualityWarnings > 0;
        const fixable = warned || (r.type === 'promo_video' && /^La scène écrite par Claude ne passe pas au rendu/.test(r.error || ''));
        for (const retry of $$('[data-retry]', consoleBox)) retry.hidden = !(r.status === 'error' || warned) || ('fix' in retry.dataset && !fixable);
        if (r.entries.length) {
          if ((cursor && r.firstId > cursor + 1) || (!cursor && r.firstId > 1)) output.append(document.createTextNode('[Début du journal abrégé]\n'));
          for (const entry of r.entries) {
            addEntry(entry);
            cursor = entry.id;
          }
          while (output.childElementCount > 400 || (output.textContent.length > 160_000 && output.childElementCount > 1)) output.firstChild.remove();
          if ($('[data-console-follow]', consoleBox).checked) output.scrollTop = output.scrollHeight;
        }
        if (!cursor && !ACTIVE.includes(r.status)) output.textContent = r.error || 'Aucun journal enregistré pour cette tâche ancienne.';
        terminal = !ACTIVE.includes(r.status);
        if (r.error && terminal) status.textContent += ' · ' + r.error;
      } catch (err) { if (!disposed) { status.textContent = 'Connexion interrompue : ' + err.message + ' — nouvelle tentative…'; setText('[data-console-live]', 'Reconnexion…'); } }
      finally { busy = false; if (!terminal && !disposed) later(pollConsole, 800); }
    };
    pollConsole();
  }

  // ---------- Rendu d'un job ----------
  function renderJob(box, job, type) {
    renderJobContent(box, job, type);
    if (box && job && job.canViewLogs !== false && !box.querySelector(`a[href="/jobs/${job.id}"]`)) {
      const link = document.createElement('a');
      link.className = 'btn small'; link.href = `/jobs/${job.id}`; link.textContent = 'Voir';
      box.append(link);
    }
    if (box && job) {
      let usage = $('[data-job-tokens]', box);
      if (!usage) { usage = document.createElement('p'); usage.dataset.jobTokens = ''; usage.className = 'small muted'; box.append(usage); }
      usage.textContent = tokenText(job.tokensUsed);
      if (job.status === 'error' && job.canViewLogs !== false && !$('[data-retry]', box)) {
        const retry = document.createElement('button');
        retry.type = 'button'; retry.className = 'btn small primary'; retry.dataset.retry = job.id; retry.textContent = 'Réessayer';
        box.append(retry);
        if (type === 'promo_video' && /^La scène écrite par Claude ne passe pas au rendu/.test(job.error || '')) {
          const fix = document.createElement('button');
          fix.type = 'button'; fix.className = 'btn small primary'; fix.dataset.retry = job.id; fix.dataset.fix = ''; fix.textContent = 'Corriger';
          box.append(fix);
        }
      }
    }
  }
  function renderJobContent(box, job, type) {
    if (!box) return;
    const name = LABELS[type] || box.dataset.label || 'Tâche';
    if (!job) { box.innerHTML = ''; box._sig = ''; return; }
    const p = job.progress || {};
    const later = job.status === 'queued' && job.runAfter && job.runAfter * 1000 > Date.now();
    // Rien n'a changé : on ne touche pas au DOM (sinon les animations d'apparition rejoueraient à chaque poll)
    const remaining = remainingTime(job);
    const sig = `${job.id}|${job.status}|${later}|${remaining}|${JSON.stringify(p)}`;
    if (box._sig === sig) return;
    box._sig = sig;
    if (later) {
      const at = new Date(job.runAfter * 1000).toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
      box.innerHTML = `<div class="running scheduled"><span class="moon" aria-hidden="true"></span>
        <div><div>${name} programmé(e) : ${esc(at)}</div><div class="small muted">Démarrage la nuit, quand ton quota Claude est libre.</div></div>
        ${job.canViewLogs !== false ? `<a class="btn small" href="/jobs/${job.id}">Voir</a>` : ''}<button class="btn small" data-cancel="${job.id}">Annuler</button></div>`;
      return;
    }
    if (ACTIVE.includes(job.status)) {
      const extra = type === 'prospect' && p.found !== undefined
        ? `<strong>${p.found}</strong> prospect(s) trouvé(s) sur ${p.target}` : '';
      // Derniers prospects ajoutés, en direct (le plus récent en haut)
      const live = type === 'prospect' && p.recent?.length
        ? `<ul class="live-list">${[...p.recent].reverse().map((r) => `<li>${esc(r.company)}${r.city ? ` <span class="muted">· ${esc(r.city)}</span>` : ''}</li>`).join('')}</ul>` : '';
      const running = job.status === 'running';
      const v = pctOf(p) ?? (running ? null : 0);
      box.innerHTML = `<div class="running"><span class="spinner"></span>
        <div><div class="run-head"><span>${esc(p.message || (running ? 'En cours…' : 'En file d\'attente…'))}</span>${v !== null ? `<strong class="jpct">${v} %</strong>` : ''}</div>
          ${extra ? `<div class="small">${extra}</div>` : ''}${progressBar(job)}${remaining ? `<div class="small muted">${esc(remaining)}</div>` : ''}${p.model ? `<div class="small muted">Modèle : ${esc(p.model)}</div>` : ''}${live}</div>
        ${job.canViewLogs !== false ? `<a class="btn small" href="/jobs/${job.id}">Voir</a>` : ''}<button class="btn small" data-cancel="${job.id}">Annuler</button></div>`;
      paintBars(box);
    } else if (job.status === 'error') {
      box.innerHTML = `<p class="error small">${name} en échec : ${esc(job.error)}</p>`;
    } else if (job.status === 'cancelled') {
      box.innerHTML = `<p class="muted small">${name} annulé(e).</p>`;
    } else if (job.status === 'done') {
      if (type === 'analyze') { box.innerHTML = ''; return; } // la fiche projet affichée juste au-dessus est le résultat
      const r = job.result || {};
      let txt = `${name} terminé(e).`;
      if (type === 'template') txt = r.reviewed ? `Modèle rédigé et relu : ${r.corrections?.length ? r.corrections.join(' ; ') : 'rien à corriger'}.` : 'Modèle rédigé (la relecture n\'a pas pu être faite : relis-le toi-même).';
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
      if (type.startsWith('poste_')) {
        const when = job.finishedAt ? new Date(job.finishedAt * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }) : '';
        box.innerHTML = `<div class="evo-done"><p class="ok small">Terminé${when ? ` · ${esc(when)}` : ''}</p>
          <button type="button" class="btn small" data-poste-view="${esc(type.slice(6))}">${icon('eye')}Voir le résultat</button></div>`;
        return;
      }
      if (type === 'promo_video' && r.qualityWarnings?.length) {
        const items = r.qualityWarnings.flatMap((w) => (w.issues.length ? w.issues.map((x) => `${Number(x.time).toFixed(2)} s : ${x.problem}`) : ['un agent de contrôle n\'a pas approuvé le rendu']));
        box.innerHTML = `<p class="ok small">${esc(txt)} Les agents de contrôle ont relevé des défauts : la vidéo est dans la liste ci-dessous, regarde-la, télécharge-la ou relance.</p><ul class="small muted">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
          <div class="row"><button type="button" class="btn small primary" data-retry="${job.id}">Réessayer</button><button type="button" class="btn small primary" data-retry="${job.id}" data-fix>Corriger</button></div>`;
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
    for (const type of ['analyze', 'prospect', 'template', 'send', 'evolution', 'audit', 'followup_template', 'followup', 'linkedin_post', 'promo_video']) renderJob($(`[data-job="${type}"]`, el), jobs[type], type);
    for (const box of $$('[data-job^="poste_"]', el)) renderJob(box, jobs[box.dataset.job], box.dataset.job);

    const running = Object.entries(jobs).filter(([, j]) => ACTIVE.includes(j.status));
    $('[data-state]', el).innerHTML = running.length
      ? `<span class="spin-inline"></span>${esc(running.map(([t, j]) => { const v = pctOf(j.progress); return `${LABELS[t] || $(`[data-job="${t}"]`, el)?.dataset.label || 'Tâche'}${v !== null ? ` ${v} %` : ''}`; }).join(', '))}`
      : `<span class="muted small">${s.stats.total || 0} prospect(s)</span>`;

    // Fin d'un post LinkedIn → on recharge la zone pour afficher le brouillon
    const li = jobs.linkedin_post;
    if (li && ACTIVE.includes(li.status)) st.liRunning = true;
    else if (st.liRunning && li) { st.liRunning = false; loadLinkedin(el); }

    // Fin d'une vidéo de promotion → on recharge la liste
    const pv = jobs.promo_video;
    if (pv && ACTIVE.includes(pv.status)) st.promoRunning = true;
    else if (st.promoRunning && pv) { st.promoRunning = false; loadPromo(el); if (pv.status === 'done') toast('Vidéo de promotion prête'); }

    // Fin d'analyse → recharge la page pour afficher fiche + cible
    const an = jobs.analyze;
    if (an && ACTIVE.includes(an.status)) st.analyzing = true;
    else if (st.analyzing && an) {
      st.analyzing = false;
      if (an.status === 'done') { toast('Analyse terminée'); reload(); return; }
      if (an.status === 'error') toast(`Analyse en échec : ${an.error}`, 'error');
    }

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
        form.html.checked = !!t.html;
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
    schedule(el, running.length ? 2500 : 30_000);
  }

  function schedule(el, ms) {
    const st = state.get(el.dataset.id) || {};
    clearTimeout(st.timer);
    st.timer = el.open ? later(() => refreshProject(el), ms) : null;
    state.set(el.dataset.id, st);
  }

  $$('details.project').forEach((el) => {
    el.addEventListener('toggle', () => { if (el.open) refreshProject(el); else schedule(el, 0); });
  });
  // Rouvre un projet une seule fois : après un rechargement voulu par l'application, ou depuis « Voir » du menu Activité. Sinon tout reste fermé
  // (un seul projet : il est ouvert par le serveur).
  const last = sessionStorageGet('reopenProject');
  try { sessionStorage.removeItem('reopenProject'); } catch { /* stockage indisponible */ }
  if (last) { const el = $(`details.project[data-id="${last}"]`); if (el) el.open = true; }
  // Projet unique : ouvert dès l'affichage de la page (attribut `open` du serveur), on lance son suivi sans attendre un clic
  $$('details.project[open]').forEach((el) => refreshProject(el));
  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }

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
    const off = lsGet(`todo-off-${el.dataset.id}`) === '1';
    const restore = $('[data-todo-restore]', el);
    if (restore) restore.hidden = !off || c.complete;
    if (!badge) return;
    badge.hidden = off; // retirée par la croix : la pastille « config » part avec la liste
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
    <button type="button" class="todo-x" data-todo-close aria-label="Retirer la mise en route de ce projet" title="Retirer la mise en route (masque aussi « config »)"><span aria-hidden="true">×</span></button>
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

  // Retirer la liste d'un projet (croix ou « Masquer ») : elle et la pastille « config » disparaissent ; « Afficher la mise en route » la rend
  function hideTodo(id) {
    lsSet(`todo-off-${id}`, '1');
    if (todo) todo.hidden = true;
    const el = $(`details.project[data-id="${id}"]`);
    const c = checklists.get(String(id));
    if (el && c) markChecklist(el, c);
  }
  function restoreTodo(el) {
    lsSet(`todo-off-${el.dataset.id}`, '0');
    lsSet('todo-min', '0');
    const c = checklists.get(el.dataset.id);
    if (c) markChecklist(el, c);
    focusTodo(el);
    renderTodo();
  }

  if (todo) {
    const projects = $$('details.project');
    const start = $('details.project[open]') || projects[0];
    if (start) focusTodo(start);
    projects.forEach((el) => el.addEventListener('toggle', () => { if (el.open) focusTodo(el); }));
    // La pastille « config » du projet rappelle la liste, même après l'avoir masquée
    listen(document, 'click', (e) => {
      const badge = e.target.closest('[data-cfg]');
      const el = badge?.closest('details.project');
      if (!el) return;
      e.preventDefault();
      restoreTodo(el);
    });
    listen(document, 'click', (e) => {
      const b = e.target.closest('[data-todo-restore-btn]');
      if (b) restoreTodo(b.closest('details.project'));
    });
    todo.addEventListener('click', (e) => {
      const id = todo.dataset.project;
      const el = $(`details.project[data-id="${id}"]`);
      if (e.target.closest('[data-todo-toggle]')) { lsSet('todo-min', todo.classList.contains('min') ? '0' : '1'); renderTodo(); return; }
      if (e.target.closest('[data-todo-hide],[data-todo-close]')) { hideTodo(id); return; }
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
  listen(document, 'click', (e) => {
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
  listen(document, 'click', async (e) => {
    const b = e.target.closest('[data-copy-token]');
    if (!b) return;
    const code = $('[data-token]');
    try { await navigator.clipboard.writeText(code.textContent); toast('Jeton copié'); }
    catch { const r = document.createRange(); r.selectNodeContents(code); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Sélectionné : copie-le avec Ctrl+C', 'error'); }
  });

  // ---------- Développeur : copier une adresse ou une commande ----------
  listen(document, 'click', async (e) => {
    const b = e.target.closest('[data-copy-cmd]');
    if (!b) return;
    const code = $('code', b.closest('.cmd'));
    try { await navigator.clipboard.writeText(code.textContent); toast('Copié'); }
    catch { const r = document.createRange(); r.selectNodeContents(code); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Sélectionné : copie-le avec Ctrl+C', 'error'); }
  });
  // Action définitive : un formulaire qui porte data-confirm demande confirmation avant de partir
  listen(document, 'submit', (e) => {
    const msg = e.target.dataset?.confirm;
    if (msg && !confirm(msg)) e.preventDefault();
  });

  // ---------- Réglages : prompts par gamme de modèle ----------
  // Onglets « Tous les modèles / Haiku / Sonnet / Opus / Fable » : un seul texte visible par tâche (les autres restent dans le formulaire).
  listen(document, 'click', (e) => {
    const tab = e.target.closest('[data-pscope-tab]');
    if (!tab) return;
    const card = tab.closest('[data-prompts]');
    card.dataset.pscope = tab.dataset.pscopeTab;
    for (const t of $$('[data-pscope-tab]', card)) t.setAttribute('aria-pressed', String(t === tab));
  });
  listen(document, 'click', (e) => {
    const b = e.target.closest('[data-prompt-reset]');
    if (!b) return;
    const ta = $('[data-prompt-text]', b.closest('.pscope-box'));
    ta.value = b.dataset.default;
    ta.focus();
  });
  // Un texte que l'utilisateur n'a pas touché n'est pas renvoyé : il ne fige pas une gamme sur l'ancien défaut quand « Tous les modèles » change
  listen(document, 'submit', (e) => {
    for (const ta of $$('[data-prompt-text]', e.target)) if (ta.value === ta.defaultValue) ta.disabled = true;
  });

  // ---------- Réglages : choix du modèle (liste recommandée + autres) ----------
  listen(document, 'change', (e) => {
    const r = e.target.closest('[data-modelpick] input[type=radio]');
    if (!r) return;
    const box = r.closest('[data-modelpick]');
    $('[data-mp-name]', box).textContent = r.dataset.mpLabel;
    $('[data-mp-tier-out]', box).textContent = r.dataset.mpTier;
    box.querySelector('details').open = false;
  });

  // ---------- Réglages : notifications, le « + » ouvre le menu des services ----------
  // Service → notifications voulues → lien du webhook. Discord peut avoir plusieurs lignes (un webhook par salon) ;
  // Slack, Telegram et e-mail une seule carte chacun, déjà dans la page mais masquée jusqu'au choix.
  (() => {
    const menu = $('[data-addmenu]');
    const list = $('[data-discordlist]');
    const tpl = $('#discord-row-tpl');
    if (!menu || !list || !tpl) return;
    const full = $('[data-discord-max]');
    const empty = $('[data-chan-empty]');
    let next = Number(list.dataset.next) || 0;
    const rows = () => $$('[data-discord-row]', list);
    const renumber = () => rows().forEach((r, i) => { $('[data-discord-title]', r).textContent = `Discord ${i + 1}`; });
    const sync = () => {
      const any = rows().length || $$('[data-channel]:not([hidden])').length;
      if (empty) empty.hidden = !!any;
      full.hidden = rows().length < Number(list.dataset.max);
    };
    const focusIn = (el) => { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); $('input:not([type="hidden"]):not([type="checkbox"])', el)?.focus({ preventScroll: true }); };

    listen(document, 'click', (e) => {
      const pick = e.target.closest('[data-chan-pick]');
      if (pick) {
        menu.open = false;
        const type = pick.dataset.chanPick;
        if (type === 'discord') {
          if (rows().length >= Number(list.dataset.max)) { full.hidden = false; return; }
          const holder = document.createElement('div');
          holder.innerHTML = tpl.innerHTML.replaceAll('__I__', String(next++));
          const el = holder.firstElementChild;
          list.append(el);
          renumber();
          focusIn(el);
        } else {
          const card = $(`[data-channel="${type}"]`);
          card.hidden = false;
          pick.hidden = true;
          focusIn(card);
        }
        sync();
        return;
      }
      if (e.target.closest('[data-discord-cancel]')) {
        e.target.closest('[data-discord-row]').remove();
        renumber(); sync();
        return;
      }
      const cancel = e.target.closest('[data-chan-cancel]');
      if (cancel) {
        const card = cancel.closest('[data-channel]');
        card.hidden = true;
        for (const f of $$('input[type="password"], input[type="text"], input[type="email"]', card)) f.value = '';
        $(`[data-chan-pick="${card.dataset.channel}"]`).hidden = false;
        sync();
        return;
      }
      // un clic ailleurs referme le menu
      if (menu.open && !e.target.closest('[data-addmenu]')) menu.open = false;
    });
    listen(document, 'keydown', (e) => { if (e.key === 'Escape' && menu.open) { menu.open = false; $('summary', menu).focus(); } });
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

  listen(document, 'click', async (e) => {
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
  listen(document, 'input', (e) => {
    const area = e.target.closest('[data-li-body]');
    if (area) $('[data-li-count]', area.closest('.project')).textContent = area.value.length;
  });
  $$('details[data-acc="linkedin"]').forEach((d) => d.addEventListener('toggle', () => { if (d.open) loadLinkedin(d.closest('.project')); }));

  // ---------- Promotion ----------
  // Section d'un projet : choisir le sujet (facultatif), le nombre d'images par seconde et la durée, lancer la production, revoir et télécharger les vidéos.
  const icon = (name) => `<svg class="ic" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${name}"></use></svg>`;
  const mo = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

  async function loadPromo(proj) {
    const box = $('[data-promo]', proj);
    if (!box) return;
    try { renderPromo(box, await api(`/api/projects/${proj.dataset.id}/promo`), proj.dataset.id); }
    catch (e) { box.innerHTML = `<p class="error small">${esc(e.message)}</p>`; }
  }

  function promoVideoCard(v, s, id) {
    const dim = v.width === v.height ? 'carré' : v.width > v.height ? 'paysage' : 'vertical';
    return `<article class="pv" data-pv="${v.id}">
      <video class="pv-video pv-${dim}" controls preload="metadata" playsinline src="/api/promo/${v.id}/file" aria-label="Vidéo de promotion"></video>
      <div class="pv-meta">
        <p class="pv-title">${v.subject ? esc(v.subject) : '<span class="muted">Présentation du projet</span>'}</p>
        <p class="muted small">${v.seconds} s · ${v.fps} images/s · ${dim} · ${mo(v.size)} · ${esc(liDay(v.createdAt))}</p>
        <p class="row"><a class="btn small" href="/api/promo/${v.id}/file?download=1" download data-noajax>Télécharger</a>
        ${s.canDelete ? `<button type="button" class="btn small danger" data-pv-delete="${v.id}" data-id="${id}">Supprimer</button>` : ''}</p>
      </div></article>`;
  }

  function renderPromo(box, s, id) {
    // Ne pas écraser ce que l'utilisateur est en train de saisir
    if (box.contains(document.activeElement) && document.activeElement.matches('input, select')) return;
    if (!s.supported) { box.innerHTML = `<p class="muted">${esc(s.reason)} La vidéo de promotion n'est pas disponible sur ce serveur.</p>`; return; }
    const L = s.limits;
    const form = s.hasProfile ? `<form class="promo-form" data-promo-form data-max-frames="${L.maxFrames}">
        <label class="field"><span class="lbl">Sujet <span class="muted small">(facultatif)</span></span>
          <input name="subject" maxlength="${L.maxSubject}" placeholder="Laisse vide : Claude présente le projet" autocomplete="off"></label>
        <div class="grid3">
          <label class="field"><span class="lbl">Images par seconde</span><input name="fps" type="number" inputmode="numeric" min="${L.fps.min}" max="${L.fps.max}" value="${L.fps.def}" required></label>
          <label class="field"><span class="lbl">Durée (secondes)</span><input name="seconds" type="number" inputmode="numeric" min="${L.seconds.min}" max="${L.seconds.max}" value="${L.seconds.def}" required></label>
          <label class="field"><span class="lbl">Format</span><span class="sel"><select name="format">${s.formats.map((f) => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join('')}</select>${icon('down')}</span></label>
        </div>
        <label class="field"><span class="lbl">Style</span><span class="sel"><select name="style">${s.styles.map((f) => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join('')}</select>${icon('down')}</span></label>
        <label class="check"><input type="checkbox" name="voice" data-promo-voice-toggle><span>Ajouter une voix</span></label>
        <div class="promo-voice" data-promo-voice hidden>
          <div class="grid2">
            <label class="field"><span class="lbl">Fournisseur</span><span class="sel"><select name="voiceProvider">${s.voices.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}</select>${icon('down')}</span></label>
            <label class="field"><span class="lbl">Voix</span><span class="sel"><select name="voiceName">${voiceOptions(s.voices[0])}</select>${icon('down')}</span></label>
          </div>
          <p class="muted small" data-promo-local hidden role="status"></p>
          <label class="field" data-promo-lang hidden><span class="lbl">Langue</span><span class="sel"><select name="voiceLang">${s.voiceLangs.map((l) => `<option value="${esc(l.id)}">${esc(l.label)}</option>`).join('')}</select>${icon('down')}</span></label>
          <div class="promo-key" data-promo-key hidden data-can="${s.canManageKeys ? '1' : ''}">
            <p class="muted small" data-promo-key-help></p>
            <div class="row" data-promo-key-new><input type="password" name="voiceKey" placeholder="Colle ta clé API" autocomplete="off" spellcheck="false" aria-label="Clé API du fournisseur"><input type="text" name="voiceRegion" data-promo-region placeholder="Région (ex. francecentral)" autocomplete="off" spellcheck="false" aria-label="Région de la ressource Microsoft Azure" hidden><button type="button" class="btn small" data-promo-key-save>Enregistrer la clé</button></div>
            <div class="row" data-promo-key-set><span class="hint" data-promo-key-last4></span><button type="button" class="btn small" data-promo-key-remove>Retirer la clé</button></div>
          </div>
          <div class="row"><button type="button" class="btn small" data-promo-sample>${icon('play')}Écouter un extrait</button><span class="hint" data-promo-sample-state role="status"></span></div>
          <audio data-promo-audio preload="none"></audio>
          <p class="muted small">La voix lit un texte écrit par Claude, dans la langue de la voix choisie. Ce texte est envoyé au fournisseur pour être lu. Google Traduction est gratuit et sans clé, mais non officiel (il peut changer ou refuser des demandes) et sa voix est simple. Piper et eSpeak NG sont des voix locales, gratuites, sans clé : elles tournent sur le serveur (rien n'en sort) si l'administrateur les a installées ; Piper est bien plus naturelle. ElevenLabs, Google Cloud et Microsoft Azure donnent des voix bien plus naturelles avec ta propre clé API (quota gratuit mensuel du fournisseur) ; ta clé est chiffrée et jamais réaffichée.</p>
        </div>
        <p class="hint" data-promo-count></p>
        <div class="row"><button class="btn primary" data-promo-go>${icon('film')}Générer la vidéo</button></div>
      </form>
      <p class="muted small">Claude écrit la scène, elle est ensuite dessinée image par image sur le serveur : compte quelques minutes selon la durée et le nombre d'images par seconde. Les consignes se modifient dans les Réglages (« Vidéo de promotion »).</p>`
      : '<p class="muted">Analyse d\'abord le projet : Claude s\'appuie sur sa fiche pour concevoir la vidéo.</p>';
    voiceCatalogs.set(box, s.voices);
    box.innerHTML = `${form}${s.videos.length ? `<div class="pv-list">${s.videos.map((v) => promoVideoCard(v, s, id)).join('')}</div>` : (s.hasProfile ? '<p class="muted small">Aucune vidéo pour l\'instant.</p>' : '')}`;
    promoCount(box);
    const pf = $('[data-promo-form]', box);
    if (pf) voiceSync(pf);
  }

  // Nombre d'images à produire, et message clair si la limite est dépassée (le serveur la contrôle aussi)
  const voiceOptions = (p) => (p?.voices ? p.voices.map((v) => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join('') : '<option value="">—</option>');
  function promoCount(box) {
    const f = $('[data-promo-form]', box);
    if (!f) return;
    const fps = Number(f.fps.value), sec = Number(f.seconds.value), n = fps * sec, max = Number(f.dataset.maxFrames);
    const out = $('[data-promo-count]', f);
    const bad = !Number.isFinite(n) || n > max;
    out.textContent = bad ? `Trop d'images (${n || 0}) : le maximum est ${max} (images par seconde × durée). Réduis la durée ou le nombre d'images par seconde.` : `${n} images à produire.`;
    out.classList.toggle('error', bad);
    $('[data-promo-go]', f).disabled = bad;
  }

  // Voix : la case montre les choix ; le fournisseur change la liste des voix (et demande une clé pour ElevenLabs et Google Cloud) ; l'extrait se lit depuis le serveur
  const voiceCatalogs = new WeakMap();
  const voiceProvider = (f) => voiceCatalogs.get(f.closest('[data-promo]'))?.find((p) => p.id === f.voiceProvider.value);
  function voiceSync(f) {
    const p = voiceProvider(f);
    if (!p) return;
    $('[data-promo-lang]', f).hidden = !p.multilingual;
    const local = $('[data-promo-local]', f);
    local.hidden = !(p.local && !p.available);
    local.textContent = p.unavailable || '';
    const key = $('[data-promo-key]', f);
    key.hidden = !p.keyed;
    if (p.keyed) {
      $('[data-promo-key-help]', f).textContent = p.keyHelp || '';
      $('[data-promo-key-new]', f).hidden = !!p.keyLast4 || !key.dataset.can;
      $('[data-promo-key-set]', f).hidden = !p.keyLast4;
      $('[data-promo-region]', f).hidden = !p.needsRegion;
      $('[data-promo-key-last4]', f).textContent = p.keyLast4 ? `Clé enregistrée (se termine par ${p.keyLast4})${p.region ? ` · région ${p.region}` : ''}` : '';
      if (!key.dataset.can && !p.keyLast4) $('[data-promo-key-help]', f).textContent = 'Seul le propriétaire du projet peut enregistrer la clé de ce fournisseur.';
      $('[data-promo-key-remove]', f).hidden = !key.dataset.can;
    }
    f.voiceName.innerHTML = voiceOptions(p);
    $('[data-promo-sample]', f).disabled = !f.voiceName.value;
  }
  async function voiceLoad(f) {
    const p = voiceProvider(f);
    voiceSync(f);
    if (!p?.keyed || !p.keyLast4 || p.voices) return;
    const state = $('[data-promo-sample-state]', f);
    state.textContent = 'Chargement des voix…';
    try { p.voices = (await api(`/api/promo/voices?provider=${encodeURIComponent(p.id)}`)).voices; state.textContent = ''; } catch (err) { state.textContent = err.message; }
    if (voiceProvider(f) === p) voiceSync(f);
  }
  listen(document, 'change', (e) => {
    const f = e.target.closest('[data-promo-form]');
    if (!f) return;
    if (e.target.matches('[data-promo-voice-toggle]')) $('[data-promo-voice]', f).hidden = !e.target.checked;
    if (e.target.name === 'voiceProvider') voiceLoad(f);
  });
  async function saveVoiceKey(f) {
    const p = voiceProvider(f);
    const input = f.voiceKey;
    const state = $('[data-promo-sample-state]', f);
    const btn = $('[data-promo-key-save]', f);
    btn.disabled = true;
    state.textContent = 'Vérification de la clé…';
    try {
      const r = await api('/api/promo/voice-key', { provider: p.id, key: input.value, region: f.voiceRegion.value });
      input.value = '';
      p.keyLast4 = r.keyLast4;
      p.region = r.region;
      p.voices = r.voices;
      state.textContent = 'Clé enregistrée';
      voiceSync(f);
    } catch (err) { state.textContent = err.message; } finally { btn.disabled = false; }
  }
  listen(document, 'keydown', (e) => { if (e.key === 'Enter' && (e.target.name === 'voiceKey' || e.target.name === 'voiceRegion')) { e.preventDefault(); const f = e.target.closest('[data-promo-form]'); if (f) saveVoiceKey(f); } });
  listen(document, 'click', async (e) => {
    const f = e.target.closest('[data-promo-form]');
    if (!f) return;
    if (e.target.closest('[data-promo-key-save]')) return saveVoiceKey(f);
    if (e.target.closest('[data-promo-key-remove]')) {
      const p = voiceProvider(f);
      if (!confirm(`Retirer la clé ${p.label.split(' (')[0]} ? Il faudra la coller de nouveau pour reprendre ses voix.`)) return;
      try { await api('/api/promo/voice-key/delete', { provider: p.id }); p.keyLast4 = null; p.region = null; p.voices = null; voiceSync(f); } catch (err) { $('[data-promo-sample-state]', f).textContent = err.message; }
      return;
    }
    const b = e.target.closest('[data-promo-sample]');
    if (!b) return;
    const state = $('[data-promo-sample-state]', f);
    const url = `/api/promo/voice-sample?provider=${encodeURIComponent(f.voiceProvider.value)}&voice=${encodeURIComponent(f.voiceName.value)}&lang=${encodeURIComponent(f.voiceLang.value)}`;
    b.disabled = true;
    state.textContent = 'Chargement de l\'extrait…';
    try {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Extrait indisponible');
      const audio = $('[data-promo-audio]', f);
      audio.src = url;
      await audio.play();
      state.textContent = 'Lecture…';
      audio.onended = () => { state.textContent = ''; };
    } catch (err) { state.textContent = err.message; } finally { b.disabled = false; }
  });
  listen(document, 'input', (e) => { const b = e.target.closest('[data-promo-form]'); if (b) promoCount(b.closest('[data-promo]')); });
  listen(document, 'submit', async (e) => {
    const f = e.target.closest('[data-promo-form]');
    if (!f) return;
    e.preventDefault();
    const proj = f.closest('.project');
    const btn = $('[data-promo-go]', f);
    if (f.voice.checked) {
      const vp = voiceProvider(f);
      if (vp?.keyed && !vp.keyLast4) return toast(`Ajoute d'abord ta clé API ${vp.label.split(' (')[0]}, ou choisis un autre fournisseur`, 'error');
      if (vp?.local && !vp.available) return toast(vp.unavailable, 'error');
      if (!f.voiceName.value) return toast('Choisis une voix', 'error');
    }
    btn.disabled = true;
    try {
      const r = await api(`/api/projects/${proj.dataset.id}/promo/generate`, { subject: f.subject.value, fps: Number(f.fps.value), seconds: Number(f.seconds.value), format: f.format.value, style: f.style.value, voice: f.voice.checked, voiceProvider: f.voiceProvider.value, voiceName: f.voiceName.value, voiceLang: f.voiceLang.value });
      toast(r.budgetBlocked ? `En file, mais ${r.budgetBlocked}` : r.existing ? 'Une vidéo est déjà en cours de production' : 'Claude conçoit la vidéo…', r.budgetBlocked ? 'error' : 'ok');
      refreshProject(proj);
    } catch (err) { toast(err.message, 'error'); }
    promoCount(f.closest('[data-promo]'));
  });
  listen(document, 'click', async (e) => {
    const t = e.target.closest('[data-pv-delete]');
    if (!t) return;
    if (!confirm('Supprimer cette vidéo ? Le fichier sera effacé.')) return;
    try {
      await api(`/api/projects/${t.dataset.id}/promo/${t.dataset.pvDelete}/delete`, {});
      loadPromo(t.closest('.project'));
    } catch (err) { toast(err.message, 'error'); }
  });
  $$('details[data-acc="promo"]').forEach((d) => d.addEventListener('toggle', () => { if (d.open) loadPromo(d.closest('.project')); }));

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
  listen(document, 'click', (e) => {
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

  listen(document, 'click', async (e) => {
    const retry = e.target.closest('[data-retry]');
    if (retry) {
      if (retry.disabled) return;
      const fix = 'fix' in retry.dataset;
      const label = retry.textContent;
      retry.disabled = true; retry.textContent = fix ? 'Correction…' : 'Relance…';
      const failure = $('[data-retry-error]');
      if (failure) failure.hidden = true;
      try {
        const result = await api(`/api/jobs/${retry.dataset.retry}/retry`, fix ? { fix: true } : {});
        location.href = `/jobs/${result.id}`;
      } catch (err) {
        if (failure) { failure.textContent = err.message; failure.hidden = false; }
        else toast(err.message, 'error');
        retry.disabled = false; retry.textContent = label;
      }
      return;
    }
    const copy = e.target.closest('[data-copy-md]');
    if (copy) {
      const md = copy.closest('.job')?._markdown || '';
      try { await navigator.clipboard.writeText(md); toast('Markdown copié'); } catch { toast('Copie impossible dans ce navigateur', 'error'); }
      return;
    }

    const runBtn = e.target.closest('[data-run]');
    if (runBtn) {
      e.preventDefault(); // le bouton « Réanalyser » est dans la ligne du projet : il ne doit pas la replier
      const { run, id } = runBtn.dataset;
      if (run === 'analyze' && runBtn.hasAttribute('data-reanalyze') && !confirm('Relancer l\'analyse complète du repo ? (consomme du quota Claude)')) return;
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
      refreshActivity();
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

  // ---------- Postes : filtre par poste et résultat d'une tâche ----------
  const ROLE_KEY = 'aitools.role';
  const savedRole = () => { try { return localStorage.getItem(ROLE_KEY) || ''; } catch { return ''; } };
  function applyRole(role) {
    for (const sel of $$('[data-role-select]')) sel.value = role;
    for (const proj of $$('.project')) {
      for (const d of $$('details.acc[data-roles]', proj)) d.hidden = !!role && !d.dataset.roles.split(' ').includes(role);
      for (const d of $$('details.role', proj)) {
        d.hidden = !!role && d.dataset.role !== role;
        if (role && d.dataset.role === role) d.open = true;
      }
      const postes = $('details.acc[data-acc="postes"]', proj);
      if (postes && role) postes.open = true;
    }
  }
  if (!$$('[data-role-select] option').some((o) => o.value === savedRole())) { try { localStorage.removeItem(ROLE_KEY); } catch { /* ignore */ } }
  applyRole(savedRole());
  listen(document, 'change', (e) => {
    const sel = e.target.closest('[data-role-select]');
    if (!sel) return;
    try { if (sel.value) localStorage.setItem(ROLE_KEY, sel.value); else localStorage.removeItem(ROLE_KEY); } catch { /* le filtre fonctionne sans mémoire */ }
    applyRole(sel.value);
  });

  let posteMd = '';
  listen(document, 'click', async (e) => {
    const v = e.target.closest('[data-poste-view]');
    if (!v) return;
    v.disabled = true;
    try {
      const r = await api(`/api/projects/${v.closest('.project').dataset.id}/poste/${v.dataset.posteView}`);
      let dlg = $('dialog.posteview');
      if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.className = 'prospect-dialog posteview';
        document.body.append(dlg);
        dlg.addEventListener('click', async (ev) => {
          if (ev.target === dlg || ev.target.closest('[data-close]')) { dlg.close(); return; }
          if (ev.target.closest('[data-poste-copy]')) {
            try { await navigator.clipboard.writeText(posteMd); toast('Markdown copié'); } catch { toast('Copie impossible dans ce navigateur', 'error'); }
          }
        });
      }
      posteMd = r.markdown;
      const when = r.finishedAt ? new Date(r.finishedAt * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }) : '';
      // r.html est rendu et échappé par le serveur (src/services/markdown.js)
      dlg.setAttribute('aria-label', r.label);
      dlg.innerHTML = `<div class="dlg-head"><div><h3>${esc(r.label)}</h3><p class="muted small">${esc(r.role)}${when ? ` · ${esc(when)}` : ''}${r.notes ? ` · précisions : ${esc(r.notes)}` : ''}</p></div>
        <button type="button" class="btn small" data-close>Fermer</button></div>
        <div class="poste-md">${r.html}</div>
        <div class="row"><button type="button" class="btn small" data-poste-copy>Copier le livrable (Markdown)</button></div>`;
      if (!dlg.open) dlg.showModal();
    } catch (err) { toast(err.message, 'error'); }
    v.disabled = false;
  });

  // ---------- Réglages : pied de page des mails (retrait confirmé, retour libre) ----------
  const FOOTER_RISK = "Retirer le pied de page de tes mails de prospection ?\n\n"
    + "• Légal : le RGPD et la CNIL exigent d'informer la personne de l'origine de son adresse et de lui offrir un moyen simple et gratuit de refuser tes messages. C'est toi qui en portes la responsabilité.\n"
    + "• Réputation : sans lien de désinscription, les destinataires cliquent « Spam » et Gmail ou Outlook peuvent bloquer ton adresse et ton domaine d'envoi.\n"
    + "• Seul l'en-tête invisible « List-Unsubscribe » reste, et toutes les messageries ne l'affichent pas.\n\n"
    + "Tu peux le remettre à tout moment. Confirmer le retrait ?";
  listen(document, 'click', async (e) => {
    const off = e.target.closest('[data-footer-off]');
    const on = e.target.closest('[data-footer-on]');
    if (!off && !on) return;
    if (off && !confirm(FOOTER_RISK)) return;
    const box = (off || on).closest('[data-footer-opt]');
    const btn = off || on;
    btn.disabled = true;
    try {
      const r = await api('/api/settings/mail-footer', { enabled: !!on, confirmed: !!off });
      $('[data-footer-off]', box).hidden = !r.enabled;
      $('[data-footer-on]', box).hidden = r.enabled;
      const st = $('[data-footer-state]', box);
      st.className = `state ${r.enabled ? 'ok' : 'warn'}`;
      st.textContent = r.enabled
        ? 'Actif : chaque mail se termine par « Vous recevez ce message car l\'adresse … est publiée publiquement (source) » et un lien « Ne plus recevoir de messages ».'
        : 'Retiré : tes mails partent sans lien « Ne plus recevoir de messages » ni origine de l\'adresse (seul l\'en-tête invisible « List-Unsubscribe » reste).';
      toast(r.enabled ? 'Pied de page remis' : 'Pied de page retiré', r.enabled ? 'ok' : 'error');
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false;
  });

  // ---------- Formulaires ----------
  listen(document, 'submit', async (e) => {
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
          // L'analyse apparaît d'abord dans « Activité », avec son pourcentage, puis la page se recharge
          await refreshSys().then(showActivity).catch(() => {});
          setTimeout(() => reload(), 1200);
          break;
        }
        case 'site': { const r = await api(`/api/projects/${id}/site`, data); form.elements.site_url.value = r.siteUrl; toast(r.siteUrl ? 'Site enregistré' : 'Site retiré'); break; }
        case 'target': await api(`/api/projects/${id}/target`, data); toast('Cible validée'); setTimeout(() => reload(), 500); break;
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
        case 'poste': {
          const r = await api(`/api/projects/${id}/poste/${form.dataset.task}`, data);
          toast(r.budgetBlocked ? `En file, mais ${r.budgetBlocked}` : r.existing ? 'Cette tâche est déjà prévue ou en cours' : 'Tâche lancée', r.budgetBlocked ? 'error' : 'ok');
          break;
        }
        case 'template': {
          data.kind = form.dataset.kind;
          const r = await api(`/api/projects/${id}/template/save`, data);
          toast(`${r.status === 'validated' ? 'Modèle validé' : 'Brouillon enregistré'}${r.warnings?.length ? ` · À vérifier : ${r.warnings.slice(0, 2).join(' ')}` : ''}`, r.warnings?.length ? 'error' : 'ok');
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
        case 'delete': await api(`/api/projects/${id}/delete`, {}); reload(); break;
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
  listen(document, 'pointermove', (e) => {
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

  listen(document, 'click', (e) => {
    const b = e.target.closest('[data-days]');
    if (b) loadHistory(b.closest('.project'), Number(b.dataset.days));
  });
  let resizeT;
  listen(window, 'resize', () => {
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
        <p class="muted small">${r.priced ? `Coût IA du projet (équivalent API) : $${r.aiCostUsd.toFixed(2)}${b?.cached ? ' · chiffres en cache (10 min)' : ''}` : (b?.cached ? 'Chiffres en cache (10 min)' : '')}
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

      <h4>Informations</h4>
      <form data-dlg="edit" class="pform">
        <div class="grid2">
          <label class="field"><span class="lbl">Entreprise</span><input name="company" required maxlength="200" value="${esc(p.company)}"></label>
          <label class="field"><span class="lbl">Email</span><input name="email" type="email" required maxlength="200" value="${esc(p.email)}"${p.status === 'new' ? '' : ' readonly aria-describedby="email-lock"'}></label>
          <label class="field"><span class="lbl">Site</span><input name="website" maxlength="300" value="${esc(p.website || '')}" placeholder="https://entreprise.fr"></label>
          <label class="field"><span class="lbl">Ville</span><input name="city" maxlength="100" value="${esc(p.city || '')}"></label>
          <label class="field"><span class="lbl">Secteur</span><input name="sector" maxlength="100" value="${esc(p.sector || '')}"></label>
          <label class="field"><span class="lbl">Score (1 à 10)</span><input name="score" type="number" min="1" max="10" inputmode="numeric" value="${p.score ?? ''}"></label>
        </div>
        <label class="field"><span class="lbl">Accroche</span><input name="hook" maxlength="400" value="${esc(p.hook || '')}"></label>
        <label class="field"><span class="lbl">Origine de l'adresse</span><input name="source" maxlength="300" value="${esc(p.source || '')}"></label>
        ${p.status === 'new' ? '' : '<p class="muted small" id="email-lock">L\'adresse ne peut plus être modifiée : des mails y sont rattachés. Pour une autre adresse, ajoute un nouveau prospect.</p>'}
        <div class="row"><button class="btn">Enregistrer les informations</button></div>
      </form>

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
      <div class="danger-zone"><button type="button" class="btn small danger" data-del-prospect>${icon('trash')}Supprimer ce prospect</button>
        <span class="muted small">Ses notes sont supprimées. Les mails déjà envoyés restent dans la page Mails.</span></div>
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
      if (e.target.closest('[data-del-prospect]')) {
        const name = $('.dlg-head h3', dlg)?.textContent || 'ce prospect';
        if (!confirm(`Supprimer définitivement « ${name} » ?\nSes notes seront supprimées. Les mails déjà envoyés restent dans la page Mails.`)) return;
        try { await api(`/api/prospects/${id}/delete`, {}); dlg.close(); toast('Prospect supprimé'); refreshOpenLists(); }
        catch (err) { toast(err.message, 'error'); }
        return;
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
        else if (form.dataset.dlg === 'edit') { await api(`/api/prospects/${id}/update`, formData(form)); toast('Informations enregistrées'); refreshOpenLists(); }
        else { await api(`/api/prospects/${id}/next`, formData(form)); toast('Prochaine action enregistrée'); refreshOpenLists(); }
        openProspect(id);
      } catch (err) { toast(err.message, 'error'); }
    });
  }
  // ---------- Aperçu du mail ----------
  // Le serveur construit le mail avec le même code que l'envoi réel (rien n'est envoyé) ; le HTML s'affiche dans un cadre isolé (sans script ni réseau).
  let pvDlg = null;
  const pv = { form: null, prospectId: '', variant: 'A', tab: 'html', prospects: null };

  async function renderPreview() {
    const form = pv.form;
    const id = form.closest('.project').dataset.id;
    let r;
    try {
      r = await api(`/api/projects/${id}/template/preview`, {
        kind: form.dataset.kind, subject: form.subject.value, subjectB: form.subjectB?.value || '', body: form.body.value, html: form.html.checked ? 'on' : '', variant: pv.variant, prospectId: pv.prospectId,
      });
    } catch (err) { toast(err.message, 'error'); return; }
    if (!pv.prospects) {
      try { pv.prospects = (await api(`/api/projects/${id}/prospects`)).rows || []; } catch { pv.prospects = []; }
    }
    if (!r.hasB) pv.variant = 'A';
    const opts = pv.prospects.map((p) => `<option value="${p.id}"${String(p.id) === String(pv.prospectId) ? ' selected' : ''}>${esc(p.company)} · ${esc(p.email)}</option>`).join('');
    $('[data-dialog-body]', pvDlg).innerHTML = `
      <div class="row dlg-head"><div><h3>${icon('eye')} Aperçu du ${r.kind === 'followup' ? 'mail de relance' : 'premier mail'}</h3>
        <p class="muted small">Voilà ce que le prospect reçoit. Rien n'est envoyé.</p></div><button type="button" class="btn small" data-close>Fermer</button></div>
      <div class="pv-controls">
        <label class="field"><span class="lbl">Voir avec</span><span class="sel"><select data-pv-prospect><option value="">Un exemple fictif</option>${opts}</select>${icon('down')}</span></label>
        ${r.hasB ? `<div class="seg" role="group" aria-label="Objet à afficher">
          <button type="button" class="btn small" data-pv-variant="A" aria-pressed="${r.variant === 'A'}">Objet A</button>
          <button type="button" class="btn small" data-pv-variant="B" aria-pressed="${r.variant === 'B'}">Objet B</button></div>` : ''}
      </div>
      ${r.note ? `<p class="muted small">${esc(r.note)}</p>` : ''}
      <dl class="pv-head"><dt>De</dt><dd>${esc(r.from)}</dd><dt>À</dt><dd>${esc(r.to)}</dd><dt>Objet</dt><dd><strong>${esc(r.subject) || '<span class="error">(vide)</span>'}</strong></dd></dl>
      ${r.warnings.length ? `<ul class="pv-warn" role="status">${r.warnings.map((w) => `<li>${icon('alert')}<span>${esc(w)}</span></li>`).join('')}</ul>` : ''}
      ${r.html ? `<div class="seg" role="group" aria-label="Version du mail">
        <button type="button" class="btn small" data-pv-tab="html" aria-pressed="${pv.tab === 'html'}">Mail</button>
        <button type="button" class="btn small" data-pv-tab="text" aria-pressed="${pv.tab === 'text'}">Version texte</button></div>` : ''}
      ${r.html && pv.tab === 'html'
    ? `<iframe class="pv-frame" sandbox title="Aperçu du mail" src="${esc(r.url)}"></iframe>`
    : `<pre class="pv-text">${esc(r.text)}</pre>`}
      <p class="muted small">${r.footer ? `Le lien « Ne plus recevoir de messages » ${r.sample ? 'est un lien d\'exemple' : 'est le vrai lien de ce prospect'} ; il est ajouté automatiquement à chaque mail, avec l'origine de l'adresse.` : 'Le pied de page est retiré dans Réglages → Garde-fous : le mail part tel quel, sans lien de désinscription visible.'}</p>`;
    if (!pvDlg.open) pvDlg.showModal();
  }

  listen(document, 'click', async (e) => {
    const open = e.target.closest('[data-tpl-preview]');
    if (open) {
      if (!pvDlg) {
        pvDlg = document.createElement('dialog');
        pvDlg.className = 'prospect-dialog mailprev';
        pvDlg.setAttribute('aria-label', 'Aperçu du mail');
        pvDlg.innerHTML = '<div data-dialog-body></div>';
        document.body.append(pvDlg);
        pvDlg.addEventListener('click', (ev) => {
          if (ev.target === pvDlg || ev.target.closest('[data-close]')) { pvDlg.close(); return; }
          const v = ev.target.closest('[data-pv-variant]');
          const t = ev.target.closest('[data-pv-tab]');
          if (v) { pv.variant = v.dataset.pvVariant; renderPreview(); }
          if (t) { pv.tab = t.dataset.pvTab; renderPreview(); }
        });
        pvDlg.addEventListener('change', (ev) => { if (ev.target.matches('[data-pv-prospect]')) { pv.prospectId = ev.target.value; renderPreview(); } });
      }
      Object.assign(pv, { form: open.closest('form'), prospectId: '', variant: 'A', tab: 'html', prospects: null });
      open.disabled = true;
      await renderPreview();
      open.disabled = false;
    }
  });

  // Ajouter un prospect à la main : le formulaire s'ouvre sous les boutons de la liste
  listen(document, 'click', (e) => {
    const t = e.target.closest('[data-pform-toggle],[data-pform-cancel]');
    if (!t) return;
    const d = t.closest('details.prospects');
    const form = $('[data-pform]', d);
    const open = t.matches('[data-pform-toggle]') ? form.hidden : false;
    form.hidden = !open;
    $('[data-pform-toggle]', d).setAttribute('aria-expanded', String(open));
    if (open) $('input[name="email"]', form).focus();
  });
  listen(document, 'submit', async (e) => {
    const form = e.target.closest('form[data-pform]');
    if (!form) return;
    e.preventDefault();
    const d = form.closest('details.prospects');
    const btn = $('button:not([type=button])', form);
    btn.disabled = true;
    try {
      await api(`/api/projects/${form.dataset.id}/prospects`, formData(form));
      toast('Prospect ajouté');
      form.reset(); form.hidden = true;
      $('[data-pform-toggle]', d).setAttribute('aria-expanded', 'false');
      loadProspects(d);
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false;
  });

  // Import CSV : Excel enregistre souvent en Windows-1252, on détecte pour ne pas abîmer les accents
  listen(document, 'change', async (e) => {
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

  listen(document, 'click', (e) => {
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
      box.innerHTML = `<div class="kanban">${r.columns.map((c) => `<section class="kcol${c.total ? '' : ' empty'}" data-col="${c.status}" aria-label="${esc(c.label)}">
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
  listen(document, 'dragstart', (e) => {
    const c = e.target.closest?.('[data-card]');
    if (!c) return;
    e.dataTransfer.setData('text/plain', c.dataset.card);
    e.dataTransfer.effectAllowed = 'move';
    c.classList.add('drag');
  });
  listen(document, 'dragend', (e) => { e.target.closest?.('[data-card]')?.classList.remove('drag'); $$('.kcol.over').forEach((c) => c.classList.remove('over')); });
  listen(document, 'dragover', (e) => {
    const col = e.target.closest?.('.kcol');
    if (!col) return;
    e.preventDefault();
    $$('.kcol.over').forEach((c) => { if (c !== col) c.classList.remove('over'); });
    col.classList.add('over');
  });
  listen(document, 'drop', (e) => {
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
  listen(document, 'change', async (e) => {
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
  // Proposition « Ajouter à ton calendrier » : titre et date préremplis à partir de la réponse, l'utilisateur corrige puis confirme
  function suggestDom(r) {
    const box = document.createElement('div');
    box.className = 'suggest';
    box.dataset.suggest = r.id;
    if (r.event) { doneDom(box, r.event); return box; }
    const s = r.suggestion;
    if (!s) return null;
    box.dataset.minutes = s.minutes;
    const why = document.createElement('p'); why.className = 'why';
    const b = document.createElement('b'); b.textContent = 'Ajouter à ton calendrier ? ';
    why.append(b, s.dateToChoose ? "Il semble partant mais n'a pas donné de date : choisis un créneau."
      : `Il évoque « ${s.phrase} »${s.guessed ? " ; l'heure n'est pas précisée, vérifie-la" : ''}${s.vague ? ' ; date approximative, à confirmer' : ''}.`);
    const title = document.createElement('input'); title.value = s.title; title.maxLength = 200; title.setAttribute('data-ev-title', ''); title.setAttribute('aria-label', 'Titre');
    const row = document.createElement('div'); row.className = 'sg-row';
    const when = document.createElement('input'); when.type = 'datetime-local'; when.value = s.whenLocal; when.setAttribute('data-ev-when', ''); when.setAttribute('aria-label', 'Date et heure (Paris)');
    const add = document.createElement('button'); add.type = 'button'; add.className = 'btn primary'; add.textContent = 'Ajouter à mon calendrier'; add.dataset.evAdd = r.id;
    row.append(when, add);
    box.append(why, title, row);
    return box;
  }
  // Après l'ajout : l'événement est dans l'agenda d'AiTools ; deux liens pour l'avoir aussi dans SON agenda
  function doneDom(box, ev) {
    box.className = 'suggest done';
    box.replaceChildren();
    const p = document.createElement('p'); p.className = 'why';
    const b = document.createElement('b'); b.textContent = 'Ajouté à ton calendrier : ';
    p.append(b, ev.title);
    const row = document.createElement('div'); row.className = 'sg-row';
    const g = document.createElement('a'); g.className = 'btn small'; g.href = ev.links.google; g.target = '_blank'; g.rel = 'noopener noreferrer'; g.textContent = 'Google Agenda';
    const i = document.createElement('a'); i.className = 'btn small'; i.href = ev.links.ics; i.textContent = 'Fichier .ics';
    row.append(g, i);
    box.append(p, row);
  }
  listen(document, 'click', async (e) => {
    const btn = e.target.closest('[data-ev-add]');
    if (!btn) return;
    const box = btn.closest('[data-suggest]');
    const title = $('[data-ev-title]', box).value.trim();
    const when = $('[data-ev-when]', box).value;
    if (!title || !when) { toast('Renseigne un titre, une date et une heure', 'error'); return; }
    btn.disabled = true;
    try {
      const r = await api(`/api/replies/${btn.dataset.evAdd}/event`, { title, when, minutes: Number(box.dataset.minutes) || 30 });
      doneDom(box, r.event);
      toast(r.existing ? 'Déjà dans ton calendrier' : 'Ajouté à ton calendrier');
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  });
  function replyPopup(r) {
    const el = document.createElement('details');
    el.className = 'reply-pop';
    const sum = document.createElement('summary');
    const who = document.createElement('strong'); who.textContent = r.from;
    sum.append(who, ' vous a apporté une réponse');
    const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = r.intentLabel; sum.append(' ', badge);
    const close = document.createElement('button'); close.type = 'button'; close.className = 'reply-x'; close.setAttribute('aria-label', 'Fermer'); close.textContent = '×';
    close.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); el.remove(); markSeen(r.id).then(pollReplies); });
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
    read.addEventListener('click', () => { el.remove(); markSeen(r.id).then(pollReplies); });
    const all = document.createElement('a'); all.className = 'btn small'; all.href = '/mails?v=replies'; all.textContent = 'Toutes les réponses';
    acts.append(copy, read, all);
    body.append(sub, txt);
    const sg = suggestDom(r);
    if (sg) body.append(sg);
    body.append(lbl, ta, acts);
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
    if (document.hidden || !$('.top') || unlinked()) return;
    try {
      const d = await api('/api/replies?unseen=1&limit=10');
      paintUnseen(d.unseen);
      // Deux popups au plus à l'écran : le reste est résumé en une ligne (sur téléphone, des popups empilées cacheraient la page)
      const room = Math.max(0, 2 - $$('.reply-pop', popHost).length);
      const fresh = d.replies.filter((r) => !shownReplies.has(r.id));
      for (const r of fresh.slice(0, room)) { shownReplies.add(r.id); replyPopup(r); }
      $('.reply-more', popHost)?.remove();
      const rest = d.unseen - $$('.reply-pop', popHost).length;
      if (rest > 0) {
        const more = document.createElement('a');
        more.className = 'reply-more'; more.href = '/mails?v=replies';
        more.textContent = `+ ${rest} autre${rest > 1 ? 's' : ''} réponse${rest > 1 ? 's' : ''} non lue${rest > 1 ? 's' : ''}`;
        popHost.append(more);
      }
    } catch { /* hors ligne ou session expirée : la prochaine requête le dira */ }
  }
  if ($('.top')) { pollReplies(); every(pollReplies, 45_000); listen(document, 'visibilitychange', () => { if (!document.hidden) pollReplies(); }); }
  listen(document, 'click', async (e) => {
    const c = e.target.closest('[data-copy-draft]');
    if (c) { copyText($('[data-draft]', c.closest('.reply-body')).value, c); return; }
    const s = e.target.closest('[data-reply-seen]');
    if (s) { await markSeen(s.dataset.replySeen); s.closest('.reply-row')?.classList.remove('unseen'); s.remove(); pollReplies(); }
  });
  // Barre d'enregistrement des réglages : visible seulement tant qu'un champ diffère de sa valeur enregistrée
  const fieldChanged = (el) => {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
    if (el.tagName === 'SELECT') return [...el.options].some((o) => o.selected !== o.defaultSelected);
    return el.value !== el.defaultValue;
  };
  const syncSavebar = (e) => {
    const form = e.target.closest?.('form');
    const bar = form && $('[data-savebar]', form);
    if (bar) bar.hidden = ![...form.elements].some((el) => el.name && el.type !== 'hidden' && el.type !== 'submit' && el.type !== 'button' && fieldChanged(el));
  };
  listen(document, 'input', syncSavebar);
  listen(document, 'change', syncSavebar);
  listen(document, 'change', (e) => { if (e.target.matches('[data-autosubmit]')) e.target.form.requestSubmit(); });

})();



