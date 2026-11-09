// Fiche contact (maquette 06, docs/REFONTE-UI.md) : un prospect ou un client, sa dernière réponse, ses échanges, sa prochaine action, son accroche,
// ses informations. Rendue par le serveur ; public/app-contact.js envoie les formulaires aux routes d'API de la fiche prospect (mêmes que l'ancienne fenêtre).
import { esc } from './http.js';
import { ic } from './icons.js';
import { layout } from './views.js';
import { suggestBlock } from './mailviews.js';
import { STATUSES } from './services/crm.js';
import { INTENTS } from './services/replies.js';

const day = (ts) => new Date(ts * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
const isoDay = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }) : '');
const when = (ts) => {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  return isoDay(ts) === today ? "Aujourd'hui" : day(ts);
};
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
const host = (u) => String(u || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
const BADGE = { replied: 'ok', client: 'ok', sent: 'info', new: '', refused: 'err', bounced: 'err' };

/** Les échanges, du plus récent au plus ancien : réponse, lecture, mails envoyés, notes, premier repérage. */
function events(d, reply) {
  const p = d.prospect;
  const list = [];
  if (reply) list.push({ at: reply.received_at, html: `<b>Réponse reçue</b> · ${esc(INTENTS[reply.intent] || INTENTS.other)}` });
  else if (p.replied_at) list.push({ at: p.replied_at, html: `<b>Réponse reçue</b>${p.reply_subject ? ` · ${esc(p.reply_subject)}` : ''}` });
  for (const m of d.mails) {
    list.push({ at: m.sent_at, html: m.error ? `<b>Mail non envoyé</b> · <span class="err">${esc(m.error)}</span>` : `<b>${m.kind === 'followup' ? 'Relance envoyée' : 'Mail envoyé'}</b>${m.variant ? ` · Objet ${esc(m.variant)}` : ''}${m.subject ? ` « ${esc(m.subject)} »` : ''}` });
    if (m.read_at) list.push({ at: m.read_at, html: '<b>Lu par le destinataire</b>' });
  }
  for (const n of d.notes) list.push({ at: n.created_at, html: `<b>Note</b> · ${esc(n.body)} <button type="button" class="link small" data-del-note="${n.id}" aria-label="Supprimer cette note">supprimer</button>` });
  list.push({ at: p.created_at, html: `<b>Prospect trouvé</b>${p.source ? ` · source : ${esc(host(p.source))}` : ''}` });
  return list.sort((a, b) => b.at - a.at);
}

/**
 * @param {{email:string, project:object, detail:object, reply:object|null, hookBusy:boolean}} a
 * `detail` : ce que renvoie prospectDetail ; `reply` : la dernière réponse reçue de ce prospect (table replies) ou null.
 */
export function contactPage({ email, project, detail, reply, hookBusy = false }) {
  const p = detail.prospect;
  const id = p.id;
  const isClient = p.status === 'client';
  const site = safeUrl(p.website);
  const ev = events(detail, reply);
  const lastMail = [...detail.mails].reverse().find((m) => !m.error);
  const subject = lastMail?.subject ? `Re: ${lastMail.subject}` : '';
  return layout({
    title: `${p.company} · ${project.name}`, email,
    body: `<div class="pj-page pj-contact" data-contact data-prospect-id="${id}" data-project-id="${project.id}">
<nav class="crumb" aria-label="Fil d'Ariane"><a href="/projets">Projets</a><span aria-hidden="true">›</span><a href="/p/${project.id}">${esc(project.name)}</a><span aria-hidden="true">›</span><span>${esc(p.company)}</span></nav>
<div class="ph"><div class="t"><h1>${esc(p.company)}</h1>
  <span class="pj-meta"><span class="badge ${BADGE[p.status] ?? ''}">${esc(STATUSES[p.status] || p.status)}</span><span class="mono muted">${esc(p.email)}</span><span class="small muted">${[p.city, p.score ? `score ${p.score}` : ''].filter(Boolean).map(esc).join(' · ')}</span></span></div>
  <div class="acts"><a class="btn primary" href="mailto:${esc(p.email)}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}">${ic('reply')}Répondre</a>
    ${isClient ? '' : '<button type="button" class="btn" data-contact-client>Passer en client</button>'}
    <a class="btn" href="/p/${project.id}/facturation#generer">${ic('file')}Faire un devis</a></div></div>
${detail.optOut ? `<p class="ban ban-warn" role="note">${ic('alert')}<span>Sur la liste d'opposition (${detail.optOut.reason === 'bounce' ? 'adresse invalide' : detail.optOut.reason === 'refused' ? 'refus' : 'désinscription'}) : ne plus contacter.</span></p>` : ''}
<div class="pj-grid pj-grid-e">
  <div class="pj-flat pj-left">
    <section class="sheet" aria-labelledby="dr-h"><div class="sheet-h"><h2 id="dr-h">Dernière réponse</h2>${reply ? `<span class="badge ok">${esc(INTENTS[reply.intent] || INTENTS.other)}</span>` : ''}</div>
      ${reply ? `<blockquote class="pj-quote">« ${esc(String(reply.body || '').replace(/\\s+/g, ' ').trim().slice(0, 400))} »</blockquote><p class="small muted">Reçue ${esc(when(reply.received_at))}${reply.subject ? ` · ${esc(reply.subject)}` : ''}</p>${suggestBlock({ id: reply.id, suggestion: reply.suggestion, event: reply.event })}` : '<p class="muted">Pas de réponse pour l\'instant.</p>'}</section>
    <section class="sheet" aria-labelledby="ex-h"><div class="sheet-h"><h2 id="ex-h">Échanges</h2><button type="button" class="btn small" data-contact-note-toggle aria-expanded="false">${ic('plus')}Ajouter une note</button></div>
      <form data-contact-form="note" class="pj-note" hidden><textarea name="body" rows="3" maxlength="2000" required aria-label="Note" placeholder="Ce qu'il a dit, le contexte, ce qu'il faut retenir…"></textarea><div class="row"><button class="btn primary">Ajouter la note</button></div></form>
      <ol class="pj-timeline">${ev.map((e) => `<li><time>${esc(when(e.at))}</time><span>${e.html}</span></li>`).join('')}</ol></section>
  </div>
  <div class="pj-flat">
    <section class="sheet" aria-labelledby="pa-h"><h2 id="pa-h">Prochaine action</h2>
      <form data-contact-form="next" class="pj-next">
        <label class="field"><span class="lbl">Quoi</span><input name="action" maxlength="200" value="${esc(p.next_action || '')}" placeholder="ex. Rappeler après les vacances"></label>
        <label class="field"><span class="lbl">Quand</span><input type="date" name="day" value="${isoDay(p.next_action_at)}"></label>
        <div class="row"><button class="btn">Enregistrer</button>${p.next_action ? '<button type="button" class="linklike" data-contact-clear-next>Effacer</button>' : ''}</div>
      </form></section>
    <section class="sheet" aria-labelledby="ac-h"><h2 id="ac-h">Accroche</h2>
      ${p.hook ? `<p><mark>${esc(p.hook)}</mark></p>` : '<p class="muted small">Pas d\'accroche pour ce prospect.</p>'}
      <button type="button" class="linklike small" data-contact-hook${hookBusy ? ' disabled' : ''}>${hookBusy ? 'Régénération en cours…' : p.hook ? "Régénérer l'accroche" : 'Générer une accroche'}</button></section>
    <section class="sheet" aria-labelledby="in-h"><h2 id="in-h">Informations</h2>
      <ul class="pj-info">${site ? `<li>Site : <a href="${esc(site)}" target="_blank" rel="noopener noreferrer">${esc(host(site))}</a></li>` : ''}${p.sector ? `<li>Secteur : ${esc(p.sector)}</li>` : ''}${p.source ? `<li>Origine : ${esc(host(p.source))}</li>` : ''}${p.city ? `<li>Ville : ${esc(p.city)}</li>` : ''}</ul>
      <button type="button" class="linklike small" data-contact-edit-toggle aria-expanded="false">Modifier les informations</button>
      <form data-contact-form="edit" class="pj-edit" hidden>
        <label class="field"><span class="lbl">Entreprise</span><input name="company" required maxlength="200" value="${esc(p.company)}"></label>
        <label class="field"><span class="lbl">Email</span><input name="email" type="email" required maxlength="200" value="${esc(p.email)}"${p.status === 'new' ? '' : ' readonly aria-describedby="email-lock"'}></label>
        <label class="field"><span class="lbl">Site</span><input name="website" maxlength="300" value="${esc(p.website || '')}" placeholder="https://entreprise.fr"></label>
        <label class="field"><span class="lbl">Ville</span><input name="city" maxlength="100" value="${esc(p.city || '')}"></label>
        <label class="field"><span class="lbl">Secteur</span><input name="sector" maxlength="100" value="${esc(p.sector || '')}"></label>
        <label class="field"><span class="lbl">Score (1 à 10)</span><input name="score" type="number" min="1" max="10" inputmode="numeric" value="${p.score ?? ''}"></label>
        <label class="field"><span class="lbl">Accroche</span><input name="hook" maxlength="400" value="${esc(p.hook || '')}"></label>
        <label class="field"><span class="lbl">Origine de l'adresse</span><input name="source" maxlength="300" value="${esc(p.source || '')}"></label>
        ${p.status === 'new' ? '' : '<p class="muted small" id="email-lock">L\'adresse ne peut plus être modifiée : des mails y sont rattachés. Pour une autre adresse, ajoute un nouveau prospect.</p>'}
        <div class="row"><button class="btn primary">Enregistrer les informations</button></div>
      </form></section>
    <button type="button" class="btn danger pj-del" data-contact-delete>${ic('trash')}Supprimer ce prospect</button>
  </div>
</div>
</div>`,
  });
}
