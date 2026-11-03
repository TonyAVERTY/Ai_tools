// Page « Comptabilité » : situation, échéance, points d'attention, chiffres, projets, journal des lignes (avec justificatif), guide de déclaration et aide.
// public/compta.js ouvre la fenêtre d'ajout / de modification et envoie le justificatif avec la ligne.
import { esc } from './http.js';
import { layout } from './views.js';
import { ic } from './icons.js';
import { banner } from './banner.js';
import {
  KINDS, KIND_BY_KEY, CATEGORIES, METHODS, VAT_RATES, REGIMES, ACTIVITIES, VAT_MODES, FREQUENCIES, REFERENCE,
  categoryLabel, methodLabel, fmtEur, dayLabel,
} from './services/accounting.js';

const dmy = (iso) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const cents = (c) => (Number(c) / 100).toFixed(2).replace('.', ',');
const opt = (value, label, selected) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
const KIND_BADGE = { payment_in: 'ok', refund_in: 'ok', expense: '', refund_out: 'warn', social_tax: 'warn', owner_in: '', owner_out: '' };

function radios(name, list, current) {
  return list.map(([key, label, help]) => `<label class="opt radio"><input type="radio" name="${name}" value="${esc(key)}"${key === current ? ' checked' : ''}><span class="box">${ic('check')}</span>
      <span>${esc(label)}${help ? `<small class="muted cmp-help">${esc(help)}</small>` : ''}</span></label>`).join('');
}

/** Les quatre questions sur la situation, posées une à une (même assistant que la page de bienvenue : public/app.js, data-wizard). */
function situationForm(s) {
  const known = s.complete; // à la première visite, rien n'est coché : une réponse est un vrai choix
  const steps = [
    { title: 'Quel est ton statut ?', hint: "Pas d'inquiétude : tu pourras changer ta réponse à tout moment.", required: true, body: radios('regime', REGIMES, s.regime) },
    { title: 'Que vends-tu ?', hint: "Cela décide de la bonne case à remplir le jour de ta déclaration.", body: radios('activity', ACTIVITIES, s.activity) },
    { title: 'Factures-tu la TVA ?', hint: 'Un doute ? Regarde une de tes factures : si elle indique « TVA non applicable, art. 293 B du CGI », tu es en franchise de TVA.', body: radios('vat', VAT_MODES, s.vat) },
    { title: 'À quel rythme déclares-tu ?', hint: "Tu l'as choisi en créant ton activité. Sans réponse, on part sur le trimestre, le choix le plus courant ; tu le retrouves sur ton compte URSSAF.", body: radios('freq', FREQUENCIES.map(([k, l]) => [k, l, '']), known ? s.freq : '') },
  ];
  return `<div class="wiz"><form method="post" action="/compta/situation" class="cmp-situation" data-wizard data-wiz-json="/compta/situation?json=1" data-wiz-go="/compta?ok=situation" data-wiz-end-title="Ta situation est enregistrée" data-wiz-end-text="On prépare ta comptabilité.">
    <div class="wiz-top">
      <p class="wiz-n"><span data-wiz-count>Question 1 sur ${steps.length}</span><b data-wiz-pct>0 %</b></p>
      <div class="bar" role="progressbar" aria-label="Questions répondues" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="w-0" data-wiz-bar></span></div>
      <ol class="wiz-dots" aria-hidden="true">${steps.map(() => `<li data-dot>${ic('check')}</li>`).join('')}</ol>
    </div>
    ${steps.map((st, i) => `<fieldset class="wiz-step" data-step${st.required ? ' data-required' : ''}${i ? ' hidden' : ''}><legend>${esc(st.title)}</legend><p class="hint">${esc(st.hint)}</p>${st.body}${st.required ? '<p class="error small" role="alert" data-wiz-error hidden>Choisis une réponse pour continuer.</p>' : ''}</fieldset>`).join('\n    ')}
    <div class="wiz-confirm" data-wiz-confirm aria-hidden="true"><span class="wiz-big">${ic('check')}</span></div>
    <p class="sr-only" role="status" data-wiz-live></p>
    <div class="wiz-f"><button type="button" class="btn" data-wiz-back hidden>Retour</button><button class="btn primary" data-wiz-next>Continuer</button></div>
  </form></div>`;
}

function summaryLine(s) {
  const r = REGIMES.find(([k]) => k === s.regime)?.[1] || '';
  const a = ACTIVITIES.find(([k]) => k === s.activity)?.[1].replace(/ \(.*\)$/, '') || '';
  const v = VAT_MODES.find(([k]) => k === s.vat)?.[1] || '';
  const f = FREQUENCIES.find(([k]) => k === s.freq)?.[1] || '';
  return [r, a, v, `déclaration ${f.toLowerCase()}`].filter(Boolean).join(' · ');
}

function entryRow(r, d) {
  const kind = KIND_BY_KEY[r.kind];
  const sign = kind.dir === 'in' ? '+' : '−';
  const data = {
    id: Number(r.id), kind: r.kind, date: r.entry_date, label: r.label, party: r.party, category: r.category, amount: cents(r.amount_cents), vatRate: Number(r.vat_rate),
    method: r.method, notes: r.notes, projectId: r.project_id == null ? '' : String(r.project_id), docName: r.doc_name,
  };
  const project = r.project_name ? `${esc(r.project_name)}${r.project_id == null ? ' (supprimé)' : ''}` : 'Hors projet';
  return `<tr>
    <td class="nowrap">${esc(dmy(r.entry_date))}</td>
    <td><b>${esc(r.label)}</b><span class="td-s">${[r.party && esc(r.party), project, esc(categoryLabel(kind.group, r.category))].filter(Boolean).join(' · ')}</span></td>
    <td><span class="badge ${KIND_BADGE[r.kind]}">${esc(kind.label)}</span></td>
    <td class="num ${kind.dir === 'in' ? 'cmp-in' : ''}"><b>${sign} ${esc(fmtEur(r.amount_cents))}</b>${Number(r.vat_cents) ? `<span class="td-s">dont ${esc(fmtEur(r.vat_cents))} de TVA</span>` : ''}</td>
    <td><a class="cmp-doc" href="/compta/entries/${r.id}/file" target="_blank" rel="noopener noreferrer" data-noajax>${ic('clip')}<span>${esc(r.doc_name)}</span></a>
      <a class="td-s" href="/compta/entries/${r.id}/file?telecharger=1" data-noajax>Télécharger</a></td>
    <td class="cmp-act"><button type="button" class="btn small" data-compta-edit="${esc(JSON.stringify(data))}" aria-label="Modifier la ligne ${esc(r.label)}">${ic('pen')}Modifier</button>
      <form method="post" action="/compta/entries/${r.id}/delete" data-confirm="Supprimer cette ligne et son justificatif ? Cette action est définitive."><button class="btn small danger" aria-label="Supprimer la ligne ${esc(r.label)}">${ic('trash')}Supprimer</button></form></td>
  </tr>`;
}

function guideBlock(g, d) {
  const where = g.where ? `<a class="btn" href="${esc(g.where.url)}" target="_blank" rel="noopener noreferrer">${ic('globe')}Ouvrir ${esc(g.where.name)}</a>` : '';
  const amounts = g.amounts.length ? `<div class="table-wrap"><table class="mtable cmp-amounts"><thead><tr><th>Où le saisir</th><th class="num">Montant</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${g.amounts.map((a) => `<tr><td><b>${esc(a.label)}</b><span class="td-s">${esc(a.hint)}</span></td><td class="num"><b>${esc(a.value)}</b></td>
        <td><button type="button" class="btn small" data-compta-copy="${esc(a.raw)}">${ic('copy')}Copier</button></td></tr>`).join('')}
    </tbody></table></div>` : '';
  const deadline = g.deadline ? `<p class="cmp-deadline">${ic('clock')}<span>À faire avant le <b>${esc(dayLabel(g.deadline))}</b>${d.settings.regime === 'reel' ? ' (la date exacte dépend de ton service des impôts : elle figure dans ton espace professionnel)' : ''}.</span></p>` : '';
  return `<section class="card cmp-guide" id="declaration" aria-labelledby="t-decl">
    <div class="row-between"><h2 id="t-decl">${esc(g.title)}</h2>
      ${d.settings.complete && d.settings.regime !== 'unknown' ? `<form method="get" action="/compta" class="inline-form"><label class="sr-only" for="decl-p">Période à déclarer</label>
        <select id="decl-p" name="declarer" data-autosubmit>${d.declOptions.map(([p, l]) => opt(p, l, p === g.period)).join('')}</select><noscript><button class="btn small">Afficher</button></noscript></form>` : ''}</div>
    ${deadline}
    ${g.done ? banner('ok', 'Tu as indiqué avoir fait cette déclaration.') : ''}
    <p class="lbl">Comment faire, pas à pas</p>
    <ol class="cmp-steps">${g.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    ${where ? `<div class="row-actions">${where}</div>` : ''}
    ${amounts}
    <p class="muted small">Ce guide vient de ta situation : ${esc(summaryLine(d.settings))}. <a href="/compta?situation=1">Modifier mes réponses</a></p>
    ${g.notes.length ? `<ul class="cmp-notes">${g.notes.map((n) => `<li>${ic('info')}<span>${esc(n)}</span></li>`).join('')}</ul>` : ''}
    <div class="row-actions">
      <a class="btn small" href="/compta?periode=${esc(g.period)}#journal">Voir les lignes de cette période</a>
      ${d.settings.regime !== 'unknown' && d.settings.complete ? (g.done
    ? `<form method="post" action="/compta/declaration"><input type="hidden" name="period" value="${esc(g.period)}"><input type="hidden" name="done" value="0"><button class="btn small">Je ne l'ai pas encore faite</button></form>`
    : `<form method="post" action="/compta/declaration"><input type="hidden" name="period" value="${esc(g.period)}"><input type="hidden" name="done" value="1"><button class="btn primary">${ic('check')}J'ai fait ma déclaration</button></form>`) : ''}
    </div>
  </section>`;
}

const HELP = [
  ["Qu'est-ce qu'un justificatif ?", '<p>C\'est la preuve d\'une ligne : la facture que tu as envoyée à un client, la facture ou le reçu d\'un fournisseur, un ticket, ou le relevé d\'un paiement Stripe ou PayPal. Une photo nette ou un PDF suffit.</p><p>Sans preuve, une dépense peut être refusée en cas de contrôle. C\'est pourquoi AiTools demande un justificatif pour chaque ligne.</p>'],
  ['TTC, HT, TVA : quelle différence ?', '<p><b>HT</b> : le prix sans la TVA. <b>TTC</b> : le prix avec la TVA, c\'est ce qui est réellement payé. La <b>TVA</b> est une taxe que tu collectes pour l\'État quand tu y es soumis.</p><p>Saisis toujours le montant <b>TTC</b> réellement payé : AiTools en déduit la TVA et le montant HT. Si tu ne factures pas la TVA (franchise en base), HT et TTC sont identiques.</p>'],
  ['Encaissé ou facturé : quelle date choisir ?', '<p>En micro-entreprise, ce qui compte est l\'argent <b>reçu</b> : la date est celle du paiement sur ton compte, pas celle de la facture. Ajoute donc une ligne « Paiement reçu » le jour où l\'argent arrive.</p>'],
  ['Combien de temps garder les justificatifs ?', '<p>Les documents comptables et leurs pièces justificatives se conservent <b>10 ans</b> (à titre indicatif). AiTools garde les tiens tant que tu ne supprimes pas la ligne ou ton compte. Pense à exporter régulièrement : le bouton « Tout exporter » crée une archive à ranger de ton côté.</p>'],
  ['Que doit contenir une facture ?', '<p>La date et un numéro unique ; ton nom, ton adresse et ton SIREN ; le nom et l\'adresse du client ; la description et le prix HT ; le taux et le montant de TVA, ou la mention « TVA non applicable, art. 293 B du CGI » ; le total TTC ; les conditions de paiement (pénalités de retard et indemnité forfaitaire de 40 € entre professionnels).</p>'],
  ['Apport, prêt, retrait : pourquoi ces types ?', '<p>L\'argent que tu mets dans l\'activité ou que tu en retires pour toi n\'est ni un gain ni une dépense : il apparaît dans le journal mais n\'entre jamais dans ton chiffre d\'affaires ni dans le montant à déclarer.</p>'],
  ["J'ai perdu un justificatif : que faire ?", '<p>Demande un <b>duplicata</b> à la personne qui l\'a émis : un fournisseur peut te renvoyer sa facture, et un service en ligne (hébergeur, Stripe, PayPal…) la garde dans ton espace client. Pour un paiement reçu, refais une copie de la facture que tu as envoyée.</p><p>Tant que tu n\'as pas la pièce, n\'ajoute pas la ligne : une ligne sans preuve ne sert à rien en cas de contrôle.</p>'],
  ['Comment corriger une erreur ?', '<p>Dans le journal, clique <b>Modifier</b> sur la ligne : tu changes le montant, la date ou la catégorie, et tu peux remplacer le justificatif. <b>Supprimer</b> efface la ligne et son justificatif, définitivement.</p>'],
  ['Cette page remplace-t-elle un comptable ?', `<p>Non. Elle t'aide à ranger tes pièces, à suivre tes chiffres et à savoir quoi déclarer. Les plafonds affichés sont des valeurs de référence ${REFERENCE.year} : vérifie-les sur service-public.fr. Pour un cas particulier (société, TVA, investissement), demande conseil à un expert-comptable.</p>`],
];

function dialog(d) {
  const cats = Object.fromEntries(Object.entries(CATEGORIES));
  const kindMeta = Object.fromEntries(KINDS.map((k) => [k.key, { group: k.group, vat: k.vat, dir: k.dir }]));
  return `<dialog class="prospect-dialog cmp-dlg" data-compta-dlg aria-labelledby="cmp-dlg-t">
  <form data-compta-form novalidate>
    <div class="row-between dlg-head"><h2 id="cmp-dlg-t" data-compta-title>Ajouter une ligne</h2><button type="button" class="btn small" data-compta-close>Fermer</button></div>
    <p class="muted small">Une ligne = un paiement, une dépense ou un remboursement, avec sa preuve (facture, reçu).</p>
    <fieldset class="cmp-kinds"><legend>Que s'est-il passé ?</legend>
      ${KINDS.map((k, i) => `<label class="opt radio"><input type="radio" name="kind" value="${k.key}"${i === 0 ? ' checked' : ''}><span class="box">${ic('check')}</span><span>${esc(k.label)}<small class="muted cmp-help">${esc(k.help)}</small></span></label>`).join('')}
    </fieldset>
    <div class="grid2">
      <label class="field"><span class="lbl">Date du paiement</span><input type="date" name="date" max="${esc(d.today)}" value="${esc(d.today)}" required></label>
      <label class="field"><span class="lbl">Montant TTC (réellement payé)</span><span class="unit"><input name="amount" inputmode="decimal" placeholder="49,90" autocomplete="off" required><span>€</span></span></label>
    </div>
    <label class="field" data-compta-vat${d.settings.vat === 'franchise' ? ' hidden' : ''}><span class="lbl">TVA</span>
      <select name="vatRate">${VAT_RATES.map(([r, l]) => opt(r, l, r === 2000)).join('')}</select>
      <span class="hint muted" data-compta-split aria-live="polite"></span></label>
    <label class="field"><span class="lbl">Libellé</span><input name="label" maxlength="120" placeholder="Facture 2026-014, abonnement hébergement…" required></label>
    <div class="grid2">
      <label class="field"><span class="lbl">Client ou fournisseur <span class="muted">(facultatif)</span></span><input name="party" maxlength="120" autocomplete="off"></label>
      <label class="field"><span class="lbl">Catégorie</span><select name="category" data-compta-cats></select></label>
    </div>
    <div class="grid2">
      <label class="field"><span class="lbl">Projet concerné</span><select name="projectId"><option value="">Aucun (hors projet)</option>${d.projects.map((p) => opt(p.id, p.name, false)).join('')}</select></label>
      <label class="field"><span class="lbl">Moyen de paiement</span><select name="method">${METHODS.map(([k, l]) => opt(k, l, k === 'transfer')).join('')}</select></label>
    </div>
    <label class="field"><span class="lbl">Justificatif (obligatoire)</span>
      <input type="file" name="doc" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" data-compta-file required>
      <span class="hint muted" data-compta-fileinfo>PDF ou image (JPG, PNG, WebP), ${Math.round(d.limits.fileBytes / 1048576)} Mo au plus. Une photo nette du ticket ou de la facture suffit.</span></label>
    <label class="field"><span class="lbl">Note <span class="muted">(facultatif)</span></span><textarea name="notes" rows="2" maxlength="400"></textarea></label>
    <p class="error small" role="alert" data-compta-error hidden></p>
    <div class="row-actions"><button type="button" class="btn" data-compta-close>Annuler</button><button class="btn primary" data-compta-save>Enregistrer la ligne</button></div>
  </form>
  <script type="application/json" data-compta-data>${JSON.stringify({ cats, kinds: kindMeta, franchise: d.settings.vat === 'franchise' }).replace(/</g, '\\u003c')}</script>
</dialog>`;
}

export function accountingPage(d) {
  const s = d.settings;
  const t = d.totals;
  const vatMode = s.vat === 'assujetti';
  const qs = (over = {}) => {
    const q = new URLSearchParams();
    const all = { periode: d.periodValue, projet: d.filters.projet, type: d.filters.type, q: d.filters.q, ...over };
    for (const [k, v] of Object.entries(all)) if (v) q.set(k, v);
    return q.toString();
  };
  const exportHref = (extra = {}) => `/compta/export?${new URLSearchParams({ periode: d.periodValue, ...extra }).toString()}`;
  const hasAny = d.count > 0;

  const flash = d.error ? banner('err', d.error) : d.saved === 'situation' ? banner('ok', 'Ta situation est enregistrée.')
    : d.saved === 'payee' ? banner('ok', 'Facture marquée payée : elle compte maintenant dans tes chiffres.') : d.saved === 'supprimee' ? banner('ok', 'Ligne supprimée.') : d.saved === 'declaration' ? banner('ok', 'C\'est noté.') : '';

  const nextCard = d.next ? `<section class="card cmp-next" aria-labelledby="t-next">
      <div><h2 id="t-next">Prochaine déclaration</h2>
        <p>Pour ${esc(d.next.label)}${d.next.deadline ? `, avant le <b>${esc(dayLabel(d.next.deadline))}</b>` : ''}.
          ${d.next.done ? '<span class="badge ok">Faite</span>' : d.next.left < 0 ? '<span class="badge err">En retard</span>' : d.next.left <= 7 ? `<span class="badge warn">Dans ${d.next.left} jour${d.next.left > 1 ? 's' : ''}</span>` : `<span class="badge">À faire</span>`}</p></div>
      <a class="btn ${d.next.done ? '' : 'primary'}" href="/compta?declarer=${esc(d.next.period)}#declaration">${ic('file')}Faire ma déclaration</a></section>` : '';

  const shown = d.alerts.filter((a) => a.code !== 'declaration' || !d.next);
  const alerts = shown.length ? `<section class="card" aria-labelledby="t-al"><h2 id="t-al">Points d'attention</h2>
      <ul class="cmp-alerts">${shown.map((a) => `<li class="${a.level}">${ic(a.level === 'info' ? 'info' : 'alert')}<span>${esc(a.text)}</span></li>`).join('')}</ul></section>` : '';

  const kpi = (label, value, sub, cls = '') => `<div class="ukpi-c${cls ? ` ${cls}` : ''}"><dt>${esc(label)}</dt><dd><b>${esc(fmtEur(value))}</b><span>${esc(sub)}</span></dd></div>`;
  const kpis = `<dl class="ukpi-r cmp-kpi">
      ${kpi('Encaissé', t.revenue, vatMode ? 'paiements reçus, hors TVA' : 'paiements reçus')}
      ${kpi('Dépensé', t.expenses, vatMode ? 'dépenses, hors TVA' : 'dépenses de l\'activité')}
      ${kpi('Cotisations et impôts', t.taxes, 'déjà payés')}
      ${kpi('Il te reste', t.result, 'encaissé − dépensé − cotisations', t.result < 0 ? 'full' : '')}
      ${vatMode ? kpi(t.vatDue >= 0 ? 'TVA à reverser' : 'Crédit de TVA', Math.abs(t.vatDue), 'collectée − déductible') : ''}
    </dl>`;

  const projectTable = `<div class="table-wrap"><table class="mtable"><thead><tr><th>Projet</th><th class="num">Encaissé</th><th class="num">Dépensé</th><th class="num">Il reste</th><th class="num">Lignes</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${d.projectRows.map((g) => `<tr><td><b>${esc(g.label)}</b></td><td class="num">${esc(fmtEur(g.totals.revenue))}</td><td class="num">${esc(fmtEur(g.totals.expenses))}</td>
        <td class="num ${g.totals.result < 0 ? 'cmp-neg' : ''}">${esc(fmtEur(g.totals.result))}</td><td class="num">${g.count}</td>
        <td class="cmp-act">${g.count ? `<a class="btn small" href="/compta?${esc(qs({ projet: g.key }))}#journal">Voir</a>
          <a class="btn small" href="${esc(exportHref({ projet: g.key }))}" data-noajax>${ic('dl')}Exporter</a>` : '<span class="muted small">Aucune ligne</span>'}</td></tr>`).join('')}
      <tr class="cmp-total"><td><b>Tous les projets</b></td><td class="num"><b>${esc(fmtEur(t.revenue))}</b></td><td class="num"><b>${esc(fmtEur(t.expenses))}</b></td><td class="num"><b>${esc(fmtEur(t.result))}</b></td><td class="num"><b>${t.count}</b></td>
        <td class="cmp-act">${t.count ? `<a class="btn small" href="${esc(exportHref())}" data-noajax>${ic('dl')}Exporter</a>` : ''}</td></tr>
    </tbody></table></div>`;

  const pendingKind = (r) => (r.kind === 'refund_out' ? 'À rembourser' : 'À encaisser');
  const pendingCard = d.pendingRows?.length ? `<section class="card cmp-pending" id="a-encaisser" aria-labelledby="t-pend">
    <div class="card-h"><h2 id="t-pend">Factures émises, à encaisser</h2><p>Générées depuis « Facturation ». Elles ne comptent dans tes chiffres qu'une fois marquées payées, à la date où l'argent arrive.</p></div>
    <div class="table-wrap"><table class="mtable cmp-table"><thead><tr><th>Émise le</th><th>Facture</th><th>Client</th><th class="num">Montant TTC</th><th>Justificatif</th><th>Paiement</th></tr></thead><tbody>${d.pendingRows.map((r) => `<tr>
      <td>${esc(dayLabel(r.entry_date))}</td>
      <td><b>${esc(r.label)}</b><span class="td-s"><span class="badge warn">${pendingKind(r)}</span></span></td>
      <td>${esc(r.party)}</td>
      <td class="num"><b>${r.kind === 'refund_out' ? '−' : '+'} ${esc(fmtEur(r.amount_cents))}</b></td>
      <td><a class="cmp-doc" href="/compta/entries/${r.id}/file" target="_blank" rel="noopener noreferrer" data-noajax>${ic('clip')}<span>${esc(r.doc_name)}</span></a>
        <a class="td-s" href="/compta/entries/${r.id}/file?telecharger=1" data-noajax>Télécharger</a></td>
      <td><form method="post" action="/compta/entries/${r.id}/paid" class="cmp-paid"><label class="sr-only" for="paid-${r.id}">Date du paiement</label><input id="paid-${r.id}" type="date" name="date" value="${esc(d.today)}" max="${esc(d.today)}" required>
        <button class="btn small primary">${r.kind === 'refund_out' ? 'Marquer remboursée' : 'Marquer payée'}</button></form></td></tr>`).join('')}</tbody></table></div></section>` : '';

  const journal = d.rows.length
    ? `<div class="table-wrap"><table class="mtable cmp-table"><thead><tr><th>Date</th><th>Libellé</th><th>Type</th><th class="num">Montant TTC</th><th>Justificatif</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${d.rows.map((r) => entryRow(r, d)).join('')}</tbody></table></div>`
    : `<div class="empty-s"><p><b>${hasAny ? 'Aucune ligne pour cette sélection.' : "Aucune ligne pour l'instant."}</b> ${hasAny ? 'Change la période ou les filtres.' : 'Ajoute ton premier paiement reçu ou ta première dépense, avec sa facture : le tableau de bord se remplit tout seul.'}</p>
      ${hasAny ? `<a class="btn small" href="/compta?periode=tout#journal">Voir toute la période</a>` : '<button type="button" class="btn primary small" data-compta-add>Ajouter une ligne</button>'}</div>`;
  const pager = d.pages > 1 ? `<nav class="pager" aria-label="Pages">${d.page > 1 ? `<a class="btn small" href="/compta?${esc(qs({ page: String(d.page - 1) }))}#journal">Précédent</a>` : ''}
      <span class="muted small">Page ${d.page} / ${d.pages}</span>${d.page < d.pages ? `<a class="btn small" href="/compta?${esc(qs({ page: String(d.page + 1) }))}#journal">Suivant</a>` : ''}</nav>` : '';

  // Première visite (ou modification demandée depuis le guide de déclaration) : seules les questions s'affichent ; le reste de la page apparaît une fois la situation enregistrée
  if (!s.complete || d.editSituation) {
    const first = `<div data-compta data-today="${esc(d.today)}">
  ${flash}
  <section class="card" id="situation" aria-labelledby="t-sit"><h1 id="t-sit">${s.complete ? 'Comptabilité : modifie ta situation' : 'Comptabilité : dis-nous où tu en es'}</h1>
    <p class="muted">${s.complete ? 'Tes réponses actuelles sont cochées : change ce qui doit l\'être, puis termine. Tes lignes et tes justificatifs ne bougent pas.' : 'Quatre questions, une seule fois. Elles servent à te dire quoi déclarer, où et quand. Ensuite ta comptabilité s\'ouvre : tes lignes, tes chiffres, ta déclaration. Tu pourras modifier tes réponses plus tard, depuis « Faire ma déclaration ».'}</p>${situationForm(s)}</section>
</div>`;
    return layout({ title: 'Comptabilité', email: d.email, body: first, scripts: ['/static/compta.js'] });
  }

  const body = `<div data-compta data-today="${esc(d.today)}">
  <section class="card">
    <div class="row-between"><div><h1>Comptabilité</h1>
      <p class="muted">Tes paiements, tes dépenses et leurs justificatifs, pour tous tes projets. Cette comptabilité est personnelle : seules tes lignes s'affichent ici, même pour un projet partagé en équipe.</p></div>
      <div class="row-actions">
        <button type="button" class="btn primary" data-compta-add>${ic('plus')}Ajouter une ligne</button>
        <a class="btn" href="/compta?declarer=${esc(d.next?.period || '1')}#declaration">${ic('file')}Faire ma déclaration</a>
        ${hasAny ? `<a class="btn" href="${esc(exportHref())}" data-noajax>${ic('dl')}Tout exporter</a>
        <a class="btn" href="/compta/journal.csv?${esc(new URLSearchParams({ periode: d.periodValue }).toString())}" data-noajax>${ic('receipt')}Journal CSV</a>` : ''}
      </div></div>
    ${hasAny ? `<p class="muted small">« Tout exporter » crée une archive avec tous les justificatifs de la période (${esc(d.periodLabel)}), classés par projet, et le journal pour ton comptable.</p>` : ''}
    ${flash}
  </section>

  ${nextCard}
  ${d.guide ? guideBlock(d.guide, d) : ''}
  ${alerts}

  <section class="card" aria-labelledby="t-fig">
    <div class="row-between"><h2 id="t-fig">Tes chiffres</h2>
      <form method="get" action="/compta" class="inline-form"><label class="sr-only" for="cmp-per">Période</label>
        <select id="cmp-per" name="periode" data-autosubmit>${d.periodOptions.map(([v, l]) => opt(v, l, v === d.periodValue)).join('')}</select><noscript><button class="btn small">Afficher</button></noscript></form></div>
    <p class="muted small">Période : ${esc(d.periodLabel)}. Seuls les paiements réellement reçus et les dépenses réellement payées comptent ; les apports et retraits personnels n'y entrent pas.</p>
    ${kpis}
  </section>

  <section class="card" aria-labelledby="t-proj"><h2 id="t-proj">Par projet</h2>${projectTable}</section>

  ${pendingCard}
  <section class="card" id="journal" aria-labelledby="t-jr">
    <div class="row-between"><h2 id="t-jr">Journal des lignes</h2>
      <form method="get" action="/compta" class="cmp-filters"><input type="hidden" name="periode" value="${esc(d.periodValue)}">
        <label class="sr-only" for="cmp-fp">Projet</label><select id="cmp-fp" name="projet" data-autosubmit><option value="">Tous les projets</option><option value="none"${d.filters.projet === 'none' ? ' selected' : ''}>Hors projet</option>${d.projects.map((p) => opt(p.id, p.name, String(p.id) === d.filters.projet)).join('')}</select>
        <label class="sr-only" for="cmp-ft">Type</label><select id="cmp-ft" name="type" data-autosubmit><option value="">Tous les types</option>${KINDS.map((k) => opt(k.key, k.label, k.key === d.filters.type)).join('')}</select>
        <label class="sr-only" for="cmp-fq">Rechercher</label><input id="cmp-fq" type="search" name="q" value="${esc(d.filters.q)}" placeholder="Rechercher…" maxlength="80">
        <button class="btn small">Filtrer</button></form></div>
    <p class="muted small">${d.total} ligne${d.total > 1 ? 's' : ''}. Chaque ligne a son justificatif : clique sur son nom pour l'ouvrir.</p>
    ${journal}${pager}
  </section>

  <section class="card cmp-faq" aria-labelledby="t-help"><div class="card-h"><h2 id="t-help">Questions fréquentes</h2><p>Les réponses aux questions que se pose tout le monde en débutant.</p></div>
    <div class="faq">${HELP.map(([q, a]) => `<details class="faq-i"><summary><span>${esc(q)}</span>${ic('chev')}</summary><div class="faq-a">${a}</div></details>`).join('')}</div>
    <p class="muted small">Espace utilisé par tes justificatifs : ${(d.usedBytes / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo sur ${Math.round(d.limits.perUserBytes / 1048576)} Mo.</p>
  </section>
  ${dialog(d)}
</div>`;
  return layout({ title: 'Comptabilité', email: d.email, body, scripts: ['/static/compta.js'] });
}
