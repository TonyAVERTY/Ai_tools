// Front vanilla, sans build. Polling léger uniquement sur les projets dépliés.
(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, body) {
    const r = await fetch(path, body === undefined ? { headers: { Accept: 'application/json' } } : {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
    });
    if (r.status === 401) { location.href = '/login'; throw new Error('Session expirée'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
    return data;
  }

  function toast(msg, kind = 'ok') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    document.body.append(t);
    setTimeout(() => t.remove(), 4500);
  }

  const formData = (form) => Object.fromEntries(new FormData(form));
  const ACTIVE = ['queued', 'running'];
  const LABELS = { analyze: 'Analyse', prospect: 'Recherche', template: 'Modèle', send: 'Envoi', evolution: 'Évolutions' };

  // ---------- Barre système ----------
  async function refreshSys() {
    const el = $('#sys');
    if (!el) return;
    try {
      const s = await api('/api/system');
      const hot = s.temp !== null && s.temp >= s.thermalMax - 5;
      el.innerHTML = `${s.temp !== null ? `<span class="${hot ? 'warn' : ''}">${s.temp} °C</span>` : ''}
        <span title="Équivalent API, consommé sur ton quota Pro">IA 24 h : $${s.usage.day.cost.toFixed(2)} · 30 j : $${s.usage.month.cost.toFixed(2)}</span>
        ${s.queue ? `<span class="spin-inline"></span>${s.queue} job(s)` : ''}`;
    } catch { /* silencieux */ }
  }
  refreshSys();
  setInterval(refreshSys, 30_000);

  // ---------- Rendu d'un job ----------
  function renderJob(box, job, type) {
    if (!box) return;
    if (!job) { box.innerHTML = ''; return; }
    const p = job.progress || {};
    if (ACTIVE.includes(job.status)) {
      const extra = type === 'prospect' && p.found !== undefined
        ? `<strong>${p.found}</strong> prospect(s) trouvé(s) sur ${p.target}` : '';
      box.innerHTML = `<div class="running"><span class="spinner"></span>
        <div><div>${esc(job.status === 'queued' ? 'En file d\'attente…' : p.message || 'En cours…')}</div>${extra ? `<div class="small">${extra}</div>` : ''}</div>
        <button class="btn small" data-cancel="${job.id}">Annuler</button></div>`;
    } else if (job.status === 'error') {
      box.innerHTML = `<p class="error small">${LABELS[type]} en échec : ${esc(job.error)}</p>`;
    } else if (job.status === 'cancelled') {
      box.innerHTML = `<p class="muted small">${LABELS[type]} annulé(e).</p>`;
    } else if (job.status === 'done') {
      const r = job.result || {};
      let txt = `${LABELS[type]} terminé(e).`;
      if (type === 'prospect') txt = `Recherche terminée : ${r.found} nouveau(x) prospect(s) sur ${r.requested} demandés.`;
      if (type === 'send') txt = `Envoi terminé : ${r.sent} envoyé(s), ${r.failed} échec(s).`;
      if (type === 'evolution') {
        box.innerHTML = `<p class="ok small">Envoyé à ${esc(r.sentTo)}.</p><pre class="md">${esc(r.markdown)}</pre>`;
        return;
      }
      box.innerHTML = `<p class="ok small">${esc(txt)}</p>`;
    }
  }

  // ---------- État d'un projet ----------
  const state = new Map(); // id -> { timer, tplStamp, analyzing }

  async function refreshProject(el) {
    const id = el.dataset.id;
    let s;
    try { s = await api(`/api/projects/${id}/status`); } catch (e) { return schedule(el, 30_000); }
    const st = state.get(id) || {};
    const jobs = s.jobs;
    for (const type of ['prospect', 'template', 'send', 'evolution']) renderJob($(`[data-job="${type}"]`, el), jobs[type], type);

    const running = Object.entries(jobs).filter(([, j]) => ACTIVE.includes(j.status)).map(([t]) => LABELS[t]);
    $('[data-state]', el).innerHTML = running.length
      ? `<span class="spin-inline"></span>${esc(running.join(', '))}`
      : `<span class="muted small">${s.stats.total || 0} prospect(s)</span>`;

    // Fin d'analyse → recharge la page pour afficher fiche + cible
    const an = jobs.analyze;
    if (an && ACTIVE.includes(an.status)) st.analyzing = true;
    else if (st.analyzing && an) {
      st.analyzing = false;
      if (an.status === 'done') { toast('Analyse terminée'); location.reload(); return; }
      if (an.status === 'error') toast(`Analyse en échec : ${an.error}`, 'error');
    }
    if (an?.status === 'error' && !s.hasProfile) $('.profile p', el).outerHTML = `<p class="error small">${esc(an.error)}</p>`;

    // Modèle de mail : on ne remplace le formulaire que s'il a changé côté serveur
    const tplForm = $('form[data-action="template"]', el);
    if (s.template && st.tplStamp !== s.template.updated_at) {
      st.tplStamp = s.template.updated_at;
      tplForm.subject.value = s.template.subject;
      tplForm.subjectB.value = s.template.subjectB || '';
      tplForm.body.value = s.template.body;
    }
    $('[data-tpl-state]', el).innerHTML = s.template
      ? (s.template.status === 'validated' ? '<span class="badge ok">validé</span>' : '<span class="badge warn">brouillon</span>') : '';

    // Bouton Envoyer : recherche finie + modèle validé + SMTP + quota dispo
    const prospecting = jobs.prospect && ACTIVE.includes(jobs.prospect.status);
    const sending = jobs.send && ACTIVE.includes(jobs.send.status);
    const sendForm = $('form[data-action="send"]', el);
    const blockers = [];
    if (prospecting) blockers.push('recherche en cours');
    if (sending) blockers.push('envoi en cours');
    if (s.template?.status !== 'validated') blockers.push('modèle à valider');
    if (!s.hasSmtp) blockers.push('SMTP à configurer');
    if (!s.sendMax) blockers.push(s.stats.new ? 'plafond du jour atteint' : 'aucun prospect à contacter');
    $('button', sendForm).disabled = blockers.length > 0;
    sendForm.count.max = s.sendMax || 1;
    if (Number(sendForm.count.value) > s.sendMax && s.sendMax) sendForm.count.value = s.sendMax;
    $('[data-send-info]', sendForm).textContent = blockers.length
      ? `Bloqué : ${blockers.join(', ')}`
      : `${s.stats.new} prospect(s) en attente · max ${s.sendMax} maintenant`;
    $('[data-count]', el).textContent = `(${s.stats.total || 0})`;

    state.set(id, st);
    schedule(el, running.length ? 4000 : 30_000);
  }

  function schedule(el, ms) {
    const st = state.get(el.dataset.id) || {};
    clearTimeout(st.timer);
    st.timer = el.open ? setTimeout(() => refreshProject(el), ms) : null;
    state.set(el.dataset.id, st);
  }

  $$('details.project').forEach((el) => {
    el.addEventListener('toggle', () => { if (el.open) refreshProject(el); else schedule(el, 0); });
  });
  // Rouvre le dernier projet consulté après un reload
  const last = sessionStorageGet('openProject');
  if (last) { const el = $(`details.project[data-id="${last}"]`); if (el) el.open = true; }
  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }
  $$('details.project').forEach((el) => el.addEventListener('toggle', () => { if (el.open) sessionStorageSet('openProject', el.dataset.id); }));

  // ---------- Panneaux ----------
  document.addEventListener('click', async (e) => {
    const panelBtn = e.target.closest('[data-panel]');
    if (panelBtn) {
      const proj = panelBtn.closest('.project');
      const name = panelBtn.dataset.panel;
      $$('[data-panel]', proj).forEach((b) => b.classList.toggle('active', b === panelBtn && !b.classList.contains('active')));
      $$('[data-panel-body]', proj).forEach((p) => { p.hidden = p.dataset.panelBody !== name || !panelBtn.classList.contains('active'); });
      if (name === 'recap' && panelBtn.classList.contains('active')) loadRecap(proj);
      return;
    }

    const runBtn = e.target.closest('[data-run]');
    if (runBtn) {
      const { run, id } = runBtn.dataset;
      if (run === 'analyze' && !confirm('Relancer l\'analyse complète du repo ? (consomme du quota Claude)')) return;
      try {
        const r = await api(`/api/projects/${id}/${run}`, {});
        toast(r.existing ? 'Déjà en cours' : 'Lancé');
        refreshProject(runBtn.closest('.project'));
      } catch (err) { toast(err.message, 'error'); }
      return;
    }

    const cancel = e.target.closest('[data-cancel]');
    if (cancel) {
      await api(`/api/jobs/${cancel.dataset.cancel}/cancel`, {}).catch((err) => toast(err.message, 'error'));
      refreshProject(cancel.closest('.project'));
      return;
    }

    if (e.target.matches('[data-recap-refresh]')) loadRecap(e.target.closest('.project'), true);
  });

  // ---------- Formulaires ----------
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-action]');
    if (!form) return;
    e.preventDefault();
    const { action, id, confirm: question } = form.dataset;
    if (question && !confirm(question)) return;
    const data = formData(form);
    if (e.submitter?.name) data[e.submitter.name] = e.submitter.value;
    const proj = form.closest('.project');
    const btns = $$('button', form);
    btns.forEach((b) => { b.disabled = true; });
    try {
      switch (action) {
        case 'create': {
          await api('/api/projects', data);
          toast('Projet créé, analyse lancée');
          setTimeout(() => location.reload(), 600);
          break;
        }
        case 'target': await api(`/api/projects/${id}/target`, data); toast('Cible validée'); setTimeout(() => location.reload(), 500); break;
        case 'prospect': await api(`/api/projects/${id}/prospect`, data); toast('Recherche lancée en arrière-plan'); break;
        case 'evolution': {
          if (data.level === 'approfondi' && !confirm('Le niveau approfondi utilise Opus et consomme beaucoup de quota. Continuer ?')) break;
          await api(`/api/projects/${id}/evolution`, data); toast('Recherche d\'évolutions lancée'); break;
        }
        case 'template': {
          const r = await api(`/api/projects/${id}/template/save`, data);
          toast(r.status === 'validated' ? 'Modèle validé' : 'Brouillon enregistré');
          break;
        }
        case 'send': {
          const n = Number(data.count);
          if (!confirm(`Envoyer ${n} mail(s) de prospection maintenant ?\nIls partiront espacés de quelques dizaines de secondes.`)) break;
          await api(`/api/projects/${id}/send`, { count: n, confirm: true });
          toast('Envoi lancé');
          break;
        }
        case 'smtp': data.pass ||= ''; await api(`/api/projects/${id}/smtp`, data); toast('SMTP enregistré'); form.pass.value = ''; break;
        case 'db': data.ssl = form.ssl.checked; await api(`/api/projects/${id}/db`, data); toast('Accès BDD enregistré'); form.password.value = ''; break;
        case 'delete': await api(`/api/projects/${id}/delete`, {}); location.reload(); break;
      }
      if (proj) refreshProject(proj);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btns.forEach((b) => { b.disabled = false; });
      if (proj && action !== 'send') refreshProject(proj);
    }
  });

  // ---------- Récap ----------
  async function loadRecap(proj, force = false) {
    const box = $('[data-recap]', proj);
    box.innerHTML = '<p class="muted"><span class="spin-inline"></span>Chargement…</p>';
    try {
      const r = await api(`/api/projects/${proj.dataset.id}/recap${force ? '?force' : ''}`);
      const b = r.business;
      const s = r.stats;
      const eur = (v) => (typeof v === 'number' ? v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : esc(v ?? '—'));
      box.innerHTML = `
        <div class="kpis">
          <div class="kpi"><span>Utilisateurs</span><strong>${b?.users ?? '—'}</strong></div>
          <div class="kpi"><span>Clients payants</span><strong>${b?.clients ?? '—'}</strong></div>
          <div class="kpi"><span>Revenu total</span><strong>${b ? eur(b.revenue) : '—'}</strong></div>
        </div>
        ${r.error ? `<p class="muted small">BDD : ${esc(r.error)}</p>` : ''}
        <h4>Prospection</h4>
        <div class="kpis">
          <div class="kpi"><span>Trouvés</span><strong>${s.total || 0}</strong></div>
          <div class="kpi"><span>Contactés</span><strong>${(s.sent || 0) + (s.replied || 0) + (s.client || 0) + (s.refused || 0)}</strong></div>
          <div class="kpi"><span>Réponses</span><strong>${(s.replied || 0) + (s.client || 0)}</strong></div>
          <div class="kpi"><span>Convertis</span><strong>${s.client || 0}</strong></div>
        </div>
        <p class="muted small">Coût IA du projet (équivalent API) : $${r.aiCostUsd.toFixed(2)}${b?.cached ? ' · chiffres en cache (10 min)' : ''}
        <button class="btn small" data-recap-refresh>Rafraîchir</button></p>`;
    } catch (err) { box.innerHTML = `<p class="error small">${esc(err.message)}</p>`; }
  }

  // ---------- Liste des prospects (mini CRM) ----------
  const STATUS = { new: 'À contacter', sent: 'Contacté', replied: 'A répondu', client: 'Client', refused: 'Refus', bounced: 'Rejeté' };
  $$('details.prospects').forEach((d) => d.addEventListener('toggle', async () => {
    if (!d.open) return;
    const proj = d.closest('.project');
    const box = $('[data-prospects]', d);
    try {
      const rows = await api(`/api/projects/${proj.dataset.id}/prospects`);
      box.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Entreprise</th><th>Email</th><th>Ville</th><th>Score</th><th>Statut</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${r.website ? `<a href="${esc(r.website)}" target="_blank" rel="noopener noreferrer">${esc(r.company)}</a>` : esc(r.company)}</td>
          <td>${esc(r.email)}</td><td>${esc(r.city)}</td><td>${r.score}</td>
          <td><select data-prospect="${r.id}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted small">Aucun prospect.</p>';
    } catch (err) { box.innerHTML = `<p class="error small">${esc(err.message)}</p>`; }
  }));
  document.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-prospect]');
    if (!sel) return;
    if (sel.value === 'refused' && !confirm('Marquer en refus ajoute l\'adresse à la liste d\'opposition. Continuer ?')) return;
    try { await api(`/api/prospects/${sel.dataset.prospect}/status`, { status: sel.value }); toast('Statut mis à jour'); }
    catch (err) { toast(err.message, 'error'); }
  });
})();
