// Page Facturation d'un projet : tant que Claude prépare quelque chose (exemples de devis, affinage, documents), on suit l'avancement
// et la page se recharge toute seule à la fin. Relancé à chaque navigation (public/ajax.js) : l'ancien minuteur est arrêté d'abord.
(() => {
  clearInterval(window.__billTimer);
  const root = document.querySelector('[data-bill-project]');

  // « Générer un document » : le client choisi remplit ses champs, et seuls les champs utiles au type de document restent visibles
  const form = root?.querySelector('[data-issue]');
  if (form) {
    const kindSel = form.querySelector('[data-issue-kind]');
    const clientSel = form.querySelector('[data-issue-client]');
    const sync = () => {
      const kind = kindSel.selectedOptions[0]?.dataset.kind || '';
      form.querySelectorAll('[data-for]').forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(kind); });
      form.querySelectorAll('[data-for="avoir"] input[name="facture_numero"]').forEach((i) => { i.required = kind === 'avoir'; });
    };
    kindSel.addEventListener('change', sync);
    clientSel.addEventListener('change', () => {
      const o = clientSel.selectedOptions[0];
      form.querySelector('[name="client_nom"]').value = o?.dataset.name || '';
      form.querySelector('[name="client_adresse"]').value = o?.dataset.address || '';
      form.querySelector('[name="client_siret"]').value = o?.dataset.siret || '';
    });
    sync();
  }
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
      if (typeof s.pct === 'number') {
        const pct = Math.max(0, Math.min(100, Math.round(s.pct)));
        const t = document.querySelector('[data-bill-pct]'); if (t) t.textContent = `${pct} %`;
        const bar = document.querySelector('[data-bill-bar]'); if (bar) bar.setAttribute('aria-valuenow', String(pct));
        const fill = document.querySelector('[data-bill-fill]'); if (fill) { fill.className = ''; fill.style.width = `${pct}%`; }
      }
      if (rev === null) rev = s.rev;
      if (!s.busy || s.rev !== rev) { stop(); if (window.AiNav) window.AiNav.reload(); else location.reload(); }
    } catch { /* réseau coupé un instant : on réessaie au prochain passage */ }
  }, 2000);
})();
