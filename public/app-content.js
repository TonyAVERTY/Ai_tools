// Communication d'un projet : posts Instagram (légende, hashtags, image dessinée d'après le design du projet) et newsletters.
// Rien n'est publié ni envoyé par iaboss : on relit, on copie, on télécharge. Chargé après app.js (window.AiTools) ; ajax.js relance ce script à chaque navigation.
(() => {
  const { $, $$, aiName, api, confirmBox, esc, listen, loadFailed, refreshProject, toast } = window.AiTools;

  const picked = new Map(); // `${projet}:${type}` → brouillon affiché (sinon le plus récent)
  const day = (ts) => new Date(ts * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const base = (id, kind) => `/api/projects/${id}/content/${kind}`;

  async function loadContent(proj, kind) {
    const box = $(`[data-content="${kind}"]`, proj);
    if (!box) return;
    try { render(box, await api(base(proj.dataset.id, kind)), proj.dataset.id, kind); }
    catch (e) { loadFailed(box, e.message, () => loadContent(proj, kind)); }
  }

  const current = (s, id, kind) => s.drafts.find((d) => d.id === picked.get(`${id}:${kind}`)) || s.drafts[0] || null;

  function history(s, draft, kind) {
    const others = s.drafts.filter((d) => d !== draft);
    if (!others.length) return '';
    return `<details class="ct-history"><summary>Brouillons précédents (${others.length})</summary><ul class="ct-list">${others.map((d) => `<li>
      <span class="ct-li-t"><b>${esc(kind === 'instagram' ? (d.body.split('\n')[0] || '').slice(0, 70) : d.title)}</b><span class="muted small">${esc(day(d.createdAt))}</span></span>
      <button type="button" class="btn small" data-ct-pick="${d.id}">Reprendre</button></li>`).join('')}</ul></details>`;
  }

  function generator(s, kind, draft, id) {
    if (!s.hasProfile) return `<p class="muted small">Analyse le projet d'abord : ${esc(aiName())} s'appuie sur la fiche projet.</p>`;
    if (!s.supported) return `<p class="warn small">${esc(s.unsupportedReason || 'Cette fonction n\'est pas disponible sur ce serveur.')}</p>`;
    const formats = s.formats ? `<label class="field ct-format"><span class="lbl">Format de l'image</span><span class="sel"><select data-ct-format>${s.formats.map((f) => `<option value="${esc(f.key)}">${esc(f.label)} (${f.width} × ${f.height})</option>`).join('')}</select></span></label>` : '';
    const what = kind === 'instagram' ? 'le post' : 'la newsletter';
    const hint = kind === 'instagram'
      ? `${esc(aiName())} cherche d'abord ce qui marche dans ton secteur, lit ton dépôt pour retrouver le vrai design de ton produit (couleurs, polices, logo, écrans), dessine l'image, puis un directeur artistique la contrôle et la fait reprendre si elle n'est pas à la hauteur. Compte quelques minutes.`
      : `${esc(aiName())} rédige l'objet, l'aperçu et le texte d'après la fiche de ton projet. Rien n'est envoyé : tu relis, puis tu copies ou tu télécharges.`;
    return `<div class="ct-gen"><label class="field"><span class="lbl">De quoi doit parler ${what} ? <span class="muted small">(facultatif)</span></span>
        <textarea rows="3" maxlength="${s.limits.direction}" data-ct-direction placeholder="Ex. : une nouveauté, un conseil pour mes clients, un cas d'usage… Laisse vide : ${esc(aiName())} choisit un angle."></textarea></label>
      ${formats}
      <div class="row-actions"><button type="button" class="btn primary" data-ct-generate>${draft ? `Régénérer ${kind === 'instagram' ? 'un autre post' : 'une autre newsletter'}` : `Générer ${kind === 'instagram' ? 'un post' : 'une newsletter'}`}</button>${kind === 'instagram' ? connectInline(s, id) : ''}</div>
      ${kind === 'instagram' && s.instagram?.configured && !s.instagram.account && s.instagram.canManage ? '<p class="muted small">Compte Instagram professionnel (business ou créateur) : tu publies ensuite en post ou en story, tout de suite ou programmé.</p>' : ''}
      <p class="muted small">${hint}</p></div>`;
  }

  const parisDay = (ts) => new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' });

  // Même rangée que « Générer un post » : relier, reconnecter ou déconnecter le compte Instagram du projet
  function connectInline(s, id) {
    const ig = s.instagram;
    if (!ig?.configured) return '';
    const acc = ig.account;
    if (!acc) return ig.canManage ? `<a class="btn" href="/instagram/connect?project=${id}" data-noajax data-ig-conn>Connecter Instagram</a>` : '<span class="muted small" data-ig-conn>Demande à un administrateur du projet de relier Instagram.</span>';
    return `<span class="ig-who small" data-ig-conn><span class="badge ${acc.expired ? 'warn' : 'ok'}">${acc.expired ? 'connexion expirée' : 'connecté'}</span> <strong>@${esc(acc.username || 'compte Instagram')}</strong></span>
      ${ig.canManage ? `${acc.expired ? `<a class="btn" href="/instagram/connect?project=${id}" data-noajax>Reconnecter</a>` : ''}<button type="button" class="btn danger" data-ig-disconnect>Déconnecter</button>` : ''}`;
  }

  // Barre de connexion, toujours visible en haut de la section (même sans brouillon) : relier, reconnecter ou déconnecter le compte Instagram du projet
  function connectBar(s, id) {
    const ig = s.instagram;
    if (!ig?.configured) return '';
    const acc = ig.account;
    if (!acc) {
      return `<div class="ig-conn" data-ig-conn><span class="small"><b>Compte Instagram</b> : non connecté.</span>
        ${ig.canManage ? `<a class="btn primary" href="/instagram/connect?project=${id}" data-noajax>Connecter Instagram</a>` : '<span class="muted small">Demande à un administrateur du projet de le relier.</span>'}
        ${ig.canManage ? '<span class="muted small">Compte professionnel (business ou créateur) : tu publies ensuite en post ou en story, tout de suite ou programmé.</span>' : ''}</div>`;
    }
    return `<div class="ig-conn" data-ig-conn><span class="small"><span class="badge ${acc.expired ? 'warn' : 'ok'}">${acc.expired ? 'connexion expirée' : 'connecté'}</span> <strong>@${esc(acc.username || 'compte Instagram')}</strong></span>
      ${ig.canManage ? `${acc.expired ? `<a class="btn small primary" href="/instagram/connect?project=${id}" data-noajax>Reconnecter</a>` : ''}<button type="button" class="btn small danger" data-ig-disconnect>Déconnecter</button>` : ''}</div>`;
  }

  // Publier sur Instagram : relier le compte, puis publier tout de suite ou programmer, en post ou en story (administrateur du projet)
  function publishPanel(s, d, id) {
    const ig = s.instagram;
    if (!ig?.configured) return `<p class="muted small">iaboss ne publie pas sur Instagram sur ce service : télécharge l'image, copie la légende et publie depuis l'application Instagram.</p>`;
    const acc = ig.account;
    const where = d.publishAs === 'story' ? 'en story' : 'en post';
    if (d.status === 'published') {
      return `<div class="ig-pub" data-ig-pub><p class="ok small"><b>Publié ${where}</b> le ${esc(parisDay(d.publishedAt))}${acc ? ` sur @${esc(acc.username)}` : ''}${d.permalink ? ` · <a href="${esc(d.permalink)}" target="_blank" rel="noopener noreferrer">Voir sur Instagram</a>` : ''}</p></div>`;
    }
    if (!acc) return `<div class="ig-pub" data-ig-pub><p class="small"><b>Publier sur Instagram</b></p>${d.publishError ? `<p class="error small">${esc(d.publishError)}</p>` : ''}<p class="muted small">Connecte d'abord ton compte Instagram avec le bouton « Connecter Instagram » en haut de cette section.</p></div>`;
    const head = '';
    if (d.status === 'scheduled') {
      return `<div class="ig-pub" data-ig-pub>${head}<p class="ok small">Programmé ${where} : ${esc(parisDay(d.scheduledAt))} (heure de Paris). Il part tout seul, dans les 15 minutes qui suivent l'heure choisie.</p>
        ${ig.canManage ? '<div class="row-actions"><button type="button" class="btn" data-ig-unschedule>Annuler la programmation</button></div>' : ''}</div>`;
    }
    if (!ig.canManage) return `<div class="ig-pub" data-ig-pub>${head}<p class="muted small">Un administrateur du projet publie ou programme le post.</p></div>`;
    const defAs = (d.extra || {}).format === 'story' ? 'story' : 'post';
    return `<div class="ig-pub" data-ig-pub>${head}
      ${d.publishError ? `<p class="error small">La dernière publication a échoué : ${esc(d.publishError)}</p>` : ''}
      <label class="field ig-as"><span class="lbl">Publier en</span><span class="sel"><select data-ig-as><option value="post"${defAs === 'post' ? ' selected' : ''}>Post (avec la légende)</option><option value="story"${defAs === 'story' ? ' selected' : ''}>Story (l'image seule, sans légende)</option></select></span></label>
      <div class="row-actions"><button type="button" class="btn primary" data-ig-publish${acc.expired ? ' disabled' : ''}>Publier maintenant</button></div>
      <div class="ig-schedule"><label class="field"><span class="lbl">Ou programmer la publication</span><input type="datetime-local" data-ig-when></label>
        <button type="button" class="btn" data-ig-schedule${acc.expired ? ' disabled' : ''}>Programmer</button></div>
      <p class="muted small">Le post est public sur ton compte. Une programmation est publiée par iaboss à l'heure choisie (heure de ton navigateur), dans les 15 minutes qui suivent.</p></div>`;
  }

  function instagramDraft(s, d, id) {
    const locked = d.status !== 'draft'; // programmé ou publié : le texte ne se modifie plus
    const x = d.extra || {};
    const tags = (x.hashtags || []).join(' ');
    // Image à gauche, texte à droite (une seule colonne sur téléphone) ; le texte alternatif et l'inspiration sont repliés dans « Détails »
    return `<div class="ct-draft ct-ig-draft" data-ct-draft="${d.id}">
      ${(x.toCheck || []).length ? `<div class="ban ban-warn ct-ig-ban" role="note"><span><b>À vérifier avant de publier :</b> ${(x.toCheck).map(esc).join(' ; ')}</span></div>` : ''}
      ${d.hasImage ? `<figure class="ct-fig ct-ig-fig"><img class="ct-img" src="${base(id, 'instagram')}/${d.id}/image" width="${x.width || 1080}" height="${x.height || 1080}" alt="${esc(x.alt || 'Image du post')}">
        <figcaption class="muted small">${esc(x.format === 'portrait' ? 'Portrait 4:5' : x.format === 'story' ? 'Story 9:16' : 'Carré 1:1')} · ${x.width || 1080} × ${x.height || 1080} px${x.score ? ` · note du directeur artistique : ${x.score}/10` : ''}</figcaption></figure>` : ''}
      <div class="ct-ig-form">
        <label class="field"><span class="lbl">Légende (modifiable)</span><textarea rows="8" maxlength="${s.limits.caption}" data-ct-body${locked ? ' readonly' : ''}>${esc(d.body)}</textarea></label>
        <p class="muted small"><span data-ct-count>${d.body.length}</span> / ${s.limits.caption} caractères${d.direction ? ` · direction : « ${esc(d.direction)} »` : ` · sujet choisi par ${esc(aiName())}`}</p>
        <label class="field"><span class="lbl">Hashtags</span><input data-ct-tags value="${esc(tags)}" maxlength="600" placeholder="#exemple #secteur"${locked ? ' readonly' : ''}></label>
        <details class="ct-insp ct-more"><summary>Détails : texte alternatif${x.inspiration ? ` et ce que ${esc(aiName())} a retenu de ton secteur` : ''}</summary>
          <label class="field"><span class="lbl">Texte alternatif de l'image <span class="muted small">(lecteurs d'écran)</span></span><input data-ct-alt value="${esc(x.alt || '')}" maxlength="${s.limits.alt}"></label>
          ${x.inspiration ? `<p class="small"><b>Ce que ${esc(aiName())} a retenu de ton secteur</b><br>${esc(x.inspiration).replace(/\n/g, '<br>')}</p>` : ''}</details>
        <div class="row-actions">
          ${d.hasImage ? `<a class="btn primary" href="${base(id, 'instagram')}/${d.id}/image?telecharger=1" data-noajax>Télécharger l'image</a>` : ''}
          <button type="button" class="btn" data-ct-copy="instagram">Copier la légende</button>
          ${locked ? '' : '<button type="button" class="btn" data-ct-save>Enregistrer</button>'}
          <button type="button" class="btn danger" data-ct-delete>Supprimer</button></div>
        ${publishPanel(s, d, id)}</div></div>`;
  }

  function newsletterDraft(s, d, id) {
    const x = d.extra || {};
    return `<div class="ct-draft" data-ct-draft="${d.id}">
      <label class="field"><span class="lbl">Objet</span><input data-ct-title value="${esc(d.title)}" maxlength="${s.limits.subject}"></label>
      <label class="field"><span class="lbl">Texte d'aperçu</span><input data-ct-preview value="${esc(x.preview || '')}" maxlength="${s.limits.preview}"></label>
      <label class="field"><span class="lbl">Texte (Markdown, modifiable)</span><textarea rows="16" maxlength="${s.limits.newsletter}" data-ct-body>${esc(d.body)}</textarea></label>
      <p class="muted small"><span data-ct-count>${d.body.length}</span> caractères${d.direction ? ` · direction : « ${esc(d.direction)} »` : ` · sujet choisi par ${esc(aiName())}`}</p>
      <div class="row-actions">
        <a class="btn primary" href="${base(id, 'newsletter')}/${d.id}/html" data-noajax>Télécharger en HTML</a>
        <button type="button" class="btn" data-ct-copy="newsletter">Copier le texte</button>
        <button type="button" class="btn" data-ct-save>Enregistrer</button>
        <button type="button" class="btn danger" data-ct-delete>Supprimer</button></div>
      <p class="muted small">iaboss n'envoie pas la newsletter : colle le texte dans ton outil d'envoi, ou télécharge la version HTML.</p></div>`;
  }

  function render(box, s, id, kind) {
    // Ne pas écraser ce que l'utilisateur est en train d'écrire
    if (box.contains(document.activeElement) && document.activeElement.matches('textarea, input')) return;
    const draft = current(s, id, kind);
    box.dataset.kind = kind;
    box.innerHTML = `${kind === 'instagram' && !(s.hasProfile && s.supported) ? connectBar(s, id) : ''}${generator(s, kind, draft, id)}${draft ? (kind === 'instagram' ? instagramDraft(s, draft, id) : newsletterDraft(s, draft, id)) : ''}${history(s, draft, kind)}`;
    box._state = s;
  }

  const textOf = (box, kind) => {
    const body = $('[data-ct-body]', box).value;
    if (kind === 'instagram') { const tags = $('[data-ct-tags]', box).value.trim(); return tags ? `${body}\n\n${tags}` : body; }
    return `${$('[data-ct-title]', box).value}\n\n${body}`;
  };

  listen(document, 'click', async (e) => {
    const t = e.target.closest('[data-ct-generate],[data-ct-save],[data-ct-copy],[data-ct-delete],[data-ct-pick],[data-ig-publish],[data-ig-schedule],[data-ig-unschedule],[data-ig-disconnect]');
    if (!t) return;
    const box = t.closest('[data-content]');
    const proj = t.closest('.project');
    if (!box || !proj) return;
    const kind = box.dataset.content;
    const id = proj.dataset.id;
    const draftEl = $('[data-ct-draft]', box);
    const draftId = draftEl ? Number(draftEl.dataset.ctDraft) : 0;
    try {
      if (t.matches('[data-ct-generate]')) {
        t.disabled = true;
        const r = await api(`${base(id, kind)}/generate`, { direction: $('[data-ct-direction]', box)?.value || '', format: $('[data-ct-format]', box)?.value || 'carre' });
        const what = kind === 'instagram' ? 'le post' : 'la newsletter';
        toast(r.budgetBlocked ? `En file, mais ${r.budgetBlocked}` : r.existing ? 'Une génération est déjà en cours' : `${aiName()} prépare ${what}…`, r.budgetBlocked ? 'error' : 'ok');
        refreshProject(proj);
      } else if (t.matches('[data-ct-save]')) {
        const body = kind === 'instagram'
          ? { draftId, body: $('[data-ct-body]', box).value, hashtags: $('[data-ct-tags]', box).value, alt: $('[data-ct-alt]', box).value }
          : { draftId, body: $('[data-ct-body]', box).value, title: $('[data-ct-title]', box).value, preview: $('[data-ct-preview]', box).value };
        await api(`${base(id, kind)}/edit`, body);
        toast('Brouillon enregistré');
      } else if (t.matches('[data-ct-copy]')) {
        await navigator.clipboard.writeText(textOf(box, kind));
        toast(kind === 'instagram' ? 'Légende copiée' : 'Newsletter copiée');
      } else if (t.matches('[data-ct-delete]')) {
        if (!(await confirmBox(kind === 'instagram' ? 'Supprimer ce post et son image ?' : 'Supprimer cette newsletter ?'))) return;
        await api(`${base(id, kind)}/delete`, { draftId });
        picked.delete(`${id}:${kind}`);
        toast('Brouillon supprimé');
        loadContent(proj, kind);
      } else if (t.matches('[data-ig-publish],[data-ig-schedule]')) {
        const as = $('[data-ig-as]', box).value;
        const asText = as === 'story' ? 'en story' : 'en post';
        let at = 0;
        if (t.matches('[data-ig-schedule]')) {
          const when = $('[data-ig-when]', box).value;
          if (!when) { toast('Choisis la date et l\'heure de publication', 'error'); return; }
          at = Math.floor(new Date(when).getTime() / 1000); // l'heure saisie est celle de ton navigateur
          if (!(await confirmBox(`Programmer la publication ${asText} le ${new Date(at * 1000).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })} ?\nLe post sera publié automatiquement et sera visible publiquement par tout le monde.`, { confirm: 'Programmer' }))) return;
        } else if (!(await confirmBox(`Publier ce post ${asText} sur Instagram ?\nIl sera visible publiquement par tout le monde.`, { confirm: 'Publier' }))) return;
        t.disabled = true;
        // Le texte affiché est celui qui part : on l'enregistre d'abord
        await api(`${base(id, 'instagram')}/edit`, { draftId, body: $('[data-ct-body]', box).value, hashtags: $('[data-ct-tags]', box).value, alt: $('[data-ct-alt]', box).value });
        if (at) await api(`/api/projects/${id}/instagram/schedule`, { draftId, as, at, confirm: true });
        else await api(`/api/projects/${id}/instagram/publish`, { draftId, as, confirm: true });
        toast(at ? 'Publication programmée' : `Post publié sur Instagram`);
        loadContent(proj, kind);
      } else if (t.matches('[data-ig-unschedule]')) {
        t.disabled = true;
        await api(`/api/projects/${id}/instagram/unschedule`, { draftId });
        toast('Programmation annulée');
        loadContent(proj, kind);
      } else if (t.matches('[data-ig-disconnect]')) {
        if (!(await confirmBox('Déconnecter le compte Instagram de ce projet ?\nLes brouillons sont conservés ; ce qui était programmé repasse en brouillon.', { danger: true, confirm: 'Déconnecter' }))) return;
        await api(`/api/projects/${id}/instagram/disconnect`, {});
        toast('Instagram déconnecté');
        loadContent(proj, kind);
      } else if (t.matches('[data-ct-pick]')) {
        picked.set(`${id}:${kind}`, Number(t.dataset.ctPick));
        loadContent(proj, kind);
      }
    } catch (err) { toast(err.message, 'error'); t.disabled = false; }
  });
  listen(document, 'input', (e) => {
    const area = e.target.closest('[data-ct-body]');
    if (area) $('[data-ct-count]', area.closest('[data-content]')).textContent = area.value.length;
  });
  for (const d of $$('details[data-acc="instagram"], details[data-acc="newsletter"]')) {
    const kind = d.dataset.acc;
    d.addEventListener('toggle', () => { if (d.open) loadContent(d.closest('.project'), kind); });
    if (d.open) loadContent(d.closest('.project'), kind);
  }

  // Retour d'Instagram après la connexion : message, puis on nettoie l'adresse
  (() => {
    const q = new URLSearchParams(location.search);
    if (!q.has('ig')) return;
    history.replaceState(null, '', location.pathname);
    if (q.get('ig') === 'ok') toast('Compte Instagram relié au projet');
    else toast(q.get('m') || 'Connexion Instagram impossible', 'error');
  })();

  window.AiTools.loadContent = loadContent;
})();
