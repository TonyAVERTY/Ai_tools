// Site public : deux petits plus, sans lesquels les pages restent complètes.
//  - Tarifs : le sélecteur « Au mois / À l'année » (sans ce script, chaque plan annonce déjà son prix annuel).
//  - Pages légales : le sommaire reste ouvert sur grand écran, et la section lue est repérée.
//  - Documentation : onglets de code et bouton « Copier ».
(() => {
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
