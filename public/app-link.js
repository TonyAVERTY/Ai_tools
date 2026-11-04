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
      const r = await api('/link/chatgpt/login/status', { id: loginId });
      if (r.state === 'done') { loginId = null; if (stopPoll) stopPoll(); go('/'); return; }
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
