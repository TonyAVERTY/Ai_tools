// Pages « Facturation » : recap des projets, puis pour un projet les informations légales, le choix du devis et les quatre documents.
// public/facturation.js suit les tâches de Claude en cours et recharge la page quand elles se terminent.
import { esc } from './http.js';
import { layout } from './views.js';
import { ic } from './icons.js';
import { LEGAL_FIELDS, LEGAL_SECTIONS, DOC_KINDS, DOC_BY_KEY, LAYOUTS, stageLabel, legalMissing, DOC_VARIABLES } from './services/billing.js';

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
        ${r.stage.busy ? `<span class="muted small bill-busy">${ic('load')} Claude travaille…</span>` : ''}</div></article>`;
  }).join('') : `<div class="empty-s"><p><b>Aucun projet pour l'instant.</b> La facturation se prépare projet par projet : crée d'abord un projet.</p><a class="btn primary small" href="/">Ouvrir mes projets</a></div>`;
  const body = `<div data-bill class="bill-page">
  <section class="card"><div class="row-between"><div><h1>Facturation</h1>
    <p class="muted">Pour chaque projet : tes informations légales, puis des modèles de devis, d'acompte, de facture finale et d'avoir écrits avec Claude, prêts à être utilisés dans AiTools.</p></div></div>
    ${rows.length ? `<p class="bill-sum"><b>${ready}</b> projet${ready > 1 ? 's' : ''} prêt${ready > 1 ? 's' : ''} sur <b>${rows.length}</b></p>
    <div class="bar" role="progressbar" aria-label="Projets prêts" aria-valuemin="0" aria-valuemax="${rows.length}" aria-valuenow="${ready}"><span class="w-${Math.round((100 * ready) / rows.length / 5) * 5}"></span></div>` : ''}
  </section>
  <div class="bill-list">${list}</div>
</div>`;
  return layout({ title: 'Facturation', email, body, scripts: ['/static/facturation.js'] });
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
const refineForm = (p, d, label, open = false) => `<details class="bill-refine"${open ? ' open' : ''}><summary>${ic('pen')}Affiner avec Claude</summary>
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

function docsSection(p, docs, stage, busy, validatedCount) {
  const finals = DOC_KINDS.map(({ key }) => docs.find((d) => d.kind === key)).filter(Boolean);
  let inner;
  if (!finals.length) {
    inner = `<p class="muted">${busy ? 'Claude prépare le devis, l\'acompte, la facture finale et l\'avoir…' : 'La préparation n\'a pas abouti.'}</p>
      ${busy ? '' : `<form method="post" action="/facturation/projet/${p.id}/documents"><button class="btn primary">${ic('repeat')}Relancer la préparation</button></form>`}`;
  } else {
    inner = `<p class="muted">Relis chaque document, affine-le si besoin, puis valide-le. <b>${validatedCount} sur ${DOC_KINDS.length}</b> validés.</p>
      <div class="bar" role="progressbar" aria-label="Documents validés" aria-valuemin="0" aria-valuemax="4" aria-valuenow="${validatedCount}"><span class="w-${validatedCount * 25}"></span></div>
      <div class="bill-docs">${finals.map((d) => `<article class="bill-doc${d.status === 'validated' ? ' ok' : ''}" aria-labelledby="bd-${d.id}">
        <div class="bill-opt-h"><h3 id="bd-${d.id}">${esc(DOC_BY_KEY[d.kind].label)}</h3><span class="badge ${d.status === 'validated' ? 'ok' : 'warn'}">${d.status === 'validated' ? 'Validé' : 'À valider'}</span></div>
        <p class="muted small">${esc(DOC_BY_KEY[d.kind].help)}</p>
        ${frame(d)}
        <p class="muted small bill-vars">Rempli à l'émission : ${DOC_VARIABLES[d.kind].map((v) => `<code>{{${v}}}</code>`).join(' ')}</p>
        <div class="row-actions">${d.status === 'validated' ? '' : `<form method="post" action="/facturation/projet/${p.id}/valider"><input type="hidden" name="doc" value="${d.id}"><button class="btn primary small"${busy ? ' disabled' : ''}>${ic('check')}Valider ce document</button></form>`}
          <a class="btn small" href="/facturation/documents/${d.id}/apercu" target="_blank" rel="noopener noreferrer" data-noajax>Voir en grand</a></div>
        ${refineForm(p, d, 'Affiner ce document')}
      </article>`).join('')}</div>`;
  }
  return `<section class="card bill-sec" id="documents" aria-labelledby="t-docs"><h2 id="t-docs">3. Valide tes documents</h2>${inner}</section>`;
}

export function billingProjectPage({ email, project: p, legal, errors, suggestions, docs, chosen, stage, jobs, flash }) {
  const running = Object.values(jobs).find((j) => ['queued', 'running'].includes(j.status));
  const lastDoc = docs.reduce((m, d) => Math.max(m, d.updatedAt), 0);
  const failed = !running ? Object.values(jobs).filter((j) => j.status === 'error' && Number(j.finishedAt || 0) >= lastDoc).sort((a, b) => b.finishedAt - a.finishedAt)[0] : null;
  const notes = { legal: 'Informations enregistrées.', legal_incomplet: 'Informations enregistrées : il en manque encore pour continuer.', quotes: 'Claude rédige tes trois exemples de devis…', refine: 'Claude affine le document selon ta demande…', docs: 'Devis validé : Claude prépare les documents…', valide: 'Document validé.', reset: 'Tout est effacé : tu repars du début (tes informations légales sont conservées).' };
  const banner = running ? `<div class="bill-run" role="status">${ic('load')}<div><b>Claude travaille…</b><span class="muted small" data-bill-msg>${esc(running.progress?.message || 'Cela prend une à deux minutes.')}</span></div></div>`
    : failed ? `<p class="cmp-flash warn" role="alert">${ic('alert')} La dernière demande à Claude a échoué : ${esc(failed.error || 'erreur inconnue')}. Tu peux réessayer.</p>`
      : flash.error ? `<p class="cmp-flash warn" role="alert">${ic('alert')} ${esc(flash.error)}</p>`
        : flash.ok && notes[flash.ok] ? `<p class="cmp-flash ${flash.ok === 'legal_incomplet' ? 'warn' : 'ok'}" role="status">${esc(notes[flash.ok])}</p>` : '';
  const finalsCount = stage.finalsValidated;
  const ready = stage.stage === 'ready';
  const sections = [legalForm(p, legal, errors, suggestions, stage.stage === 'legal')];
  if (stage.complete) {
    if (['generate', 'choose'].includes(stage.stage)) sections.push(quoteSection(p, docs, chosen, stage, legal, stage.busy));
    else {
      const q = docs.find((d) => d.kind === 'quote_option' && d.status === 'validated');
      if (q) sections.push(`<section class="card bill-sec" id="devis" aria-labelledby="t-devis"><h2 id="t-devis">2. Ton devis est validé</h2><p class="muted">Exemple ${q.variant} (${esc(LAYOUTS.find(([k]) => k === q.layout)?.[1] || '')}). Les documents suivants reprennent son style et ses lignes.</p></section>`);
      sections.push(docsSection(p, docs, stage, stage.busy, finalsCount));
    }
  }
  const done = ready ? `<section class="card bill-ready" aria-labelledby="t-ready"><div>${ic('check')}</div><div><h2 id="t-ready">Tes documents sont prêts</h2>
    <p class="muted">Le devis, l'acompte, la facture finale et l'avoir de « ${esc(p.name)} » sont validés : ils peuvent être utilisés dans AiTools. Les mentions légales se mettent à jour d'après tes informations légales.</p></div></section>` : '';
  const reset = docs.length ? `<form method="post" action="/facturation/projet/${p.id}/recommencer" data-confirm="Effacer les exemples et les documents de ce projet et repartir du début ? Tes informations légales sont conservées."><button class="btn small danger">${ic('trash')}Recommencer depuis le début</button></form>` : '';
  const body = `<div class="bill-page" data-bill data-bill-project="${p.id}" data-busy="${stage.busy ? '1' : '0'}">
  <section class="card"><p><a class="link" href="/facturation">${ic('back')} Tous les projets</a></p>
    <div class="row-between"><div><h1>Facturation : ${esc(p.name)}</h1><p class="muted small">${esc(host(p.gitUrl))}</p></div></div>
    ${stepper(stage.steps, stageStep[stage.stage])}${banner}</section>
  ${done}
  ${sections.join('\n  ')}
  ${reset ? `<div class="bill-foot">${reset}</div>` : ''}
  <p class="muted small bill-disc">Les documents suivent les usages entre professionnels en France. Les mentions légales sont rédigées par AiTools d'après tes informations, jamais par Claude : fais-les vérifier par un expert-comptable avant un usage particulier (client particulier, TVA sur les encaissements, marché public).</p>
</div>`;
  return layout({ title: `Facturation · ${p.name}`, email, body, scripts: ['/static/facturation.js'] });
}
