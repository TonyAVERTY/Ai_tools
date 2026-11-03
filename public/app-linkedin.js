// LinkedIn d'un projet : relier un compte, donner une direction, générer / régénérer un post, le relire et le publier.
// Chargé après app.js, qui expose ses outils communs dans window.AiTools ; ajax.js relance ce script à chaque navigation, comme app.js.
(() => {
  const { $, $$, api, confirmBox, esc, liDay, listen, refreshProject, toast } = window.AiTools;

  // ---------- LinkedIn ----------
  // Section d'un projet : relier un compte, donner une direction (facultative), générer / régénérer un post, le relire et le publier.

  async function loadLinkedin(proj) {
    const box = $('[data-linkedin]', proj);
    if (!box) return;
    try { renderLinkedin(box, await api(`/api/projects/${proj.dataset.id}/linkedin`), proj.dataset.id); }
    catch (e) { box.innerHTML = `<p class="error small">${esc(e.message)}</p>`; }
  }

  function renderLinkedin(box, s, id) {
    // Ne pas écraser ce que l'utilisateur est en train d'écrire
    if (box.contains(document.activeElement) && document.activeElement.matches('textarea')) return;
    if (!s.configured) {
      box.innerHTML = '<p class="muted">LinkedIn n\'est pas activé sur ce service : l\'administrateur doit renseigner les clés de l\'application LinkedIn.</p>';
      return;
    }
    const acc = s.account;
    if (!acc) {
      box.innerHTML = `<p>Relie un compte LinkedIn à ce projet : Claude pourra écrire des posts pour ce compte. AiTools demande seulement le droit de <strong>publier un post ${s.pagesEnabled ? 'sur ton profil ou sur une page que tu administres' : 'sur ton profil'}</strong>, et ne publie jamais sans ton clic.</p>
        ${s.canManage ? `<p><a class="btn primary" href="/linkedin/connect?project=${id}">Connecter LinkedIn</a></p>` : '<p class="muted small">Demande à un administrateur du projet de relier le compte.</p>'}`;
      return;
    }
    const head = `<div class="row li-head"><p><span class="badge ${acc.expired ? 'warn' : 'ok'}">${acc.expired ? 'connexion expirée' : 'connecté'}</span> <strong>${esc(acc.name)}</strong>
        ${acc.expiresAt ? `<span class="muted small">· ${acc.expired ? 'a expiré' : 'valable'} jusqu'au ${esc(liDay(acc.expiresAt))}</span>` : ''}</p>
      ${s.canManage ? `<span>${acc.expired ? `<a class="btn small primary" href="/linkedin/connect?project=${id}">Reconnecter</a> ` : ''}<button type="button" class="btn small danger" data-li-disconnect="${id}">Déconnecter</button></span>` : ''}</div>`;
    // Où partent les posts : une page choisie, sinon le profil. La liste des pages n'est demandée à LinkedIn qu'au clic sur « Changer ».
    const where = acc.target ? acc.target.name : acc.canPersonal ? 'ton profil' : null;
    let targetHtml = '';
    if (s.pagesEnabled && !acc.expired) {
      targetHtml = !acc.canPages
        ? `<p class="muted small">Pour publier sur une page, ${s.canManage ? `<a href="/linkedin/connect?project=${id}">reconnecte LinkedIn</a> (nouvelle autorisation)` : 'un administrateur du projet doit reconnecter LinkedIn'}.</p>`
        : `<div class="li-target" data-li-target-box><p>Publier sur : <strong>${where ? esc(where) : 'aucune page choisie'}</strong>
            ${s.canManage ? `<button type="button" class="btn small" data-li-pages="${id}">${where ? 'Changer' : 'Choisir une page'}</button>` : ''}</p>
            ${where ? '' : '<p class="warn small">Choisis la page où publier : ce compte ne peut pas publier sur ton profil.</p>'}
            <div data-li-pages-list></div></div>`;
    } else if (!s.pagesEnabled && s.canManage) {
      targetHtml = '<p class="muted small">Les posts partent sur ton profil. Publier sur une page demande l\'accès « Community Management API » côté application LinkedIn.</p>';
    }
    const posts = s.posts || [];
    const latest = posts[0];
    const draft = latest && latest.status !== 'published' ? latest : null;
    const direction = latest?.direction || '';
    const gen = !s.hasProfile ? '<p class="muted small">Analyse le projet d\'abord : Claude s\'appuie sur la fiche projet.</p>' : acc.expired ? '' : `<div class="li-gen">
        <label>De quoi doit parler le post ? <span class="muted small">(facultatif)</span>
          <textarea name="direction" rows="3" maxlength="500" data-li-direction placeholder="Ex. : le lancement de la nouvelle offre, un retour d'expérience, un conseil pour mes clients… Laisse vide : Claude choisit le sujet.">${esc(direction)}</textarea></label>
        <button type="button" class="btn primary" data-li-generate="${id}">${draft ? 'Régénérer un autre post' : 'Générer un post'}</button></div>`;
    const liWhen = (ts) => new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' });
    const scheduled = draft?.status === 'scheduled';
    const publishBtn = s.canManage && !acc.expired
      ? `<button type="button" class="btn${scheduled ? '' : ' primary'}" data-li-publish="${id}" data-where="${esc(where || 'LinkedIn')}"${where ? '' : ' disabled'}>${scheduled ? 'Publier maintenant' : `Publier sur ${esc(acc.target ? acc.target.name : 'LinkedIn')}`}</button>` : '<span class="muted small">Un administrateur du projet publie.</span>';
    const scheduleBox = !draft || scheduled || !s.canManage || acc.expired ? '' : `<div class="li-schedule"><label>Programmer la publication
          <input type="datetime-local" data-li-when></label>
        <button type="button" class="btn" data-li-schedule="${id}"${where ? '' : ' disabled'}>Programmer</button></div>`;
    const draftHtml = draft ? `<div class="li-draft"><label>${scheduled ? 'Post programmé (annule la programmation pour le modifier)' : 'Brouillon (modifiable)'}
        <textarea rows="11" maxlength="${s.maxLength}" data-li-body="${draft.id}"${scheduled ? ' readonly' : ''}>${esc(draft.body)}</textarea></label>
        <p class="muted small"><span data-li-count>${draft.body.length}</span> / ${s.maxLength} caractères${draft.direction ? ` · direction : « ${esc(draft.direction)} »` : ' · sujet choisi par Claude'}</p>
        ${scheduled ? `<p class="ok small">Programmé : ${esc(liWhen(draft.scheduledAt))} (heure de Paris). Il part tout seul, dans les 15 minutes qui suivent l'heure choisie.</p>` : ''}
        ${draft.scheduleError ? `<p class="error small">La dernière publication programmée a échoué : ${esc(draft.scheduleError)}</p>` : ''}
        <div class="row-actions">${scheduled ? `<button type="button" class="btn" data-li-unschedule="${id}">Annuler la programmation</button>` : `<button type="button" class="btn" data-li-save="${id}">Enregistrer</button>`}
          <button type="button" class="btn" data-li-copy>Copier</button>
          ${publishBtn}</div>${scheduleBox}</div>` : '';
    const history = posts.filter((x) => x !== draft && x.status === 'published');
    const hist = history.length ? `<details class="li-history"><summary>Posts publiés (${history.length})</summary>${history.map((x) => `<article class="card"><p class="muted small">Publié le ${esc(liDay(x.publishedAt))}${x.publishedOn ? ` sur ${esc(x.publishedOn)}` : ''}</p><p class="li-text">${esc(x.body)}</p></article>`).join('')}</details>` : '';
    box.innerHTML = `${head}${targetHtml}${gen}${draftHtml}${hist}`;
  }

  listen(document, 'click', async (e) => {
    const t = e.target.closest('[data-li-generate],[data-li-save],[data-li-copy],[data-li-publish],[data-li-schedule],[data-li-unschedule],[data-li-disconnect],[data-li-pages],[data-li-target-save],[data-li-pages-refresh]');
    if (!t) return;
    const proj = t.closest('.project');
    const id = proj?.dataset.id;
    const body = () => $('[data-li-body]', proj);
    try {
      if (t.matches('[data-li-generate]')) {
        t.disabled = true;
        const r = await api(`/api/projects/${id}/linkedin/generate`, { direction: $('[data-li-direction]', proj)?.value || '' });
        toast(r.budgetBlocked ? `En file, mais ${r.budgetBlocked}` : r.existing ? 'Un post est déjà en cours de rédaction' : 'Claude rédige le post…', r.budgetBlocked ? 'error' : 'ok');
        refreshProject(proj);
      } else if (t.matches('[data-li-save]')) {
        await api(`/api/projects/${id}/linkedin/post`, { postId: Number(body().dataset.liBody), body: body().value });
        toast('Brouillon enregistré');
      } else if (t.matches('[data-li-copy]')) {
        await navigator.clipboard.writeText(body().value);
        toast('Post copié');
      } else if (t.matches('[data-li-schedule]')) {
        const when = $('[data-li-when]', proj).value;
        if (!when) { toast('Choisis la date et l\'heure de publication', 'error'); return; }
        const at = Math.floor(new Date(when).getTime() / 1000); // l'heure saisie est celle de ton navigateur
        if (!(await confirmBox(`Programmer la publication le ${new Date(at * 1000).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })} ?\nLe post sera publié automatiquement et sera visible publiquement par tout le monde.`, { confirm: 'Programmer' }))) return;
        t.disabled = true;
        await api(`/api/projects/${id}/linkedin/schedule`, { postId: Number(body().dataset.liBody), body: body().value, at, confirm: true });
        toast('Publication programmée');
        loadLinkedin(proj);
      } else if (t.matches('[data-li-unschedule]')) {
        t.disabled = true;
        await api(`/api/projects/${id}/linkedin/unschedule`, { postId: Number(body().dataset.liBody) });
        toast('Programmation annulée');
        loadLinkedin(proj);
      } else if (t.matches('[data-li-publish]')) {
        if (!(await confirmBox(`Publier ce post sur ${t.dataset.where || 'LinkedIn'} ?\nIl sera visible publiquement par tout le monde.`, { confirm: 'Publier' }))) return;
        t.disabled = true;
        await api(`/api/projects/${id}/linkedin/publish`, { postId: Number(body().dataset.liBody), body: body().value, confirm: true });
        toast('Post publié sur LinkedIn');
        loadLinkedin(proj);
      } else if (t.matches('[data-li-pages],[data-li-pages-refresh]')) {
        // Les pages que ce compte administre, relues chez LinkedIn (en cache côté serveur ; « Actualiser » force un nouvel appel)
        const refresh = t.matches('[data-li-pages-refresh]');
        const list = $('[data-li-pages-list]', proj);
        t.disabled = true;
        const r = await api(`/api/projects/${id}/linkedin/pages${refresh ? '?refresh=1' : ''}`);
        const options = r.pages.map((p) => `<option value="${esc(p.urn)}"${r.target?.urn === p.urn ? ' selected' : ''}>${esc(p.name)}</option>`);
        list.innerHTML = r.pages.length
          ? `<label>Où publier ?<select data-li-target-select>
              <option value="me"${r.target ? '' : ' selected'}>Mon profil</option>${options.join('')}</select></label>
            <div class="row-actions"><button type="button" class="btn small primary" data-li-target-save="${id}">Choisir</button>
              <button type="button" class="btn small" data-li-pages-refresh="${id}">Actualiser la liste</button></div>`
          : `<p class="warn small">LinkedIn ne montre aucune page administrée par ce compte.</p>
            <div class="row-actions"><button type="button" class="btn small" data-li-pages-refresh="${id}">Actualiser la liste</button></div>`;
        t.disabled = false;
      } else if (t.matches('[data-li-target-save]')) {
        const urn = $('[data-li-target-select]', proj).value;
        t.disabled = true;
        const r = await api(`/api/projects/${id}/linkedin/target`, { urn });
        toast(r.target ? `Les posts partiront sur ${r.target.name}` : 'Les posts partiront sur ton profil');
        loadLinkedin(proj);
      } else if (t.matches('[data-li-disconnect]')) {
        if (!(await confirmBox('Déconnecter le compte LinkedIn de ce projet ?\nLes brouillons sont conservés.'))) return;
        await api(`/api/projects/${id}/linkedin/disconnect`, {});
        loadLinkedin(proj);
      }
    } catch (err) { toast(err.message, 'error'); t.disabled = false; }
  });
  listen(document, 'input', (e) => {
    const area = e.target.closest('[data-li-body]');
    if (area) $('[data-li-count]', area.closest('.project')).textContent = area.value.length;
  });
  $$('details[data-acc="linkedin"]').forEach((d) => d.addEventListener('toggle', () => { if (d.open) loadLinkedin(d.closest('.project')); }));

  window.AiTools.loadLinkedin = loadLinkedin;
})();
