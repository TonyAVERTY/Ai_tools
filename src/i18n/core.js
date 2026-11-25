// Noyau de la traduction de l'interface. Le texte français est la clé : `makeLookup({ 'Texte français': 'Translation' })` renvoie une fonction qui traduit un texte
// ou renvoie null (le texte reste alors en français : repli automatique). Ce fichier est servi tel quel au navigateur (/static/i18n-core.js) : aucun import,
// aucune API de Node. Le serveur (src/i18n/html.js) et le navigateur (public/i18n.js) traduisent donc avec exactement les mêmes règles.
//
// Règles de recherche, dans l'ordre :
//   1. texte exact (espaces réduits à un seul, insécables compris) ;
//   2. texte exact sans le point final (« Erreur. » se traduit comme « Erreur » : l'application ajoute ce point à l'affichage) ;
//   3. modèles à trous, avec { nom } dans la clé et dans la traduction : « Tu as {n} projets » → « You have {n} projects ».
// Un texte qui contient du balisage (« Clique sur <strong>Accepter</strong> ») se cherche avec ses balises SANS leurs attributs (voir `canonInline`) ;
// les attributs d'origine (href, class…) sont remis dans la traduction, balise par balise, dans l'ordre.

export const normalize = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

const ENTITIES = { quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', hellip: '…', middot: '·', ndash: '–', mdash: '—', rarr: '→', larr: '←', euro: '€', copy: '©' };
/** Décode les entités HTML d'un texte (sauf & < > : voir `canonInline`). */
export function decodeEntities(s, { keepMarkup = false } = {}) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      const ch = Number.isFinite(code) ? String.fromCodePoint(code) : m;
      return keepMarkup && /[&<>]/.test(ch) ? m : ch;
    }
    const lower = e.toLowerCase();
    if (lower === 'amp') return keepMarkup ? m : '&';
    if (lower === 'lt') return keepMarkup ? m : '<';
    if (lower === 'gt') return keepMarkup ? m : '>';
    return ENTITIES[lower] ?? m;
  });
}
export const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escapeAttr = (s) => escapeText(s).replace(/"/g, '&quot;');

/** Forme canonique d'un texte avec balisage : entités décodées (sauf & < >), balises sans attributs, espaces réduits. */
export function canonInline(html) {
  return normalize(decodeEntities(String(html), { keepMarkup: true }).replace(/<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi, (_, close, name, self) => `<${close}${name.toLowerCase()}${self}>`));
}

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(fr, tr) {
  const names = [];
  const source = fr.split(/(\{[a-zA-Z0-9_]+\})/).map((part) => {
    const m = /^\{([a-zA-Z0-9_]+)\}$/.exec(part);
    if (!m) return reEscape(part);
    names.push(m[1]);
    return '(.+?)';
  }).join('');
  const literal = fr.replace(/\{[a-zA-Z0-9_]+\}/g, '').length;
  return { re: new RegExp(`^${source}$`, 's'), names, tr, literal };
}

/**
 * @param {Record<string,string>} entries  texte français → traduction
 * @returns {{ text(raw:string): string|null, inline(html:string): string|null, size: number }}
 */
export function makeLookup(entries) {
  const exact = new Map();
  const patterns = [];
  for (const [fr, tr] of Object.entries(entries)) {
    const key = fr.includes('<') ? canonInline(fr) : normalize(fr);
    if (/\{[a-zA-Z0-9_]+\}/.test(key)) patterns.push(compile(key, tr));
    else exact.set(key, tr);
  }
  patterns.sort((a, b) => b.literal - a.literal); // le modèle le plus précis d'abord
  const cache = new Map();

  function find(key) {
    if (exact.has(key)) return exact.get(key);
    for (const p of patterns) {
      const m = p.re.exec(key);
      if (!m) continue;
      let out = p.tr;
      p.names.forEach((n, i) => { out = out.split(`{${n}}`).join(m[i + 1]); });
      return out;
    }
    return null;
  }
  function resolve(key) {
    if (!key) return null;
    if (cache.has(key)) return cache.get(key);
    let r = find(key);
    // « Erreur. » : le point final est ajouté à l'affichage, la clé est écrite sans lui
    if (r == null && key.length > 1 && key.endsWith('.') && !key.endsWith('..')) { const base = find(key.slice(0, -1)); if (base != null) r = base.endsWith('.') ? base : `${base}.`; }
    if (cache.size > 20000) cache.clear();
    cache.set(key, r);
    return r;
  }
  return {
    /** Texte brut (entités déjà décodées). Les espaces autour sont conservés. */
    text(raw) {
      const s = String(raw ?? '');
      const key = normalize(s);
      const tr = resolve(key);
      if (tr == null) return null;
      return `${/^\s*/.exec(s)[0]}${tr}${/\s*$/.exec(s)[0]}`;
    },
    /** Contenu avec balisage : clé canonique (balises sans attributs). La traduction garde ses balises ; l'appelant remet les attributs. */
    inline(html) { return resolve(canonInline(html)); },
    size: exact.size + patterns.length,
  };
}

/** Remet, dans une traduction qui contient des balises sans attributs, les balises d'ouverture d'origine (avec leurs attributs), dans l'ordre. null si les balises ne correspondent pas. */
export function restoreTags(translated, originalHtml) {
  const queues = new Map();
  for (const m of String(originalHtml).matchAll(/<([a-z][a-z0-9]*)\b[^>]*>/gi)) {
    const name = m[1].toLowerCase();
    if (!queues.has(name)) queues.set(name, []);
    queues.get(name).push(m[0]);
  }
  let ok = true;
  const out = String(translated).replace(/<([a-z][a-z0-9]*)(\/?)>/gi, (whole, name, self) => {
    const q = queues.get(name.toLowerCase());
    if (!q?.length) { ok = false; return whole; }
    const raw = q.shift();
    return self && !/\/\s*>$/.test(raw) ? raw.replace(/>$/, '/>') : raw;
  });
  const leftover = [...queues.values()].some((q) => q.length);
  return ok && !leftover ? out : null;
}
