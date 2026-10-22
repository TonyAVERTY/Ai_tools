// Mouvement du site public : apparition au défilement, compteurs, mot qui change, galerie d'écrans.
// Tout est un plus : sans ce script (ou avec « réduire les animations »), la page est complète et lisible.
(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  // ---------- Apparition au défilement ----------
  // Seuls les blocs encore hors de l'écran sont masqués : ce qui est déjà visible ne clignote jamais.
  const reveal = $$('[data-reveal]');
  if (reveal.length && 'IntersectionObserver' in window && !still) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.remove('pending');
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    for (const el of reveal) {
      if (el.getBoundingClientRect().top < innerHeight) continue;
      el.classList.add('pending');
      io.observe(el);
    }
  }

  // ---------- Compteurs ----------
  const counters = $$('[data-count]');
  const paint = (el, v) => { el.textContent = Math.round(v).toLocaleString('fr-FR'); };
  if (counters.length && 'IntersectionObserver' in window && !still) {
    const co = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        co.unobserve(e.target);
        const end = Number(e.target.dataset.count);
        const t0 = performance.now();
        const step = (t) => {
          const k = Math.min(1, (t - t0) / 1100);
          paint(e.target, end * (1 - (1 - k) ** 3));
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }
    }, { threshold: 0.6 });
    counters.forEach((el) => co.observe(el));
  }

  // ---------- Mot qui change dans le titre ----------
  const word = document.querySelector('[data-rotate]');
  if (word && !still) {
    const list = word.dataset.rotate.split('|');
    let i = 0;
    setInterval(() => {
      word.classList.add('swap');
      setTimeout(() => { i = (i + 1) % list.length; word.textContent = list[i]; word.classList.remove('swap'); }, 280);
    }, 2600);
  }

  // ---------- Galerie d'écrans : défile toute seule, s'arrête dès qu'on y touche ----------
  for (const g of $$('[data-gallery]')) {
    const track = g.querySelector('[data-track]');
    const slides = $$('[data-slide]', g);
    const dots = $$('[data-dot]', g);
    if (!track || slides.length < 2) continue;
    let index = 0;
    let paused = still;
    const go = (n) => {
      index = (n + slides.length) % slides.length;
      track.scrollTo({ left: slides[index].offsetLeft - track.offsetLeft, behavior: still ? 'auto' : 'smooth' });
    };
    const mark = () => {
      const mid = track.scrollLeft + track.clientWidth / 2;
      const cur = slides.findIndex((s) => s.offsetLeft - track.offsetLeft + s.offsetWidth > mid);
      index = cur < 0 ? slides.length - 1 : cur;
      dots.forEach((d, k) => d.setAttribute('aria-current', k === index ? 'true' : 'false'));
    };
    track.addEventListener('scroll', mark, { passive: true });
    g.querySelector('[data-prev]')?.addEventListener('click', () => { paused = true; go(index - 1); });
    g.querySelector('[data-next]')?.addEventListener('click', () => { paused = true; go(index + 1); });
    dots.forEach((d, k) => d.addEventListener('click', () => { paused = true; go(k); }));
    for (const ev of ['pointerdown', 'focusin', 'wheel', 'touchstart']) g.addEventListener(ev, () => { paused = true; }, { passive: true });
    let visible = true;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(g);
    setInterval(() => { if (!paused && visible && !document.hidden) go(index + 1); }, 3800);
    mark();
  }
})();
