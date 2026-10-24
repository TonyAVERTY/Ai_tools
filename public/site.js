// Site public : deux petits plus, sans lesquels les pages restent complètes.
//  - Tarifs : le sélecteur « Au mois / À l'année » (sans ce script, chaque plan annonce déjà son prix annuel).
//  - Pages légales : le sommaire reste ouvert sur grand écran, et la section lue est repérée.
//  - Tout le site : les blocs apparaissent en douceur quand on arrive dessus.
(() => {
  // ---------- Apparition au défilement ----------
  // Seuls les blocs encore hors de l'écran sont masqués : ce qui est déjà visible ne clignote jamais, et sans ce script rien n'est caché.
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) {
        const el = e.target;
        el.classList.add('in'); io.unobserve(el);
        // l'apparition terminée, le bloc redevient ordinaire (ses animations au survol reprennent leurs durées normales)
        setTimeout(() => { el.classList.remove('reveal', 'in'); el.style.transitionDelay = ''; }, 1000);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    document.querySelectorAll('.card, .steps li, .tr, .plan, .stp, .cta, .lg-body .art h2, .acc, .claude-n').forEach((el, i) => {
      if (el.getBoundingClientRect().top < innerHeight) return;
      el.classList.add('reveal');
      el.style.transitionDelay = `${(i % 4) * 60}ms`; // CSSOM : la CSP interdit style=""
      io.observe(el);
    });
  }

  // ---------- Documentation : onglets de code et bouton « Copier » ----------
  for (const box of document.querySelectorAll('[data-ctabs]')) {
    const tabs = [...box.querySelectorAll(':scope > .ctab')];
    if (tabs.length < 2) continue;
    box.classList.add('js-tabs');
    const bar = document.createElement('div');
    bar.className = 'tabbar';
    bar.setAttribute('role', 'tablist');
    const show = (i) => tabs.forEach((t, j) => { t.hidden = i !== j; bar.children[j].setAttribute('aria-selected', String(i === j)); });
    tabs.forEach((t, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'tab'); b.textContent = t.dataset.label;
      b.addEventListener('click', () => show(i));
      bar.append(b);
    });
    box.prepend(bar);
    show(0);
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const label = b.querySelector('span');
    try { await navigator.clipboard.writeText(b.closest('.code').querySelector('code').textContent); label.textContent = 'Copié'; }
    catch { label.textContent = 'Sélectionne et copie'; }
    setTimeout(() => { label.textContent = 'Copier'; }, 1800);
  });

  // ---------- Documentation : ruban en parallaxe + bulles ----------
  // Le ruban (SVG) recule de 25 % du défilement : il défile moins vite que le texte. Les bulles, posées le long de son tracé, suivent
  // exactement le même mouvement pour rester dedans. Sans script, ou avec « réduire les animations », le ruban reste fixe dans la page.
  const ribbon = document.querySelector('.fx .page-ribbon');
  const path = ribbon?.querySelector('path');
  if (ribbon && path && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const K = 0.25;
    const layer = document.createElement('div');
    layer.className = 'rb-bubbles';
    ribbon.append(layer);
    // Les bulles montent le long du tracé comme dans un verre de bière : surtout de toutes petites, quelques grosses, les grosses plus vite,
    // en files le long du trait, avec un léger balancement. Le tracé est converti en pixels (le SVG est étiré) pour mesurer les distances.
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const STEPS = 700;
    const units = path.getTotalLength();
    let table = { xs: [], ys: [], len: [], total: 0, w: 0, h: 0 };
    const sample = () => {
      const w = layer.clientWidth, h = layer.clientHeight;
      const xs = [], ys = [], len = [];
      let acc = 0;
      for (let i = 0; i <= STEPS; i++) {
        const pt = path.getPointAtLength((i / STEPS) * units);
        xs.push((pt.x / 100) * w); ys.push((pt.y / 1000) * h);
        if (i) acc += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
        len.push(acc);
      }
      table = { xs, ys, len, total: acc, w, h };
    };
    // Position et direction (unité) à la distance s le long du tracé, par dichotomie dans la table
    const at = (s) => {
      const { len, xs, ys } = table;
      let lo = 0, hi = len.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (len[m] < s) lo = m; else hi = m; }
      const k = len[hi] > len[lo] ? (s - len[lo]) / (len[hi] - len[lo]) : 0;
      const dx = xs[hi] - xs[lo], dy = ys[hi] - ys[lo], d = Math.hypot(dx, dy) || 1;
      return { x: xs[lo] + dx * k, y: ys[lo] + dy * k, tx: dx / d, ty: dy / d };
    };
    const bubbles = [];
    const LANES = [-8, -4, 0, 4, 8];
    const spawn = (b, anywhere) => {
      const r = rnd();
      b.size = r < 0.5 ? 4.5 + rnd() * 3 : r < 0.85 ? 8 + rnd() * 4 : 12 + rnd() * 5;
      b.speed = 14 + b.size * 5 + rnd() * 10;          // px/s : une grosse bulle monte plus vite
      b.lane = (LANES[Math.floor(rnd() * LANES.length)] / 8) * Math.max(0, 12 - b.size / 2) + (rnd() - 0.5) * 1.5; // reste dans le trait (26 px)
      b.phase = rnd() * 6.283; b.freq = 1.2 + rnd() * 1.6; b.amp = 0.6 + rnd() * 1.2;
      b.alpha = 0.7 + rnd() * 0.3;
      b.s = anywhere ? rnd() * table.total : table.total;
      b.el.style.width = b.el.style.height = `${b.size.toFixed(1)}px`;
    };
    const build = () => {
      const was = table.total;
      sample();
      if (was && table.total) for (const b of bubbles) b.s *= table.total / was; // la page a changé de taille : les bulles gardent leur place relative
      const want = Math.min(320, Math.max(24, Math.round(table.total / 24)));
      while (bubbles.length < want) { const el = document.createElement('span'); el.className = 'rb-b'; layer.append(el); const b = { el, shown: false }; spawn(b, true); bubbles.push(b); }
      while (bubbles.length > want) bubbles.pop().el.remove();
    };
    let last = 0;
    const tick = (now) => {
      requestAnimationFrame(tick);
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
      last = now;
      if (!table.total) return;
      const top = layer.getBoundingClientRect().top;
      const t = now / 1000;
      for (const b of bubbles) {
        b.s -= b.speed * dt;
        if (b.s < 0) spawn(b, false);
        const p = at(b.s);
        const y = top + p.y;
        if (y < -30 || y > innerHeight + 30) { if (b.shown) { b.el.style.opacity = '0'; b.shown = false; } continue; }
        // Balancement perpendiculaire au tracé, autour de la file de la bulle
        const off = b.lane + Math.sin(t * b.freq + b.phase) * b.amp;
        const x = p.x - p.ty * off, yy = p.y + p.tx * off;
        const fade = Math.min(1, b.s / 50, (table.total - b.s) / 50);
        b.el.style.transform = `translate3d(${(x - b.size / 2).toFixed(1)}px, ${(yy - b.size / 2).toFixed(1)}px, 0)`;
        b.el.style.opacity = (b.alpha * Math.max(0, fade)).toFixed(2);
        b.shown = true;
      }
    };
    build();
    requestAnimationFrame(tick);
    // Le ruban est raccourci de la distance dont il prend du retard (25 % du défilement possible) : en bas de page il est donc exactement
    // arrivé au bout de son tracé, et il couvre toujours la fenêtre
    const root = document.documentElement.style;
    let ticking = false;
    const measure = () => {
      const scrollable = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      root.setProperty('--par', `${Math.round(scrollable * K)}px`);
      update();
      build();
    };
    const update = () => {
      ticking = false;
      root.setProperty('--py', `${Math.round(scrollY * K)}px`);
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener('resize', measure);
    addEventListener('load', measure);
    measure();
  }

  // ---------- Tarifs : mois / année ----------
  const plans = document.querySelector('[data-billing]');
  const bill = document.querySelector('[data-bill]');
  if (plans && bill) {
    bill.hidden = false;
    const buttons = [...bill.querySelectorAll('[data-period]')];
    const set = (period) => {
      plans.dataset.billing = period;
      for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.period === period));
    };
    for (const b of buttons) b.addEventListener('click', () => set(b.dataset.period));
    set('month');
  }

  // ---------- Pages légales : sommaire ----------
  const toc = document.querySelector('details.toc');
  if (toc) {
    const wide = matchMedia('(min-width: 900px)');
    const sync = () => { if (wide.matches) toc.open = true; };
    sync();
    wide.addEventListener('change', sync);
    toc.querySelector('summary').addEventListener('click', (e) => { if (wide.matches) e.preventDefault(); });

    const links = [...toc.querySelectorAll('a[href^="#"]')];
    const mark = (id) => { for (const a of links) { if (a.getAttribute('href') === `#${id}`) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); } };
    const heads = links.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
    if ('IntersectionObserver' in window && heads.length) {
      const seen = new Set();
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) { if (e.isIntersecting) seen.add(e.target.id); else seen.delete(e.target.id); }
        const first = heads.find((h) => seen.has(h.id));
        if (first) mark(first.id);
      }, { rootMargin: '0px 0px -70% 0px' });
      heads.forEach((h) => io.observe(h));
    }
    if (location.hash) mark(location.hash.slice(1));
  }
})();
