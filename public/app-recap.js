// Récap d'un projet : indicateurs et courbes d'historique (SVG maison : pas de lib externe, CSP stricte).
// Chargé après app.js, qui expose ses outils communs dans window.AiTools ; ajax.js relance ce script à chaque navigation, comme app.js.
(() => {
  const { $, $$, api, esc, every, listen, loadFailed, loadingHtml } = window.AiTools;

  // ---------- Courbes (SVG maison : pas de lib externe, CSP stricte) ----------
  // Dessinées à la largeur réelle du conteneur (1 unité = 1 px) pour que les textes restent lisibles sur mobile.
  const M = { l: 46, r: 56, t: 12, b: 24, h: 150 };
  const niceMax = (v) => { if (!(v > 0)) return 1; const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
  const fmtVal = (v, unit) => (unit === '€'
    ? v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
    : v.toLocaleString('fr-FR', { maximumFractionDigits: 1 }));
  const shortDay = (d) => { const [, m, dd] = d.split('-'); return `${dd}/${m}`; };
  const yGrid = (w, max, unit, Y) => [0, 0.5, 1].map((f) => `<line class="grid" x1="${M.l}" x2="${w - M.r}" y1="${Y(max * f)}" y2="${Y(max * f)}"/>
    <text class="axis" x="${M.l - 6}" y="${Y(max * f) + 4}" text-anchor="end">${esc(fmtVal(max * f, unit))}</text>`).join('');

  function drawLine(fig, w) {
    const { unit, xs, ys } = JSON.parse(fig.dataset.series);
    const max = niceMax(Math.max(...ys));
    const step = (w - M.l - M.r) / (xs.length - 1);
    const X = (i) => M.l + i * step;
    const Y = (v) => M.t + (M.h - M.t - M.b) * (1 - v / max);
    const d = ys.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    const n = xs.length - 1;
    fig.querySelector('.plot').innerHTML = `<svg width="${w}" height="${M.h}" role="img" aria-label="${esc(fig.dataset.title)}">
      ${yGrid(w, max, unit, Y)}
      <text class="axis" x="${M.l}" y="${M.h - 6}">${shortDay(xs[0])}</text>
      <text class="axis" x="${w - M.r}" y="${M.h - 6}" text-anchor="end">${shortDay(xs[n])}</text>
      <path class="line" d="${d}"/>
      <circle class="dot" cx="${X(n)}" cy="${Y(ys[n])}" r="4"/>
      <text class="end" x="${X(n) + 8}" y="${Y(ys[n]) + 4}">${esc(fmtVal(ys[n], unit))}</text>
      <line class="cross" x1="0" x2="0" y1="${M.t}" y2="${M.h - M.b}"/>
      <circle class="dot hover" r="5"/>
      <rect class="hit" x="${M.l - step / 2}" y="0" width="${w - M.l - M.r + step}" height="${M.h}"/>
    </svg>`;
    fig._hover = (vx) => {
      const i = Math.max(0, Math.min(n, Math.round((vx - M.l) / step)));
      return { x: X(i), y: Y(ys[i]), html: `<strong>${esc(fmtVal(ys[i], unit))}</strong> · ${shortDay(xs[i])}` };
    };
  }

  // Barres arrondies en haut (4 px), à plat sur la ligne de base
  const bar = (x, y, bw, base) => {
    const r = Math.min(4, bw / 2, base - y);
    return base - y < 1 ? '' : `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${base}Z`;
  };

  function drawBars(fig, w) {
    const { weeks } = JSON.parse(fig.dataset.series);
    const max = niceMax(Math.max(1, ...weeks.flatMap((x) => [x.sent, x.replies, x.followups || 0])));
    const base = M.h - M.b;
    const Y = (v) => M.t + (base - M.t) * (1 - v / max);
    const gw = (w - M.l - M.r) / weeks.length;
    const bw = Math.max(3, Math.min(14, (gw - 8) / 3));
    // Une étiquette de date tous les ~56 px au minimum, quelle que soit la largeur
    const every = Math.max(1, Math.ceil(weeks.length / Math.max(1, Math.floor((w - M.l - M.r) / 56))));
    const marks = weeks.map((x, i) => {
      const x0 = M.l + i * gw + (gw - (3 * bw + 4)) / 2;
      const last = i === weeks.length - 1;
      return `<path class="b1" d="${bar(x0, Y(x.sent), bw, base)}"/><path class="b2" d="${bar(x0 + bw + 2, Y(x.replies), bw, base)}"/><path class="b3" d="${bar(x0 + 2 * bw + 4, Y(x.followups || 0), bw, base)}"/>
        ${(weeks.length - 1 - i) % every === 0 ? `<text class="axis" x="${x0 + bw + 1}" y="${M.h - 6}" text-anchor="middle">${shortDay(x.start)}</text>` : ''}
        ${last ? `<text class="end" x="${x0 + bw / 2}" y="${Y(x.sent) - 5}" text-anchor="middle">${x.sent}</text>
                  <text class="end" x="${x0 + bw * 1.5 + 2}" y="${Y(x.replies) - 5}" text-anchor="middle">${x.replies}</text>` : ''}`;
    }).join('');
    fig.querySelector('.plot').innerHTML = `<svg width="${w}" height="${M.h}" role="img" aria-label="${esc(fig.dataset.title)}">
      ${yGrid(w, max, '', Y)}<line class="base" x1="${M.l}" x2="${w - M.r}" y1="${base}" y2="${base}"/>${marks}
      <rect class="hit" x="${M.l}" y="0" width="${w - M.l - M.r}" height="${M.h}"/></svg>`;
    fig._hover = (vx) => {
      const i = Math.max(0, Math.min(weeks.length - 1, Math.floor((vx - M.l) / gw)));
      const x = weeks[i];
      const rate = x.sent ? ` (${Math.round((x.replies / x.sent) * 100)} %)` : '';
      return { x: M.l + (i + 0.5) * gw, y: Y(Math.max(x.sent, x.replies)), band: true,
        html: `Semaine du ${shortDay(x.start)}<br><strong>${x.sent}</strong> envoyé(s) · <strong>${x.replies}</strong> réponse(s) · <strong>${x.followups || 0}</strong> relance(s)${rate}` };
    };
  }

  function drawChart(fig) {
    const w = Math.max(240, Math.floor(fig.querySelector('.plot').clientWidth));
    (fig.dataset.kind === 'bars' ? drawBars : drawLine)(fig, w);
  }

  // Survol : réticule + infobulle (souris et tactile)
  listen(document, 'pointermove', (e) => {
    const svg = e.target.closest?.('.chart svg');
    const fig = svg?.closest('.chart');
    // L'attribut hidden n'agit pas sur les éléments SVG : on passe par une classe
    $$('.chart.hovering').forEach((c) => { if (c !== fig) { c.classList.remove('hovering'); c.querySelector('.tip').hidden = true; } });
    if (!svg) return;
    fig.classList.add('hovering');
    if (!fig._hover) return;
    const box = svg.getBoundingClientRect();
    const h = fig._hover(e.clientX - box.left);
    const cross = svg.querySelector('.cross');
    const dot = svg.querySelector('.dot.hover');
    if (cross) { cross.setAttribute('x1', h.x); cross.setAttribute('x2', h.x); }
    if (dot) { dot.setAttribute('cx', h.x); dot.setAttribute('cy', h.y); }
    const tip = fig.querySelector('.tip');
    tip.innerHTML = h.html;
    tip.hidden = false;
    tip.style.left = `${Math.min(box.width - 70, Math.max(70, h.x))}px`;
    tip.style.top = `${h.y + fig.querySelector('.plot').offsetTop - 8}px`;
  });

  function figure(kind, title, series, empty) {
    return `<figure class="chart" data-kind="${kind}" data-title="${esc(title)}" data-series="${esc(JSON.stringify(series))}">
      <figcaption>${esc(title)}</figcaption>
      ${kind === 'bars' ? '<p class="legend small"><span class="sw s1"></span>Mails envoyés <span class="sw s2"></span>Réponses <span class="sw s3"></span>Relances</p>' : ''}${empty ? `<p class="muted small">${empty}</p>` : '<div class="plot"></div><div class="tip" hidden></div>'}</figure>`;
  }

  async function loadHistory(proj, days = 30) {
    const box = $('[data-charts]', proj);
    if (!box) return;
    let h;
    try { h = await api(`/api/projects/${proj.dataset.id}/history?days=${days}`); }
    catch (err) { loadFailed(box, err.message, () => loadHistory(proj, days)); return; }
    const kpi = (key, title, unit) => {
      const pts = h.daily.filter((d) => d[key] != null);
      return figure('line', title, { unit, xs: pts.map((d) => d.day), ys: pts.map((d) => d[key]) },
        pts.length < 2 ? 'Pas encore assez de données : une photo est prise chaque jour (et à chaque ouverture du récap).' : '');
    };
    box.innerHTML = `
      <div class="row chart-head"><h4>Évolution</h4>
        <div class="seg" role="group" aria-label="Période">${[30, 90].map((d) => `<button type="button" class="btn small" data-days="${d}" aria-pressed="${d === days}">${d} jours</button>`).join('')}</div>
      </div>
      <div class="charts">
        ${kpi('users', 'Utilisateurs', '')}${kpi('clients', 'Clients payants', '')}${kpi('revenue', 'Revenu total', '€')}
        ${figure('bars', 'Prospection par semaine', { weeks: h.weeks })}
      </div>
      <details class="small"><summary>Voir les données</summary>
        <div class="table-wrap"><table><thead><tr><th>Jour</th><th>Utilisateurs</th><th>Clients</th><th>Revenu</th></tr></thead><tbody>
          ${h.daily.map((d) => `<tr><td>${shortDay(d.day)}</td><td>${d.users ?? '–'}</td><td>${d.clients ?? '–'}</td><td>${d.revenue != null ? esc(fmtVal(d.revenue, '€')) : '–'}</td></tr>`).join('') || '<tr><td colspan="4">Aucune photo pour l\'instant.</td></tr>'}
        </tbody></table>
        <table><thead><tr><th>Semaine du</th><th>Envoyés</th><th>Réponses</th><th>Relances</th></tr></thead><tbody>
          ${h.weeks.map((x) => `<tr><td>${shortDay(x.start)}</td><td>${x.sent}</td><td>${x.replies}</td><td>${x.followups || 0}</td></tr>`).join('')}
        </tbody></table></div>
      </details>`;
    $$('.chart', box).forEach((fig) => { if (fig.querySelector('.plot')) drawChart(fig); });
  }

  listen(document, 'click', (e) => {
    const b = e.target.closest('[data-days]');
    if (b) loadHistory(b.closest('.project'), Number(b.dataset.days));
  });
  let resizeT;
  listen(window, 'resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => $$('.chart .plot').forEach((p) => drawChart(p.closest('.chart'))), 150);
  });

  // ---------- Récap ----------
  async function loadRecap(proj, force = false) {
    const box = $('[data-recap]', proj);
    box.innerHTML = loadingHtml();
    try {
      const r = await api(`/api/projects/${proj.dataset.id}/recap${force ? '?force' : ''}`);
      const b = r.business;
      const s = r.stats;
      const eur = (v) => (typeof v === 'number' ? v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : esc(v ?? '—'));
      box.innerHTML = `
        <div class="kpis">
          <div class="kpi"><span>Utilisateurs</span><strong>${b?.users ?? '—'}</strong></div>
          <div class="kpi"><span>Clients payants</span><strong>${b?.clients ?? '—'}</strong></div>
          <div class="kpi"><span>Revenu total</span><strong>${b ? eur(b.revenue) : '—'}</strong></div>
        </div>
        ${r.error ? `<p class="muted small">BDD : ${esc(r.error)}</p>` : ''}
        <h4>Prospection</h4>
        <div class="kpis">
          <div class="kpi"><span>Trouvés</span><strong>${s.total || 0}</strong></div>
          <div class="kpi"><span>Contactés</span><strong>${(s.sent || 0) + (s.replied || 0) + (s.client || 0) + (s.refused || 0)}</strong></div>
          <div class="kpi"><span>Réponses</span><strong>${(s.replied || 0) + (s.client || 0)}</strong></div>
          <div class="kpi"><span>Convertis</span><strong>${s.client || 0}</strong></div>
        </div>
        <p class="muted small">${r.priced ? `Coût IA du projet (équivalent API) : $${r.aiCostUsd.toFixed(2)}${b?.cached ? ' · chiffres en cache (10 min)' : ''}` : (b?.cached ? 'Chiffres en cache (10 min)' : '')}
        <button class="btn small" data-recap-refresh>Rafraîchir</button></p>
        <div data-charts></div>`;
      loadHistory(proj);
    } catch (err) { loadFailed(box, err.message, () => loadRecap(proj, force)); }
  }

  window.AiTools.loadRecap = loadRecap;
  $$('details[data-acc="recap"][open]').forEach((d) => loadRecap(d.closest('.project'))); // onglet Récapitulatif : la section est ouverte d'office
})();
