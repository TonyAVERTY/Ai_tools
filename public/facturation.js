// Page Facturation d'un projet : tant que Claude prépare quelque chose (exemples de devis, affinage, documents), on suit l'avancement
// et la page se recharge toute seule à la fin. Relancé à chaque navigation (public/ajax.js) : l'ancien minuteur est arrêté d'abord.
(() => {
  clearInterval(window.__billTimer);
  const root = document.querySelector('[data-bill-project]');
  if (!root || root.dataset.busy !== '1') return;
  const id = root.dataset.billProject;
  let rev = null;
  const stop = () => clearInterval(window.__billTimer);
  window.__billTimer = setInterval(async () => {
    // Plus sur cette page (navigation sans rechargement) : on s'arrête
    if (!document.querySelector(`[data-bill-project="${id}"]`)) return stop();
    try {
      const r = await fetch(`/api/facturation/${id}/state`, { headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const s = await r.json();
      const msg = document.querySelector('[data-bill-msg]');
      if (msg && s.message) msg.textContent = s.message;
      if (rev === null) rev = s.rev;
      if (!s.busy || s.rev !== rev) { stop(); if (window.AiNav) window.AiNav.reload(); else location.reload(); }
    } catch { /* réseau coupé un instant : on réessaie au prochain passage */ }
  }, 3000);
})();
