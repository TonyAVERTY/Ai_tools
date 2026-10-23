// Page « Mails » : l'historique des envois avec leur état, et les réponses reçues classées par intention.
import { esc } from './http.js';
import { layout } from './views.js';
import { ic } from './icons.js';
import { INTENTS } from './services/replies.js';

const STATE_LABELS = { sent: 'Envoyé', replied: 'Répondu', bounced: 'Rejeté', refused: 'Refus', failed: 'Non envoyé' };
const STATE_BADGE = { sent: '', replied: 'ok', bounced: 'err', refused: 'warn', failed: 'err' };
const INTENT_BADGE = { interested: 'ok', question: '', later: 'warn', refused: 'err', other: '' };
const KIND = { initial: 'Premier mail', followup: 'Relance' };

const when = (ts) => new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });

function link(base, over) {
  const q = new URLSearchParams();
  const all = { v: base.view === 'replies' ? 'replies' : '', project: base.project || '', filter: base.filter || '', page: '', ...over };
  for (const [k, v] of Object.entries(all)) if (v) q.set(k, v);
  const s = q.toString();
  return `/mails${s ? `?${s}` : ''}`;
}

export function mailsPage(d) {
  const labels = d.view === 'replies' ? INTENTS : STATE_LABELS;
  const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
  const chips = [['', 'Tous', total], ...Object.entries(labels).map(([k, l]) => [k, l, d.counts[k] || 0])]
    .map(([k, l, n]) => `<a class="chip${(d.filter || '') === k ? ' on' : ''}" href="${esc(link(d, { filter: k }))}"${(d.filter || '') === k ? ' aria-current="true"' : ''}>${esc(l)} <span class="n">${n}</span></a>`).join('');

  const projectSelect = d.projects.length > 1 ? `<form class="inline-form" method="get" action="/mails">
      ${d.view === 'replies' ? '<input type="hidden" name="v" value="replies">' : ''}
      <label class="sr-only" for="mp">Projet</label>
      <select id="mp" name="project" data-autosubmit><option value="">Tous les projets</option>${d.projects.map((p) => `<option value="${p.id}"${Number(p.id) === d.project ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <noscript><button class="btn small">Filtrer</button></noscript></form>` : '';

  let list;
  if (!d.rows.length) {
    list = `<p class="muted">${d.view === 'replies' ? "Aucune réponse pour l'instant. Elles apparaissent ici dès que la boîte de réception du projet (IMAP) en détecte une." : 'Aucun mail envoyé pour l\'instant.'}</p>`;
  } else if (d.view === 'replies') {
    list = d.rows.map((r) => `<details class="reply-row${r.seen ? '' : ' unseen'}">
      <summary><span class="badge ${INTENT_BADGE[r.intent]}">${esc(r.intentLabel)}</span>
        <span class="r-from">${esc(r.company ? `${r.company} · ` : '')}${esc(r.from)}</span>
        <span class="muted small r-meta">${esc(r.project)} · ${esc(when(r.receivedAt))}</span></summary>
      <div class="reply-body">
        ${r.subject ? `<p class="muted small">Objet : ${esc(r.subject)}</p>` : ''}
        <p class="reply-text">${esc(r.text || '(texte non disponible)')}</p>
        <label class="field"><span class="lbl">Réponse suggérée (à relire, puis à envoyer depuis ta messagerie)</span>
          <textarea rows="9" readonly data-draft>${esc(r.draft)}</textarea></label>
        <div class="row-actions"><button type="button" class="btn small" data-copy-draft>${ic('copy')}Copier la réponse</button>
          ${r.seen ? '' : `<button type="button" class="btn small" data-reply-seen="${r.id}">${ic('check')}Marquer comme lu</button>`}</div>
      </div></details>`).join('');
  } else {
    list = `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Destinataire</th><th>Objet</th><th>Projet</th><th>Type</th><th>État</th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr><td>${esc(when(r.sent_at))}</td>
        <td>${esc(r.company ? `${r.company} · ` : '')}${esc(r.email)}</td>
        <td>${esc(r.subject || '—')}</td><td>${esc(r.project)}</td><td>${esc(KIND[r.kind] || r.kind)}</td>
        <td><span class="badge ${STATE_BADGE[r.state]}"${r.error ? ` title="${esc(r.error)}"` : ''}>${esc(STATE_LABELS[r.state])}</span></td></tr>`).join('')}
      </tbody></table></div>`;
  }

  const pager = d.pages > 1 ? `<nav class="pager" aria-label="Pages">
      ${d.page > 1 ? `<a class="btn small" href="${esc(link(d, { page: String(d.page - 1) }))}">Précédent</a>` : ''}
      <span class="muted small">Page ${d.page} / ${d.pages}</span>
      ${d.page < d.pages ? `<a class="btn small" href="${esc(link(d, { page: String(d.page + 1) }))}">Suivant</a>` : ''}</nav>` : '';

  return layout({
    title: 'Mails', email: d.email,
    body: `<section class="card">
  <div class="row-between"><h1>${ic('mail')}Mails</h1>${projectSelect}</div>
  <div class="tabs" role="tablist" aria-label="Affichage">
    <a class="tab${d.view === 'sent' ? ' on' : ''}" href="${esc(link({ ...d, view: 'sent', filter: '' }, {}))}"${d.view === 'sent' ? ' aria-current="page"' : ''}>${ic('send')}Envoyés</a>
    <a class="tab${d.view === 'replies' ? ' on' : ''}" href="${esc(link({ ...d, view: 'replies', filter: '' }, {}))}"${d.view === 'replies' ? ' aria-current="page"' : ''}>${ic('reply')}Réponses</a>
  </div>
  <div class="chips" role="group" aria-label="${d.view === 'replies' ? 'Intention' : 'État'}">${chips}</div>
  ${list}${pager}
  ${d.view === 'sent' ? `<p class="muted small">Pas de suivi d'ouverture : il demande un pixel invisible dans chaque mail, ce qui abîme la délivrabilité et pose un problème de consentement (RGPD). L'état « Répondu » vient de la boîte de réception du projet (IMAP).</p>` : ''}
</section>`,
  });
}
