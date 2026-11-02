// Promotion d'un projet : formulaire de la vidéo, choix de la voix, vidéos produites, clés des fournisseurs de voix.
// Chargé après app.js, qui expose ses outils communs dans window.AiTools ; ajax.js relance ce script à chaque navigation, comme app.js.
(() => {
  const { $, $$, api, esc, go, icon, liDay, listen, loadLinkedin, refreshProject, toast } = window.AiTools;
  const mo = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

  // ---------- Promotion ----------
  // Section d'un projet : choisir le sujet (facultatif), le nombre d'images par seconde et la durée, lancer la production, revoir et télécharger les vidéos.

  async function loadPromo(proj) {
    const box = $('[data-promo]', proj);
    if (!box) return;
    try { renderPromo(box, await api(`/api/projects/${proj.dataset.id}/promo`), proj.dataset.id); }
    catch (e) { box.innerHTML = `<p class="error small">${esc(e.message)}</p>`; }
  }

  function promoVideoCard(v, s, id) {
    const dim = v.width === v.height ? 'carré' : v.width > v.height ? 'paysage' : 'vertical';
    return `<article class="pv" data-pv="${v.id}">
      <video class="pv-video pv-${dim}" controls preload="metadata" playsinline src="/api/promo/${v.id}/file" aria-label="Vidéo de promotion"></video>
      <div class="pv-meta">
        <p class="pv-title">${v.subject ? esc(v.subject) : '<span class="muted">Présentation du projet</span>'}</p>
        <p class="muted small">${v.seconds} s · ${v.fps} images/s · ${dim} · ${mo(v.size)} · ${esc(liDay(v.createdAt))}</p>
        <p class="row"><a class="btn small" href="/api/promo/${v.id}/file?download=1" download data-noajax>Télécharger</a>
        ${s.canDelete ? `<button type="button" class="btn small danger" data-pv-delete="${v.id}" data-id="${id}">Supprimer</button>` : ''}</p>
      </div></article>`;
  }

  function renderPromo(box, s, id) {
    // Ne pas écraser ce que l'utilisateur est en train de saisir
    if (box.contains(document.activeElement) && document.activeElement.matches('input, select')) return;
    if (!s.supported) { box.innerHTML = `<p class="muted">${esc(s.reason)} La vidéo de promotion n'est pas disponible sur ce serveur.</p>`; return; }
    const L = s.limits;
    const form = s.hasProfile ? `<form class="promo-form" data-promo-form data-max-frames="${L.maxFrames}">
        <label class="field"><span class="lbl">Sujet <span class="muted small">(facultatif)</span></span>
          <input name="subject" maxlength="${L.maxSubject}" placeholder="Laisse vide : Claude présente le projet" autocomplete="off"></label>
        <div class="grid3">
          <label class="field"><span class="lbl">Images par seconde</span><input name="fps" type="number" inputmode="numeric" min="${L.fps.min}" max="${L.fps.max}" value="${L.fps.def}" required></label>
          <label class="field"><span class="lbl">Durée (secondes)</span><input name="seconds" type="number" inputmode="numeric" min="${L.seconds.min}" max="${L.seconds.max}" value="${L.seconds.def}" required></label>
          <label class="field"><span class="lbl">Format</span><span class="sel"><select name="format">${s.formats.map((f) => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join('')}</select>${icon('down')}</span></label>
        </div>
        <label class="field"><span class="lbl">Style</span><span class="sel"><select name="style">${s.styles.map((f) => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join('')}</select>${icon('down')}</span></label>
        <label class="check"><input type="checkbox" name="voice" data-promo-voice-toggle><span>Ajouter une voix</span></label>
        <div class="promo-voice" data-promo-voice hidden>
          <div class="grid2">
            <label class="field"><span class="lbl">Fournisseur</span><span class="sel"><select name="voiceProvider">${s.voices.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}</select>${icon('down')}</span></label>
            <label class="field"><span class="lbl">Voix</span><span class="sel"><select name="voiceName">${voiceOptions(s.voices[0])}</select>${icon('down')}</span></label>
          </div>
          <p class="muted small" data-promo-local hidden role="status"></p>
          <label class="field" data-promo-lang hidden><span class="lbl">Langue</span><span class="sel"><select name="voiceLang">${s.voiceLangs.map((l) => `<option value="${esc(l.id)}">${esc(l.label)}</option>`).join('')}</select>${icon('down')}</span></label>
          <div class="promo-key" data-promo-key hidden data-can="${s.canManageKeys ? '1' : ''}">
            <p class="muted small" data-promo-key-help></p>
            <div class="row" data-promo-key-new><input type="password" name="voiceKey" placeholder="Colle ta clé API" autocomplete="off" spellcheck="false" aria-label="Clé API du fournisseur"><input type="text" name="voiceRegion" data-promo-region placeholder="Région (ex. francecentral)" autocomplete="off" spellcheck="false" aria-label="Région de la ressource Microsoft Azure" hidden><button type="button" class="btn small" data-promo-key-save>Enregistrer la clé</button></div>
            <div class="row" data-promo-key-set><span class="hint" data-promo-key-last4></span><button type="button" class="btn small" data-promo-key-remove>Retirer la clé</button></div>
          </div>
          <div class="row"><button type="button" class="btn small" data-promo-sample>${icon('play')}Écouter un extrait</button><span class="hint" data-promo-sample-state role="status"></span></div>
          <audio data-promo-audio preload="none"></audio>
          <p class="muted small">La voix lit un texte écrit par Claude, dans la langue de la voix choisie. Ce texte est envoyé au fournisseur pour être lu. Google Traduction est gratuit et sans clé, mais non officiel (il peut changer ou refuser des demandes) et sa voix est simple. Piper et eSpeak NG sont des voix locales, gratuites, sans clé : elles tournent sur le serveur (rien n'en sort) si l'administrateur les a installées ; Piper est bien plus naturelle. ElevenLabs, Google Cloud et Microsoft Azure donnent des voix bien plus naturelles avec ta propre clé API (quota gratuit mensuel du fournisseur) ; ta clé est chiffrée et jamais réaffichée.</p>
        </div>
        <p class="hint" data-promo-count></p>
        <div class="row"><button class="btn primary" data-promo-go>${icon('film')}Générer la vidéo</button></div>
      </form>
      <p class="muted small">Claude écrit la scène, elle est ensuite dessinée image par image sur le serveur : compte quelques minutes selon la durée et le nombre d'images par seconde. Les consignes se modifient dans les Réglages (« Vidéo de promotion »).</p>`
      : '<p class="muted">Analyse d\'abord le projet : Claude s\'appuie sur sa fiche pour concevoir la vidéo.</p>';
    voiceCatalogs.set(box, s.voices);
    box.innerHTML = `${form}${s.videos.length ? `<div class="pv-list">${s.videos.map((v) => promoVideoCard(v, s, id)).join('')}</div>` : (s.hasProfile ? '<p class="muted small">Aucune vidéo pour l\'instant.</p>' : '')}`;
    promoCount(box);
    const pf = $('[data-promo-form]', box);
    if (pf) voiceSync(pf);
  }

  // Nombre d'images à produire, et message clair si la limite est dépassée (le serveur la contrôle aussi)
  const voiceOptions = (p) => (p?.voices ? p.voices.map((v) => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join('') : '<option value="">—</option>');
  function promoCount(box) {
    const f = $('[data-promo-form]', box);
    if (!f) return;
    const fps = Number(f.fps.value), sec = Number(f.seconds.value), n = fps * sec, max = Number(f.dataset.maxFrames);
    const out = $('[data-promo-count]', f);
    const bad = !Number.isFinite(n) || n > max;
    out.textContent = bad ? `Trop d'images (${n || 0}) : le maximum est ${max} (images par seconde × durée). Réduis la durée ou le nombre d'images par seconde.` : `${n} images à produire.`;
    out.classList.toggle('error', bad);
    $('[data-promo-go]', f).disabled = bad;
  }

  // Voix : la case montre les choix ; le fournisseur change la liste des voix (et demande une clé pour ElevenLabs et Google Cloud) ; l'extrait se lit depuis le serveur
  const voiceCatalogs = new WeakMap();
  const voiceProvider = (f) => voiceCatalogs.get(f.closest('[data-promo]'))?.find((p) => p.id === f.voiceProvider.value);
  function voiceSync(f) {
    const p = voiceProvider(f);
    if (!p) return;
    $('[data-promo-lang]', f).hidden = !p.multilingual;
    const local = $('[data-promo-local]', f);
    local.hidden = !(p.local && !p.available);
    local.textContent = p.unavailable || '';
    const key = $('[data-promo-key]', f);
    key.hidden = !p.keyed;
    if (p.keyed) {
      $('[data-promo-key-help]', f).textContent = p.keyHelp || '';
      $('[data-promo-key-new]', f).hidden = !!p.keyLast4 || !key.dataset.can;
      $('[data-promo-key-set]', f).hidden = !p.keyLast4;
      $('[data-promo-region]', f).hidden = !p.needsRegion;
      $('[data-promo-key-last4]', f).textContent = p.keyLast4 ? `Clé enregistrée (se termine par ${p.keyLast4})${p.region ? ` · région ${p.region}` : ''}` : '';
      if (!key.dataset.can && !p.keyLast4) $('[data-promo-key-help]', f).textContent = 'Seul le propriétaire du projet peut enregistrer la clé de ce fournisseur.';
      $('[data-promo-key-remove]', f).hidden = !key.dataset.can;
    }
    f.voiceName.innerHTML = voiceOptions(p);
    $('[data-promo-sample]', f).disabled = !f.voiceName.value;
  }
  async function voiceLoad(f) {
    const p = voiceProvider(f);
    voiceSync(f);
    if (!p?.keyed || !p.keyLast4 || p.voices) return;
    const state = $('[data-promo-sample-state]', f);
    state.textContent = 'Chargement des voix…';
    try { p.voices = (await api(`/api/promo/voices?provider=${encodeURIComponent(p.id)}`)).voices; state.textContent = ''; } catch (err) { state.textContent = err.message; }
    if (voiceProvider(f) === p) voiceSync(f);
  }
  listen(document, 'change', (e) => {
    const f = e.target.closest('[data-promo-form]');
    if (!f) return;
    if (e.target.matches('[data-promo-voice-toggle]')) $('[data-promo-voice]', f).hidden = !e.target.checked;
    if (e.target.name === 'voiceProvider') voiceLoad(f);
  });
  async function saveVoiceKey(f) {
    const p = voiceProvider(f);
    const input = f.voiceKey;
    const state = $('[data-promo-sample-state]', f);
    const btn = $('[data-promo-key-save]', f);
    btn.disabled = true;
    state.textContent = 'Vérification de la clé…';
    try {
      const r = await api('/api/promo/voice-key', { provider: p.id, key: input.value, region: f.voiceRegion.value });
      input.value = '';
      p.keyLast4 = r.keyLast4;
      p.region = r.region;
      p.voices = r.voices;
      state.textContent = 'Clé enregistrée';
      voiceSync(f);
    } catch (err) { state.textContent = err.message; } finally { btn.disabled = false; }
  }
  listen(document, 'keydown', (e) => { if (e.key === 'Enter' && (e.target.name === 'voiceKey' || e.target.name === 'voiceRegion')) { e.preventDefault(); const f = e.target.closest('[data-promo-form]'); if (f) saveVoiceKey(f); } });
  listen(document, 'click', async (e) => {
    const f = e.target.closest('[data-promo-form]');
    if (!f) return;
    if (e.target.closest('[data-promo-key-save]')) return saveVoiceKey(f);
    if (e.target.closest('[data-promo-key-remove]')) {
      const p = voiceProvider(f);
      if (!confirm(`Retirer la clé ${p.label.split(' (')[0]} ? Il faudra la coller de nouveau pour reprendre ses voix.`)) return;
      try { await api('/api/promo/voice-key/delete', { provider: p.id }); p.keyLast4 = null; p.region = null; p.voices = null; voiceSync(f); } catch (err) { $('[data-promo-sample-state]', f).textContent = err.message; }
      return;
    }
    const b = e.target.closest('[data-promo-sample]');
    if (!b) return;
    const state = $('[data-promo-sample-state]', f);
    const url = `/api/promo/voice-sample?provider=${encodeURIComponent(f.voiceProvider.value)}&voice=${encodeURIComponent(f.voiceName.value)}&lang=${encodeURIComponent(f.voiceLang.value)}`;
    b.disabled = true;
    state.textContent = 'Chargement de l\'extrait…';
    try {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Extrait indisponible');
      const audio = $('[data-promo-audio]', f);
      audio.src = url;
      await audio.play();
      state.textContent = 'Lecture…';
      audio.onended = () => { state.textContent = ''; };
    } catch (err) { state.textContent = err.message; } finally { b.disabled = false; }
  });
  listen(document, 'input', (e) => { const b = e.target.closest('[data-promo-form]'); if (b) promoCount(b.closest('[data-promo]')); });
  listen(document, 'submit', async (e) => {
    const f = e.target.closest('[data-promo-form]');
    if (!f) return;
    e.preventDefault();
    const proj = f.closest('.project');
    const btn = $('[data-promo-go]', f);
    if (f.voice.checked) {
      const vp = voiceProvider(f);
      if (vp?.keyed && !vp.keyLast4) return toast(`Ajoute d'abord ta clé API ${vp.label.split(' (')[0]}, ou choisis un autre fournisseur`, 'error');
      if (vp?.local && !vp.available) return toast(vp.unavailable, 'error');
      if (!f.voiceName.value) return toast('Choisis une voix', 'error');
    }
    btn.disabled = true;
    try {
      const r = await api(`/api/projects/${proj.dataset.id}/promo/generate`, { subject: f.subject.value, fps: Number(f.fps.value), seconds: Number(f.seconds.value), format: f.format.value, style: f.style.value, voice: f.voice.checked, voiceProvider: f.voiceProvider.value, voiceName: f.voiceName.value, voiceLang: f.voiceLang.value });
      toast(r.budgetBlocked ? `En file, mais ${r.budgetBlocked}` : r.existing ? 'Une vidéo est déjà en cours de production' : 'Claude conçoit la vidéo…', r.budgetBlocked ? 'error' : 'ok');
      refreshProject(proj);
    } catch (err) { toast(err.message, 'error'); }
    promoCount(f.closest('[data-promo]'));
  });
  listen(document, 'click', async (e) => {
    const t = e.target.closest('[data-pv-delete]');
    if (!t) return;
    if (!confirm('Supprimer cette vidéo ? Le fichier sera effacé.')) return;
    try {
      await api(`/api/projects/${t.dataset.id}/promo/${t.dataset.pvDelete}/delete`, {});
      loadPromo(t.closest('.project'));
    } catch (err) { toast(err.message, 'error'); }
  });
  $$('details[data-acc="promo"]').forEach((d) => d.addEventListener('toggle', () => { if (d.open) loadPromo(d.closest('.project')); }));

  // Retour de LinkedIn : message, puis on rouvre le projet concerné
  (() => {
    const q = new URLSearchParams(location.search);
    if (!q.has('li')) return;
    history.replaceState(null, '', location.pathname);
    if (q.get('li') === 'ok') toast('Compte LinkedIn relié au projet');
    else toast(q.get('m') || 'Connexion LinkedIn impossible', 'error');
    const proj = $(`details.project[data-id="${q.get('p')}"]`);
    if (proj) { proj.open = true; const acc = $('details[data-acc="linkedin"]', proj); if (acc) { acc.open = true; loadLinkedin(proj); } }
  })();

  window.AiTools.loadPromo = loadPromo;
})();
