// Projets (maquettes 02 et 03, docs/REFONTE-UI.md) : la liste en cartes et la page d'un projet, une adresse par onglet (/p/:id, /p/:id/prospection…).
// Les formulaires et leurs routes d'API sont ceux d'avant : seule leur place change (chaque section de l'ancien accordéon est un bloc d'un onglet).
// Le conteneur « details.project » (résumé masqué) reste l'ancre de public/app*.js : analyse, état des tâches, chargements paresseux.
import { esc } from './http.js';
import { ic } from './icons.js';
import { layout, projectBlocks } from './views.js';
import { JOB_LABELS } from './today.js';

const fr = (n) => Number(n).toLocaleString('fr-FR');
const shortDay = (ts) => new Date(ts * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
const repoOf = (url) => String(url || '').replace(/^https?:\/\//, '').replace(/\.git$/, '');

/** Onglets d'un projet : [adresse, libellé, réservé aux personnes qui gèrent le projet]. */
export const TABS = [
  ['', "Vue d'ensemble", false], ['prospection', 'Prospection', false], ['envoi', 'Envoi', false], ['clients', 'Clients', true], ['facturation', 'Facturation', true],
  ['communication', 'Communication', false], ['outils', 'Outils IA', false], ['recap', 'Récapitulatif', true], ['reglages', 'Réglages du projet', true],
];
export const tabSlugs = () => TABS.map(([s]) => s);
const tabHref = (id, slug) => (slug ? `/p/${id}/${slug}` : `/p/${id}`);

/** Où vit chaque section (data-acc) : sert aux lignes de « Mise en route » et aux liens `#section`. */
export const TAB_OF_ACC = {
  header: 'reglages', config: 'reglages', target: 'prospection', search: 'prospection', prospects: 'prospection',
  template: 'envoi', followuptpl: 'envoi', send: 'envoi', followup: 'envoi', inbox: 'envoi', evolution: 'outils', audit: 'outils', postes: 'outils',
  linkedin: 'communication', promo: 'communication', recap: 'recap', setup: '',
};
const TAB_BLOCKS = {
  prospection: ['target', 'search', 'prospects'], envoi: ['template', 'followuptpl', 'send', 'followup', 'inbox'], communication: ['linkedin', 'promo'],
  outils: ['evolution', 'audit', 'postes'], recap: ['recap'], reglages: ['header', 'config'],
};

const stateBadge = (c) => (!c ? '' : c.ready
  ? `<span class="badge ok">${ic('check')}Prêt à prospecter</span>`
  : `<span class="badge warn">${ic('alert')}Mise en route ${c.done} sur ${c.total}</span>`);

// ---------- Liste (02) ----------
function card(x, d) {
  const p = x.project, st = d.stats.get(Number(p.id)), c = d.checks.get(Number(p.id)), cash = d.cash.get(Number(p.id)) || 0;
  if (p.access !== 'owner') {
    return `<a class="sheet pj-card" href="/p/${p.id}"><div class="sheet-h"><h2>${esc(p.name)}</h2>${stateBadge(c)}</div>
  <span class="small muted">Partagé par ${esc(p.ownerEmail || '')} · <span class="badge">équipe de ${esc(p.ownerEmail || '')}</span></span>
  <span class="small">Facturation et Comptabilité restent celles de ${esc(p.ownerEmail || 'son propriétaire')}.</span></a>`;
  }
  const kpis = st && st.prospects ? `<div class="pj-kpis">
    <div><span class="k-l">Prospects</span><span class="k-v">${fr(st.prospects)}</span><span class="k-s">${fr(st.toContact || 0)} à contacter</span></div>
    <div><span class="k-l">Réponses</span><span class="k-v${st.replies ? ' hl' : ''}">${fr(st.replies || 0)}</span><span class="k-s">${st.lastSentAt ? `dernier envoi : ${esc(shortDay(st.lastSentAt))}` : 'aucun envoi'}</span></div>
  </div>` : '';
  const next = c && !c.ready ? c.steps.find((s) => !s.done && !s.optional) : null;
  return `<a class="sheet pj-card" href="/p/${p.id}"><div class="sheet-h"><h2>${esc(p.name)}</h2>${stateBadge(c)}</div>
  <span class="mono muted">${esc(repoOf(p.gitUrl))}</span>
  ${c && !c.ready ? `<progress class="td-meter" max="${c.total}" value="${c.done}" aria-label="Mise en route : ${c.done} étapes sur ${c.total}"></progress>` : ''}
  ${next ? `<span class="small">Étape suivante : <b>${esc(next.label.charAt(0).toLowerCase() + next.label.slice(1))}</b></span>` : ''}
  ${kpis || '<span class="small muted">Aucun prospect pour l\'instant</span>'}
  ${cash ? `<span class="small muted">À encaisser : ${esc(d.fmtEur(cash))}</span>` : ''}</a>`;
}

export function projectsPage({ email, projects, stats, checks, cash, fmtEur, usage, gitHosts = [], pauseMessage = null }) {
  const room = usage?.items.find((i) => i.kind === 'projects');
  const sub = room ? `${room.used} projet${room.used > 1 ? 's' : ''}${room.limit == null ? '' : ` sur ${room.limit}`} avec ton offre ${esc(usage.planLabel)}` : '';
  const d = { stats, checks, cash, fmtEur };
  return layout({
    title: 'Projets', email,
    body: `<div class="pj-list">
<div class="ph"><div class="t"><h1 id="h-projets">Projets</h1>${sub ? `<span class="muted small">${sub}</span>` : ''}</div>
  <div class="acts"><button type="button" class="btn primary" data-new-toggle aria-expanded="false" aria-controls="new-project">${ic('plus')}Nouveau projet</button></div></div>
${pauseMessage ? `<p class="ban ban-err" role="alert">${ic('alert')}<span class="ban-t"><b>${esc(pauseMessage)}</b></span></p>` : ''}
<section aria-labelledby="h-projets">
${projects.length ? `<div class="pj-cards">${projects.map((x) => card(x, d)).join('\n')}</div>` : `<div class="empty">
  <span class="empty-i">${ic('folder')}</span><h3>Aucun projet pour l'instant</h3>
  <p>Crée ton premier projet : donne-lui un nom et l'adresse de son dépôt Git, ton IA s'occupe de l'analyser.</p></div>`}
<form data-action="create" class="sheet cfg" id="new-project" aria-labelledby="h-new" hidden>
  <h2 id="h-new">Nouveau projet</h2>
  <div class="form pj-new">
    <label class="field"><span class="lbl">Nom</span><input name="name" required maxlength="80" placeholder="Ex. Atelier Exemple"></label>
    <label class="field"><span class="lbl">Dépôt Git</span><input name="gitUrl" required placeholder="https://github.com/utilisateur/projet.git"></label>
    <label class="field"><span class="lbl">Site du produit (facultatif)</span><input name="site_url" maxlength="300" inputmode="url" autocomplete="off" placeholder="https://monproduit.fr"></label>
  </div>
  <div class="form-b"><button class="btn primary">Créer et analyser</button><button type="button" class="btn linklike" data-new-toggle>Annuler</button></div>
  <p class="hint">Le site est demandé dès la création (il remplit <code>{{site}}</code> dans les mails). Le lien du dépôt ne se modifie plus ensuite. ${gitHosts.length ? `GitHub et ${gitHosts.map(esc).join(', ')} sont acceptés.` : 'GitHub est accepté.'} Dépôt privé ou autre serveur Git : ajoute un token dans <a href="/settings">Réglages</a>.</p>
</form>
<dialog class="prospect-dialog" id="prospect-dialog" aria-label="Fiche prospect"><div data-dialog-body></div></dialog>
</section>
</div>`,
  });
}

// ---------- Page d'un projet (03) ----------
function steps(c, id) {
  if (!c) return '';
  const cur = c.steps.find((s) => !s.done);
  const verb = (s) => (['smtp', 'imap'].includes(s.key) ? 'Régler' : 'Ouvrir');
  const href = (s) => `${tabHref(id, s.key === 'analyze' ? '' : TAB_OF_ACC[s.acc] ?? '')}${s.key === 'analyze' ? '' : `#acc-${s.acc}`}`;
  return `<ol class="pj-steps">${c.steps.map((s, i) => `<li class="${s.done ? 'done' : s === cur ? 'cur' : ''}">
    <span class="n" aria-hidden="true">${s.done ? ic('check') : i + 1}</span>
    <span class="st">${s.done ? esc(s.label) : `<b>${esc(s.label)}</b>`}${s.done ? '' : `<span class="small muted">${esc(s.hint)}${s.optional ? ' · facultatif' : ''}</span>`}</span>
    ${s.done ? '<span></span>' : `<a class="btn small${s === cur ? '' : ' ghost'}" href="${href(s)}">${verb(s)}</a>`}</li>`).join('')}</ol>`;
}

function overview(p, c, st, jobs) {
  const profile = p.profile;
  const active = Object.entries(jobs || {}).filter(([, j]) => ['queued', 'running'].includes(j.status));
  const pct = (j) => (typeof j.progress?.pct === 'number' ? Math.max(0, Math.min(100, Math.round(j.progress.pct))) : null);
  const k = (label, value, href, hl) => `<a href="${href}"><span class="k-l">${label}</span><span class="k-v${hl ? ' hl' : ''}">${fr(value)}</span></a>`;
  return `<div class="pj-grid">
  <div class="pj-main">
    ${c ? `<section class="sheet" aria-labelledby="mr-h"><div class="sheet-h"><h2 id="mr-h">${c.complete ? 'Mise en route terminée' : c.ready ? 'Prêt à prospecter' : 'Mise en route'}</h2><span class="small muted">${c.done} étape${c.done > 1 ? 's' : ''} sur ${c.total}</span></div>
      <progress class="td-meter" max="${c.total}" value="${c.done}" aria-label="Avancement de la mise en route"></progress>
      ${steps(c, p.id)}</section>` : ''}
    <section class="sheet" aria-labelledby="fp-h"><div class="sheet-h"><h2 id="fp-h">Fiche projet</h2>${profile ? `<span class="small muted">analyse du ${esc(new Date(p.profileAt * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }))}, commit ${esc(String(p.profileCommit || '').slice(0, 7))}</span>` : ''}</div>
      ${profile ? `<p>${esc(profile.resume)}</p>${profile.stack ? `<p class="small muted">${esc(profile.stack)}</p>` : ''}`
        : '<p class="muted">Le dépôt n\'est pas encore analysé : « Analyser » lit le code et écrit la fiche du projet.</p>'}</section>
  </div>
  <div class="pj-side">
    <section class="sheet" aria-labelledby="pr-h"><h2 id="pr-h">Prospection</h2>
      <div class="pj-kpis4">${k('Prospects', st?.prospects || 0, tabHref(p.id, 'prospection'))}${k('À contacter', st?.toContact || 0, tabHref(p.id, 'prospection'))}${k('Réponses', st?.replies || 0, '/mails', !!st?.replies)}${k('Clients', st?.clients || 0, tabHref(p.id, 'clients'))}</div></section>
    <section class="sheet" aria-labelledby="ec-h"><h2 id="ec-h">En cours</h2>
      ${active.length ? active.map(([t, j]) => `<div class="small"><b>${esc(JOB_LABELS[t] || t)}</b> · ${j.status === 'running' ? (pct(j) !== null ? `${pct(j)} %` : 'en cours') : 'en attente'}</div>${pct(j) !== null ? `<progress class="td-meter" max="100" value="${pct(j)}" aria-label="${esc(JOB_LABELS[t] || t)}"></progress>` : ''}`).join('') : '<p class="small muted">Aucune tâche en cours.</p>'}
    </section>
  </div>
</div>`;
}

/** Journal du projet (maquette 05) : quatre compteurs qui mènent à la page Mails filtrée sur ce projet. */
function journalCard(p, j) {
  const cell = (label, n, filter, extra = '') => `<a href="/mails?project=${p.id}${filter ? `&filter=${filter}` : ''}"><span class="k-l">${label}</span><span class="k-v">${fr(n || 0)}</span>${extra}</a>`;
  return `<section class="sheet flush pj-journal" aria-labelledby="jr-h"><div class="sheet-h"><h2 id="jr-h">Journal du projet</h2><a class="small" href="/mails?project=${p.id}">Tous les mails</a></div>
    <div class="pj-kpis4 pj-j">${cell('Tous', j?.all, '')}${cell('Envoyé', j?.sent, 'sent')}${cell('Répondu', j?.replied, 'replied')}${cell('Non envoyé', j?.failed, 'failed', j?.failed ? `<span class="badge err">${ic('x')}échecs</span>` : '')}</div></section>`;
}

const external = (p, slug) => (slug === 'facturation'
  ? `<section class="sheet"><h2>Facturation</h2><p>Informations légales, devis, acomptes, factures et avoirs de ce projet.</p><p><a class="btn primary" href="/facturation/projet/${p.id}">${ic('receipt')}Ouvrir la facturation du projet</a></p></section>`
  : `<section class="sheet"><h2>Clients</h2><p>Les clients et prospects de ce projet : recherche, fiche, documents générés et export.</p><p><a class="btn primary" href="/clients">${ic('user')}Ouvrir les clients</a></p></section>`);

/**
 * @param {{email:string, entry:object, tab:string, stats:object|null, checklist:object|null, jobs:object}} a
 */
export function projectTabPage({ email, entry, tab, stats = null, checklist = null, jobs = {}, journal = null }) {
  const p = entry.project;
  const manage = p.access !== 'member';
  const tabs = TABS.filter(([, , needs]) => manage || !needs);
  const label = (TABS.find(([s]) => s === tab) || TABS[0])[1];
  const blocks = projectBlocks(p, entry.smtp, entry.dbCfg, entry.imap);
  const profile = p.profile;
  const body = tab === '' ? overview(p, checklist, stats, jobs)
    : tab === 'clients' || tab === 'facturation' ? external(p, tab)
      : tab === 'prospection' ? `<div class="pj-grid pj-grid-p"><div class="pj-flat pj-left">${blocks.target}\n${blocks.search}</div><div class="pj-flat">${blocks.prospects}</div></div>`
        : tab === 'envoi' ? `<p class="ban ban-info pj-ready" data-ready role="status"></p>
          <div class="pj-grid pj-grid-e"><div class="pj-flat pj-left">${blocks.template}\n${blocks.followuptpl}\n${journalCard(p, journal)}</div><div class="pj-flat">${blocks.send}\n${blocks.followup}\n${blocks.inbox}</div></div>`
          : `<div class="pj-flat">${(TAB_BLOCKS[tab] || []).map((k) => blocks[k]).join('\n')}</div>`;
  const summary = `<summary><span class="pname">${esc(p.name)}</span><button type="button" class="pcfg badge" data-cfg hidden></button><span class="pstate" data-state></span></summary>`;
  return layout({
    title: `${p.name} · ${label}`, email,
    body: `<div class="pj-page">
<details class="project tab-project" data-id="${p.id}" data-tab="${esc(tab)}" open>
${summary}
<div class="pbody">
<nav class="crumb" aria-label="Fil d'Ariane"><a href="/projets">Projets</a><span aria-hidden="true">›</span><span>${esc(p.name)}</span></nav>
<div class="ph pj-head"><div class="t"><h1 id="h-projet">${esc(p.name)}</h1>
  <span class="pj-meta"><span class="mono muted">${esc(repoOf(p.gitUrl))}</span>${stateBadge(checklist)}${profile ? `<span class="small muted">analysé le ${esc(new Date(p.profileAt * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }))}</span>` : ''}${p.access !== 'owner' ? `<span class="badge" title="Projet partagé par ${esc(p.ownerEmail || '')}">équipe de ${esc(p.ownerEmail || '')}</span>` : p.teamId ? '<span class="badge ok">partagé</span>' : ''}</span></div>
  <div class="acts"><button type="button" class="btn secondary prean" data-run="analyze" data-id="${p.id}"${profile ? ' data-reanalyze' : ''} aria-label="${profile ? 'Réanalyser' : 'Analyser'} le projet">${ic(profile ? 'repeat' : 'spark')}<span>${profile ? 'Réanalyser' : 'Analyser'}</span></button></div></div>
<nav class="ptabs" aria-label="Sections du projet">${tabs.map(([s, l]) => `<a href="${tabHref(p.id, s)}"${s === tab ? ' aria-current="page"' : ''}>${esc(l)}${s === 'prospection' && stats?.prospects ? ` <span class="count">${fr(stats.prospects)}</span>` : ''}</a>`).join('')}</nav>
<label class="psel">Section : <select data-psel aria-label="Section du projet">${tabs.map(([s, l]) => `<option value="${tabHref(p.id, s)}"${s === tab ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
<div class="job" data-job="analyze"></div>
${body}
</div>
</details>
<dialog class="prospect-dialog" id="prospect-dialog" aria-label="Fiche prospect"><div data-dialog-body></div></dialog>
</div>`,
  });
}
