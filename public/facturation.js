// Page Facturation d'un projet : tant que Claude prépare quelque chose (exemples de devis, affinage, documents), on suit l'avancement
// et la page se recharge toute seule à la fin. Relancé à chaque navigation (public/ajax.js) : l'ancien minuteur est arrêté d'abord.
(() => {
  clearInterval(window.__billTimer);
  const root = document.querySelector('[data-bill-project]');

  // « Générer un document » : seuls les champs utiles au type de document restent visibles ; le client choisi remplit ses champs ; les lignes du devis s'ajoutent ;
  // l'avoir ne propose que les factures du devis choisi
  const form = root?.querySelector('[data-issue]');
  if (form) {
    const $ = (sel) => form.querySelector(sel);
    const kindSel = $('[data-issue-kind]');
    const clientSel = $('[data-issue-client]');
    const devisSel = $('[data-issue-devis]');
    const refSel = $('[data-issue-ref]');
    const linesBox = $('[data-lines]');
    const totalEl = $('[data-lines-total]');
    const num = (v) => { const n = Number(String(v || '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
    const kind = () => kindSel.selectedOptions[0]?.dataset.kind || '';
    const euro = (n) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
    const total = () => {
      if (!totalEl) return;
      const ht = [...linesBox.querySelectorAll('[data-line]')].reduce((a, row) => a + num(row.querySelector('[name$="_qty"]').value) * num(row.querySelector('[name$="_price"]').value), 0);
      totalEl.textContent = ht > 0 ? `Total HT : ${euro(ht)}` : '';
    };
    const sync = () => {
      const k = kind();
      form.querySelectorAll('[data-for]').forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(k); });
      const need = (sel, on) => form.querySelectorAll(sel).forEach((i) => { i.required = on; });
      need('[name="client_nom"], [name="client_adresse"], [name="l0_label"]', k === 'devis');
      need('[name="devis_id"]', k === 'acompte' || k === 'facture' || k === 'avoir');
      need('[name="ref_id"]', k === 'avoir');
    };
    const filterRefs = () => {
      if (!refSel) return;
      const d = devisSel.value;
      [...refSel.options].forEach((o) => { if (o.value) { o.hidden = o.dataset.devis !== d; o.disabled = o.dataset.devis !== d; } });
      if (refSel.selectedOptions[0]?.disabled) refSel.value = '';
    };
    kindSel.addEventListener('change', sync);
    devisSel?.addEventListener('change', filterRefs);
    clientSel.addEventListener('change', () => {
      const o = clientSel.selectedOptions[0];
      form.querySelector('[name="client_nom"]').value = o?.dataset.name || '';
      form.querySelector('[name="client_adresse"]').value = o?.dataset.address || '';
      form.querySelector('[name="client_siret"]').value = o?.dataset.siret || '';
    });
    linesBox?.addEventListener('input', total);
    $('[data-add-line]')?.addEventListener('click', () => {
      const rows = linesBox.querySelectorAll('[data-line]');
      if (rows.length >= 30) return;
      const i = rows.length;
      const row = rows[rows.length - 1].cloneNode(true);
      row.querySelectorAll('input').forEach((input) => {
        input.name = input.name.replace(/^l\d+_/, `l${i}_`);
        input.id = input.id.replace(/^gen-l\d+-/, `gen-l${i}-`);
        input.value = input.name.endsWith('_qty') ? '1' : input.name.endsWith('_unit') ? 'forfait' : '';
        input.required = false;
      });
      row.querySelectorAll('label').forEach((l) => { l.htmlFor = l.htmlFor.replace(/^gen-l\d+-/, `gen-l${i}-`); });
      linesBox.append(row);
      row.querySelector('input').focus();
    });
    sync(); filterRefs(); total();
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
