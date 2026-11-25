// Traduction de ce que le navigateur ajoute à la page après son envoi (notifications, fenêtres, blocs chargés, textes mis à jour). Les pages arrivent déjà traduites du
// serveur (src/i18n/html.js) ; ce script traduit le reste avec EXACTEMENT les mêmes règles (/static/i18n-core.js). Il ne s'active que dans une autre langue que le français.
(() => {
  const lang = document.documentElement.lang;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'PRE', 'CODE', 'KBD', 'SAMP', 'TEXTAREA', 'SVG', 'TEMPLATE', 'NOSCRIPT']);
  const INLINE = new Set(['A', 'ABBR', 'B', 'BR', 'CODE', 'EM', 'I', 'KBD', 'MARK', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'S']);
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'data-confirm', 'data-confirm-label', 'data-label', 'data-tip', 'data-empty', 'data-text', 'data-title', 'data-ok'];

  // Français : pas de dictionnaire, seulement la marque (« IaBoss ») dans les textes ajoutés après coup
  Promise.all([import('/static/i18n-core.js'), /^(en|es)$/.test(lang) ? fetch(`/static/i18n/${lang}.json`, { credentials: 'same-origin' }).then((r) => r.json()) : Promise.resolve({})]).then(([core, dict]) => {
    const lookup = core.withBrand(core.makeLookup(dict));
    const skipped = (el) => SKIP.has(el.tagName?.toUpperCase());

    const text = (node) => {
      const tr = lookup.text(node.nodeValue);
      if (tr != null && tr !== node.nodeValue) node.nodeValue = tr;
    };
    const attrs = (el) => {
      for (const a of ATTRS) {
        const v = el.getAttribute?.(a);
        if (v == null) continue;
        const tr = lookup.text(v);
        if (tr != null && tr !== v) el.setAttribute(a, tr);
      }
      const type = (el.getAttribute?.('type') || '').toLowerCase();
      if (el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(type)) {
        const tr = lookup.text(el.getAttribute('value') || '');
        if (tr != null) el.setAttribute('value', tr);
      }
    };
    // Une phrase avec balises (« Clique sur <strong>Accepter</strong> ») se traduit d'un bloc
    const inlineOnly = (el) => [...el.childNodes].every((n) => n.nodeType === 3 || n.nodeType === 8 || (n.nodeType === 1 && INLINE.has(n.tagName) && inlineOnly(n)));
    const tree = (node) => {
      if (node.nodeType === 3) { text(node); return; }
      if (node.nodeType !== 1 || skipped(node)) return;
      attrs(node);
      if (node.children.length && inlineOnly(node) && [...node.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) {
        const html = node.innerHTML;
        const tr = lookup.inline(html);
        const restored = tr == null ? null : core.restoreTags(tr, html);
        if (restored != null) { node.innerHTML = restored; return; }
      }
      for (const child of [...node.childNodes]) tree(child);
    };

    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') attrs(r.target);
        else if (r.type === 'characterData') { if (!skipped(r.target.parentElement || document.body)) text(r.target); }
        else if (r.addedNodes.length && r.target.nodeType === 1 && !skipped(r.target)) {
          // Une phrase à balises qui change est relue d'un bloc ; sinon seuls les nœuds ajoutés sont traduits (jamais toute la page)
          const t = r.target;
          if (t !== document.body && t !== document.documentElement && t.children.length && inlineOnly(t)) tree(t);
          else for (const n of r.addedNodes) tree(n);
        }
      }
      observer.takeRecords(); // nos propres changements ne se re-traduisent pas
    });
    const start = () => {
      tree(document.body);
      document.title = lookup.text(document.title) ?? document.title;
      observer.takeRecords();
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(['value']) });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
    window.AiI18n = { lang, t: (fr) => lookup.text(fr) ?? fr };
    document.dispatchEvent(new Event('ai-i18n-ready'));
  }).catch(() => { /* sans dictionnaire, tout reste en français */ });
})();
