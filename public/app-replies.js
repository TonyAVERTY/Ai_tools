// Réponses des prospects : popup d'arrivée (consultée toutes les 45 s), proposition « Ajouter à ton calendrier » et boutons de la page
// « Mails ». Chargé après app.js, qui expose ses outils communs dans window.AiTools ; ajax.js relance ce script à chaque navigation,
// comme app.js. Aucune fonction n'est appelée de l'extérieur : tout passe par des écouteurs et par la consultation périodique.
(() => {
  const { $, $$, api, every, listen, toast, unlinked } = window.AiTools;

  // ---------- Réponses des prospects : popup d'arrivée, page « Mails » ----------
  // La popup ne s'affiche que pour les réponses non lues ; tout le texte vient de la base et passe par textContent.
  const popHost = (() => {
    let host = $('.reply-pops');
    if (!host) { host = document.createElement('div'); host.className = 'reply-pops'; host.setAttribute('aria-live', 'polite'); document.body.append(host); }
    return host;
  })();
  const shownReplies = new Set();
  const copyText = async (text, btn) => {
    try { await navigator.clipboard.writeText(text); toast('Réponse copiée'); } catch { const ta = $('textarea', btn.closest('details')); ta?.select(); toast('Sélectionnée : copie-la avec Ctrl+C', 'error'); }
  };
  const markSeen = async (id) => { try { await api(`/api/replies/${id}/seen`, {}); } catch { /* sera réessayé au prochain passage */ } };
  // Proposition « Ajouter à ton calendrier » : titre et date préremplis à partir de la réponse, l'utilisateur corrige puis confirme
  function suggestDom(r) {
    const box = document.createElement('div');
    box.className = 'suggest';
    box.dataset.suggest = r.id;
    if (r.event) { doneDom(box, r.event); return box; }
    const s = r.suggestion;
    if (!s) return null;
    box.dataset.minutes = s.minutes;
    const why = document.createElement('p'); why.className = 'why';
    const b = document.createElement('b'); b.textContent = 'Ajouter à ton calendrier ? ';
    why.append(b, s.dateToChoose ? "Il semble partant mais n'a pas donné de date : choisis un créneau."
      : `Il évoque « ${s.phrase} »${s.guessed ? " ; l'heure n'est pas précisée, vérifie-la" : ''}${s.vague ? ' ; date approximative, à confirmer' : ''}.`);
    const title = document.createElement('input'); title.value = s.title; title.maxLength = 200; title.setAttribute('data-ev-title', ''); title.setAttribute('aria-label', 'Titre');
    const row = document.createElement('div'); row.className = 'sg-row';
    const when = document.createElement('input'); when.type = 'datetime-local'; when.value = s.whenLocal; when.setAttribute('data-ev-when', ''); when.setAttribute('aria-label', 'Date et heure (Paris)');
    const add = document.createElement('button'); add.type = 'button'; add.className = 'btn primary'; add.textContent = 'Ajouter à mon calendrier'; add.dataset.evAdd = r.id;
    row.append(when, add);
    box.append(why, title, row);
    return box;
  }
  // Après l'ajout : l'événement est dans l'agenda d'iaboss ; deux liens pour l'avoir aussi dans SON agenda
  function doneDom(box, ev) {
    box.className = 'suggest done';
    box.replaceChildren();
    const p = document.createElement('p'); p.className = 'why';
    const b = document.createElement('b'); b.textContent = 'Ajouté à ton calendrier : ';
    p.append(b, ev.title);
    const row = document.createElement('div'); row.className = 'sg-row';
    const g = document.createElement('a'); g.className = 'btn small'; g.href = ev.links.google; g.target = '_blank'; g.rel = 'noopener noreferrer'; g.textContent = 'Google Agenda';
    const i = document.createElement('a'); i.className = 'btn small'; i.href = ev.links.ics; i.textContent = 'Fichier .ics';
    row.append(g, i);
    box.append(p, row);
  }
  listen(document, 'click', async (e) => {
    const btn = e.target.closest('[data-ev-add]');
    if (!btn) return;
    const box = btn.closest('[data-suggest]');
    const title = $('[data-ev-title]', box).value.trim();
    const when = $('[data-ev-when]', box).value;
    if (!title || !when) { toast('Renseigne un titre, une date et une heure', 'error'); return; }
    btn.disabled = true;
    try {
      const r = await api(`/api/replies/${btn.dataset.evAdd}/event`, { title, when, minutes: Number(box.dataset.minutes) || 30 });
      doneDom(box, r.event);
      toast(r.existing ? 'Déjà dans ton calendrier' : 'Ajouté à ton calendrier');
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  });
  function replyPopup(r) {
    const el = document.createElement('details');
    el.className = 'reply-pop';
    const sum = document.createElement('summary');
    const who = document.createElement('strong'); who.textContent = r.from;
    sum.append(who, ' t\'a répondu');
    const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = r.intentLabel; sum.append(' ', badge);
    const close = document.createElement('button'); close.type = 'button'; close.className = 'reply-x'; close.setAttribute('aria-label', 'Fermer'); close.textContent = '×';
    close.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); el.remove(); markSeen(r.id).then(pollReplies); });
    sum.append(close);
    const body = document.createElement('div'); body.className = 'reply-body';
    const sub = document.createElement('p'); sub.className = 'muted small'; sub.textContent = `${r.project}${r.subject ? ` · ${r.subject}` : ''}`;
    const txt = document.createElement('p'); txt.className = 'reply-text'; txt.textContent = r.text || '(texte non disponible)';
    const lbl = document.createElement('p'); lbl.className = 'lbl'; lbl.textContent = 'Voici une réponse toute rédigée :';
    const ta = document.createElement('textarea'); ta.readOnly = true; ta.rows = 8; ta.value = r.draft;
    const acts = document.createElement('div'); acts.className = 'row-actions';
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn small'; copy.textContent = 'Copier la réponse';
    copy.addEventListener('click', () => copyText(ta.value, copy));
    const read = document.createElement('button'); read.type = 'button'; read.className = 'btn small'; read.textContent = 'Marquer comme lu';
    read.addEventListener('click', () => { el.remove(); markSeen(r.id).then(pollReplies); });
    const all = document.createElement('a'); all.className = 'btn small'; all.href = '/mails?v=replies'; all.textContent = 'Toutes les réponses';
    acts.append(copy, read, all);
    body.append(sub, txt);
    const sg = suggestDom(r);
    if (sg) body.append(sg);
    body.append(lbl, ta, acts);
    el.append(sum, body);
    popHost.append(el);
  }
  function paintUnseen(n) {
    for (const a of $$('.pill[href="/mails"]')) {
      let b = $('.pill-n', a);
      if (!n) { b?.remove(); continue; }
      if (!b) { b = document.createElement('span'); b.className = 'pill-n'; a.append(b); }
      b.textContent = n > 9 ? '9+' : String(n);
    }
  }
  async function pollReplies() {
    if (document.hidden || !$('.top') || unlinked()) return;
    try {
      const d = await api('/api/replies?unseen=1&limit=10');
      paintUnseen(d.unseen);
      // Deux popups au plus à l'écran : le reste est résumé en une ligne (sur téléphone, des popups empilées cacheraient la page)
      const room = Math.max(0, 2 - $$('.reply-pop', popHost).length);
      const fresh = d.replies.filter((r) => !shownReplies.has(r.id));
      for (const r of fresh.slice(0, room)) { shownReplies.add(r.id); replyPopup(r); }
      $('.reply-more', popHost)?.remove();
      const rest = d.unseen - $$('.reply-pop', popHost).length;
      if (rest > 0) {
        const more = document.createElement('a');
        more.className = 'reply-more'; more.href = '/mails?v=replies';
        more.textContent = `+ ${rest} autre${rest > 1 ? 's' : ''} réponse${rest > 1 ? 's' : ''} non lue${rest > 1 ? 's' : ''}`;
        popHost.append(more);
      }
    } catch { /* hors ligne ou session expirée : la prochaine requête le dira */ }
  }
  if ($('.top')) { pollReplies(); every(pollReplies, 45_000); listen(document, 'visibilitychange', () => { if (!document.hidden) pollReplies(); }); }
  listen(document, 'click', async (e) => {
    const c = e.target.closest('[data-copy-draft]');
    if (c) { copyText($('[data-draft]', c.closest('.reply-body')).value, c); return; }
    const s = e.target.closest('[data-reply-seen]');
    if (s) { await markSeen(s.dataset.replySeen); s.closest('.reply-row')?.classList.remove('unseen'); s.remove(); pollReplies(); }
  });
})();
