// Page « Mails » : l'historique des envois avec leur état, et les réponses reçues classées par intention.
import { esc } from './http.js';
import { layout } from './views.js';
import { ic } from './icons.js';
import { INTENTS } from './services/replies.js';

const STATE_LABELS = { sent: 'Envoyé', read: 'Lu (accusé)', replied: 'Répondu', bounced: 'Rejeté', refused: 'Refus', failed: 'Non envoyé' };
const STATE_BADGE = { sent: '', read: 'ok', replied: 'ok', bounced: 'err', refused: 'warn', failed: 'err' };
const INTENT_BADGE = { interested: 'ok', question: '', later: 'warn', refused: 'err', other: '' };
const KIND = { initial: 'Premier mail', followup: 'Relance' };

const when = (ts) => new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });

/** Proposition d'ajout à l'agenda (ou événement déjà ajouté) pour une réponse. */
export function suggestBlock(r) {
  if (r.event) {
    return `<div class="suggest done" data-suggest="${r.id}"><p class="why"><b>${ic('check')} Ajouté à ton calendrier :</b> ${esc(r.event.title)}</p>
      <div class="sg-row"><a class="btn small" href="${esc(r.event.links.google)}" target="_blank" rel="noopener noreferrer">Google Agenda</a><a class="btn small" href="${esc(r.event.links.ics)}">Fichier .ics</a></div></div>`;
  }
  const s = r.suggestion;
  if (!s) return '';
  const why = s.dateToChoose ? "Le prospect semble partant mais n'a pas donné de date : choisis un créneau."
    : `Il évoque « ${esc(s.phrase)} »${s.guessed ? " ; l'heure n'est pas précisée, vérifie-la" : ''}${s.vague ? ' ; date approximative, à confirmer' : ''}.`;
  return `<div class="suggest" data-suggest="${r.id}" data-minutes="${s.minutes}"><p class="why"><b>${ic('clock')} Ajouter à ton calendrier ?</b> ${why}</p>
    <label class="field"><span class="lbl">Titre</span><input data-ev-title value="${esc(s.title)}" maxlength="200"></label>
    <div class="sg-row"><label class="field"><span class="lbl">Date et heure (Paris)</span><input type="datetime-local" data-ev-when value="${esc(s.whenLocal)}"></label>
    <button type="button" class="btn primary" data-ev-add="${r.id}">${ic('plus')}Ajouter à mon calendrier</button></div></div>`;
}

function link(base, over) {
  const q = new URLSearchParams();
  const all = { v: base.view === 'sent' ? 'sent' : '', project: base.project || '', filter: base.filter || '', page: '', ...over };
  for (const [k, v] of Object.entries(all)) if (v) q.set(k, v);
  const s = q.toString();
  return `/mails${s ? `?${s}` : ''}`;
}

export function mailsPage(d) {
  const labels = d.view === 'replies' ? INTENTS : STATE_LABELS;
  const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
  const BAD = new Set(['bounced', 'refused', 'failed']);
  const stats = [['', 'Tous', total], ...Object.entries(labels).map(([k, l]) => [k, l, d.counts[k] || 0])]
    .map(([k, l, n]) => `<a class="mstat${(d.filter || '') === k ? ' on' : ''}${BAD.has(k) && n ? ' bad' : ''}" href="${esc(link(d, { filter: k }))}"${(d.filter || '') === k ? ' aria-current="true"' : ''}><b>${n.toLocaleString('fr-FR')}</b><span>${esc(l)}</span></a>`).join('');

  const projectSelect = d.projects.length > 1 ? `<form class="inline-form" method="get" action="/mails">
      ${d.view === 'sent' ? '<input type="hidden" name="v" value="sent">' : ''}
      <label class="sr-only" for="mp">Projet</label>
      <select id="mp" name="project" data-autosubmit><option value="">Tous les projets</option>${d.projects.map((p) => `<option value="${p.id}"${Number(p.id) === d.project ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <noscript><button class="btn small">Filtrer</button></noscript></form>` : '';

  let list;
  if (!d.rows.length) {
    if (d.filter) list = `<div class="empty-s"><p>${d.view === 'replies' ? 'Aucune réponse avec cette intention.' : 'Aucun mail dans cet état.'}</p><a class="btn small" href="${esc(link(d, { filter: '' }))}">Voir tous</a></div>`;
    else if (d.view === 'replies') list = `<div class="empty-s"><p><b>Aucune réponse pour l'instant.</b> Elles s'affichent ici dès que la boîte de réception du projet (IMAP) en détecte une.</p><a class="btn small" href="/">Régler la boîte de réception</a></div>`;
    else list = `<div class="empty-s"><p><b>Aucun mail envoyé pour l'instant.</b> Les mails partent depuis un projet, section « Prospecter », après ta confirmation.</p><a class="btn small" href="/">Ouvrir mes projets</a></div>`;
  } else if (d.view === 'replies') {
    list = `<div class="reply-list">${d.rows.map((r) => `<details class="reply-row${r.seen ? '' : ' unseen'}" open>
      <summary><span class="badge ${INTENT_BADGE[r.intent]}">${esc(r.intentLabel)}</span>
        <span class="r-from">${esc(r.company ? `${r.company} · ` : '')}${esc(r.from)}</span>
        <span class="muted small r-meta">${esc(r.project)} · ${esc(when(r.receivedAt))}</span></summary>
      <div class="reply-body">
        ${r.subject ? `<p class="muted small">Objet : ${esc(r.subject)}</p>` : ''}
        <p class="reply-text">${esc(r.text || '(texte non disponible)')}</p>
        ${suggestBlock(r)}
        <label class="field"><span class="lbl">Réponse suggérée (à relire, puis à envoyer depuis ta messagerie)</span>
          <textarea rows="9" readonly data-draft>${esc(r.draft)}</textarea></label>
        <div class="row-actions"><a class="btn small primary" href="mailto:${esc(r.from)}?subject=${encodeURIComponent(/^re:/i.test(r.subject) ? r.subject : `Re: ${r.subject}`)}">${ic('reply')}Répondre</a>
          <button type="button" class="btn small" data-copy-draft>${ic('copy')}Copier la réponse</button>
          ${r.prospectId ? `<button type="button" class="btn small" data-remind-toggle aria-expanded="false">${ic('clock')}Programmer un rappel</button>` : ''}
          ${r.seen ? '' : `<button type="button" class="btn small" data-reply-seen="${r.id}">${ic('check')}Marquer traitée</button>`}</div>
        ${r.prospectId ? `<form class="remind-f" data-remind="${r.prospectId}" hidden><label class="field"><span class="lbl">Me le rappeler le</span><input type="date" name="day" required></label><button class="btn small primary">Programmer</button></form>` : ''}
      </div></details>`).join('')}</div>`;
  } else {
    const solo = d.project || d.projects.length < 2;
    list = `<div class="table-wrap"><table class="mtable">
      <thead><tr><th>Date</th><th>Destinataire</th><th>Objet</th><th>État</th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr class="mail-row"><td class="nowrap">${esc(when(r.sent_at))}</td>
        <td>${r.company ? `<b>${esc(r.company)}</b><span class="td-s">${esc(r.email)}</span>` : esc(r.email)}</td>
        <td><button type="button" class="mail-toggle" data-mail="${Number(r.id)}" aria-expanded="false" aria-controls="mail-d-${Number(r.id)}">${esc(r.subject || '—')}${ic('down')}</button><span class="td-s">${esc(solo ? KIND[r.kind] || r.kind : `${r.project} · ${KIND[r.kind] || r.kind}`)}</span></td>
        <td><span class="badge ${STATE_BADGE[r.state]}">${esc(STATE_LABELS[r.state])}</span>${r.error ? `<span class="td-s">${esc(String(r.error).slice(0, 80))}</span>` : ''}</td></tr>
      <tr class="mail-detail" id="mail-d-${Number(r.id)}" hidden><td colspan="4"></td></tr>`).join('')}
      </tbody></table></div>`;
  }

  const pager = d.pages > 1 ? `<nav class="pager" aria-label="Pages">
      ${d.page > 1 ? `<a class="btn small" href="${esc(link(d, { page: String(d.page - 1) }))}">Précédent</a>` : ''}
      <span class="muted small">Page ${d.page} / ${d.pages}</span>
      ${d.page < d.pages ? `<a class="btn small" href="${esc(link(d, { page: String(d.page + 1) }))}">Suivant</a>` : ''}</nav>` : '';

  return layout({
    title: 'Mails', email: d.email,
    body: `<section class="pj-page mails-page">
  <div class="ph"><div class="t"><h1>Mails</h1><span class="muted small">${esc(d.project ? (d.projects.find((p) => Number(p.id) === d.project)?.name || 'Ce projet') : 'Tous les projets')}</span></div></div>
  ${projectSelect}
  <nav class="tabs" aria-label="Affichage">
    <a class="tab${d.view === 'replies' ? ' on' : ''}" href="${esc(link({ ...d, view: 'replies', filter: '' }, {}))}"${d.view === 'replies' ? ' aria-current="page"' : ''}>${ic('reply')}Réponses</a>
    <a class="tab${d.view === 'sent' ? ' on' : ''}" href="${esc(link({ ...d, view: 'sent', filter: '' }, {}))}"${d.view === 'sent' ? ' aria-current="page"' : ''}>${ic('send')}Envoyés</a>
  </nav>
  <nav class="mstats" aria-label="${d.view === 'replies' ? 'Filtrer par intention' : 'Filtrer par état'}">${stats}</nav>
  ${list}${pager}
  ${d.view === 'sent' ? `<details class="tip"><summary><span class="tip-i" aria-hidden="true">i</span><span class="tip-t">Comment sont comptés « Lu » et « Répondu » ?</span></summary>
    <div class="tip-body"><p>« Lu » vient de l'accusé de lecture standard : la messagerie du destinataire lui demande s'il accepte de l'envoyer (option dans Réglages → Garde-fous). « Lu » est donc un minimum. « Répondu » vient de la boîte de réception du projet (IMAP).</p></div></details>` : ''}
</section>`,
  });
}
