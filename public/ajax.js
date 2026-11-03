// Navigation sans rafraîchissement : liens et formulaires de l'application passent par fetch ; seul le contenu de la page est remplacé.
// La position de défilement, les sections ouvertes et le fond animé sont conservés, une erreur de formulaire s'affiche en notification sans
// rien perdre, et tout ce qui ne peut pas se faire ainsi (autre site, connexion, téléchargement) retombe sur la navigation normale.
// Après chaque remplacement, les scripts de la page (app.js, responsive.js…) sont relancés : app.js arrête d'abord son exécution précédente.
(() => {
  if (!window.fetch || !window.DOMParser || !history.pushState || !window.URL) return;
  history.scrollRestoration = 'manual';
  const mark = (state) => { document.documentElement.dataset.nav = state; }; // « loading » pendant un remplacement de page, « ready » une fois ses scripts relancés
  mark('ready');
  history.replaceState({ y: scrollY }, '');

  const STAY = /\/static\/(ajax|fx)\.js(\?|$)/; // scripts qui restent en place (le reste est relancé à chaque page)
  const abs = (u) => new URL(u, location.href);
  const here = () => location.pathname + location.search;
  const sheets = (d) => [...d.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute('href')).sort().join('|');
  const toast = (msg, kind = 'error') => (window.AiTools?.toast ? window.AiTools.toast(msg, kind) : console.error(msg));
  let loaded = here();
  let seq = 0;
  let inflight = null;

  // ---------- Indicateur : un filet en haut de page, seulement si la réponse tarde ----------
  let bar = null;
  let barTimer = 0;
  const busy = (on) => {
    document.documentElement.classList.toggle('nav-busy', on);
    clearTimeout(barTimer);
    if (on) {
      barTimer = setTimeout(() => {
        if (!bar) { bar = document.createElement('div'); bar.setAttribute('aria-hidden', 'true'); document.documentElement.append(bar); }
        bar.className = 'nav-bar on';
      }, 150);
    } else if (bar) bar.className = 'nav-bar';
  };

  // La page reçue a-t-elle la même « coque » (feuilles de style, type de page) ? Sinon : navigation normale (site public, connexion, nouvelle version…).
  // (classes posées par le script lui-même, comme hdr-off, ne comptent pas)
  const shell = (body) => [...body.classList].filter((c) => c !== 'hdr-off').sort().join(' ');
  const compatible = (doc) => {
    const why = !doc.body ? 'page vide' : shell(doc.body) !== shell(document.body) ? 'autre type de page' : sheets(doc) !== sheets(document) ? 'feuilles de style différentes (nouvelle version ?)' : !doc.getElementById('contenu') ? 'pas de contenu principal' : null;
    if (why) console.info(`[ajax] navigation normale : ${why}`);
    return !why;
  };

  const errorText = (doc, status) => {
    const t = doc.querySelector('.card p, main p')?.textContent?.trim();
    return t || window.AiTools?.httpErrorText?.(status) || (status >= 500 ? 'Erreur interne : réessaie dans un instant.' : `Erreur ${status}`);
  };

  async function download(res) {
    const blob = await res.blob();
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') || '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = m ? decodeURIComponent(m[1]) : '';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // Ce qui doit survivre à un remplacement sur la même page : sections ouvertes, onglet de gamme des prompts
  const OPENABLE = 'details.project, details.acc, details.prompt-def, details.tip, details.faq-i';
  const snapshot = () => ({
    open: [...document.querySelectorAll(OPENABLE)].map((d) => [d.querySelector('summary')?.textContent.trim() ?? '', d.open]),
    scope: document.querySelector('[data-prompts]')?.dataset.pscope ?? null,
  });
  const restore = (snap) => {
    const list = [...document.querySelectorAll(OPENABLE)];
    if (list.length === snap.open.length) list.forEach((d, i) => { if (d.querySelector('summary')?.textContent.trim() === snap.open[i][0]) d.open = snap.open[i][1]; });
    if (snap.scope && snap.scope !== '*') document.querySelector(`[data-pscope-tab="${snap.scope}"]`)?.click();
  };

  async function boot(doc) {
    for (const s of document.head.querySelectorAll('script[data-soft]')) s.remove();
    const srcs = [...doc.head.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).filter((src) => !STAY.test(src));
    for (const src of srcs) {
      await new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.dataset.soft = '';
        s.onload = s.onerror = resolve;
        document.head.append(s);
      });
    }
  }

  // Anime l'arrivée du contenu (classes de tokens.css). Le nettoyage se fait à la fin de l'animation, ou au bout d'un délai si elle n'a pas lieu (mouvement réduit).
  function transition(move) {
    const main = document.getElementById('contenu');
    const page = main?.querySelector(':scope > .page');
    if (!page) return;
    main.classList.add('pt-run');
    page.dataset.move = move;
    const done = () => { delete page.dataset.move; main.classList.remove('pt-run'); };
    setTimeout(done, 700);
  }

  async function swap(doc, url, { push, keepScroll, y }) {
    const u = abs(url);
    const next = u.pathname + u.search;
    const snap = keepScroll ? snapshot() : null;
    mark('loading');
    // Sens de la transition d'après l'ordre des onglets de la barre du haut : vers la droite, le contenu arrive par la droite ; vers la gauche, par la gauche.
    // Hors des onglets (Réglages, Compte…) : simple fondu vers le haut. Rien lors d'un rechargement de la même page (formulaire enregistré).
    const tabs = [...document.querySelectorAll('.pills a.pill')].map((a) => a.pathname);
    const tabOf = (p) => tabs.findIndex((t) => (t === '/' ? p === '/' : p === t || p.startsWith(`${t}/`)));
    const fromPath = abs(loaded).pathname;
    const [a, z] = [tabOf(fromPath), tabOf(u.pathname)];
    const move = keepScroll || fromPath === u.pathname ? null : a >= 0 && z >= 0 ? (z > a ? 'right' : 'left') : 'up';
    const savedY = scrollY; // le contenu est remplacé d'un coup : la page peut être raccourcie un instant, on garde la valeur d'avant
    const toastBox = document.querySelector('.toasts'); // les notifications en cours survivent à la navigation
    // Le fond animé reste tel quel pendant le remplacement : pas de clignotement
    const bg = document.getElementById('bg');
    document.title = doc.title;
    const keep = document.body.classList.contains('hdr-off');
    document.body.className = doc.body.className;
    if (keep) document.body.classList.add('hdr-off');
    document.body.innerHTML = doc.body.innerHTML;
    if (bg && document.getElementById('bg')) document.getElementById('bg').replaceWith(bg);
    if (toastBox) document.body.append(toastBox);
    if (push) {
      history.replaceState({ ...history.state, y: scrollY }, '');
      if (next === here()) history.replaceState({ y: 0 }, '', url); else history.pushState({ y: 0 }, '', url);
    } else if (keepScroll && next !== here()) {
      history.replaceState({ y: scrollY }, '', url); // redirection après un formulaire (ex. ?ok) : même place dans l'historique
    }
    loaded = next;
    const target = u.hash && document.getElementById(decodeURIComponent(u.hash.slice(1)));
    const place = () => { if (target) target.scrollIntoView(); else scrollTo(0, keepScroll || y != null ? (y ?? savedY) : 0); };
    place();
    if (move) transition(move);
    await boot(doc);
    if (snap) restore(snap);
    place();
    if (!keepScroll && y == null) document.getElementById('contenu')?.focus({ preventScroll: true });
    mark('ready');
    document.dispatchEvent(new Event('soft:ready'));
  }

  /**
   * @param {string} url
   * @param {{method?: string, body?: URLSearchParams|null, push?: boolean, keepScroll?: boolean, y?: number|null, onFail?: () => void}} [o]
   */
  async function visit(url, { method = 'GET', body = null, push = true, keepScroll = false, y = null, onFail = () => {} } = {}) {
    const mine = ++seq;
    inflight?.abort();
    const ctrl = inflight = new AbortController();
    busy(true);
    let res;
    try {
      res = await fetch(url, {
        method, body, signal: ctrl.signal, credentials: 'same-origin', redirect: 'follow',
        headers: { Accept: 'text/html,application/xhtml+xml', 'X-AiTools-Nav': '1', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' } : {}) },
      });
    } catch (e) {
      if (e.name === 'AbortError') return;
      busy(false);
      if (method === 'GET') { location.assign(url); return; }
      onFail();
      toast(window.AiTools?.networkErrorText?.() || 'Connexion impossible : réessaie dans un instant.');
      return;
    }
    if (mine !== seq) return;
    const type = res.headers.get('content-type') || '';
    if (!type.includes('text/html')) {
      // Fichier (CSV, .ics…) : enregistré directement depuis cette réponse, sans refaire la requête ni quitter la page.
      // Autre contenu affichable (JSON, texte…) : navigation normale, vers une adresse qui ne change rien (GET).
      if (/attachment/i.test(res.headers.get('content-disposition') || '') || method !== 'GET') {
        try { await download(res); } catch { toast('Téléchargement impossible.'); }
        busy(false);
        onFail();
        return;
      }
      busy(false);
      location.assign(url);
      return;
    }
    const text = await res.text();
    if (mine !== seq) return;
    busy(false);
    const doc = new DOMParser().parseFromString(text, 'text/html');
    if (method !== 'GET' && !res.ok) { onFail(); toast(errorText(doc, res.status)); return; } // erreur de formulaire : on reste là, rien n'est perdu
    // Le serveur refuse la saisie en redirigeant vers la même page avec « ?e=… » : remplacer la page viderait le formulaire. Même traitement qu'une erreur 4xx :
    // on reste là, les champs gardent ce qui a été saisi, l'erreur s'affiche en notification. Une redirection vers une autre page (ou sans « e ») est une navigation normale.
    if (method !== 'GET' && res.redirected) {
      const back = new URL(res.url);
      if (back.origin === location.origin && back.pathname === location.pathname && back.searchParams.get('e')) { onFail(); toast(back.searchParams.get('e')); return; }
    }
    if (!compatible(doc)) { if (method === 'GET' || res.redirected) location.assign(res.url); else { onFail(); toast('Réponse inattendue : recharge la page.'); } return; }
    await swap(doc, res.url, { push, keepScroll, y });
  }

  window.AiNav = {
    go: (url) => visit(abs(url).href, { push: true }),
    reload: () => visit(location.href, { push: false, keepScroll: true }),
  };

  // ---------- Liens ----------
  // Écouteurs sur window (après ceux d'app.js sur document) : un clic déjà traité par l'application (defaultPrevented) n'est pas repris.
  window.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href]');
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download') || a.hasAttribute('data-noajax') || /\bexternal\b/.test(a.rel)) return;
    const u = abs(a.href);
    if (u.origin !== location.origin || !/^https?:$/.test(u.protocol)) return;
    if (u.pathname + u.search === here() && u.hash) return; // ancre dans la page
    if (/^\/static\//.test(u.pathname)) return;
    e.preventDefault();
    visit(u.href, { push: true });
  });

  // ---------- Formulaires ----------
  window.addEventListener('submit', (e) => {
    if (e.defaultPrevented) return;
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || form.hasAttribute('data-noajax') || form.dataset.soft === 'busy') return;
    const sub = e.submitter;
    const attr = (name) => (sub && sub.getAttribute(name)) || form.getAttribute(name.replace('form', ''));
    const method = (attr('formmethod') || 'get').toLowerCase();
    const target = attr('formtarget');
    if (method === 'dialog' || (target && target !== '_self')) return;
    const action = abs(attr('formaction') || location.href);
    if (action.origin !== location.origin) return;
    if (/multipart/i.test(attr('formenctype') || form.enctype) || form.querySelector('input[type=file]')) return; // envoi de fichier : navigation normale
    e.preventDefault();

    const fields = [...new FormData(form)].filter(([, v]) => typeof v === 'string');
    if (sub?.name) fields.push([sub.name, sub.value]);
    const same = action.pathname === location.pathname;
    form.dataset.soft = 'busy';
    if (sub) sub.disabled = true;
    const done = () => { delete form.dataset.soft; if (sub) sub.disabled = false; };
    if (method === 'get') {
      for (const [k, v] of fields) action.searchParams.set(k, v);
      visit(action.href, { push: !same, keepScroll: same, onFail: done });
    } else {
      visit(action.href, { method: 'POST', body: new URLSearchParams(fields), push: false, keepScroll: true, onFail: done });
    }
  });

  // ---------- Précédent / suivant ----------
  window.addEventListener('popstate', () => {
    if (here() === loaded) return; // simple changement d'ancre
    visit(location.href, { push: false, y: history.state?.y ?? 0 });
  });
})();
