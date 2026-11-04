// Page Clients : la liste d'un projet (clients et prospects) se charge quand on déroule le projet ; la recherche la relance à la frappe ;
// « Afficher plus » en charge davantage. Relancé à chaque navigation (public/ajax.js) : le DOM est neuf, on rattache les écouteurs.
(() => {
  const root = document.querySelector('[data-clients]');
  if (!root) return;
  const KEY = 'clientsOpen';
  const remembered = () => { try { return new Set(JSON.parse(sessionStorage.getItem(KEY) || '[]')); } catch { return new Set(); } };
  const remember = (id, on) => { try { const s = remembered(); if (on) s.add(id); else s.delete(id); sessionStorage.setItem(KEY, JSON.stringify([...s])); } catch { /* stockage indisponible : sans conséquence */ } };

  const load = async (det, { limit = 30 } = {}) => {
    const id = det.dataset.clProject;
    const box = det.querySelector('[data-cl-lists]');
    const q = det.querySelector('[data-cl-search]').value.trim();
    const token = String((Number(det.dataset.clReq) || 0) + 1);
    det.dataset.clReq = token; // une réponse plus ancienne que la dernière demande est ignorée
    det.dataset.clLimit = String(limit);
    const T = window.AiTools;
    const retry = () => load(det, { limit });
    try {
      const r = await fetch(`/clients/projet/${id}/liste?q=${encodeURIComponent(q)}&limit=${limit}`, { headers: { Accept: 'text/html' } });
      if (det.dataset.clReq !== token) return;
      if (r.status === 401) return T.toLogin();
      if (r.ok) box.innerHTML = await r.text(); else T.loadFailed(box, T.httpErrorText(r.status), retry);
    } catch {
      if (det.dataset.clReq === token) T.loadFailed(box, T.networkErrorText(), retry);
    }
  };

  const open = remembered();
  root.querySelectorAll('details[data-cl-project]').forEach((det) => {
    const id = det.dataset.clProject;
    let timer = null;
    det.addEventListener('toggle', () => { remember(id, det.open); if (det.open && !det.dataset.clLoaded) { det.dataset.clLoaded = '1'; load(det); } });
    det.querySelector('[data-cl-search]').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load(det), 250); });
    det.querySelector('[data-cl-search-form]').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(timer); load(det); });
    det.querySelector('[data-cl-lists]').addEventListener('click', (e) => {
      const more = e.target.closest('[data-cl-more]');
      if (more) load(det, { limit: Number(more.dataset.clMore) });
    });
    if (det.hasAttribute('open')) { det.dataset.clLoaded = '1'; load(det); }
    else if (open.has(id) && !new URLSearchParams(location.search).has('projet')) det.open = true;
  });
})();
