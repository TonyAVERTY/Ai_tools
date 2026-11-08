// Page « Aujourd'hui » (maquette docs/REFONTE-UI.md, écran 01) : rendu serveur à partir de todayData() ; public/app-today.js ne fait que filtrer
// la liste, marquer une ligne « traitée » et basculer graphique / données. Aucun style en ligne : les barres du graphique sont des <rect> SVG.
import { esc } from './http.js';
import { ic } from './icons.js';
import { layout, claudePanel } from './views.js';
import { FILTERS } from './today.js';

const fr = (n) => Number(n).toLocaleString('fr-FR');

const header = (d) => `<header class="td-head">
  <div class="td-hello">
    <p class="td-date">${esc(d.dateLabel)}</p>
    <h1 class="td-title">Bonjour ${esc(d.name)}</h1>
    <p class="td-sum">${esc(d.summary)}</p>
  </div>
  <div class="td-cta">
    <a class="btn" href="/facturation">${ic('file')}Nouveau devis</a>
    <a class="btn primary" href="/projets">${ic('search')}Lancer une recherche</a>
  </div>
</header>`;

/** Mise en route du premier projet pas prêt : les étapes obligatoires de la liste de src/checklist.js, l'étape en cours, le bouton qui y mène. */
function onboarding(o) {
  if (!o) return '';
  const steps = o.steps.filter((s) => !s.optional);
  const cur = steps.find((s) => !s.done);
  if (!cur) return '';
  const n = steps.indexOf(cur) + 1;
  return `<section class="td-start" aria-labelledby="mr-h">
  <div>
    <h2 id="mr-h">Mise en route de ${esc(o.name)}</h2>
    <p>Étape ${n} sur ${steps.length} : ${esc(cur.label.charAt(0).toLowerCase() + cur.label.slice(1))}.</p>
  </div>
  <ol class="td-steps" aria-label="Étapes">
    ${steps.map((s) => `<li class="${s.done ? 'done' : s === cur ? 'cur' : ''}" aria-label="${esc(s.label)}, ${s.done ? 'fait' : s === cur ? 'en cours' : 'à faire'}"></li>`).join('\n    ')}
  </ol>
  <a class="btn primary" href="/projets">${esc(cur.label)}</a>
</section>`;
}

const kpis = (d) => `<section class="td-kpis" aria-label="Chiffres clés">
  ${d.kpis.map((k) => `<a class="td-kpi${k.tone ? ` ${k.tone}` : ''}" href="${k.href}"><span class="td-k-l">${esc(k.label)}</span><span class="td-k-v">${esc(k.value)}</span><span class="td-k-s">${esc(k.sub)}</span></a>`).join('\n  ')}
</section>`;

const item = (it) => `<li class="td-item" data-today-item data-kind="${it.kind}" data-key="${esc(it.key)}">
  <span class="td-ico ${it.kind}" aria-hidden="true">${ic(it.icon)}</span>
  <div class="td-body">
    <div class="td-line"><b>${esc(it.title)}</b><span class="badge${it.tone === 'n' ? '' : ` ${it.tone}`}">${ic(it.badgeIcon)}${esc(it.badge)}</span><span class="td-meta">${esc(it.meta)}</span></div>
    ${it.text ? `<p class="${it.quote ? 'td-quote' : 'td-text'}">${esc(it.text)}</p>` : ''}
  </div>
  <div class="td-acts">
    <span class="td-done" data-today-done hidden>${ic('check')}Traité<button type="button" class="linklike" data-today-undo>Annuler</button></span>
    <span class="td-open" data-today-open><a class="btn small${it.primary ? ' primary' : ''}" href="${esc(it.href)}">${esc(it.action)}</a><button type="button" class="btn small" data-today-mark aria-label="Marquer traité : ${esc(it.title)}">Marquer traité</button></span>
  </div>
</li>`;

const todo = (d) => `<section class="td-todo" aria-labelledby="at-h" data-today-root>
  <div class="td-sec-h">
    <h2 id="at-h">À traiter <span class="td-count" data-today-count>${d.counts.all}</span></h2>
    <div role="tablist" aria-label="Filtrer" class="td-tabs">
      ${FILTERS.map(([k, label]) => `<button type="button" role="tab" data-today-filter="${k}" aria-selected="${k === 'all'}">${label} <span data-today-n="${k}">${d.counts[k]}</span></button>`).join('\n      ')}
    </div>
  </div>
  <div class="td-empty" data-today-empty${d.items.length ? ' hidden' : ''}>
    <span class="td-empty-i">${ic('check')}</span>
    <h3>Tout est traité</h3>
    <p>Rien n'attend de réponse ici. Les nouvelles réponses et les tâches terminées arriveront dans cette liste.</p>
  </div>
  <ul class="td-list" data-today-list>
    ${d.items.map(item).join('\n    ')}
  </ul>
</section>`;

const agenda = (d) => `<section class="td-card" aria-labelledby="ag-h">
  <div class="td-sec-h"><h2 id="ag-h">Aujourd'hui dans l'agenda</h2><a href="/calendar">Calendrier</a></div>
  ${d.agenda.length ? `<ol class="td-agenda">
    ${d.agenda.map((e) => `<li${e.past ? ' class="past"' : ''}><span class="td-time">${esc(e.time)}</span><span class="td-ev"><b>${esc(e.title)}</b><span>${esc(e.meta)}</span></span></li>`).join('\n    ')}
  </ol>` : '<p class="td-none">Rien de prévu aujourd\'hui.</p>'}
</section>`;

const money = (d) => `<section class="td-card" aria-labelledby="ar-h">
  <div class="td-sec-h"><h2 id="ar-h">Argent</h2><a href="/compta">Comptabilité</a></div>
  ${d.invoices.length ? `<ul class="td-inv">
    ${d.invoices.map((i) => `<li><span class="td-ev"><b>${esc(i.client)}</b><span class="${i.late ? 'late' : ''}">${esc(i.ref)} · ${esc(i.due)}</span></span><span class="td-amt"><b>${esc(i.amount)}</b><a href="${i.projectId ? `/facturation/projet/${i.projectId}` : '/compta'}">${i.late ? 'Relancer' : 'Voir la facture'}</a></span></li>`).join('\n    ')}
  </ul>${d.more ? `<p class="td-none">et ${d.more} de plus dans <a href="/compta">Comptabilité</a>.</p>` : ''}` : '<p class="td-none">Aucune facture en attente d\'encaissement.</p>'}
  ${d.declaration ? `<div class="td-note" role="note">${ic('alert')}<span><b>Déclaration ${esc(d.declaration.label)}</b> à faire avant le ${esc(d.declaration.deadlineLabel)}${d.declaration.left <= 7 ? ` (${d.declaration.left === 0 ? "c'est aujourd'hui" : `dans ${d.declaration.left} jour${d.declaration.left > 1 ? 's' : ''}`})` : ''}. Montant à déclarer : <b>${esc(d.declaration.amount)}</b>.</span></div>
  <a class="td-link" href="/compta?declarer=1">Faire ma déclaration</a>` : ''}
</section>`;

/** Une série du graphique : huit barres SVG, chacune avec sa propre échelle (la dernière semaine est pleine, les autres un ton plus clair). */
function series(label, key, cls, weeks) {
  const vals = weeks.map((w) => w[key]);
  const max = Math.max(...vals);
  const H = 40;
  const bars = vals.map((v, i) => {
    const h = !v ? 0 : Math.max(2, Math.round((v / max) * H));
    return `<rect class="${cls}${i === vals.length - 1 ? ' last' : ''}" x="${i * 10 + 1.5}" y="${H - h}" width="7" height="${h}"/>`;
  }).join('');
  return `<div class="td-ser">
    <div class="td-ser-h"><b><i class="td-dot ${cls}"></i>${esc(label)}</b><span>maximum ${fr(max)}</span></div>
    <div class="td-vals">${vals.map((v, i) => `<span${i === vals.length - 1 ? ' class="last"' : ''}>${fr(v)}</span>`).join('')}</div>
    <svg class="td-bars" viewBox="0 0 80 ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${bars}</svg>
  </div>`;
}

const chart = (d) => {
  const alt = `Sur 8 semaines : ${fr(d.totalSent)} mails envoyés, ${fr(d.totalReplies)} réponses. Cette semaine : ${fr(d.lastWeek.sent)} mails, ${fr(d.lastWeek.rep)} réponses, ${fr(d.lastWeek.rdv)} rendez-vous.`;
  return `<section class="td-card td-weeks" aria-labelledby="sm-h" data-today-weeks>
  <div class="td-sec-h"><h2 id="sm-h">Les 8 dernières semaines</h2><button type="button" class="linklike" data-today-data aria-expanded="false">Voir les données</button></div>
  <div data-today-chart>
    <div role="img" aria-label="${esc(alt)}">
      ${series('Mails envoyés', 'sent', 's1', d.weeks)}
      ${series('Réponses', 'rep', 's2', d.weeks)}
      ${series('Rendez-vous', 'rdv', 's3', d.weeks)}
      <div class="td-wk">${d.weeks.map((w) => `<span>${esc(w.label)}</span>`).join('')}</div>
    </div>
    <p class="td-note-s">Cette semaine : <b>${fr(d.lastWeek.sent)}</b> mails, <b>${fr(d.lastWeek.rep)}</b> réponses, <b>${fr(d.lastWeek.rdv)}</b> rendez-vous.${d.replyRate ? ` Taux de réponse sur 8 semaines : <b>${esc(d.replyRate)}</b>.` : ''} Chaque ligne a sa propre échelle.</p>
  </div>
  <div data-today-table hidden>
    <table class="td-table">
      <thead><tr><th scope="col">Semaine</th><th scope="col">Mails</th><th scope="col">Réponses</th><th scope="col">Rendez-vous</th></tr></thead>
      <tbody>${d.weeks.map((w) => `<tr><th scope="row">${esc(w.label)}</th><td>${fr(w.sent)}</td><td>${fr(w.rep)}</td><td>${fr(w.rdv)}</td></tr>`).join('')}</tbody>
    </table>
  </div>
</section>`;
};

const projects = (d) => `<section class="td-card" aria-labelledby="pj-h">
  <div class="td-sec-h"><h2 id="pj-h">Mes projets</h2><a href="/projets">Tous les projets</a></div>
  ${d.projects.length ? `<ul class="td-proj">
    ${d.projects.map((p) => `<li>
      <div class="td-p-h"><a href="/projets">${esc(p.name)}</a><span class="badge${p.ready ? ' ok' : ' warn'}">${esc(p.state)}</span></div>
      <ol class="td-funnel" aria-label="Parcours du projet">
        ${p.funnel.map((s) => `<li${s.n ? '' : ' class="zero"'}><b>${fr(s.n)}</b><span>${esc(s.label)}</span></li>`).join('\n        ')}
      </ol>
      <p class="td-p-n">${esc(p.next)}</p>
    </li>`).join('\n    ')}
  </ul>` : '<p class="td-none">Aucun projet pour l\'instant. <a href="/projets" data-new-project>Crée le premier</a>.</p>'}
</section>`;

const usage = (d) => `<section class="td-card" aria-labelledby="um-h">
  <div class="td-sec-h"><h2 id="um-h">Ce mois-ci</h2><span class="td-plan">Offre ${esc(d.plan)} · <a href="/tarifs">Offres</a></span></div>
  <div class="td-usage">
    ${d.usage.map((u) => `<div class="td-u${u.warn ? ' warn' : ''}">
      <div class="td-u-h"><span>${esc(u.label)}</span><span><b>${fr(u.used)}</b>${u.max == null ? '' : ` sur ${fr(u.max)}`}</span></div>
      <progress class="td-meter" max="100" value="${u.max == null ? 0 : u.pct}" aria-label="${esc(u.label)}"></progress>
      <span class="td-u-n">${esc(u.note)}</span>
    </div>`).join('\n    ')}
  </div>
</section>`;

export function todayPage({ email, data: d, tour = null, tourJson: tourData = '' }) {
  return layout({
    title: "Aujourd'hui", email,
    body: `<div class="today">
${header(d)}
${onboarding(d.onboarding)}
${kpis(d)}
<div class="td-cols">
  ${todo(d)}
  <div class="td-side">
    ${agenda(d)}
    ${money(d)}
    ${claudePanel()}
  </div>
</div>
<div class="td-cols td-cols-2">
  ${chart(d)}
  ${projects(d)}
</div>
${usage(d)}
</div>
${tour ? `<script type="application/json" id="tour-data" data-mode="${esc(tour)}">${tourData}</script>` : ''}`,
  });
}
