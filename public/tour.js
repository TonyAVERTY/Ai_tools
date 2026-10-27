// Visite guidée : une surcouche qui assombrit la page et n'éclaire qu'un élément à la fois (un « trou » dans l'ombre), avec une carte d'explication
// à côté. Aucune dépendance. Démarrée par public/app.js (window.AiTour.start) quand la page porte les données de la visite.
// CSP : aucune règle de style en ligne ; la position se règle par l'API CSSOM (element.style.x = …), comme ailleurs dans l'application.
(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const PAD = 8; // marge claire autour de l'élément éclairé

  let live = null;

  function stop() {
    if (!live) return;
    const l = live;
    live = null;
    l.cleanup();
  }

  /**
   * @param {Array<{target?:string, also?:string, open?:string, title:string, text:string}>} all
   * @param {{onClose?: (state: 'done'|'skipped') => void}} [opts]
   */
  function start(all, opts = {}) {
    stop();
    const steps = all.filter((s) => !s.target || shown($(s.target))); // une étape dont l'élément n'est pas à l'écran est sautée
    if (!steps.length) return;
    const opener = document.activeElement;
    const root = document.createElement('div');
    root.className = 'tour';
    root.innerHTML = `<div class="tour-shield"></div><div class="tour-hole snap"></div>
      <section class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-t" aria-describedby="tour-d" tabindex="-1">
        <p class="tour-n"><span data-tour-count></span><b data-tour-pct></b></p>
        <div class="bar" role="progressbar" aria-label="Progression de la visite" aria-valuemin="0" aria-valuemax="100"><span class="w-0" data-tour-bar></span></div>
        <h2 id="tour-t" data-tour-title></h2>
        <p id="tour-d" data-tour-text></p>
        <div class="tour-f"><button type="button" class="link" data-tour-skip>Passer la visite</button><span class="tour-sp"></span>
          <button type="button" class="btn" data-tour-prev>Précédent</button><button type="button" class="btn primary" data-tour-next>Suivant</button></div>
      </section>`;
    document.body.append(root);
    document.body.classList.add('tour-active');
    // Les clics dans la visite ne remontent pas au reste de la page (sinon le « clic en dehors » du menu déplié le refermerait aussitôt)
    for (const t of ['click', 'mousedown', 'pointerdown']) root.addEventListener(t, (e) => e.stopPropagation());
    const hole = $('.tour-hole', root);
    const card = $('.tour-card', root);
    const prev = $('[data-tour-prev]', root);
    const next = $('[data-tour-next]', root);
    let at = 0;
    let opened = null; // <details> déplié pour l'étape en cours

    const rectOf = (s) => {
      const el = s.target && $(s.target);
      if (!el) return null;
      let r = el.getBoundingClientRect();
      const more = s.also && $(s.also);
      if (more && shown(more)) {
        const m = more.getBoundingClientRect();
        r = { left: Math.min(r.left, m.left), top: Math.min(r.top, m.top), right: Math.max(r.right, m.right), bottom: Math.max(r.bottom, m.bottom) };
      }
      return { left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top };
    };

    function place() {
      const s = steps[at];
      const r = rectOf(s);
      const vw = innerWidth;
      const vh = innerHeight;
      if (!r) { // étape centrée : l'ombre couvre tout, la carte est au milieu
        Object.assign(hole.style, { left: `${vw / 2}px`, top: `${vh / 2}px`, width: '0px', height: '0px', borderRadius: '0px' });
        card.classList.toggle('tour-sheet', vw < 640);
        Object.assign(card.style, vw < 640 ? { left: '', top: '' } : { left: `${Math.max(12, (vw - card.offsetWidth) / 2)}px`, top: `${Math.max(12, (vh - card.offsetHeight) / 2)}px` });
        return;
      }
      Object.assign(hole.style, { left: `${r.left - PAD}px`, top: `${r.top - PAD}px`, width: `${r.width + 2 * PAD}px`, height: `${r.height + 2 * PAD}px`, borderRadius: '14px' });
      if (vw < 640) { card.classList.add('tour-sheet'); Object.assign(card.style, { left: '', top: '' }); return; }
      card.classList.remove('tour-sheet');
      const w = card.offsetWidth;
      const h = card.offsetHeight;
      const gap = 18;
      let top = r.top + r.height + PAD + gap;
      if (top + h > vh - 12) top = r.top - PAD - gap - h; // pas la place en dessous : au-dessus
      if (top < 12) top = Math.min(vh - h - 12, Math.max(12, r.top + r.height / 2 - h / 2)); // ni l'un ni l'autre : à côté, centrée
      let left = r.left + r.width / 2 - w / 2;
      if (top > r.top - h - PAD && top < r.top + r.height + PAD) left = r.left + r.width + PAD + gap; // à côté de l'élément
      left = Math.max(12, Math.min(vw - w - 12, left));
      Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
    }

    function show(i, { snap = false } = {}) {
      at = i;
      const s = steps[i];
      if (opened && opened !== (s.open && $(s.open))) { opened.open = false; opened = null; }
      if (s.open) { const d = $(s.open); if (d) { d.open = true; opened = d; } }
      $('[data-tour-count]', root).textContent = `Étape ${i + 1} sur ${steps.length}`;
      const pct = Math.round((100 * i) / (steps.length - 1 || 1));
      $('[data-tour-pct]', root).textContent = `${pct} %`;
      $('[data-tour-bar]', root).className = `w-${Math.floor(pct / 5) * 5}`;
      $('[role=progressbar]', root).setAttribute('aria-valuenow', String(pct));
      $('[data-tour-title]', root).textContent = s.title;
      $('[data-tour-text]', root).textContent = s.text;
      prev.hidden = i === 0;
      $('[data-tour-skip]', root).hidden = i === steps.length - 1;
      next.textContent = i === steps.length - 1 ? 'Terminer' : i === 0 ? 'Commencer' : 'Suivant';
      const el = s.target && $(s.target);
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      hole.classList.toggle('snap', snap || calm());
      card.classList.remove('tour-in'); void card.offsetWidth; card.classList.add('tour-in');
      place();
      // Sur téléphone, la carte est en bas : l'élément éclairé doit rester au-dessus d'elle
      if (el && innerWidth < 640) {
        // Une page courte ne peut pas défiler : on ajoute temporairement de la place sous le contenu, de quoi remonter l'élément au-dessus de la carte
        document.documentElement.style.setProperty('--tour-pad', `${card.offsetHeight + 24}px`);
        const r = el.getBoundingClientRect();
        const room = innerHeight - card.offsetHeight - 24;
        if (r.bottom + PAD > room) { scrollBy(0, r.bottom + PAD - room); place(); }
      }
      next.focus({ preventScroll: true });
    }

    const finish = (state) => { stop(); opts.onClose?.(state); };
    const go = (d) => { const n = at + d; if (n < 0) return; if (n >= steps.length) finish('done'); else show(n); };
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    $('[data-tour-skip]', root).addEventListener('click', () => finish('skipped'));

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish('skipped'); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'Tab') { // le focus reste dans la carte
        const f = [...card.querySelectorAll('button')].filter((b) => !b.hidden);
        if (!f.length) return;
        const first = f[0]; const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!card.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    };
    const onMove = () => place();
    document.addEventListener('keydown', onKey, true);
    addEventListener('resize', onMove);
    addEventListener('scroll', onMove, true);
    live = {
      cleanup() {
        document.removeEventListener('keydown', onKey, true);
        removeEventListener('resize', onMove);
        removeEventListener('scroll', onMove, true);
        if (opened) opened.open = false;
        document.body.classList.remove('tour-active');
        document.documentElement.style.removeProperty('--tour-pad');
        root.classList.add('tour-out');
        setTimeout(() => root.remove(), calm() ? 0 : 220);
        try { opener?.focus?.({ preventScroll: true }); } catch { /* l'élément n'existe plus */ }
      },
    };
    show(0, { snap: true });
    requestAnimationFrame(() => { root.classList.add('tour-on'); if (!calm()) hole.classList.remove('snap'); });
  }

  window.AiTour = { start, stop, active: () => !!live };
})();
