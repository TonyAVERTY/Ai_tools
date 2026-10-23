// Tableaux sur téléphone : chaque cellule reprend le titre de sa colonne (data-label), pour l'affichage « une carte par ligne »
// défini dans responsive.css. Sans JavaScript, le tableau défile simplement dans son cadre.
(() => {
  const mark = (table) => {
    if (table.dataset.rt) return;
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (!heads.length) { table.classList.add('rt-flow'); table.dataset.rt = '1'; return; }
    for (const tr of table.querySelectorAll('tbody tr')) {
      [...tr.children].forEach((td, i) => {
        if (td.tagName !== 'TD') return;
        td.dataset.label = heads[i] ?? '';
        // Le contenu de la cellule dans un seul bloc : en carte, la cellule est une ligne « titre / valeur » et ses morceaux ne doivent pas s'éparpiller
        const cv = document.createElement('div');
        cv.className = 'cv';
        cv.append(...td.childNodes);
        td.append(cv);
      });
    }
    table.classList.add('rt-stack');
    table.dataset.rt = '1';
  };
  const scan = (root = document) => root.querySelectorAll('.table-wrap table, .art .tw table').forEach(mark);
  scan();
  // Tableaux fabriqués après coup par app.js (liste des prospects, récap…)
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; scan(); });
  }).observe(document.body, { childList: true, subtree: true });
})();
