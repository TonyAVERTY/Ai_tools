// Raccourcis clavier : « g » puis une lettre va à une page, « / » ouvre la recherche, « j » ouvre l'Activité, « ? » ouvre la page des raccourcis.
// La liste vient du serveur (attribut data-go du <body>, voir src/shortcuts.js) : une seule source pour les touches et pour la page /raccourcis.
// Chargé après app.js (window.AiTools) ; ajax.js relance ce script à chaque navigation : tout passe par listen() et later().
(() => {
  const { $, go, later, listen } = window.AiTools;
  const map = new Map(String(document.body.dataset.go || '').split(';').filter(Boolean).map((p) => { const i = p.indexOf(':'); return [p.slice(0, i), p.slice(i + 1)]; }));
  let armed = null; // minuteur de la touche « g » : la lettre doit suivre dans la seconde

  // Pas de raccourci quand on écrit, avec une touche de commande, pendant une composition (IME), ni dans une fenêtre ouverte (recherche, fiche, confirmation, visite)
  const typing = (t) => !!t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  const modalOpen = () => !!document.querySelector('dialog[open], .tour-card');

  listen(document, 'keydown', (e) => {
    if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (typing(e.target)) return;
    const key = e.key;
    if (armed) {
      clearTimeout(armed);
      armed = null;
      const href = map.get(key.toLowerCase());
      if (href && !modalOpen()) { e.preventDefault(); if (location.pathname !== href) go(href); }
      return; // une autre touche annule simplement la séquence
    }
    if (modalOpen()) return;
    if (key === 'g' && !e.shiftKey) { armed = later(() => { armed = null; }, 1000); return; }
    if (key === '/') { const b = $('[data-search-open]'); if (b) { e.preventDefault(); b.click(); } return; }
    if (key === 'j' && !e.shiftKey) { const b = $('.jobs-btn'); if (b) { e.preventDefault(); b.click(); } return; }
    if (key === '?') { e.preventDefault(); if (location.pathname !== '/raccourcis') go('/raccourcis'); }
  });
})();
