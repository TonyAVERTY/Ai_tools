// Page « Relier mon IA » : les trois cartes (un clic ouvre les options de connexion de l'IA choisie) et la connexion guidée ChatGPT.
// Chargé après app.js, qui expose ses outils communs dans window.AiTools ; ajax.js relance ce script à chaque navigation.
(() => {
  const { $, $$, api, every, go } = window.AiTools;

  // ---------- Cartes ----------
  const cards = $$('[data-ai-card]');
  const panels = $$('[data-ai-panel]');
  function choose(id) {
    cards.forEach((c) => { const on = c.dataset.aiCard === id; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
    panels.forEach((p) => { p.hidden = p.dataset.aiPanel !== id; });
    const hint = $('.ai-pick');
    if (hint) hint.hidden = true;
    try { history.replaceState(history.state, '', `/link?ia=${id}`); } catch { /* adresse non modifiable : sans importance */ }
  }
  cards.forEach((c) => c.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return; // « ouvrir dans un nouvel onglet » garde son sens (la page sait ouvrir ?ia=)
    e.preventDefault();
    choose(c.dataset.aiCard);
  }));

  // ---------- Connexion guidée Google ----------
  // 1) le serveur donne le lien de Google, 2) l'utilisateur se connecte et recopie le code que Google affiche : le CLI n'attend que 60 secondes, la page
  // affiche le compte à rebours, 3) le code est transmis, la connexion est vérifiée (appel minimal) puis rangée : la page se recharge.
  // Passé le délai, « Nouveau lien » repart de zéro. Fermer la fenêtre annule la connexion en cours.
  (() => {
    const first = $('form[data-google-login]');
    if (!first) return;
    const dlg = first.closest('dialog');
    const second = $('form[data-google-step2]', dlg);
    let id = null;
    let left = 0;
    let ticker = null;
    const stop = () => { if (ticker) clearInterval(ticker); ticker = null; };
    const showErr = (form, sel, message) => { const p = $(sel, dlg); p.textContent = message; p.hidden = false; };
    const busy = (btn, on, label) => {
      if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
      const l = $('[data-label]', btn); if (l) l.textContent = label;
      btn.disabled = on;
    };
    const reset = () => {
      stop(); id = null;
      first.hidden = false; second.hidden = true;
      second.reset(); $('[data-google-error2]', dlg).hidden = true; $('[data-google-again]', dlg).hidden = true;
      const go1 = $('button:not([type=button])', first); busy(go1, false, 'Continuer'); go1.disabled = !$('[data-consent]', first).checked;
    };
    const render = () => {
      const t = $('[data-google-timer]', dlg);
      if (left > 0) { t.textContent = `Il te reste ${left} seconde${left > 1 ? 's' : ''} pour coller le code.`; return; }
      stop();
      t.textContent = 'Le délai de Google est passé : clique sur « Nouveau lien ».';
      $('[data-google-send]', dlg).disabled = true;
      $('[data-google-again]', dlg).hidden = false;
    };
    const tick = () => { left -= 1; render(); };
    async function begin() {
      $('[data-google-error]', dlg).hidden = true;
      const go1 = $('button:not([type=button])', first);
      busy(go1, true, 'Je prépare ton lien…');
      $('[data-google-status]', first).textContent = 'Ça prend quelques secondes.';
      try {
        const r = await api('/link/google/login', { accept: 'on' });
        id = r.id;
        $('[data-google-link]', dlg).href = r.url;
        first.hidden = true; second.hidden = false;
        $('[data-google-again]', dlg).hidden = true; $('[data-google-error2]', dlg).hidden = true;
        busy($('[data-google-send]', dlg), false, 'Valider le code');
        left = r.expiresIn; render();
        stop(); ticker = every(tick, 1000);
        $('input[name=code]', second).focus();
      } catch (err) { showErr(first, '[data-google-error]', err.message); busy(go1, false, 'Continuer'); }
      $('[data-google-status]', first).textContent = '';
    }
    first.addEventListener('submit', (e) => { e.preventDefault(); begin(); });
    $('[data-google-again]', dlg).addEventListener('click', async () => {
      const old = id; stop(); id = null;
      if (old) api('/link/google/login/cancel', { id: old }).catch(() => {});
      second.hidden = true; first.hidden = false;
      await begin();
    });
    second.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!id) return;
      $('[data-google-error2]', dlg).hidden = true;
      const btn = $('[data-google-send]', dlg);
      stop();
      busy(btn, true, 'Je vérifie ton code…');
      $('[data-google-timer]', dlg).textContent = 'Vérification en cours : ça peut prendre une minute.';
      try {
        await api('/link/google/login/code', { id, code: $('input[name=code]', second).value });
        id = null;
        go('/');
      } catch (err) {
        id = null;
        showErr(second, '[data-google-error2]', err.message);
        $('[data-google-timer]', dlg).textContent = '';
        busy(btn, false, 'Valider le code'); btn.disabled = true;
        $('[data-google-again]', dlg).hidden = false;
      }
    });
    dlg.addEventListener('close', () => {
      if (id) api('/link/google/login/cancel', { id }).catch(() => {});
      reset();
      first.reset();
      $('[data-google-error]', dlg).hidden = true;
      $('button:not([type=button])', first).disabled = true;
    });
  })();

  // ---------- Connexion guidée ChatGPT ----------
  // 1) le serveur prépare le lien et le code (petit chargement), 2) l'utilisateur valide sur chatgpt.com : le serveur attend et la page
  // interroge son état toutes les 2 secondes, 3) connexion rangée : la page se recharge. Fermer la fenêtre annule la connexion en cours.
  const form = $('form[data-chatgpt-login]');
  if (!form) return;
  const dlg = form.closest('dialog');
  const step2 = $('[data-chatgpt-step2]', dlg);
  let loginId = null;
  let polling = false;
  let stopPoll = null;

  const busy = (on, label) => {
    const btn = $('button:not([type=button])', form);
    if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy'); // l'indicateur est affiché par le CSS (.btn[aria-busy])
    $('[data-label]', btn).textContent = label;
    btn.disabled = on || !$('[data-consent]', form).checked;
  };
  const fail = (message) => { const p = $('[data-chatgpt-error]', dlg); p.textContent = message; p.hidden = false; };
  const reset = () => {
    if (stopPoll) stopPoll();
    stopPoll = null; polling = false; loginId = null;
    form.hidden = false; step2.hidden = true; busy(false, 'Continuer');
  };

  async function poll() {
    if (polling || !loginId) return;
    polling = true;
    try {
      const r = await api(`/link/chatgpt/login/status?id=${encodeURIComponent(loginId)}`); // lecture seule, limite à part
      if (r.state === 'ready') {
        // Validée sur chatgpt.com : une seule requête enregistre la connexion (vérifiée par un appel minimal à Codex)
        if (stopPoll) stopPoll();
        $('[data-chatgpt-wait]', dlg).textContent = 'Connexion validée : je l\'enregistre…';
        await api('/link/chatgpt/login/finish', { id: loginId });
        loginId = null;
        go('/');
        return;
      }
      if (r.state === 'failed') { reset(); fail(r.message); }
    } catch (err) {
      // Connexion expirée ou refusée à la vérification : on repart du début avec le message du serveur
      reset(); fail(err.message);
    } finally { polling = false; }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('[data-chatgpt-error]', dlg).hidden = true;
    busy(true, 'Je prépare ton lien…');
    $('[data-chatgpt-status]', form).textContent = 'Ça prend quelques secondes.';
    try {
      const r = await api('/link/chatgpt/login', { accept: 'on' });
      loginId = r.id;
      $('[data-chatgpt-link]', dlg).href = r.url;
      $('[data-chatgpt-code]', dlg).textContent = r.code;
      form.hidden = true;
      step2.hidden = false;
      const timer = every(poll, 2000); // `every` renvoie l'identifiant du minuteur (nettoyé aussi à la prochaine navigation)
      stopPoll = () => clearInterval(timer);
    } catch (err) {
      fail(err.message);
      busy(false, 'Continuer');
    }
    $('[data-chatgpt-status]', form).textContent = '';
  });

  dlg.addEventListener('close', () => {
    if (loginId) api('/link/chatgpt/login/cancel', { id: loginId }).catch(() => {});
    reset();
    form.reset();
    $('[data-chatgpt-error]', dlg).hidden = true;
    $('button:not([type=button])', form).disabled = true;
  });
})();
