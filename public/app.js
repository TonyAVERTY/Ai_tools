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
  const formData = (form) => Object.fromEntries(new FormData(form));
  const icon = (name) => `<svg class="ic" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${name}"></use></svg>`;
  const liDay = (ts) => new Date(ts * 1000).toLocaleDateString('fr-FR', { dateStyle: 'medium', timeZone: 'Europe/Paris' });

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
    // Le bouton cliqué est « occupé » le temps de l'envoi : `aria-busy` affiche l'indicateur dans le bouton (CSS `.btn[aria-busy]`) et le bloque
    // (anti double envoi). Un bouton que le code a déjà désactivé avant l'appel (la majorité) garde sa logique : on ne fait que le marquer occupé,
    // et on ne le réactive pas.
    const btn = body !== undefined && lastTrigger?.tagName === 'BUTTON' && lastTrigger.isConnected ? lastTrigger : null;
    const lock = !!btn && !btn.disabled;
    if (btn) { if (lock) btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
    try {
      const data = await call(path, body);
      if (launching && !data.existing) launched(lastTrigger);
      return data;
    } finally {
      if (btn) { btn.removeAttribute('aria-busy'); if (lock) btn.disabled = false; }
    }
  }

  // Outils communs pour les fichiers public/app-*.js (chargés après celui-ci)
  Object.assign(window.AiTools, { $, $$, api, esc, every, formData, go, icon, liDay, listen, refreshProject, httpErrorText, networkErrorText, toLogin });

  // Une erreur dit ce qui s'est passé et quoi faire ensuite : jamais « Failed to fetch » ni un code brut. Le message du serveur, quand il y en a un, passe en premier.
  function httpErrorText(status) {
    if (status === 403) return "Tu n'as pas accès à cette action.";
    if (status === 404) return 'Introuvable : recharge la page.';
    if (status === 429) return 'Trop de demandes : attends un instant puis réessaie.';
    if (status >= 500) return 'Erreur interne : réessaie dans un instant.';
    return `Erreur ${status} : recharge la page puis réessaie.`;
  }
  function networkErrorText() { return 'Connexion impossible : réessaie dans un instant.'; } // déclaration (hoistée) : exportée plus haut dans window.AiTools
  // Session expirée : on revient à la connexion avec l'explication (la page de connexion affiche déjà `?e=`), plutôt qu'une redirection muette
  function toLogin() { location.href = `/login?e=${encodeURIComponent('Ta session a expiré : reconnecte-toi.')}`; }

  async function call(path, body) {
    let r;
    try {
      r = await fetch(path, body === undefined ? { headers: { Accept: 'application/json' } } : {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
      });
    } catch { throw new Error(networkErrorText()); }
    if (r.status === 401) { toLogin(); throw new Error('Session expirée'); }
    const data = await r.json().catch(() => ({}));
    if (r.status === 403 && data.code === 'link_required') showReconnect();
    if (!r.ok) throw new Error(data.error || httpErrorText(r.status));
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

  // Notifications d'une action : empilées dans un conteneur (sinon deux messages se superposent), annoncées aux lecteurs d'écran
  // (alert pour une erreur, status sinon), fermables, sans doublon (le même message ne s'empile pas : sa durée repart), trois au plus.
  // Une erreur reste 8 s (le temps de la lire), le reste 4,2 s.
  function toast(msg, kind = 'ok') {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.append(box); }
    const key = `${kind}|${msg}`;
    const arm = (t) => { clearTimeout(t._timer); t._timer = setTimeout(() => close(t), kind === 'error' ? 8000 : 4200); };
    const close = (t) => { clearTimeout(t._timer); t.classList.add('out'); setTimeout(() => t.remove(), 300); };
    const same = [...box.children].find((t) => t.dataset.key === key);
    if (same) { arm(same); return; }
    while (box.children.length >= 3) box.firstElementChild.remove();
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.dataset.key = key;
    t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const text = document.createElement('span');
    text.className = 'toast-t';
    text.textContent = msg;
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'toast-x'; x.setAttribute('aria-label', 'Fermer la notification'); x.textContent = '×';
    x.addEventListener('click', () => close(t));
    t.append(text, x);
    box.append(t);
    arm(t);
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
      if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy'); // l'indicateur est affiché par le CSS (.btn[aria-busy])
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
  window.AiTools.unlinked = unlinked;
  let activityTimerId, activityRequest = null, activityBusy = false;
  function refreshActivity() {
    clearTimeout(activityTimerId);
    if (!jobsBox || disposed || document.hidden) return Promise.resolve();
    if (unlinked()) { activityTimerId = later(refreshActivity, 4000); return Promise.resolve(); }
    if (activityRequest) return activityRequest;
    activityRequest = (async () => {
      try {
        const response = await fetch('/api/jobs/activity', { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (response.status === 401) { toLogin(); return; }
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
    // « En-tête » est replié une fois le projet analysé : une analyse qui échoue y affiche son erreur, on l'ouvre (une fois par échec, pour ne pas rouvrir ce qu'on vient de fermer)
    const analyzeJob = jobs.analyze;
    if (analyzeJob && analyzeJob.status === 'error' && st.analyzeErrorOpened !== analyzeJob.id) {
      st.analyzeErrorOpened = analyzeJob.id;
      const head = $('details[data-acc="header"]', el);
      if (head) head.open = true;
    }

    const running = Object.entries(jobs).filter(([, j]) => ACTIVE.includes(j.status));
    $('[data-state]', el).innerHTML = running.length
      ? `<span class="spin-inline"></span>${esc(running.map(([t, j]) => { const v = pctOf(j.progress); return `${LABELS[t] || $(`[data-job="${t}"]`, el)?.dataset.label || 'Tâche'}${v !== null ? ` ${v} %` : ''}`; }).join(', '))}`
      : ''; // au repos : rien, les chiffres sont déjà dans la ligne du projet (projectFacts)

    // Fin d'un post LinkedIn → on recharge la zone pour afficher le brouillon
    const li = jobs.linkedin_post;
    if (li && ACTIVE.includes(li.status)) st.liRunning = true;
    else if (st.liRunning && li) { st.liRunning = false; window.AiTools.loadLinkedin?.(el); }

    // Fin d'une vidéo de promotion → on recharge la liste
    const pv = jobs.promo_video;
    if (pv && ACTIVE.includes(pv.status)) st.promoRunning = true;
    else if (st.promoRunning && pv) { st.promoRunning = false; window.AiTools.loadPromo?.(el); if (pv.status === 'done') toast('Vidéo de promotion prête'); }

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
      btn.disabled = true; // api() marque le bouton occupé (indicateur dans le bouton) puis ne le réactive pas : c'est ici
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
      }
    });
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
  $$('details[data-acc="recap"]').forEach((d) => d.addEventListener('toggle', () => { if (d.open) window.AiTools.loadRecap?.(d.closest('.project')); }));

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

    if (e.target.matches('[data-recap-refresh]')) window.AiTools.loadRecap?.(e.target.closest('.project'), true);

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



