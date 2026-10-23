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
    // Des points du tracé (coordonnées 0-100 × 0-1000 du SVG) deviennent des positions en pourcentage de la page
    const total = path.getTotalLength();
    const count = Math.min(220, Math.round(document.documentElement.scrollHeight / 130)); // une bulle tous les ~130 px de page
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < count; i++) {
      const pt = path.getPointAtLength(((i + rnd() * 0.8) / count) * total);
      const b = document.createElement('span');
      b.className = 'rb-b';
      const size = 8 + Math.round(rnd() * 14);
      b.style.width = b.style.height = `${size}px`;
      b.style.left = `${pt.x}%`;
      b.style.setProperty('--ox', `${Math.round((rnd() - 0.5) * 14)}px`); // le trait fait 26 px de large : les bulles restent dedans
      b.style.top = `${pt.y / 10}%`;
      b.style.setProperty('--d', `${(5 + rnd() * 6).toFixed(1)}s`);
      b.style.setProperty('--delay', `${(-rnd() * 6).toFixed(1)}s`);
      b.style.setProperty('--dx', `${Math.round((rnd() - 0.5) * 22)}px`);
      b.style.setProperty('--dy', `${Math.round(-6 - rnd() * 14)}px`);
      layer.append(b);
    }
    // Le ruban est raccourci de la distance dont il prend du retard (25 % du défilement possible) : en bas de page il est donc exactement
    // arrivé au bout de son tracé, et il couvre toujours la fenêtre
    const root = document.documentElement.style;
    let ticking = false;
    const measure = () => {
      const scrollable = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      root.setProperty('--par', `${Math.round(scrollable * K)}px`);
      update();
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
