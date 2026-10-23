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
