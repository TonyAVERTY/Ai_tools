// Recherche globale (⌘K ou Ctrl+K) : projets, prospects et clients, mails reçus. Interroge /api/search après une courte pause de frappe.
// Chargé après app.js, qui expose ses outils communs dans window.AiTools ; ajax.js relance ce script à chaque navigation. Tout passe par listen().
(() => {
  const { $, $$, esc, go, listen } = window.AiTools;
  const dlg = $('#search');
  const openers = $$('[data-search-open]');
  if (!dlg || !dlg.showModal) return;
  const input = $('[data-search-q]', dlg);
  const out = $('[data-search-out]', dlg);
  let timer = 0;
  let seq = 0;
  let active = -1;

  const rows = () => $$('a.s-row', out);
  const mark = (i) => {
    const r = rows();
    if (!r.length) { active = -1; return; }
    active = (i + r.length) % r.length;
    r.forEach((a, k) => { a.classList.toggle('is-on', k === active); if (k === active) a.scrollIntoView({ block: 'nearest' }); });
    input.setAttribute('aria-activedescendant', r[active].id);
  };
  const say = (text) => { out.innerHTML = `<p class="s-none">${esc(text)}</p>`; active = -1; input.removeAttribute('aria-activedescendant'); };

  function paint(groups) {
    if (!groups.length) return say('Rien de trouvé');
    let n = 0;
    out.innerHTML = groups.map((g) => `<section class="s-grp" aria-label="${esc(g.label)}"><h3>${esc(g.label)}</h3>${g.items.map((it) => `<a class="s-row" id="s-${n++}" href="${esc(it.href)}"><b>${esc(it.title)}</b><span>${esc(it.sub)}</span></a>`).join('')}</section>`).join('');
    mark(0);
  }

  async function run() {
    const q = input.value.trim();
    const mine = ++seq;
    if (q.length < 2) return say('Tape au moins 2 lettres');
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      if (mine === seq) paint(d.groups || []);
    } catch {
      if (mine === seq) say('Recherche indisponible : réessaie dans un instant');
    }
  }

  function open() {
    if (!dlg.open) dlg.showModal();
    input.focus();
    input.select();
    if (!rows().length) say('Tape au moins 2 lettres');
  }

  openers.forEach((b) => listen(b, 'click', open));
  listen(document, 'keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); if (dlg.open) dlg.close(); else open(); }
  });
  listen(input, 'input', () => { clearTimeout(timer); timer = setTimeout(run, 180); });
  listen(input, 'keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); mark(active + 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); mark(active - 1); } else if (e.key === 'Enter') {
      const a = rows()[active];
      if (a) { e.preventDefault(); a.click(); }
    }
  });
  listen(dlg, 'click', (e) => {
    if (e.target === dlg) { dlg.close(); return; } // clic sur le fond
    const a = e.target.closest('a.s-row');
    if (a) { e.preventDefault(); dlg.close(); go(a.getAttribute('href')); }
  });
})();
