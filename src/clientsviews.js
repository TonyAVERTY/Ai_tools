// Pages « Clients » : la liste des projets (déroulants comme sur le tableau de bord), la fiche d'un client et la fiche d'un prospect.
// public/clients.js charge la liste d'un projet quand on le déroule et relance la recherche à la frappe.
import { esc } from './http.js';
import { layout } from './views.js';
import { ic } from './icons.js';
import { fmtEur } from './services/accounting.js';
import { STATUSES } from './services/crm.js';
import { DOC_BY_KEY } from './services/billing.js';
import { banner } from './banner.js';
import { loadingBlock } from './loading.js';

const day = (ts) => (ts ? new Date(ts * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' }) : '—');
const dayTime = (ts) => (ts ? new Date(ts * 1000).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : '—');
const money = (c) => fmtEur(c);
const host = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/\.git$/, '').slice(0, 80);
const INTENTS = { interested: ['Intéressé', 'ok'], question: ['Question', 'info'], later: ['Plus tard', ''], refused: ['Refus', 'err'], other: ['Réponse', ''] };
const STATE = { pending: ['À encaisser', 'warn'], paid: ['Payée', 'ok'], devis: ['Devis', ''], hors: ['Non jointe à la comptabilité', ''] };

const flashOf = (flash) => {
  const notes = { cree: 'Client ajouté.', maj: 'Les informations du client sont enregistrées.', converti: 'Le prospect est maintenant un client.', note: 'Note ajoutée.', retire: 'Client retiré de la liste.' };
  if (flash.error) return banner('err', flash.error);
  return flash.ok && notes[flash.ok] ? banner('ok', notes[flash.ok]) : '';
};

// ---------- Lignes de la liste (aussi servies en fragment HTML) ----------

function clientRow(c) {
  const sub = [c.contact, c.email, c.phone].filter(Boolean).map(esc).join(' · ');
  const t = c.totals;
  return `<a class="cl-row" href="/clients/c/${c.id}">
    <span class="cl-main"><b>${esc(c.name)}</b>${sub ? `<span class="muted small">${sub}</span>` : '<span class="muted small">Pas encore de coordonnées</span>'}</span>
    <span class="cl-meta">${t.docs ? `<span class="badge">${t.docs} document${t.docs > 1 ? 's' : ''}</span>` : ''}${t.billed ? `<span class="badge">Facturé ${esc(money(t.billed))}</span>` : ''}${t.pending ? `<span class="badge warn">À encaisser ${esc(money(t.pending))}</span>` : ''}</span>
    <span class="cl-go" aria-hidden="true">${ic('chev')}</span></a>`;
}

function prospectRow(x) {
  const sub = [x.city, x.sector].filter(Boolean).map(esc).join(' · ');
  const when = x.repliedAt ? `a répondu le ${day(x.repliedAt)}` : x.sentAt ? `contacté le ${day(x.sentAt)}` : '';
  return `<a class="cl-row" href="/clients/p/${x.id}">
    <span class="cl-main"><b>${esc(x.company)}</b><span class="muted small">${esc(x.email)}${sub ? ` · ${sub}` : ''}</span></span>
    <span class="cl-meta"><span class="badge ${x.status === 'replied' ? 'ok' : x.status === 'refused' || x.status === 'bounced' || x.status === 'invalid' ? 'err' : ''}">${esc(STATUSES[x.status] || x.status)}</span>${when ? `<span class="muted small">${esc(when)}</span>` : ''}</span>
    <span class="cl-go" aria-hidden="true">${ic('chev')}</span></a>`;
}

/** Les deux listes d'un projet (clients, prospects) ; `more` : lien « Afficher plus » quand il en reste. */
export function clientListsHtml({ projectId, q, limit, clients, prospects }) {
  const more = (shown, total, kind) => (total > shown ? `<button type="button" class="btn small" data-cl-more="${limit + 30}" data-kind="${kind}">Afficher plus (${total - shown} de plus)</button>` : '');
  const empty = (txt) => `<p class="muted cl-empty">${txt}</p>`;
  const noMatch = q ? ` pour « ${esc(q)} »` : '';
  return `<section class="cl-sec" aria-labelledby="cl-t-c-${projectId}"><h3 id="cl-t-c-${projectId}">Clients <span class="badge">${clients.total}</span></h3>
      ${clients.rows.length ? `<div class="cl-list">${clients.rows.map(clientRow).join('')}</div>${more(clients.rows.length, clients.total, 'clients')}`
    : empty(q ? `Aucun client${noMatch}.` : "Aucun client pour l'instant. Ajoute-en un, ou passe un prospect en client : un client est aussi créé quand tu émets un document dans « Facturation ».")}</section>
    <section class="cl-sec" aria-labelledby="cl-t-p-${projectId}"><h3 id="cl-t-p-${projectId}">Prospects <span class="badge">${prospects.total}</span></h3>
      ${prospects.rows.length ? `<div class="cl-list">${prospects.rows.map(prospectRow).join('')}</div>${more(prospects.rows.length, prospects.total, 'prospects')}`
    : empty(q ? `Aucun prospect${noMatch}.` : "Aucun prospect pour l'instant : la prospection se lance depuis la page « Projets ».")}</section>`;
}

// ---------- Page Clients ----------

/** Le déroulant d'un projet (recherche, ajout, export, listes chargées à l'ouverture) ; réutilisé par la page Clients et par l'onglet Clients du projet. */
export const clientProjectBlock = (r, openId) => `<details class="cl-proj" data-cl-project="${r.id}"${r.id === openId ? ' open' : ''}>
    <summary><span class="pname">${esc(r.name)}</span>
      <span class="cl-sum"><span class="badge">${r.counts.clients} client${r.counts.clients > 1 ? 's' : ''}</span><span class="badge">${r.counts.prospects} prospect${r.counts.prospects > 1 ? 's' : ''}</span>${r.counts.pending ? `<span class="badge warn">À encaisser ${esc(money(r.counts.pending))}</span>` : ''}</span></summary>
    <div class="cl-body">
      <div class="cl-tools">
        <form class="cl-search" role="search" method="get" action="/clients" data-cl-search-form><input type="hidden" name="projet" value="${r.id}">
          <label class="sr-only" for="cl-q-${r.id}">Rechercher un client ou un prospect</label>
          <span class="cl-q">${ic('search')}<input id="cl-q-${r.id}" type="search" name="q" placeholder="Rechercher un client ou un prospect…" maxlength="100" autocomplete="off" data-cl-search></span></form>
        <details class="cl-add"><summary class="btn small">${ic('plus')}Ajouter un client</summary>
          <form method="post" action="/clients/projet/${r.id}/ajouter" class="cl-add-f">
            <div class="grid2">
              <label class="field" for="ca-n-${r.id}"><span class="lbl">Nom du client</span><input id="ca-n-${r.id}" name="name" maxlength="120" required autocomplete="off"></label>
              <label class="field" for="ca-c-${r.id}"><span class="lbl">Contact <span class="muted small">(facultatif)</span></span><input id="ca-c-${r.id}" name="contact" maxlength="120" autocomplete="off"></label>
              <label class="field" for="ca-e-${r.id}"><span class="lbl">E-mail</span><input id="ca-e-${r.id}" type="email" name="email" maxlength="255" autocomplete="off"></label>
              <label class="field" for="ca-p-${r.id}"><span class="lbl">Téléphone</span><input id="ca-p-${r.id}" name="phone" maxlength="40" autocomplete="off"></label>
              <label class="field wide" for="ca-a-${r.id}"><span class="lbl">Adresse</span><input id="ca-a-${r.id}" name="address" maxlength="200" autocomplete="off"></label>
              <label class="field" for="ca-s-${r.id}"><span class="lbl">SIRET <span class="muted small">(vide pour un particulier)</span></span><input id="ca-s-${r.id}" name="siret" inputmode="numeric" maxlength="20" autocomplete="off"></label>
            </div>
            <div class="row-actions"><button class="btn primary">Ajouter le client</button></div>
          </form></details>
        <a class="btn small" href="/clients/projet/${r.id}/export.csv" data-noajax>${ic('file')}Exporter les clients (CSV)</a>
      </div>
      <div class="cl-lists" data-cl-lists aria-live="polite">${loadingBlock()}</div>
    </div></details>`;

export function clientsPage({ email, rows, openId, flash }) {
  const total = rows.reduce((a, r) => ({ clients: a.clients + r.counts.clients, prospects: a.prospects + r.counts.prospects, pending: a.pending + r.counts.pending }), { clients: 0, prospects: 0, pending: 0 });
  const items = rows.map((r) => clientProjectBlock(r, openId)).join('');
  const body = `<div class="bill-page" data-clients>
  <section class="card"><div class="row-between"><div><h1>Clients</h1>
    <p class="muted">Pour chaque projet : tes clients et tes prospects, leurs coordonnées, les documents que tu leur as générés et vos échanges.</p></div></div>
    ${flashOf(flash)}
    ${rows.length ? `<dl class="cl-kpis"><div><dt>Clients</dt><dd>${total.clients}</dd></div><div><dt>Prospects</dt><dd>${total.prospects}</dd></div><div><dt>À encaisser</dt><dd>${esc(money(total.pending))}</dd></div></dl>` : ''}
  </section>
  ${rows.length ? `<div class="cl-projects">${items}</div>` : `<div class="empty-s"><p><b>Aucun projet pour l'instant.</b> Les clients se gèrent projet par projet : crée d'abord un projet.</p><a class="btn primary small" href="/">Ouvrir mes projets</a></div>`}
</div>`;
  return layout({ title: 'Clients', email, body, scripts: ['/static/clients.js'] });
}

// ---------- Fiche d'un échange (client ou prospect) ----------

/** `freshNote` : on vient d'ajouter une note, la plus récente (la première du fil) est surlignée un instant. */
function timeline(items, { freshNote = false } = {}) {
  if (!items.length) return '<p class="muted">Aucun échange pour l\'instant : les mails envoyés, les réponses et les notes de ce contact apparaîtront ici.</p>';
  const newest = freshNote ? items.findIndex((x) => x.type === 'note') : -1;
  return `<ol class="cl-tl">${items.map((x, i) => {
    if (x.type === 'sent') {
      return `<li class="cl-tl-i out"><span class="cl-tl-ic">${ic('send')}</span><div><div class="cl-tl-h"><b>${x.kind === 'initial' ? 'Mail envoyé' : 'Relance envoyée'}</b><span class="muted small">${esc(dayTime(x.at))}</span></div>
        <p>${esc(x.subject || '(sans objet)')}</p>${x.error ? `<p class="small err">Échec de l'envoi : ${esc(x.error)}</p>` : x.read ? '<p class="muted small">Lu par le destinataire</p>' : ''}</div></li>`;
    }
    if (x.type === 'reply') {
      const [label, tone] = INTENTS[x.intent] || INTENTS.other;
      return `<li class="cl-tl-i in"><span class="cl-tl-ic">${ic('reply')}</span><div><div class="cl-tl-h"><b>Réponse reçue</b><span class="badge ${tone}">${label}</span><span class="muted small">${esc(dayTime(x.at))}</span></div>
        <p><b>${esc(x.subject || '(sans objet)')}</b></p>${x.body ? `<p class="cl-quote">${esc(x.body).replace(/\n/g, '<br>')}</p>` : ''}</div></li>`;
    }
    return `<li class="cl-tl-i note${i === newest ? ' row-new' : ''}"><span class="cl-tl-ic">${ic('pen')}</span><div><div class="cl-tl-h"><b>Note</b><span class="muted small">${esc(dayTime(x.at))}</span></div><p>${esc(x.body).replace(/\n/g, '<br>')}</p></div></li>`;
  }).join('')}</ol>`;
}

// ---------- Fiche client ----------

export function clientSheetPage({ email, project: p, client: c, documents, totals, exchanges, flash }) {
  const docs = documents.length ? `<div class="table-wrap"><table class="mtable"><thead><tr><th>Numéro</th><th>Émis le</th><th class="num">Montant TTC</th><th>État</th><th><span class="sr-only">PDF</span></th></tr></thead><tbody>${documents.map((d) => `<tr>
      <td><b>${esc(d.number)}</b><span class="td-s">${esc(DOC_BY_KEY[d.kind]?.label || d.kind)}</span></td><td>${esc(d.issueDate.split('-').reverse().join('/'))}</td>
      <td class="num">${esc(money(d.kind === 'avoir' ? -d.amount : d.amount))}</td><td><span class="badge ${STATE[d.state][1]}">${STATE[d.state][0]}</span></td>
      <td><a class="btn small" href="/facturation/factures/${d.id}/pdf" data-noajax>${ic('file')}PDF</a></td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">Aucun document pour ce client. Génère-lui un devis ou une facture : il apparaîtra ici.</p>';
  const body = `<div class="bill-page" data-client-sheet>
  <section class="card"><p><a class="link" href="/clients?projet=${p.id}">${ic('back')} Tous les clients</a></p>
    <div class="row-between"><div><h1>${esc(c.name)}</h1><p class="muted small">Client de « ${esc(p.name)} » · ${esc(host(p.gitUrl))}</p></div>
      <div class="row-actions"><a class="btn primary" href="/p/${p.id}/facturation?client=${c.id}&type=facture#generer">${ic('receipt')}Générer un document</a>
        <form method="post" action="/clients/c/${c.id}/supprimer" data-confirm="Retirer ce client de la liste ? Les documents déjà émis restent dans « Facturation » et dans la Comptabilité."><button class="btn danger">${ic('trash')}Retirer ce client</button></form></div></div>
    ${flashOf(flash)}
    <dl class="cl-kpis"><div><dt>Facturé TTC</dt><dd>${esc(money(totals.billed))}</dd></div><div><dt>Encaissé</dt><dd>${esc(money(totals.paid))}</dd></div><div><dt>À encaisser</dt><dd>${esc(money(totals.pending))}</dd></div><div><dt>Documents</dt><dd>${totals.docs}</dd></div></dl>
  </section>
  <section class="card bill-sec" aria-labelledby="t-inf"><h2 id="t-inf">Informations</h2>
    <form method="post" action="/clients/c/${c.id}" class="bill-issue-f">
      <div class="grid2">
        <label class="field" for="c-n"><span class="lbl">Nom du client</span><input id="c-n" name="name" value="${esc(c.name)}" maxlength="120" required autocomplete="off"></label>
        <label class="field" for="c-c"><span class="lbl">Contact</span><input id="c-c" name="contact" value="${esc(c.contact)}" maxlength="120" autocomplete="off"></label>
        <label class="field" for="c-e"><span class="lbl">E-mail</span><input id="c-e" type="email" name="email" value="${esc(c.email)}" maxlength="255" autocomplete="off"></label>
        <label class="field" for="c-p"><span class="lbl">Téléphone</span><input id="c-p" name="phone" value="${esc(c.phone)}" maxlength="40" autocomplete="off"></label>
        <label class="field wide" for="c-a"><span class="lbl">Adresse</span><input id="c-a" name="address" value="${esc(c.address)}" maxlength="200" autocomplete="off"></label>
        <label class="field" for="c-s"><span class="lbl">SIRET <span class="muted small">(vide pour un particulier)</span></span><input id="c-s" name="siret" value="${esc(c.siret)}" inputmode="numeric" maxlength="20" autocomplete="off"></label>
        <label class="field wide" for="c-t"><span class="lbl">Notes</span><textarea id="c-t" name="notes" rows="4" maxlength="2000" placeholder="Ce qu'il faut savoir sur ce client : préférences, rappels, conditions particulières…">${esc(c.notes)}</textarea></label>
      </div>
      <p class="muted small">Ces informations préremplissent les documents que tu génères pour ce client (nom, adresse, SIRET).${c.prospectId ? ` Ce client vient du prospect : <a class="link" href="/clients/p/${c.prospectId}">voir sa fiche prospect</a>.` : ''}</p>
      <div class="row-actions"><button class="btn primary">Enregistrer</button></div>
    </form></section>
  <section class="card bill-sec" id="documents" aria-labelledby="t-doc"><h2 id="t-doc">Documents générés</h2>${docs}</section>
  <section class="card bill-sec" id="echanges" aria-labelledby="t-ech"><h2 id="t-ech">Échanges</h2>${timeline(exchanges)}
    ${!c.email ? `<p class="muted small">Ajoute l'adresse e-mail du client pour retrouver ici les mails échangés avec lui.</p>` : ''}</section>
</div>`;
  return layout({ title: `${c.name} · Clients`, email, body, scripts: [] });
}

// ---------- Fiche prospect ----------

export function prospectSheetPage({ email, project: p, sheet, flash }) {
  const x = sheet.prospect;
  const body = `<div class="bill-page" data-client-sheet>
  <section class="card"><p><a class="link" href="/clients?projet=${p.id}">${ic('back')} Tous les clients</a></p>
    <div class="row-between"><div><h1>${esc(x.company)}</h1><p class="muted small">Prospect de « ${esc(p.name)} » · <span class="badge">${esc(STATUSES[x.status] || x.status)}</span></p></div>
      <div class="row-actions"><form method="post" action="/clients/p/${x.id}/client" data-confirm="Passer ce prospect en client ? Il passe au statut « Client » et une fiche client est créée." data-confirm-label="Passer en client"><button class="btn primary">${ic('check')}Passer en client</button></form></div></div>
    ${flashOf(flash)}</section>
  <section class="card bill-sec" aria-labelledby="t-pi"><h2 id="t-pi">Informations</h2>
    <dl class="cl-dl"><div><dt>E-mail</dt><dd>${esc(x.email)}</dd></div><div><dt>Site internet</dt><dd>${x.website ? esc(x.website) : '—'}</dd></div><div><dt>Ville</dt><dd>${esc(x.city || '—')}</dd></div>
      <div><dt>Secteur</dt><dd>${esc(x.sector || '—')}</dd></div><div><dt>Score</dt><dd>${x.score == null ? '—' : `${x.score}/10`}</dd></div><div><dt>Premier contact</dt><dd>${esc(day(x.sent_at))}</dd></div>
      ${x.source ? `<div class="wide"><dt>Origine de l'adresse</dt><dd>${esc(x.source)}</dd></div>` : ''}${x.hook ? `<div class="wide"><dt>Accroche</dt><dd>${esc(x.hook)}</dd></div>` : ''}</dl></section>
  <section class="card bill-sec" id="echanges" aria-labelledby="t-pe"><h2 id="t-pe">Échanges</h2>
    <form method="post" action="/clients/p/${x.id}/note" class="cl-note-f"><label class="field" for="pn"><span class="lbl">Ajouter une note</span><textarea id="pn" name="body" rows="2" maxlength="2000" required placeholder="Un appel, un rendez-vous, une remarque…"></textarea></label>
      <div class="row-actions"><button class="btn">Ajouter la note</button></div></form>
    ${timeline(sheet.exchanges, { freshNote: flash.ok === 'note' })}</section>
</div>`;
  return layout({ title: `${x.company} · Clients`, email, body, scripts: [] });
}
