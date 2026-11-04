// Récapitulatif : choix des tables de la base du projet, sans écrire de SQL. « Se connecter et analyser » demande au serveur de lire la structure de la base
// (lecture seule) ; les listes se remplissent avec les vraies tables, la bonne est présélectionnée et marquée « (recommandé) », et un aperçu chiffré s'affiche.
// Changer une liste relance l'aperçu. Chargé après app.js (outils communs dans window.AiTools) ; ajax.js relance ce script à chaque navigation.
(() => {
  const { $, $$, api, listen } = window.AiTools;
  const nf = new Intl.NumberFormat('fr-FR');
  const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  const loaded = new WeakSet(); // formulaires dont les listes viennent d'être remplies par une analyse
  const timers = new WeakMap();

  const field = (form, name) => form.elements[name];
  const connection = (form) => ({
    type: field(form, 'type').value, host: field(form, 'host').value, port: field(form, 'port').value, database: field(form, 'database').value,
    user: field(form, 'user').value, password: field(form, 'password').value, ssl: field(form, 'ssl').checked,
  });
  const choice = (form) => Object.fromEntries(['users_table', 'clients_table', 'revenue_table', 'revenue_column', 'revenue_unit'].map((n) => [n, field(form, n)?.value || '']));

  /** Une liste de tables : « Ne pas suivre », puis la table recommandée en premier (« recommandé »), puis les autres. */
  function fillTables(sel, tables, value, recommended) {
    sel.replaceChildren(new Option('Ne pas suivre', ''));
    const ordered = [...tables].sort((a, b) => (b.key === recommended) - (a.key === recommended));
    for (const t of ordered) sel.append(new Option(`${t.name}${t.key === recommended ? ' (recommandé)' : ''} · ${t.rows > 0 ? `~${nf.format(t.rows)} lignes` : 'vide'}`, t.key));
    sel.value = value || '';
  }

  function show(form, r) {
    const k = r.kpi || {};
    fillTables(field(form, 'users_table'), r.tables, k.users?.table, r.recommended.users);
    fillTables(field(form, 'clients_table'), r.tables, k.clients?.table, r.recommended.clients);
    fillTables(field(form, 'revenue_table'), r.tables, k.revenue?.table, r.recommended.revenue);
    const rev = $('[data-bdd-rev]', form);
    rev.hidden = !k.revenue;
    if (k.revenue) {
      const cols = r.tables.find((t) => t.key === k.revenue.table)?.numeric || [k.revenue.amountColumn];
      const sel = field(form, 'revenue_column');
      sel.replaceChildren(...cols.map((c) => new Option(c, c)));
      sel.value = k.revenue.amountColumn;
      field(form, 'revenue_unit').value = k.revenue.cents ? 'cents' : 'euros';
    }
    for (const name of ['users', 'clients', 'revenue']) $(`[data-bdd-rule="${name}"]`, form).textContent = r.rules[name] || '';
    const p = r.preview || {};
    const part = (v, f) => (v === null || v === undefined ? 'indisponible' : f(v));
    const bits = [];
    if (k.users) bits.push(`${part(p.users, (v) => nf.format(v))} utilisateurs`);
    if (k.clients) bits.push(`${part(p.clients, (v) => nf.format(v))} clients payants`);
    if (k.revenue) bits.push(`${part(p.revenue, (v) => eur.format(v))} de revenu`);
    $('[data-bdd-preview]', form).textContent = bits.length ? `Aperçu : ${bits.join(' · ')}` : 'Rien n\'est suivi : le récapitulatif n\'affichera pas ces chiffres.';
  }

  const say = (form, text, bad = false) => { const s = $('[data-bdd-state]', form); s.textContent = text; s.classList.toggle('error', bad); };

  /** Interroge le serveur : sans choix, il propose ; avec un choix, il chiffre cette sélection. */
  async function analyze(form, withChoice) {
    say(form, 'Connexion à la base et analyse des tables…');
    try {
      const r = await api(`/api/projects/${form.dataset.id}/db/analyze`, { ...connection(form), ...(withChoice ? choice(form) : {}) });
      loaded.add(form);
      show(form, r);
      say(form, r.suggested ? `${r.tables.length} table${r.tables.length > 1 ? 's' : ''} trouvée${r.tables.length > 1 ? 's' : ''}. Les tables recommandées sont présélectionnées : vérifie, puis enregistre.` : '');
    } catch (err) { say(form, err.message, true); }
  }

  listen(document, 'click', (e) => {
    const b = e.target.closest('[data-bdd-analyze]');
    if (b) analyze(b.closest('form'), false);
  });
  listen(document, 'change', (e) => {
    const sel = e.target.closest('[data-bdd-sel]');
    const form = sel?.closest('form[data-action="db"]');
    if (!form) return;
    if (sel.name === 'revenue_table') { field(form, 'revenue_column').replaceChildren(); $('[data-bdd-rev]', form).hidden = !sel.value; }
    if (!loaded.has(form)) return; // pas encore analysé : les listes ne contiennent que la table enregistrée
    clearTimeout(timers.get(form));
    timers.set(form, setTimeout(() => analyze(form, true), 250));
  });
})();
