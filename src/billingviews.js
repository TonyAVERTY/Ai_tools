// Pages « Facturation » : recap des projets, puis pour un projet les informations légales, le choix du devis et les quatre documents.
// public/facturation.js suit les tâches de Claude en cours et recharge la page quand elles se terminent.
import { todayIso, fmtEur } from './services/accounting.js';
import { esc } from './http.js';
import { layout } from './views.js';
import { ic } from './icons.js';
import { LEGAL_FIELDS, LEGAL_SECTIONS, DOC_KINDS, DOC_BY_KEY, LAYOUTS, stageLabel, legalMissing, DOC_VARIABLES } from './services/billing.js';
import { banner } from './banner.js';

const CTA = { legal: 'Compléter les informations', generate: 'Générer un modèle de document', choose: 'Choisir mon devis', docs_pending: 'Suivre la préparation', validate: 'Valider mes documents', ready: 'Voir mes documents' };
const host = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/\.git$/, '').slice(0, 80);

function stepper(steps, current) {
  return `<ol class="bill-steps" aria-label="Étapes de la facturation">${steps.map((s, i) => `<li class="${s.done ? 'done' : s.id === current ? 'on' : ''}"${s.id === current ? ' aria-current="step"' : ''}><span class="bill-dot">${s.done ? ic('check') : i + 1}</span><span>${esc(s.label)}</span></li>`).join('')}</ol>`;
}
const stageStep = { legal: 'legal', generate: 'quote', choose: 'quote', docs_pending: 'docs', validate: 'docs', ready: 'docs' };

// ---------- Recap ----------

export function billingOverviewPage({ email, rows }) {
  const ready = rows.filter((r) => r.stage.stage === 'ready').length;
  const list = rows.length ? rows.map((r) => {
    const [label, tone] = stageLabel(r.stage, r.missing);
    return `<article class="card bill-proj" aria-labelledby="bp-${r.id}">
      <div class="bill-proj-h"><div><h2 id="bp-${r.id}">${esc(r.name)}</h2><p class="muted small">${esc(host(r.gitUrl))}</p></div><span class="badge ${tone}">${esc(label)}</span></div>
      ${r.resume ? `<p class="bill-resume">${esc(r.resume.length > 190 ? `${r.resume.slice(0, 190)}…` : r.resume)}</p>` : ''}
      ${stepper(r.stage.steps, stageStep[r.stage.stage])}
      <div class="row-actions"><a class="btn ${r.stage.stage === 'ready' ? '' : 'primary'}" href="/facturation/projet/${r.id}">${esc(CTA[r.stage.stage])}</a>
        ${r.stage.busy ? `<span class="muted small bill-busy"><span class="spin-inline" aria-hidden="true"></span>Claude travaille…</span>` : ''}</div></article>`;
  }).join('') : `<div class="empty-s"><p><b>Aucun projet pour l'instant.</b> La facturation se prépare projet par projet : crée d'abord un projet.</p><a class="btn primary small" href="/">Ouvrir mes projets</a></div>`;
  const body = `<div data-bill class="bill-page">
  <section class="card"><div class="row-between"><div><h1>Facturation</h1>
    <p class="muted">Pour chaque projet : tes informations légales, puis des modèles de devis, d'acompte, de facture finale et d'avoir écrits avec Claude, prêts à être utilisés dans iaboss.</p></div></div>
    ${rows.length ? `<p class="bill-sum"><b>${ready}</b> projet${ready > 1 ? 's' : ''} prêt${ready > 1 ? 's' : ''} sur <b>${rows.length}</b></p>
    <div class="bar" role="progressbar" aria-label="Projets prêts" aria-valuemin="0" aria-valuemax="${rows.length}" aria-valuenow="${ready}"><span class="w-${Math.round((100 * ready) / rows.length / 5) * 5}"></span></div>` : ''}
  </section>
  <div class="bill-list">${list}</div>
</div>`;
  return layout({ title: 'Facturation', email, body, scripts: ['/static/facturation.js'], named: true });
}

// ---------- Un projet ----------

const SRC = { 'un autre de tes projets': "d'un autre de tes projets" };
function fieldHtml(f, value, error, suggestion) {
  const id = `lf-${f.key}`;
  const shown = value || (suggestion ? suggestion.value : '');
  const from = !value && suggestion ? `<span class="badge info bill-src">${ic('git')} Repris ${esc(SRC[suggestion.source] || `de ${suggestion.source}`)}</span>` : '';
  const need = f.required({ legal_form: 'sas', vat_mode: 'assujetti' }) ? '' : ' <span class="muted">(facultatif)</span>';
  let input;
  if (f.type === 'select') {
    input = `<select id="${id}" name="${f.key}"${error ? ' aria-invalid="true"' : ''}><option value="">Choisir…</option>${f.options.map(([k, l]) => `<option value="${esc(k)}"${k === shown ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea id="${id}" name="${f.key}" rows="3" maxlength="${f.max}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}${error ? ' aria-invalid="true"' : ''}>${esc(shown)}</textarea>`;
  } else {
    const inp = `<input id="${id}" name="${f.key}" value="${esc(shown)}"${f.type === 'number' ? ' inputmode="numeric"' : ''} maxlength="${f.max || 4}" autocomplete="off"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}${error ? ' aria-invalid="true"' : ''}>`;
    input = f.unit ? `<span class="unit">${inp}<span>${esc(f.unit)}</span></span>` : inp;
  }
  return `<label class="field${f.key === 'offer_description' || f.key === 'pricing_notes' || f.key === 'activity_label' ? ' wide' : ''}" for="${id}"><span class="lbl">${esc(f.label)}${need}</span>${input}${from}
    ${error ? `<span class="error small" role="alert">${esc(error)}</span>` : ''}${f.hint ? `<span class="hint muted">${esc(f.hint)}</span>` : ''}</label>`;
}

function legalForm(p, legal, errors, suggestions, open) {
  const missing = legalMissing(legal);
  return `<section class="card bill-sec" id="legal" aria-labelledby="t-legal">
    <div class="row-between"><div><h2 id="t-legal">1. Informations légales</h2>
      <p class="muted">${missing.length ? `${missing.length} information${missing.length > 1 ? 's' : ''} à compléter. Ce que Claude a trouvé dans ton projet, ou que tu as déjà saisi ailleurs, est prérempli : vérifie-le, rien n'est enregistré avant « Enregistrer les informations ». Le reste, seul toi le sais.` : 'Tout est rempli. Ces informations figurent sur tes devis et tes factures.'}</p></div>
      <span class="badge ${missing.length ? 'warn' : 'ok'}">${missing.length ? `${missing.length} à compléter` : 'Complet'}</span></div>
    <details class="bill-det"${open ? ' open' : ''}><summary class="btn small">${missing.length ? 'Remplir les informations' : 'Modifier les informations'}</summary>
    <form method="post" action="/facturation/projet/${p.id}/legal" class="bill-form">
      ${LEGAL_SECTIONS.map(([sec, title]) => `<fieldset class="bill-fs"><legend>${esc(title)}</legend><div class="grid2">${LEGAL_FIELDS.filter((f) => f.section === sec).map((f) => fieldHtml(f, legal[f.key], errors[f.key], suggestions[f.key])).join('')}</div></fieldset>`).join('')}
      <div class="row-actions"><button class="btn primary">Enregistrer les informations</button></div>
    </form></details></section>`;
}

const frame = (d) => `<iframe class="bill-frame" sandbox title="Aperçu : ${esc(d.content.title)}" loading="lazy" src="/facturation/documents/${d.id}/apercu"></iframe>`;
const refineForm = (p, d, label, open = false, summary = 'Affiner avec Claude') => `<details class="bill-refine"${open ? ' open' : ''}><summary>${ic('pen')}${summary}</summary>
    <form method="post" action="/facturation/projet/${p.id}/affiner"><input type="hidden" name="doc" value="${d.id}">
      <label class="field"><span class="lbl">Ce que tu veux changer</span><textarea name="request" rows="3" maxlength="800" required placeholder="Ex. : un ton plus chaleureux, ajouter une ligne « formation de 2 heures », réduire l'acompte à 20 %…"></textarea></label>
      <div class="row-actions"><button class="btn">${label}</button></div></form></details>`;

function quoteSection(p, docs, chosen, stage, legal, busy) {
  const opts = docs.filter((d) => d.kind === 'quote_option');
  const generateBtn = (label, cls = 'primary') => `<form method="post" action="/facturation/projet/${p.id}/generer"><button class="btn ${cls}"${busy ? ' disabled' : ''}>${ic('spark')}${label}</button></form>`;
  let inner;
  if (!opts.length) {
    inner = `<div class="bill-cta"><p>Claude va proposer <b>trois exemples de devis</b> écrits d'après ton projet et tes informations. Tu en choisis un, tu l'affines, puis tu le valides.</p>${generateBtn('Générer un modèle de document')}</div>`;
  } else {
    const sel = opts.find((o) => o.variant === chosen);
    inner = `${!legal.pricing_notes ? `<p class="bill-note">${ic('info')}<span>Tu n'as pas indiqué tes tarifs : les prix des exemples sont des <b>prix d'exemple</b>. Ajuste-les avec « Affiner avec Claude ».</span></p>` : ''}
      <div class="bill-opts">${opts.map((o) => `<article class="bill-opt${o.variant === chosen ? ' on' : ''}" aria-labelledby="bo-${o.id}">
        <div class="bill-opt-h"><h3 id="bo-${o.id}">Exemple ${o.variant}</h3><span class="badge">${esc(LAYOUTS.find(([k]) => k === o.layout)?.[1] || '')}</span></div>
        ${o.content.tagline ? `<p class="muted small">${esc(o.content.tagline)}</p>` : ''}
        ${frame(o)}
        <div class="row-actions">${o.variant === chosen ? `<span class="badge ok">${ic('check')} Choisi</span>` : `<form method="post" action="/facturation/projet/${p.id}/choisir"><input type="hidden" name="variant" value="${o.variant}"><button class="btn small">Choisir cet exemple</button></form>`}
          <a class="btn small" href="/facturation/documents/${o.id}/apercu" target="_blank" rel="noopener noreferrer" data-noajax>Voir en grand</a></div>
      </article>`).join('')}</div>
      ${sel ? `<div class="bill-pick"><h3>Ton devis : exemple ${sel.variant}</h3><p class="muted">Dis à Claude ce que tu veux changer, autant de fois que nécessaire. Quand il te convient, valide-le : Claude prépare alors l'acompte, la facture finale et l'avoir dans le même style.</p>
        ${refineForm(p, sel, 'Affiner ce devis', true)}
        <div class="row-actions"><form method="post" action="/facturation/projet/${p.id}/valider"><input type="hidden" name="doc" value="${sel.id}"><button class="btn primary"${busy ? ' disabled' : ''}>${ic('check')}Valider ce devis</button></form>
          ${generateBtn('Générer trois nouveaux exemples', '')}</div></div>` : `<p class="muted">Choisis l'un des trois exemples pour continuer.</p><div class="row-actions">${generateBtn('Générer trois nouveaux exemples', '')}</div>`}`;
  }
  return `<section class="card bill-sec" id="devis" aria-labelledby="t-devis"><h2 id="t-devis">2. Choisis ton devis</h2>${inner}</section>`;
}

const KIND_INVOICE = { acompte: true, facture: true, avoir: true };

const LINE_ROWS = 3;
const lineRow = (i) => `<div class="bill-line" data-line>
    <label class="field" for="gen-l${i}-n"><span class="lbl">Désignation</span><input id="gen-l${i}-n" name="l${i}_label" maxlength="120" autocomplete="off" placeholder="Ex. : Développement de l'application"></label>
    <label class="field" for="gen-l${i}-q"><span class="lbl">Quantité</span><input id="gen-l${i}-q" name="l${i}_qty" value="1" inputmode="decimal" maxlength="12" autocomplete="off"></label>
    <label class="field" for="gen-l${i}-u"><span class="lbl">Unité</span><input id="gen-l${i}-u" name="l${i}_unit" value="forfait" maxlength="20" autocomplete="off" placeholder="jours, heures…"></label>
    <label class="field" for="gen-l${i}-p"><span class="lbl">Prix unitaire HT (€)</span><input id="gen-l${i}-p" name="l${i}_price" inputmode="decimal" maxlength="14" autocomplete="off" placeholder="450,00"></label>
    <label class="field bill-line-d" for="gen-l${i}-d"><span class="lbl">Description <span class="muted small">(facultatif)</span></span><input id="gen-l${i}-d" name="l${i}_description" maxlength="300" autocomplete="off"></label></div>`;

/**
 * Section « Générer un document » : le devis se remplit (client et lignes de ce que le client commande) ; acompte, facture finale et avoir se rattachent à un devis
 * émis et en reprennent le client et les lignes. Les lignes des modèles ne sont que des exemples.
 */
function issueSection(p, docs, clients, invoices, selectedKind, selectedClientId) {
  const today = todayIso();
  const sel = clients.find((c) => c.id === selectedClientId) || null;
  const finals = DOC_KINDS.map(({ key }) => docs.find((d) => d.kind === key)).filter(Boolean);
  if (!finals.some((d) => d.status === 'validated')) return '';
  const devisList = invoices.filter((i) => i.kind === 'devis' && i.lines.length);
  const refs = invoices.filter((i) => (i.kind === 'acompte' || i.kind === 'facture') && i.devisId);
  const usable = (d) => d.status === 'validated' && (d.kind === 'devis' || devisList.length > 0);
  const first = finals.find((d) => usable(d) && d.kind === selectedKind) || finals.find((d) => usable(d));
  const modelDeposit = docs.find((d) => d.kind === 'acompte')?.content.deposit_percent || 30;
  const hint = (d) => (d.status !== 'validated' ? " (à valider d'abord)" : !usable(d) ? " (génère d'abord un devis)" : '');
  return `<section class="card bill-sec" id="generer" aria-labelledby="t-gen"><h2 id="t-gen">Générer un document</h2>
    <p class="muted">Commence par le <b>devis</b> : tu y saisis ce que ton client t'a commandé (les lignes des modèles ne sont que des exemples). L'acompte, la facture finale et l'avoir se rattachent ensuite à un devis et en reprennent le client et les lignes. Les clients se gèrent dans la page <a class="link" href="/clients?projet=${p.id}">Clients</a>.</p>
    <form method="post" action="/facturation/projet/${p.id}/emettre" class="bill-issue-f" data-issue>
      <div class="grid2">
        <label class="field wide" for="gen-doc"><span class="lbl">Type de document</span><span class="sel"><select id="gen-doc" name="doc" data-issue-kind>
          ${finals.map((d) => `<option value="${d.id}" data-kind="${d.kind}"${first && d.id === first.id ? ' selected' : ''}${usable(d) ? '' : ' disabled'}>${esc(DOC_BY_KEY[d.kind].label)}${hint(d)}</option>`).join('')}
        </select>${ic('down')}</span></label>
      </div>
      <div class="grid2" data-for="devis">
        <label class="field" for="gen-client"><span class="lbl">Client</span><span class="sel"><select id="gen-client" name="client_id" data-issue-client>
          <option value="">${clients.length ? 'Nouveau client' : 'Nouveau client (aucun enregistré)'}</option>
          ${clients.map((c) => `<option value="${c.id}" data-name="${esc(c.name)}" data-address="${esc(c.address)}" data-siret="${esc(c.siret)}"${sel && sel.id === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>${ic('down')}</span></label>
        <label class="field" for="gen-n"><span class="lbl">Nom du client</span><input id="gen-n" name="client_nom" maxlength="120" autocomplete="off" value="${esc(sel?.name || '')}"></label>
        <label class="field wide" for="gen-a"><span class="lbl">Adresse du client</span><input id="gen-a" name="client_adresse" maxlength="200" autocomplete="off" value="${esc(sel?.address || '')}"></label>
        <label class="field" for="gen-s"><span class="lbl">SIRET du client <span class="muted small">(vide pour un particulier)</span></span><input id="gen-s" name="client_siret" inputmode="numeric" maxlength="20" autocomplete="off" value="${esc(sel?.siret || '')}"></label>
      </div>
      <fieldset class="bill-fs" data-for="devis"><legend>Ce que ton client commande</legend>
        <p class="muted small">Une ligne par prestation ou produit. Les prix sont hors taxes : la TVA est calculée d'après tes informations légales.</p>
        <div data-lines>${Array.from({ length: LINE_ROWS }, (_, i) => lineRow(i)).join('')}</div>
        <div class="row-actions"><button type="button" class="btn small" data-add-line>${ic('plus')}Ajouter une ligne</button><span class="muted" data-lines-total aria-live="polite"></span></div>
      </fieldset>
      <div class="grid2" data-for="acompte facture avoir">
        <label class="field wide" for="gen-devis"><span class="lbl">Devis de référence</span><span class="sel"><select id="gen-devis" name="devis_id" data-issue-devis>
          <option value="">Choisis le devis…</option>
          ${devisList.map((d) => `<option value="${d.id}">${esc(d.number)} — ${esc(d.client.name || '')} — ${esc(fmtEur(d.amount))} TTC</option>`).join('')}
        </select>${ic('down')}</span></label>
        <label class="field" for="gen-pct" data-for="acompte"><span class="lbl">Part de l'acompte (%)</span><input id="gen-pct" name="deposit_percent" value="${modelDeposit}" inputmode="numeric" maxlength="3" autocomplete="off"></label>
        <label class="field wide" for="gen-ref" data-for="avoir"><span class="lbl">Facture corrigée par l'avoir</span><span class="sel"><select id="gen-ref" name="ref_id" data-issue-ref>
          <option value="">Choisis la facture…</option>
          ${refs.map((r) => `<option value="${r.id}" data-devis="${r.devisId}">${esc(r.number)} — ${esc(DOC_BY_KEY[r.kind].label)} — ${esc(fmtEur(r.amount))} TTC</option>`).join('')}
        </select>${ic('down')}</span></label>
        <label class="field" for="gen-cr" data-for="avoir"><span class="lbl">Montant à rembourser TTC (€) <span class="muted small">(vide : toute la facture)</span></span><input id="gen-cr" name="credit_ttc" inputmode="decimal" maxlength="14" autocomplete="off"></label>
        <label class="field wide" for="gen-m" data-for="avoir"><span class="lbl">Motif de l'avoir</span><input id="gen-m" name="motif" maxlength="300" autocomplete="off" value="${esc(docs.find((d) => d.kind === 'avoir')?.content.reason || '')}"></label>
        <label class="field" for="gen-p" data-for="facture"><span class="lbl">Date de la prestation</span><input id="gen-p" type="date" name="date_prestation" value="${today}" max="${today}"></label>
      </div>
      <div class="grid2"><label class="field" for="gen-d"><span class="lbl">Date d'émission</span><input id="gen-d" type="date" name="issue_date" value="${today}" max="${today}" required></label></div>
      <div data-for="acompte facture avoir"><label class="check" for="gen-c"><input id="gen-c" type="checkbox" name="to_accounting" value="1" checked><span>Joindre automatiquement à la comptabilité</span></label>
        <p class="muted small">Coché : la facture est ajoutée à ta Comptabilité, à encaisser (elle ne compte dans tes chiffres qu'une fois payée). Décoché : le PDF reste ici et rien n'est ajouté à la Comptabilité.</p></div>
      <div class="row-actions"><button class="btn primary">${ic('file')}Générer le PDF</button></div>
    </form></section>`;
}

function invoicesSection(invoices) {
  if (!invoices?.length) return '';
  const byId = new Map(invoices.map((x) => [x.id, x]));
  const label = { pending: ['À encaisser', 'warn'], paid: ['Payée', 'ok'], devis: ['Devis', ''], hors: ['Non jointe à la comptabilité', ''] };
  return `<section class="card bill-sec" id="emis" aria-labelledby="t-emis"><h2 id="t-emis">Documents émis</h2>
    <p class="muted">Les factures jointes à la <a class="link" href="/compta#a-encaisser">Comptabilité</a> s'y marquent payées à l'encaissement.</p>
    <div class="table-wrap"><table class="mtable"><thead><tr><th>Numéro</th><th>Client</th><th>Émis le</th><th class="num">Montant TTC</th><th>État</th><th><span class="sr-only">PDF</span></th></tr></thead><tbody>${invoices.map((i) => `<tr>
      <td><b>${esc(i.number)}</b><span class="td-s">${esc(DOC_BY_KEY[i.kind]?.label || i.kind)}${i.devisId && byId.get(i.devisId) ? ` · devis ${esc(byId.get(i.devisId).number)}` : ''}</span></td><td>${esc(i.client.name || '')}</td><td>${esc(i.issueDate.split('-').reverse().join('/'))}</td>
      <td class="num">${esc(fmtEur(i.kind === 'avoir' ? -i.amount : i.amount))}</td>
      <td><span class="badge ${label[i.state][1]}">${label[i.state][0]}</span></td>
      <td><a class="btn small" href="/facturation/factures/${i.id}/pdf" data-noajax>${ic('file')}PDF</a>${i.entryId ? ` <a class="btn small" href="/compta/entries/${i.entryId}/file" target="_blank" rel="noopener noreferrer" data-noajax>Comptabilité</a>` : ''}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function docsSection(p, docs, stage, busy, validatedCount) {
  const finals = DOC_KINDS.map(({ key }) => docs.find((d) => d.kind === key)).filter(Boolean);
  let inner;
  if (!finals.length) {
    inner = `<p class="muted">${busy ? 'Claude prépare le devis, l\'acompte, la facture finale et l\'avoir…' : 'La préparation n\'a pas abouti.'}</p>
      ${busy ? '' : `<form method="post" action="/facturation/projet/${p.id}/documents"><button class="btn primary">${ic('repeat')}Relancer la préparation</button></form>`}`;
  } else {
    inner = `<p class="muted">Relis chaque document, affine-le si besoin, puis valide-le. <b>${validatedCount} sur ${DOC_KINDS.length}</b> validés.</p>
      <div class="bar" role="progressbar" aria-label="Documents validés" aria-valuemin="0" aria-valuemax="4" aria-valuenow="${validatedCount}"><span class="w-${validatedCount * 25}"></span></div>
      <div class="bill-docs">${finals.map((d) => `<article class="bill-doc${d.status === 'validated' ? ' ok locked' : ''}" aria-labelledby="bd-${d.id}">
        <div class="bill-opt-h"><h3 id="bd-${d.id}">${esc(DOC_BY_KEY[d.kind].label)}</h3><span class="badge ${d.status === 'validated' ? 'ok' : 'warn'}">${d.status === 'validated' ? 'Validé' : 'À valider'}</span></div>
        <p class="muted small">${esc(DOC_BY_KEY[d.kind].help)}</p>
        ${d.status === 'validated' ? '' : `${frame(d)}
        <p class="muted small bill-vars">Rempli à l'émission : ${DOC_VARIABLES[d.kind].map((v) => `<code>{{${v}}}</code>`).join(' ')}</p>`}
        <div class="row-actions">${d.status === 'validated' ? '' : `<form method="post" action="/facturation/projet/${p.id}/valider"><input type="hidden" name="doc" value="${d.id}"><button class="btn primary small"${busy ? ' disabled' : ''}>${ic('check')}Valider ce document</button></form>`}
          <a class="btn small" href="/facturation/documents/${d.id}/apercu" target="_blank" rel="noopener noreferrer" data-noajax>Voir en grand</a>
          <a class="btn small" href="/facturation/documents/${d.id}/pdf" data-noajax>${ic('file')}Modèle en PDF</a>
          ${d.status === 'validated' ? `<a class="btn small primary" href="?type=${d.kind}#generer">${ic('file')}Émettre ce document</a>` : ''}</div>
        ${d.status === 'validated' ? refineForm(p, d, 'Modifier ce document', false, 'Modifier') : refineForm(p, d, 'Affiner ce document')}
      </article>`).join('')}</div>`;
  }
  return `<section class="card bill-sec" id="documents" aria-labelledby="t-docs"><h2 id="t-docs">3. Valide tes documents</h2>${inner}</section>`;
}

export function billingProjectPage({ email, project: p, legal, errors, suggestions, docs, invoices = [], clients = [], selectedKind = '', selectedClientId = null, chosen, stage, jobs, flash }) {
  const running = Object.values(jobs).find((j) => ['queued', 'running'].includes(j.status));
  const lastDoc = docs.reduce((m, d) => Math.max(m, d.updatedAt), 0);
  const failed = !running ? Object.values(jobs).filter((j) => j.status === 'error' && Number(j.finishedAt || 0) >= lastDoc).sort((a, b) => b.finishedAt - a.finishedAt)[0] : null;
  const notes = { legal: 'Informations enregistrées.', legal_incomplet: 'Informations enregistrées : il en manque encore pour continuer.', quotes: 'Claude rédige tes trois exemples de devis…', refine: 'Claude affine le document selon ta demande…', docs: 'Devis validé : Claude prépare les documents…', valide: 'Document validé.', emis: 'Document émis : le PDF est prêt, et la facture est dans ta Comptabilité, à encaisser.', emis_devis: 'Devis émis : le PDF est prêt.',  reset: 'Tout est effacé : tu repars du début (tes informations légales sont conservées).' };
  const runPct = typeof running?.progress?.pct === 'number' ? Math.max(0, Math.min(100, Math.round(running.progress.pct))) : 0;
  const statusBar = running ? `<div class="bill-run" role="status"><span class="spinner" aria-hidden="true"></span><div class="bill-run-b"><div class="bill-run-h"><b>Claude travaille…</b><strong class="jpct" data-bill-pct>${runPct} %</strong></div>
    <span class="muted small" data-bill-msg>${esc(running.progress?.message || 'Cela prend une à deux minutes.')}</span>
    <div class="bar" role="progressbar" aria-label="Avancement" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${runPct}" data-bill-bar><span class="w-${Math.round(runPct / 5) * 5}" data-bill-fill></span></div></div></div>`
    : failed ? banner('err', `La dernière demande à Claude a échoué : ${failed.error || 'erreur inconnue'}. Tu peux réessayer.`)
      : flash.error ? banner('err', flash.error)
        : flash.ok && notes[flash.ok] ? banner(flash.ok === 'legal_incomplet' ? 'warn' : 'ok', notes[flash.ok]) : '';
  const finalsCount = stage.finalsValidated;
  const ready = stage.stage === 'ready';
  const sections = [legalForm(p, legal, errors, suggestions, stage.stage === 'legal')];
  if (stage.complete) {
    if (['generate', 'choose'].includes(stage.stage)) sections.push(quoteSection(p, docs, chosen, stage, legal, stage.busy));
    else {
      const q = docs.find((d) => d.kind === 'quote_option' && d.status === 'validated');
      if (q) sections.push(`<section class="card bill-sec" id="devis" aria-labelledby="t-devis"><h2 id="t-devis">2. Ton devis est validé</h2><p class="muted">Exemple ${q.variant} (${esc(LAYOUTS.find(([k]) => k === q.layout)?.[1] || '')}). Les documents suivants reprennent son style et ses lignes.</p></section>`);
      sections.push(docsSection(p, docs, stage, stage.busy, finalsCount));
      if (!ready) sections.push(issueSection(p, docs, clients, invoices, selectedKind, selectedClientId), invoicesSection(invoices));
    }
  }
  const done = ready ? `<section class="card bill-ready" aria-labelledby="t-ready"><div>${ic('check')}</div><div><h2 id="t-ready">Tes documents sont prêts</h2>
    <p class="muted">Le devis, l'acompte, la facture finale et l'avoir de « ${esc(p.name)} » sont validés : ils peuvent être utilisés dans iaboss. Les mentions légales se mettent à jour d'après tes informations légales.</p></div></section>` : '';
  const reset = docs.length ? `<form method="post" action="/facturation/projet/${p.id}/recommencer" data-confirm="Effacer les exemples et les documents de ce projet et repartir du début ? Tes informations légales sont conservées."><button class="btn small danger">${ic('trash')}Recommencer depuis le début</button></form>` : '';
  const body = `<div class="bill-page" data-bill data-bill-project="${p.id}" data-busy="${stage.busy ? '1' : '0'}">
  <section class="card"><p><a class="link" href="/facturation">${ic('back')} Tous les projets</a></p>
    <div class="row-between"><div><h1>Facturation : ${esc(p.name)}</h1><p class="muted small">${esc(host(p.gitUrl))}</p></div></div>
    ${stepper(stage.steps, stageStep[stage.stage])}${statusBar}</section>
  ${done}
  ${ready ? [issueSection(p, docs, clients, invoices, selectedKind, selectedClientId), invoicesSection(invoices)].join('\n  ') : ''}
  ${sections.join('\n  ')}
  ${reset ? `<div class="bill-foot">${reset}</div>` : ''}
  <p class="muted small bill-disc">Les documents suivent les usages entre professionnels en France. Les mentions légales sont rédigées par iaboss d'après tes informations, jamais par Claude : fais-les vérifier par un expert-comptable avant un usage particulier (client particulier, TVA sur les encaissements, marché public).</p>
</div>`;
  return layout({ title: `Facturation · ${p.name}`, email, body, scripts: ['/static/facturation.js'], named: true });
}
