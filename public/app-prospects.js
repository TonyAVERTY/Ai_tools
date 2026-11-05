// Prospects d'un projet : liste et vue tableau (glisser-déposer entre statuts), fiche d'un prospect (notes, modification, prochaine action,
// suppression) et aperçu du mail. Chargé après app.js, qui expose ses outils communs dans window.AiTools ;
// ajax.js relance ce script à chaque navigation, comme app.js. Aucune fonction n'est appelée de l'extérieur : tout passe par des écouteurs.
(() => {
  const { $, $$, aiName, api, confirmBox, esc, formData, icon, listen, loadingHtml, toast } = window.AiTools;

  // ---------- Liste des prospects (mini CRM) ----------
  const STATUS = { new: 'À contacter', sent: 'Contacté', replied: 'A répondu', client: 'Client', refused: 'Refus', bounced: 'Rejeté', invalid: 'Adresse invalide' };
  // Seuls les liens http(s) sont cliquables : un "javascript:" venu d'une page web scrapée ne doit jamais s'exécuter ici
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
  const fmtDate = (ts) => new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });
  const isoDay = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }) : '');

  // ---------- Fiche prospect ----------
  const dlg = $('#prospect-dialog');

  async function openProspect(id) {
    let d;
    try { d = await api(`/api/prospects/${id}`); } catch (err) { toast(err.message, 'error'); return; }
    const p = d.prospect;
    const site = safeUrl(p.website);
    const source = safeUrl(p.source);
    const events = [
      ...d.mails.map((m) => ({
        at: m.sent_at,
        html: `<strong>${m.kind === 'followup' ? 'Relance' : 'Premier mail'}</strong>${m.variant ? ` <span class="muted">(objet ${esc(m.variant)})</span>` : ''} : ${esc(m.subject || '')}
          ${m.error ? `<span class="error"> · échec : ${esc(m.error)}</span>` : ''}`,
      })),
      ...(p.replied_at ? [{ at: p.replied_at, html: `<strong class="ok">Réponse reçue</strong> : ${esc(p.reply_subject || 'sans objet')}` }] : []),
    ].sort((a, b) => a.at - b.at);

    $('[data-dialog-body]', dlg).innerHTML = `
      <div class="row dlg-head">
        <div>
          <h3>${site ? `<a href="${esc(site)}" target="_blank" rel="noopener noreferrer">${esc(p.company)}</a>` : esc(p.company)}</h3>
          <div class="small muted"><a href="mailto:${esc(p.email)}">${esc(p.email)}</a>${p.city ? ` · ${esc(p.city)}` : ''}${p.sector ? ` · ${esc(p.sector)}` : ''}${p.score ? ` · score ${p.score}/10` : ''} · ${esc(STATUS[p.status] || p.status)}</div>
        </div>
        <button type="button" class="btn small" data-close>Fermer</button>
      </div>
      ${d.optOut ? `<p class="error small">Sur la liste d'opposition (${d.optOut.reason === 'bounce' ? 'adresse invalide' : d.optOut.reason === 'refused' ? 'refus' : 'désinscription'}) : ne plus contacter.</p>` : ''}
      ${(() => {
        const busy = d.hookJob && ['queued', 'running'].includes(d.hookJob.status);
        return `<div class="hook-row">${p.hook ? `<p class="hook">« ${esc(p.hook)} »</p>` : '<p class="muted small">Pas d\'accroche pour ce prospect.</p>'}
          <button type="button" class="btn small" data-regen-hook${busy ? ' disabled' : ''}>${busy ? 'Régénération en cours…' : p.hook ? "Régénérer l'accroche" : 'Générer une accroche'}</button>
          ${d.hookJob?.status === 'error' ? `<p class="error small">Échec : ${esc(d.hookJob.error)}</p>` : ''}</div>`;
      })()}
      ${source ? `<p class="small muted">Email trouvé sur : <a href="${esc(source)}" target="_blank" rel="noopener noreferrer">${esc(source)}</a></p>` : ''}

      <h4>Informations</h4>
      <form data-dlg="edit" class="pform">
        <div class="grid2">
          <label class="field"><span class="lbl">Entreprise</span><input name="company" required maxlength="200" value="${esc(p.company)}"></label>
          <label class="field"><span class="lbl">Email</span><input name="email" type="email" required maxlength="200" value="${esc(p.email)}"${p.status === 'new' ? '' : ' readonly aria-describedby="email-lock"'}></label>
          <label class="field"><span class="lbl">Site</span><input name="website" maxlength="300" value="${esc(p.website || '')}" placeholder="https://entreprise.fr"></label>
          <label class="field"><span class="lbl">Ville</span><input name="city" maxlength="100" value="${esc(p.city || '')}"></label>
          <label class="field"><span class="lbl">Secteur</span><input name="sector" maxlength="100" value="${esc(p.sector || '')}"></label>
          <label class="field"><span class="lbl">Score (1 à 10)</span><input name="score" type="number" min="1" max="10" inputmode="numeric" value="${p.score ?? ''}"></label>
        </div>
        <label class="field"><span class="lbl">Accroche</span><input name="hook" maxlength="400" value="${esc(p.hook || '')}"></label>
        <label class="field"><span class="lbl">Origine de l'adresse</span><input name="source" maxlength="300" value="${esc(p.source || '')}"></label>
        ${p.status === 'new' ? '' : '<p class="muted small" id="email-lock">L\'adresse ne peut plus être modifiée : des mails y sont rattachés. Pour une autre adresse, ajoute un nouveau prospect.</p>'}
        <div class="row"><button class="btn">Enregistrer les informations</button></div>
      </form>

      <h4>Historique</h4>
      ${events.length ? `<ol class="timeline">${events.map((e) => `<li><time>${fmtDate(e.at)}</time><div>${e.html}</div></li>`).join('')}</ol>` : '<p class="muted small">Pas encore contacté.</p>'}

      <h4>Prochaine action</h4>
      <form data-dlg="next" class="inline">
        <label>Quoi<input name="action" value="${esc(p.next_action || '')}" placeholder="ex. Rappeler après les vacances" maxlength="200"></label>
        <label>Quand<input type="date" name="day" value="${isoDay(p.next_action_at)}"></label>
        <button class="btn">Enregistrer</button>
        ${p.next_action ? '<button type="button" class="btn small" data-clear-next>Effacer</button>' : ''}
      </form>

      <h4>Notes</h4>
      <form data-dlg="note">
        <textarea name="body" rows="3" maxlength="2000" placeholder="Ce qu'il a dit, le contexte, ce qu'il faut retenir…"></textarea>
        <button class="btn">Ajouter la note</button>
      </form>
      <div class="danger-zone"><button type="button" class="btn small danger" data-del-prospect>${icon('trash')}Supprimer ce prospect</button>
        <span class="muted small">Ses notes sont supprimées. Les mails déjà envoyés restent dans la page Mails.</span></div>
      <ul class="notes">${d.notes.map((n) => `<li><div class="small muted">${fmtDate(n.created_at)} · <button type="button" class="link small" data-del-note="${n.id}">supprimer</button></div><div class="note-body">${esc(n.body)}</div></li>`).join('')}</ul>`;
    dlg.dataset.id = id;
    if (!dlg.open) dlg.showModal();
  }

  function refreshOpenLists() { $$('details.prospects[open]').forEach((d) => loadProspects(d, Number(d.dataset.page) || 1)); }

  if (dlg) {
    dlg.addEventListener('click', async (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
      const id = dlg.dataset.id;
      const del = e.target.closest('[data-del-note]');
      if (del && (await confirmBox('Supprimer cette note ?'))) {
        await api(`/api/prospects/${id}/notes/${del.dataset.delNote}/delete`, {}).catch((err) => toast(err.message, 'error'));
        openProspect(id);
      }
      const regen = e.target.closest('[data-regen-hook]');
      if (regen) {
        regen.disabled = true;
        try {
          await api(`/api/prospects/${id}/hook`, {});
          toast(`Accroche en cours de rédaction : ${aiName()} lit le site du prospect`);
          // La fiche se met à jour toute seule quand le job se termine
          for (let i = 0; i < 60 && dlg.open && dlg.dataset.id === id; i++) {
            await new Promise((r) => setTimeout(r, 3000));
            const d = await api(`/api/prospects/${id}`);
            if (!d.hookJob || !['queued', 'running'].includes(d.hookJob.status)) { if (dlg.open && dlg.dataset.id === id) openProspect(id); refreshOpenLists(); break; }
          }
        } catch (err) { toast(err.message, 'error'); regen.disabled = false; }
      }
      if (e.target.closest('[data-del-prospect]')) {
        const name = $('.dlg-head h3', dlg)?.textContent || 'ce prospect';
        if (!(await confirmBox(`Supprimer définitivement « ${name} » ?\nSes notes seront supprimées. Les mails déjà envoyés restent dans la page Mails.`))) return;
        try { await api(`/api/prospects/${id}/delete`, {}); dlg.close(); toast('Prospect supprimé'); refreshOpenLists(); }
        catch (err) { toast(err.message, 'error'); }
        return;
      }
      if (e.target.closest('[data-clear-next]')) {
        await api(`/api/prospects/${id}/next`, { action: '' }).catch((err) => toast(err.message, 'error'));
        openProspect(id); refreshOpenLists();
      }
    });
    dlg.addEventListener('submit', async (e) => {
      const form = e.target.closest('form[data-dlg]');
      if (!form) return;
      e.preventDefault();
      const id = dlg.dataset.id;
      try {
        if (form.dataset.dlg === 'note') { await api(`/api/prospects/${id}/notes`, formData(form)); toast('Note ajoutée'); }
        else if (form.dataset.dlg === 'edit') { await api(`/api/prospects/${id}/update`, formData(form)); toast('Informations enregistrées'); refreshOpenLists(); }
        else { await api(`/api/prospects/${id}/next`, formData(form)); toast('Prochaine action enregistrée'); refreshOpenLists(); }
        openProspect(id);
      } catch (err) { toast(err.message, 'error'); }
    });
  }
  // ---------- Aperçu du mail ----------
  // Le serveur construit le mail avec le même code que l'envoi réel (rien n'est envoyé) ; le HTML s'affiche dans un cadre isolé (sans script ni réseau).
  let pvDlg = null;
  const pv = { form: null, prospectId: '', variant: 'A', tab: 'html', prospects: null, seq: 0, fixBody: null, vars: {}, pick: null, mode: 'idle', rseq: 0, avoid: [], hold: false, proposal: null };

  async function renderPreview() {
    hideSel();
    const form = pv.form;
    const id = form.closest('.project').dataset.id;
    let r;
    try {
      r = await api(`/api/projects/${id}/template/preview`, {
        kind: form.dataset.kind, subject: form.subject.value, subjectB: form.subjectB?.value || '', body: form.body.value, html: form.html.checked ? 'on' : '', variant: pv.variant, prospectId: pv.prospectId,
      });
    } catch (err) { toast(err.message, 'error'); return; }
    if (!pv.prospects) {
      try { pv.prospects = (await api(`/api/projects/${id}/prospects`)).rows || []; } catch { pv.prospects = []; }
    }
    if (!r.hasB) pv.variant = 'A';
    pv.vars = r.vars || {};
    const opts = pv.prospects.map((p) => `<option value="${p.id}"${String(p.id) === String(pv.prospectId) ? ' selected' : ''}>${esc(p.company)} · ${esc(p.email)}</option>`).join('');
    $('[data-dialog-body]', pvDlg).innerHTML = `
      <div class="row dlg-head"><div><h3>${icon('eye')} Aperçu du ${r.kind === 'followup' ? 'mail de relance' : 'premier mail'}</h3>
        <p class="muted small">Voilà ce que le prospect reçoit. Rien n'est envoyé.</p></div><button type="button" class="btn small" data-close>Fermer</button></div>
      <div class="pv-controls">
        <label class="field"><span class="lbl">Voir avec</span><span class="sel"><select data-pv-prospect><option value="">Un exemple fictif</option>${opts}</select>${icon('down')}</span></label>
        ${r.hasB ? `<div class="seg" role="group" aria-label="Objet à afficher">
          <button type="button" class="btn small" data-pv-variant="A" aria-pressed="${r.variant === 'A'}">Objet A</button>
          <button type="button" class="btn small" data-pv-variant="B" aria-pressed="${r.variant === 'B'}">Objet B</button></div>` : ''}
      </div>
      ${r.note ? `<p class="muted small">${esc(r.note)}</p>` : ''}
      <dl class="pv-head"><dt>De</dt><dd>${esc(r.from)}</dd><dt>À</dt><dd>${esc(r.to)}</dd><dt>Objet</dt><dd><strong>${esc(r.subject) || '<span class="error">(vide)</span>'}</strong></dd></dl>
      <div class="pv-sense" data-pv-sense aria-live="polite">${loadingHtml("L'IA relit le sens du mail…", { small: true })}</div>
      ${r.warnings.length ? `<ul class="pv-warn" role="status">${r.warnings.map((w) => `<li>${icon('alert')}<span>${esc(w)}</span></li>`).join('')}</ul>` : ''}
      ${r.html ? `<div class="seg" role="group" aria-label="Version du mail">
        <button type="button" class="btn small" data-pv-tab="html" aria-pressed="${pv.tab === 'html'}">Mail</button>
        <button type="button" class="btn small" data-pv-tab="text" aria-pressed="${pv.tab === 'text'}">Version texte</button></div>` : ''}
      ${r.html && pv.tab === 'html'
    ? `<iframe class="pv-frame" sandbox title="Aperçu du mail" src="${esc(r.url)}"></iframe>`
    : `<pre class="pv-text" data-pv-body>${esc(r.text)}</pre>`}
      <p class="muted small">${r.footer ? `Le lien « Ne plus recevoir de messages » ${r.sample ? 'est un lien d\'exemple' : 'est le vrai lien de ce prospect'} ; il est ajouté automatiquement à chaque mail, avec l'origine de l'adresse.` : 'Le pied de page est retiré dans Réglages → Garde-fous : le mail part tel quel, sans lien de désinscription visible.'}</p>`;
    if (!pvDlg.open) pvDlg.showModal();
    senseCheck(id, form);
  }

  // ---------- Phrase sélectionnée dans l'aperçu : « Changer » (l'IA propose une autre phrase) ou « Modifier » (à la main) ----------
  // La sélection porte sur le texte REMPLI (« Chez Boulangerie Le Fournil, … ») ; la modification se fait dans le MODÈLE (« Chez {{entreprise}}, … »).
  // On retrouve donc la phrase dans le modèle en remettant les variables à la place de leurs valeurs. Aucun mouvement : la barre apparaît et disparaît d'un coup.
  const regexEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function locateInTemplate(body, picked, vars) {
    const t = String(picked).replace(/ /g, ' ').trim();
    if (t.length < 3) return null;
    const values = Object.entries(vars || {}).filter(([, v]) => v && String(v).length >= 2).sort((a, b) => String(b[1]).length - String(a[1]).length);
    let src = '';
    for (let i = 0; i < t.length;) {
      const hit = values.find(([, v]) => t.startsWith(String(v), i));
      if (hit) { src += `(?:\\{\\{\\s*${hit[0]}\\s*\\}\\}|${regexEsc(String(hit[1]))})`; i += String(hit[1]).length; continue; }
      if (/\s/.test(t[i])) { src += '\\s+'; while (i < t.length && /\s/.test(t[i])) i++; continue; }
      src += regexEsc(t[i]); i++;
    }
    const found = [...body.matchAll(new RegExp(src, 'g'))];
    if (found.length !== 1) return null; // absente (en-tête, pied de page, texte coupé en deux) ou en double : la barre n'apparaît pas
    return { start: found[0].index, end: found[0].index + found[0][0].length };
  }

  const selBox = () => $('[data-pv-sel]', pvDlg);
  function hideSel() {
    pv.mode = 'idle'; pv.pick = null; pv.avoid = []; pv.rseq++; pv.hold = false; pv.proposal = null;
    const box = pvDlg && selBox();
    if (box) { box.hidden = true; box.className = 'pv-sel'; box.innerHTML = ''; }
  }
  function placeSel(rect) {
    const box = selBox();
    box.hidden = false;
    const w = box.offsetWidth, h = box.offsetHeight;
    const top = rect.top - h - 6 >= 8 ? rect.top - h - 6 : Math.min(rect.bottom + 6, innerHeight - h - 8);
    box.style.top = `${Math.max(8, top)}px`;
    box.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - w / 2, innerWidth - w - 8))}px`;
  }
  function onSelection() {
    if (!pvDlg || !pvDlg.open || pv.mode !== 'idle' || pv.hold) return;
    const sel = getSelection();
    const pre = $('[data-pv-body]', pvDlg);
    if (!pre || !sel || sel.isCollapsed || !sel.rangeCount || !pre.contains(sel.getRangeAt(0).commonAncestorContainer)) { selBox().hidden = true; pv.pick = null; return; }
    const at = locateInTemplate(pv.form.body.value, sel.toString(), pv.vars);
    if (!at) { selBox().hidden = true; pv.pick = null; return; }
    if (!pv.pick || pv.pick.start !== at.start || pv.pick.end !== at.end) pv.avoid = [];
    pv.pick = at;
    const box = selBox();
    box.className = 'pv-sel';
    box.innerHTML = '<button type="button" class="btn small" data-pv-change>Changer</button><button type="button" class="btn small" data-pv-edit>Modifier</button>';
    showSel();
  }
  // Place la barre près de la sélection ; elle suit un défilement et se cache quand la phrase sort de l'écran (jamais elle-même hors de l'écran)
  function showSel() {
    const sel = getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (pv.mode === 'idle' && (rect.bottom <= 0 || rect.top >= innerHeight)) { selBox().hidden = true; return; }
    placeSel(rect);
  }
  // « Modifier » : l'aperçu se ferme et la phrase est sélectionnée dans le champ du modèle, prête à être retouchée à la main
  function editPick() {
    const { start, end } = pv.pick;
    const field = pv.form.body;
    hideSel();
    pvDlg.close();
    field.focus();
    field.setSelectionRange(start, end);
    field.blur(); field.focus(); // le navigateur fait alors défiler le champ jusqu'à la sélection
    field.scrollIntoView({ block: 'center' });
  }
  async function changePick() {
    const mine = ++pv.rseq;
    const { start, end } = pv.pick;
    const box = selBox();
    pv.mode = 'busy';
    box.className = 'pv-sel pv-sel-panel';
    box.innerHTML = loadingHtml(`${aiName()} cherche une autre phrase…`, { small: true });
    const id = pv.form.closest('.project').dataset.id;
    let r;
    try {
      r = await api(`/api/projects/${id}/template/rephrase`, { kind: pv.form.dataset.kind, body: pv.form.body.value, start, end, prospectId: pv.prospectId, avoid: pv.avoid });
    } catch (err) { r = { unavailable: true, reason: err.message }; }
    if (mine !== pv.rseq || pv.mode !== 'busy') return;
    pv.mode = 'proposal';
    if (r.unavailable) {
      pv.proposal = null;
      box.innerHTML = `<p class="small">${esc(aiName())} n'a pas pu proposer une autre phrase : ${esc(String(r.reason || 'réponse indisponible').replace(/[.\s]+$/, ''))}.</p><div class="row"><button type="button" class="btn small" data-pv-more>Réessayer</button><button type="button" class="btn small" data-pv-cancel>Fermer</button></div>`;
      return;
    }
    pv.proposal = r.sentence;
    box.innerHTML = `<p class="small muted">Nouvelle phrase proposée par ${esc(aiName())} :</p><blockquote class="pv-prop-t">${esc(r.shown)}</blockquote>
      <div class="row"><button type="button" class="btn small primary" data-pv-use>Utiliser cette phrase</button><button type="button" class="btn small" data-pv-more>Proposer une autre phrase</button><button type="button" class="btn small" data-pv-cancel>Annuler</button></div>`;
  }
  function usePick() {
    const { start, end } = pv.pick;
    const field = pv.form.body;
    field.value = field.value.slice(0, start) + pv.proposal + field.value.slice(end);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    hideSel();
    toast('Phrase remplacée');
    renderPreview();
  }
  listen(document, 'selectionchange', onSelection);
  listen(document, 'scroll', () => { if (pvDlg?.open && pv.pick) showSel(); }, true); // capture : la fenêtre et le cadre du texte défilent chacun

  // L'IA de la personne relit le mail rempli : a-t-il un sens ? Sinon elle propose une version corrigée du modèle, appliquée seulement au clic.
  // `seq` : un résultat arrivé après un changement de prospect ou d'objet est ignoré.
  async function senseCheck(id, form) {
    const mine = ++pv.seq;
    pv.fixBody = null;
    let r;
    try {
      r = await api(`/api/projects/${id}/template/sense`, { kind: form.dataset.kind, subject: form.subject.value, body: form.body.value, prospectId: pv.prospectId });
    } catch (err) { r = { unavailable: true, reason: err.message }; }
    const box = $('[data-pv-sense]', pvDlg);
    if (mine !== pv.seq || !box) return;
    if (r.unavailable) {
      box.innerHTML = `<ul class="pv-warn" role="status"><li>${icon('alert')}<span>${esc(aiName())} n'a pas pu relire le sens de ce mail : ${esc(String(r.reason || 'réponse indisponible').replace(/[.\s]+$/, ''))}. L'envoi attend cette relecture.</span></li></ul>`;
    } else if (r.sense) {
      box.innerHTML = `<p class="small"><span class="badge ok">${icon('check')}Sens vérifié</span> ${esc(aiName())} a relu ce mail.</p>`;
    } else {
      pv.fixBody = r.fixBody || null;
      box.innerHTML = `<ul class="pv-warn" role="status"><li>${icon('alert')}<span><strong>Ce mail ne veut pas dire grand-chose.</strong> ${esc(r.problem || '')}</span></li></ul>
        ${r.fixBody ? `<p class="small">Version corrigée proposée par ${esc(aiName())} :</p><pre class="pv-text">${esc(r.fixedText || r.fixBody)}</pre>
        <p><button type="button" class="btn small primary" data-pv-apply>Appliquer la correction au modèle</button></p>
        <p class="muted small">Le modèle ne change pas tant que tu n'as pas cliqué. Tu pourras ensuite le retoucher avant de l'enregistrer et de le valider.</p>`
    : `<p class="muted small">Aucune correction sûre n'a pu être proposée : retouche le texte du modèle, puis rouvre l'aperçu.</p>`}`;
    }
  }

  listen(document, 'click', async (e) => {
    const open = e.target.closest('[data-tpl-preview]');
    if (open) {
      if (!pvDlg) {
        pvDlg = document.createElement('dialog');
        pvDlg.className = 'prospect-dialog mailprev';
        pvDlg.setAttribute('aria-label', 'Aperçu du mail');
        pvDlg.innerHTML = '<div data-dialog-body></div><div class="pv-sel" data-pv-sel role="toolbar" aria-label="Actions sur la phrase sélectionnée" hidden></div>';
        document.body.append(pvDlg);
        pvDlg.addEventListener('click', (ev) => {
          if (ev.target === pvDlg || ev.target.closest('[data-close]')) { pvDlg.close(); return; }
          if (ev.target.closest('[data-pv-change]') && pv.pick) { changePick(); return; }
          if (ev.target.closest('[data-pv-edit]') && pv.pick) { editPick(); return; }
          if (ev.target.closest('[data-pv-use]') && pv.proposal) { usePick(); return; }
          if (ev.target.closest('[data-pv-more]') && pv.pick) { if (pv.proposal) pv.avoid.push(pv.proposal); pv.proposal = null; changePick(); return; }
          if (ev.target.closest('[data-pv-cancel]')) { hideSel(); return; }
          if (ev.target.closest('[data-pv-apply]') && pv.fixBody) {
            pv.form.body.value = pv.fixBody;
            pv.form.body.dispatchEvent(new Event('input', { bubbles: true }));
            pv.fixBody = null;
            toast('Correction appliquée');
            renderPreview();
            return;
          }
          const v = ev.target.closest('[data-pv-variant]');
          const t = ev.target.closest('[data-pv-tab]');
          if (v) { pv.variant = v.dataset.pvVariant; renderPreview(); }
          if (t) { pv.tab = t.dataset.pvTab; renderPreview(); }
        });
        // Un clic sur la barre ne doit pas faire disparaître la sélection (et donc la barre) avant d'être pris en compte
        selBox().addEventListener('mousedown', (ev) => ev.preventDefault());
        selBox().addEventListener('pointerdown', () => { pv.hold = true; });
        pvDlg.addEventListener('close', hideSel);
        pvDlg.addEventListener('change', (ev) => { if (ev.target.matches('[data-pv-prospect]')) { pv.prospectId = ev.target.value; renderPreview(); } });
      }
      Object.assign(pv, { form: open.closest('form'), prospectId: '', variant: 'A', tab: 'html', prospects: null });
      open.disabled = true;
      await renderPreview();
      open.disabled = false;
    }
  });

  // Ajouter un prospect à la main : le formulaire s'ouvre sous les boutons de la liste
  listen(document, 'click', (e) => {
    const t = e.target.closest('[data-pform-toggle],[data-pform-cancel]');
    if (!t) return;
    const d = t.closest('details.prospects');
    const form = $('[data-pform]', d);
    const open = t.matches('[data-pform-toggle]') ? form.hidden : false;
    form.hidden = !open;
    $('[data-pform-toggle]', d).setAttribute('aria-expanded', String(open));
    if (open) $('input[name="email"]', form).focus();
  });
  listen(document, 'submit', async (e) => {
    const form = e.target.closest('form[data-pform]');
    if (!form) return;
    e.preventDefault();
    const d = form.closest('details.prospects');
    const btn = $('button:not([type=button])', form);
    btn.disabled = true;
    try {
      const added = await api(`/api/projects/${form.dataset.id}/prospects`, formData(form));
      toast('Prospect ajouté');
      form.reset(); form.hidden = true;
      $('[data-pform-toggle]', d).setAttribute('aria-expanded', 'false');
      loadProspects(d, 1, added.id);
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false;
  });

  // Import CSV : Excel enregistre souvent en Windows-1252, on détecte pour ne pas abîmer les accents
  listen(document, 'change', async (e) => {
    const input = e.target.closest('[data-import]');
    if (!input?.files?.length) return;
    const file = input.files[0];
    input.value = '';
    const d = input.closest('details.prospects');
    const report = $('[data-import-report]', d);
    if (file.size > 1024 * 1024) { toast('Fichier trop gros (1 Mo max, environ 2000 lignes)', 'error'); return; }
    const buf = await file.arrayBuffer();
    let csv;
    try { csv = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { csv = new TextDecoder('windows-1252').decode(buf); }
    try {
      const r = await api(`/api/projects/${input.dataset.import}/prospects/import`, { csv });
      report.innerHTML = `<p class="small"><span class="ok">${r.imported} importé(s)</span> sur ${r.total} ·
        ${r.skipped} ignoré(s) (déjà présents ou à ne pas contacter) · ${r.invalid.length} invalide(s)</p>
        ${r.invalid.length ? `<details class="small"><summary>Lignes ignorées</summary><ul>${r.invalid.map((x) => `<li>Ligne ${x.line} : ${esc(x.reason)}</li>`).join('')}</ul></details>` : ''}`;
      toast(`${r.imported} prospect(s) importé(s)`);
      loadProspects(d);
    } catch (err) { report.innerHTML = ''; toast(err.message, 'error'); }
  });

  listen(document, 'click', (e) => {
    const b = e.target.closest('[data-open-prospect]');
    if (b) openProspect(b.dataset.openProspect);
  });

  const fmtDay = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' }) : '');

  // `fresh` : l'identifiant du prospect qu'on vient d'ajouter ; sa ligne est surlignée un instant et amenée à l'écran si elle est cachée (vue liste ; le kanban n'est pas concerné)
  async function loadProspects(d, page = 1, fresh = null) {
    const proj = d.closest('.project');
    const box = $('[data-prospects]', d);
    const filters = formData($('[data-filters]', d));
    const qs = new URLSearchParams({ ...filters, page });
    // L'export suit les filtres affichés
    $('[data-export]', d).href = `/api/projects/${proj.dataset.id}/prospects.csv?${new URLSearchParams(filters)}`;
    if (d.dataset.view === 'board') return loadBoard(d, proj, filters, box);
    try {
      const r = await api(`/api/projects/${proj.dataset.id}/prospects?${qs}`);
      d.dataset.page = r.page;
      box.innerHTML = r.rows.length ? `<div class="table-wrap"><table><thead><tr><th>Entreprise</th><th>Email</th><th>Ville</th><th>Score</th><th>Contacté</th><th>Statut</th></tr></thead><tbody>
        ${r.rows.map((x) => `<tr data-row="${x.id}"><td><button type="button" class="link" data-open-prospect="${x.id}">${esc(x.company)}</button>
            ${x.next_action ? `<div class="small ${x.next_action_at * 1000 <= Date.now() ? 'warn' : 'muted'}">→ ${esc(x.next_action)} (${fmtDay(x.next_action_at)})</div>` : ''}</td>
          <td>${esc(x.email)}</td><td>${esc(x.city)}</td><td>${x.score ?? ''}</td>
          <td>${fmtDay(x.sent_at)}${x.followup_at ? ' <span class="muted small">+ relance</span>' : ''}</td>
          <td><select data-prospect="${x.id}" class="st-${x.status}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === x.status ? 'selected' : ''}>${v}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted small">Aucun prospect ne correspond.</p>';
      $('[data-pager]', d).innerHTML = r.pages > 1
        ? `<button type="button" class="btn small" data-page="${r.page - 1}" ${r.page <= 1 ? 'disabled' : ''}>←</button>
           <span class="small muted">Page ${r.page} / ${r.pages} · ${r.total} prospect(s)</span>
           <button type="button" class="btn small" data-page="${r.page + 1}" ${r.page >= r.pages ? 'disabled' : ''}>→</button>`
        : `<span class="small muted">${r.total} prospect(s)</span>`;
      const row = fresh ? $(`tr[data-row="${fresh}"]`, box) : null;
      if (row) {
        row.classList.add('row-new');
        setTimeout(() => row.classList.remove('row-new'), 1700); // l'animation la retire déjà ; ceci couvre le mouvement réduit, où elle n'a pas lieu
        row.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    } catch (err) { box.innerHTML = `<p class="error small">${esc(err.message)}</p>`; }
  }

  // Kanban : une colonne par statut ; on glisse une fiche pour changer son statut (ou on utilise le menu de la fiche, au clavier)
  async function loadBoard(d, proj, filters, box) {
    try {
      const { status: _ignored, ...f } = filters; // les colonnes sont les statuts
      const r = await api(`/api/projects/${proj.dataset.id}/kanban?${new URLSearchParams(f)}`);
      const card = (x) => `<article class="kcard" draggable="true" data-card="${x.id}">
        <button type="button" class="link" data-open-prospect="${x.id}">${esc(x.company)}</button>
        <div class="small muted">${esc(x.email)}${x.city ? ` · ${esc(x.city)}` : ''}${x.score ? ` · ${x.score}/10` : ''}</div>
        ${x.next_action ? `<div class="small ${x.next_action_at * 1000 <= Date.now() ? 'warn' : 'muted'}">→ ${esc(x.next_action)} (${fmtDay(x.next_action_at)})</div>` : ''}
        <select data-prospect="${x.id}" class="st-${x.status}" aria-label="Statut de ${esc(x.company)}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === x.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </article>`;
      box.innerHTML = `<div class="kanban">${r.columns.map((c) => `<section class="kcol${c.total ? '' : ' empty'}" data-col="${c.status}" aria-label="${esc(c.label)}">
        <h4>${esc(c.label)} <span class="n">${c.total}</span></h4>
        <div class="kcards" data-drop="${c.status}">${c.rows.map(card).join('') || '<p class="muted small">Vide</p>'}
          ${c.total > c.rows.length ? `<p class="muted small">+ ${c.total - c.rows.length} autre(s) : affine avec les filtres ou passe en liste.</p>` : ''}</div>
      </section>`).join('')}</div>`;
      $('[data-pager]', d).innerHTML = '';
    } catch (err) { box.innerHTML = `<p class="error small">${esc(err.message)}</p>`; }
  }
  const moveProspect = async (d, id, status) => {
    if (status === 'refused' && !(await confirmBox('Marquer ce prospect en refus ?\nSon adresse est ajoutée à la liste d\'opposition.', { confirm: 'Marquer en refus' }))) return;
    try { await api(`/api/prospects/${id}/status`, { status }); toast('Statut mis à jour'); } catch (err) { toast(err.message, 'error'); }
    loadProspects(d);
  };
  listen(document, 'dragstart', (e) => {
    const c = e.target.closest?.('[data-card]');
    if (!c) return;
    e.dataTransfer.setData('text/plain', c.dataset.card);
    e.dataTransfer.effectAllowed = 'move';
    c.classList.add('drag');
  });
  listen(document, 'dragend', (e) => { e.target.closest?.('[data-card]')?.classList.remove('drag'); $$('.kcol.over').forEach((c) => c.classList.remove('over')); });
  listen(document, 'dragover', (e) => {
    const col = e.target.closest?.('.kcol');
    if (!col) return;
    e.preventDefault();
    $$('.kcol.over').forEach((c) => { if (c !== col) c.classList.remove('over'); });
    col.classList.add('over');
  });
  listen(document, 'drop', (e) => {
    const col = e.target.closest?.('.kcol');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('over');
    const id = e.dataTransfer.getData('text/plain');
    const card = id && $(`[data-card="${CSS.escape(id)}"]`);
    if (card && card.closest('.kcol') !== col) moveProspect(col.closest('details.prospects'), id, col.dataset.col);
  });

  $$('details.prospects').forEach((d) => {
    d.dataset.view = 'list';
    for (const b of $$('[data-view-mode]', d)) b.addEventListener('click', () => {
      d.dataset.view = b.dataset.viewMode;
      for (const o of $$('[data-view-mode]', d)) { o.classList.toggle('on', o === b); o.setAttribute('aria-pressed', String(o === b)); }
      loadProspects(d);
    });
    d.addEventListener('toggle', () => { if (d.open) loadProspects(d); });
    const form = $('[data-filters]', d);
    let t;
    form.addEventListener('input', (e) => { if (e.target.name === 'q') { clearTimeout(t); t = setTimeout(() => loadProspects(d), 300); } });
    form.addEventListener('change', (e) => { if (e.target.name !== 'q') loadProspects(d); });
    form.addEventListener('submit', (e) => { e.preventDefault(); loadProspects(d); });
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-page]');
      if (b) loadProspects(d, Number(b.dataset.page));
    });
  });
  listen(document, 'change', async (e) => {
    const sel = e.target.closest('[data-prospect]');
    if (!sel) return;
    if (sel.value === 'refused' && !(await confirmBox('Marquer ce prospect en refus ?\nSon adresse est ajoutée à la liste d\'opposition.', { confirm: 'Marquer en refus' }))) return;
    try { await api(`/api/prospects/${sel.dataset.prospect}/status`, { status: sel.value }); sel.className = `st-${sel.value}`; toast('Statut mis à jour'); }
    catch (err) { toast(err.message, 'error'); }
    const d = sel.closest('details.prospects');
    if (d?.dataset.view === 'board') loadProspects(d); // la fiche change de colonne
  });
})();
