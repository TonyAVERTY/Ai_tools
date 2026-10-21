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
  const ago = (ts) => {
    if (!ts) return 'jamais';
    const m = Math.round((Date.now() / 1000 - ts) / 60);
    return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`;
  };
  const pct = (x) => `${Math.round(x * 100)} %`;
  const ACTIVE = ['queued', 'running'];
  const LABELS = {
    analyze: 'Analyse', prospect: 'Recherche', template: 'Modèle', send: 'Envoi', evolution: 'Évolutions',
    followup_template: 'Modèle de relance', followup: 'Relances',
  };

  // ---------- Barre système ----------
  // "IA 24 h : 0,42 $ / 2 $" : orange à 80 %, rouge une fois atteint
  function gauge(label, x) {
    const used = `${x.used.toFixed(2)} $`;
    if (!x.limit) return `<span title="Équivalent API, consommé sur ton quota Pro">IA ${label} : ${used}</span>`;
    const r = x.used / x.limit;
    return `<span class="${r >= 1 ? 'error' : r >= 0.8 ? 'warn' : ''}" title="Équivalent API, consommé sur ton quota Pro">IA ${label} : ${used} / ${x.limit} $</span>`;
  }

  async function refreshSys() {
    const el = $('#sys');
    if (!el) return;
    try {
      const s = await api('/api/system');
      const hot = s.temp !== null && s.temp >= s.thermalMax - 5;
      el.innerHTML = `${s.temp !== null ? `<span class="${hot ? 'warn' : ''}">${s.temp} °C</span>` : ''}
        ${gauge('24 h', s.budget.day)} ${gauge('30 j', s.budget.month)}
        ${s.budget.blocked ? '<span class="error">Budget IA atteint : jobs IA en attente</span>' : ''}
        ${s.queue ? `<span class="spin-inline"></span>${s.queue} job(s)` : ''}
        ${s.scheduled ? `<span>${s.scheduled} programmé(s) cette nuit</span>` : ''}`;
    } catch { /* silencieux */ }
  }
  refreshSys();
  setInterval(refreshSys, 30_000);

  // ---------- Rendu d'un job ----------
  function renderJob(box, job, type) {
    if (!box) return;
    if (!job) { box.innerHTML = ''; return; }
    const p = job.progress || {};
    if (job.status === 'queued' && job.runAfter && job.runAfter * 1000 > Date.now()) {
      const at = new Date(job.runAfter * 1000).toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
      box.innerHTML = `<div class="running scheduled"><span class="moon" aria-hidden="true"></span>
        <div><div>${LABELS[type]} programmé(e) : ${esc(at)}</div><div class="small muted">Le Pi est au frais et ton quota Claude est libre.</div></div>
        <button class="btn small" data-cancel="${job.id}">Annuler</button></div>`;
      return;
    }
    if (ACTIVE.includes(job.status)) {
      const extra = type === 'prospect' && p.found !== undefined
        ? `<strong>${p.found}</strong> prospect(s) trouvé(s) sur ${p.target}` : '';
      box.innerHTML = `<div class="running"><span class="spinner"></span>
        <div><div>${esc(p.message || (job.status === 'queued' ? 'En file d\'attente…' : 'En cours…'))}</div>${extra ? `<div class="small">${extra}</div>` : ''}</div>
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
      if (type === 'followup') txt = r.postponed ? 'Relances reportées au prochain créneau (lun-ven 9h-18h).' : `Relances terminées : ${r.sent} envoyée(s), ${r.failed} échec(s).`;
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
    for (const type of ['prospect', 'template', 'send', 'evolution', 'followup_template', 'followup']) renderJob($(`[data-job="${type}"]`, el), jobs[type], type);

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
    st.tplStamp ||= {};
    for (const kind of ['initial', 'followup']) {
      const t = s.templates[kind];
      const form = $(`form[data-action="template"][data-kind="${kind}"]`, el);
      if (t && st.tplStamp[kind] !== t.updated_at) {
        st.tplStamp[kind] = t.updated_at;
        form.subject.value = t.subject;
        if (form.subjectB) form.subjectB.value = t.subjectB || '';
        form.body.value = t.body;
      }
      $('[data-tpl-state]', form).innerHTML = t
        ? (t.status === 'validated' ? '<span class="badge ok">validé</span>' : '<span class="badge warn">brouillon</span>') : '';
    }

    // Relance automatique : ce qui est prévu, ou ce qui bloque
    const f = s.followup;
    $('[data-followup-info]', el).innerHTML = !f.enabled
      ? 'Désactivée.'
      : f.blockers.length
        ? `<span class="warn">En attente : ${esc(f.blockers.join(', '))}.</span> ${f.due} relance(s) due(s).`
        : f.due
          ? `${f.due} relance(s) due(s) : ${f.inHours ? 'envoi au prochain passage (≤ 15 min)' : 'envoi aux heures ouvrées (lun-ven 9h-18h)'}.`
          : `Active : les prospects sans réponse après ${f.days} jours seront relancés une fois.`;

    // Bouton Envoyer : recherche finie + modèle validé + SMTP + quota dispo
    const prospecting = jobs.prospect && ACTIVE.includes(jobs.prospect.status);
    const sending = jobs.send && ACTIVE.includes(jobs.send.status);
    const sendForm = $('form[data-action="send"]', el);
    const blockers = [];
    if (prospecting) blockers.push('recherche en cours');
    if (sending) blockers.push('envoi en cours');
    if (s.templates.initial?.status !== 'validated') blockers.push('modèle à valider');
    if (!s.hasSmtp) blockers.push('SMTP à configurer');
    if (!s.sendMax) blockers.push(s.stats.new ? 'plafond du jour atteint' : 'aucun prospect à contacter');
    $('button', sendForm).disabled = blockers.length > 0;
    sendForm.count.max = s.sendMax || 1;
    if (Number(sendForm.count.value) > s.sendMax && s.sendMax) sendForm.count.value = s.sendMax;
    $('[data-send-info]', sendForm).textContent = blockers.length
      ? `Bloqué : ${blockers.join(', ')}`
      : `${s.stats.new} prospect(s) en attente · max ${s.sendMax} maintenant`;
    $('[data-count]', el).textContent = `(${s.stats.total || 0})`;

    // Boîte de réception + test A/B
    const ib = $('[data-inbox]', el);
    const ab = s.ab.length > 1
      ? `<br>Test A/B : ${s.ab.map((v) => `<strong>${v.variant}</strong> ${v.replied}/${v.sent} réponses (${pct(v.rate)})`).join(' · ')}` : '';
    if (!s.hasImap) {
      ib.innerHTML = `<span class="muted">Boîte non connectée : configure l'IMAP (Configuration du projet) pour détecter les réponses.</span>${ab}`;
    } else {
      const i = s.inbox || {};
      const head = i.lastError ? `<span class="error">Boîte en erreur : ${esc(i.lastError)}</span>` : `Boîte vérifiée ${ago(i.lastOk)}`;
      ib.innerHTML = `${head} · ${i.replies || 0} réponse(s) · ${i.bounces || 0} adresse(s) invalide(s)
        <button class="btn small" data-inbox-check="${id}">Vérifier maintenant</button>${ab}`;
    }

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

    if (e.target.closest('[data-report-send]')) {
      try { const r = await api('/api/report/send', {}); toast(`Rapport envoyé (${r.channels.join(' + ')})`); }
      catch (err) { toast(err.message, 'error'); }
      return;
    }

    if (e.target.closest('[data-notify-test]')) {
      try { await api('/api/notify/test', {}); toast('Notification envoyée sur Discord'); }
      catch (err) { toast(err.message, 'error'); }
      return;
    }

    const inboxBtn = e.target.closest('[data-inbox-check]');
    if (inboxBtn) {
      inboxBtn.disabled = true;
      try {
        const r = await api(`/api/projects/${inboxBtn.dataset.inboxCheck}/inbox/check`, {});
        toast(`Boîte lue : ${r.check.replies} nouvelle(s) réponse(s), ${r.check.bounces} rejet(s)`);
      } catch (err) { toast(err.message, 'error'); }
      refreshProject(inboxBtn.closest('.project'));
    }
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
        case 'prospect': {
          const r = await api(`/api/projects/${id}/prospect`, data);
          toast(r.budgetBlocked ? `En file, mais ${r.budgetBlocked}` : r.existing ? 'Une recherche est déjà prévue ou en cours' : data.when === 'night' ? 'Recherche programmée cette nuit' : 'Recherche lancée en arrière-plan', r.budgetBlocked ? 'error' : 'ok');
          break;
        }
        case 'evolution': {
          if (data.level === 'approfondi' && !confirm('Le niveau approfondi utilise Opus et consomme beaucoup de quota. Continuer ?')) break;
          const r = await api(`/api/projects/${id}/evolution`, data);
          toast(r.budgetBlocked ? `En file, mais ${r.budgetBlocked}` : r.existing ? 'Une recherche est déjà prévue ou en cours' : data.when === 'night' ? 'Évolutions programmées cette nuit' : 'Recherche d\'évolutions lancée', r.budgetBlocked ? 'error' : 'ok');
          break;
        }
        case 'template': {
          data.kind = form.dataset.kind;
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
        case 'imap': {
          const r = await api(`/api/projects/${id}/imap`, data);
          form.pass.value = '';
          if (r.disabled) toast('Détection des réponses désactivée');
          else if (r.ok) toast(`Boîte connectée : ${r.check.replies} réponse(s) trouvée(s)`);
          else toast(r.error, 'error');
          break;
        }
        case 'followup': {
          data.enabled = form.enabled.checked;
          await api(`/api/projects/${id}/followup`, data);
          toast(data.enabled ? 'Relance automatique activée' : 'Relance automatique désactivée');
          break;
        }
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
  // Seuls les liens http(s) sont cliquables : un "javascript:" venu d'une page web scrapée ne doit jamais s'exécuter ici
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');

  const fmtDay = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' }) : '');

  async function loadProspects(d, page = 1) {
    const proj = d.closest('.project');
    const box = $('[data-prospects]', d);
    const qs = new URLSearchParams({ ...formData($('[data-filters]', d)), page });
    try {
      const r = await api(`/api/projects/${proj.dataset.id}/prospects?${qs}`);
      d.dataset.page = r.page;
      box.innerHTML = r.rows.length ? `<div class="table-wrap"><table><thead><tr><th>Entreprise</th><th>Email</th><th>Ville</th><th>Score</th><th>Contacté</th><th>Statut</th></tr></thead><tbody>
        ${r.rows.map((x) => `<tr data-row="${x.id}"><td>${safeUrl(x.website) ? `<a href="${esc(safeUrl(x.website))}" target="_blank" rel="noopener noreferrer">${esc(x.company)}</a>` : esc(x.company)}</td>
          <td>${esc(x.email)}</td><td>${esc(x.city)}</td><td>${x.score ?? ''}</td>
          <td>${fmtDay(x.sent_at)}${x.followup_at ? ' <span class="muted small">+ relance</span>' : ''}</td>
          <td><select data-prospect="${x.id}" class="st-${x.status}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === x.status ? 'selected' : ''}>${v}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted small">Aucun prospect ne correspond.</p>';
      $('[data-pager]', d).innerHTML = r.pages > 1
        ? `<button type="button" class="btn small" data-page="${r.page - 1}" ${r.page <= 1 ? 'disabled' : ''}>←</button>
           <span class="small muted">Page ${r.page} / ${r.pages} · ${r.total} prospect(s)</span>
           <button type="button" class="btn small" data-page="${r.page + 1}" ${r.page >= r.pages ? 'disabled' : ''}>→</button>`
        : `<span class="small muted">${r.total} prospect(s)</span>`;
    } catch (err) { box.innerHTML = `<p class="error small">${esc(err.message)}</p>`; }
  }

  $$('details.prospects').forEach((d) => {
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
  document.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-prospect]');
    if (!sel) return;
    if (sel.value === 'refused' && !confirm('Marquer en refus ajoute l\'adresse à la liste d\'opposition. Continuer ?')) return;
    try { await api(`/api/prospects/${sel.dataset.prospect}/status`, { status: sel.value }); sel.className = `st-${sel.value}`; toast('Statut mis à jour'); }
    catch (err) { toast(err.message, 'error'); }
  });
})();
