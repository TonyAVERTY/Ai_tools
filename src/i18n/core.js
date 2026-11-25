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
    // {n} et {m} : des nombres (« 3 », « 1 200 », « 2,5 ») ; les autres trous prennent n'importe quel texte
    // {aiName} : seulement le nom d'une IA (Claude, ChatGPT, Gemini), pour que « Ouvrir Claude » n'avale pas « Ouvrir ou fermer… »
    if (m[1] === 'aiName') return '(Claude|ChatGPT|Gemini)';
    return /^[nm]$/.test(m[1]) ? '(\\d[\\d\\s.,]*?)' : '(.+?)';
  }).join('');
  const literal = fr.replace(/\{[a-zA-Z0-9_]+\}/g, '').length;
  // Un modèle avec très peu de mots fixes (« À {a} », « sur {a} », « {a} : {b} ») ne s'applique qu'à une valeur courte, sans phrase :
  // sinon il avalerait n'importe quel texte inconnu (« À quoi sert… ? », « Siège : … ») et l'abîmerait sans qu'on le voie
  const letters = fr.replace(/\{[a-zA-Z0-9_]+\}/g, '').replace(/<[^>]*>/g, '').replace(/[^\p{L}]/gu, '').length;
  const numericOnly = names.every((n) => /^[nm]$/.test(n));
  const loose = letters < 4 && !numericOnly;
  return { re: new RegExp(`^${source}$`, 's'), names, tr, literal, loose };
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
    else {
      exact.set(key, tr);
      // L'application met le nom de l'IA de la personne à la place de « Claude » (ChatGPT, Gemini) : la même phrase, avec un autre nom, se traduit aussi
      if (key !== 'Claude' && key.includes('Claude') && String(tr).includes('Claude')) patterns.push(compile(key.split('Claude').join('{aiName}'), String(tr).split('Claude').join('{aiName}')));
    }
  }
  patterns.sort((a, b) => b.literal - a.literal); // le modèle le plus précis d'abord
  const cache = new Map();

  // Les valeurs d'un modèle sont traduites à leur tour : « Étape {n} sur {m} : {étape} » traduit aussi l'étape (3 niveaux au plus)
  function find(key, depth) {
    if (exact.has(key)) return exact.get(key);
    for (const p of patterns) {
      const m = p.re.exec(key);
      if (!m) continue;
      if (p.loose && m.slice(1).some((v) => v.length > 40 || /[.:;!?…]/.test(v))) continue;
      let out = p.tr;
      p.names.forEach((n, i) => { const v = m[i + 1]; out = out.split(`{${n}}`).join((depth < 3 && resolve(v, depth + 1)) || v); });
      return out;
    }
    return null;
  }
  function resolve(key, depth = 0) {
    if (!key) return null;
    if (depth === 0 && cache.has(key)) return cache.get(key);
    let r = find(key, depth);
    // « Erreur. » : le point final est ajouté à l'affichage, la clé est écrite sans lui
    if (r == null && key.length > 1 && key.endsWith('.') && !key.endsWith('..')) { const base = find(key.slice(0, -1), depth); if (base != null) r = base.endsWith('.') ? base : `${base}.`; }
    if (depth === 0) { if (cache.size > 20000) cache.clear(); cache.set(key, r); }
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

// La marque s'écrit « IaBoss » dans le texte visible ; les adresses, fichiers, jetons et noms techniques (iaboss.fr, iaboss-mcp.js, iaboss_…) ne changent pas
const BRAND = /(?<![\w@./_-])iaboss(?![\w@_-]|\.[a-z]|\/)/g;
export const brand = (s) => String(s).replace(BRAND, 'IaBoss');

/** Ajoute la marque à un dictionnaire : un texte sans traduction mais qui contient « iaboss » est tout de même renvoyé avec « IaBoss ». */
export function withBrand(lookup) {
  const wrap = (fn) => (arg) => {
    const t = fn(arg);
    const base = t ?? String(arg ?? '');
    const b = brand(base);
    return t == null && b === base ? null : b;
  };
  return { ...lookup, text: wrap((x) => lookup.text(x)), inline: wrap((x) => lookup.inline(x)) };
}
