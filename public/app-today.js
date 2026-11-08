// Page « Aujourd'hui » : filtres de la liste « À traiter », ligne « traitée » (avec annulation, mémorisée côté serveur) et bascule graphique / données.
// Chargé après app.js, qui expose ses outils communs dans window.AiTools ; ajax.js relance ce script à chaque navigation. Tout passe par listen().
(() => {
  const { $, $$, api, listen, toast } = window.AiTools;
  const root = $('[data-today]');
  if (!root) return;
  const items = () => $$('[data-today-item]', root);
  const isOpen = (el) => $('[data-today-done]', el).hidden;
  let filter = 'all';

  // Une ligne traitée reste visible (avec « Annuler ») mais ne compte plus ; l'état vide s'affiche quand plus aucune ligne n'est visible
  function refresh() {
    const count = (k) => items().filter((el) => isOpen(el) && (k === 'all' || el.dataset.kind === k)).length;
    for (const el of items()) el.hidden = !(filter === 'all' || el.dataset.kind === filter);
    $$('[data-today-n]', root).forEach((n) => { n.textContent = String(count(n.dataset.todayN)); });
    $('[data-today-count]', root).textContent = String(count('all'));
    $('[data-today-empty]', root).hidden = items().some((el) => !el.hidden);
  }

  async function mark(el, done) {
    const before = !isOpen(el);
    const show = (d) => { $('[data-today-done]', el).hidden = !d; $('[data-today-open]', el).hidden = d; el.classList.toggle('is-done', d); refresh(); };
    show(done); // affichage tout de suite, puis le serveur : s'il refuse, on revient en arrière et on le dit
    try { await api('/api/today/done', { key: el.dataset.key, done }); } catch (err) {
      show(before);
      toast(`Ligne non mise à jour : ${err.message}`, 'error');
    }
  }

  listen(root, 'click', (e) => {
    const tab = e.target.closest('[data-today-filter]');
    if (tab) {
      filter = tab.dataset.todayFilter;
      $$('[data-today-filter]', root).forEach((b) => b.setAttribute('aria-selected', String(b === tab)));
      refresh();
      return;
    }
    const li = e.target.closest('[data-today-item]');
    if (!li) return;
    if (e.target.closest('[data-today-mark]')) mark(li, true);
    else if (e.target.closest('[data-today-undo]')) mark(li, false);
  });

  // Graphique ou tableau des mêmes données
  const weeks = $('[data-today-weeks]');
  if (weeks) {
    listen(weeks, 'click', (e) => {
      const b = e.target.closest('[data-today-data]');
      if (!b) return;
      const table = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(table));
      b.textContent = table ? 'Voir le graphique' : 'Voir les données';
      $('[data-today-table]', weeks).hidden = !table;
      $('[data-today-chart]', weeks).hidden = table;
    });
  }
  refresh();
})();
