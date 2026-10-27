// Page Comptabilité : fenêtre d'ajout et de modification d'une ligne (le justificatif part avec la ligne), calcul de la TVA, boutons « Copier ».
// Relancé à chaque navigation (public/ajax.js) : tout est branché sur les éléments de la page, remplacés à chaque fois.
(() => {
  const root = document.querySelector('[data-compta]');
  if (!root) return;
  const $ = (s, el = root) => el.querySelector(s);
  const dlg = $('[data-compta-dlg]');
  const form = $('[data-compta-form]');
  const data = JSON.parse($('[data-compta-data]', dlg).textContent);
  const errBox = $('[data-compta-error]');
  const saveBtn = $('[data-compta-save]');
  const fileInput = $('[data-compta-file]');
  const fileInfo = $('[data-compta-fileinfo]');
  const catSel = $('[data-compta-cats]');
  const vatBox = $('[data-compta-vat]');
  const split = $('[data-compta-split]');
  const toast = (m, k = 'ok') => window.AiTools?.toast?.(m, k);
  const defaultInfo = fileInfo.textContent;
  let editing = null; // données de la ligne en cours de modification

  const kindNow = () => form.elements.kind.value;
  const eur = (n) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  const parse = (v) => {
    const s = String(v || '').replace(/[\s  €]/g, '').replace(',', '.');
    return /^\d{1,9}(\.\d{1,2})?$/.test(s) && Number(s) > 0 ? Number(s) : null;
  };

  function fillCategories(selected) {
    const group = data.kinds[kindNow()].group;
    catSel.replaceChildren(...data.cats[group].map(([k, l]) => { const o = document.createElement('option'); o.value = k; o.textContent = l; return o; }));
    if (selected && data.cats[group].some(([k]) => k === selected)) catSel.value = selected;
  }
  function refresh() {
    const meta = data.kinds[kindNow()];
    const showVat = meta.vat && !data.franchise;
    vatBox.hidden = !showVat;
    const amount = parse(form.elements.amount.value);
    const rate = Number(form.elements.vatRate.value) / 10000;
    split.textContent = showVat && rate > 0 && amount ? `Soit ${eur(amount / (1 + rate))} hors taxes, dont ${eur(amount - amount / (1 + rate))} de TVA.` : '';
  }
  const showError = (m) => { errBox.textContent = m || ''; errBox.hidden = !m; };

  function open(entry) {
    editing = entry || null;
    form.reset();
    showError('');
    $('[data-compta-title]').textContent = entry ? 'Modifier la ligne' : 'Ajouter une ligne';
    saveBtn.textContent = entry ? 'Enregistrer les modifications' : 'Enregistrer la ligne';
    fileInput.required = !entry;
    fileInfo.textContent = entry ? `Justificatif actuel : ${entry.docName}. Choisis un autre fichier seulement pour le remplacer.` : defaultInfo;
    if (entry) {
      form.elements.kind.value = entry.kind;
      form.elements.date.value = entry.date;
      form.elements.amount.value = entry.amount;
      form.elements.vatRate.value = String(entry.vatRate);
      form.elements.label.value = entry.label;
      form.elements.party.value = entry.party;
      form.elements.projectId.value = entry.projectId;
      form.elements.method.value = entry.method;
      form.elements.notes.value = entry.notes;
    } else form.elements.date.value = root.dataset.today;
    fillCategories(entry?.category);
    refresh();
    dlg.showModal();
    form.elements.label.focus();
  }

  root.addEventListener('click', (e) => {
    const add = e.target.closest('[data-compta-add]');
    if (add) { open(null); return; }
    const edit = e.target.closest('[data-compta-edit]');
    if (edit) { open(JSON.parse(edit.dataset.comptaEdit)); return; }
    const copy = e.target.closest('[data-compta-copy]');
    if (copy) {
      const v = copy.dataset.comptaCopy;
      (navigator.clipboard?.writeText(v) || Promise.reject()).then(() => toast(`Copié : ${v}`), () => toast('Copie impossible : sélectionne le montant à la main.', 'error'));
    }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-compta-close]')) dlg.close(); });
  form.addEventListener('change', (e) => { if (e.target.name === 'kind') { fillCategories(); } refresh(); });
  form.addEventListener('input', (e) => { if (e.target.name === 'amount') refresh(); });

  const fields = () => ({
    kind: kindNow(), date: form.elements.date.value, label: form.elements.label.value, party: form.elements.party.value, category: catSel.value,
    amount: form.elements.amount.value, vatRate: Number(form.elements.vatRate.value) || 0, method: form.elements.method.value, notes: form.elements.notes.value, projectId: form.elements.projectId.value,
  });
  async function send(url, init) {
    const r = await fetch(url, { ...init, headers: { Accept: 'application/json', ...init.headers } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Erreur ${r.status}`);
    return d;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const f = fields();
    const file = fileInput.files[0];
    if (!f.label.trim()) return showError("Écris un libellé : de quoi s'agit-il ?");
    if (!parse(f.amount)) return showError('Le montant est invalide (exemple : 49,90).');
    if (!editing && !file) return showError('Joins le justificatif (PDF ou image) : il est obligatoire pour chaque ligne.');
    saveBtn.disabled = true;
    try {
      const fileHeaders = (x) => ({ 'Content-Type': x.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(x.name) });
      if (editing) {
        await send(`/api/compta/entries/${editing.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
        if (file) await send(`/api/compta/entries/${editing.id}/file`, { method: 'POST', body: file, headers: fileHeaders(file) });
      } else {
        await send('/api/compta/entries', { method: 'POST', body: file, headers: { ...fileHeaders(file), 'X-Entry': encodeURIComponent(JSON.stringify(f)) } });
      }
      dlg.close();
      toast(editing ? 'Ligne modifiée' : 'Ligne ajoutée');
      if (window.AiNav) window.AiNav.reload(); else location.reload();
    } catch (err) {
      showError(err.message);
    } finally {
      saveBtn.disabled = false;
    }
  });
})();
