// Traduction d'une page HTML déjà écrite en français : les textes et les attributs visibles sont remplacés par leur traduction (src/i18n/core.js), le reste est
// recopié à l'identique. Ce qui n'est pas dans le dictionnaire reste en français (repli). Jamais traduit : scripts, styles, code, texte préformaté, champs de saisie
// (ce que la personne a écrit), dessins SVG.
import { canonInline, decodeEntities, escapeAttr, escapeText, normalize, restoreTags, withBrand } from './core.js';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'textarea']);
const SKIP = new Set(['script', 'style', 'pre', 'code', 'kbd', 'samp', 'textarea', 'svg', 'template']);
// Éléments qui peuvent faire partie d'une phrase : « Clique sur <strong>Accepter</strong> pour… » se traduit d'un bloc
const INLINE = new Set(['a', 'abbr', 'b', 'br', 'code', 'em', 'i', 'kbd', 'mark', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 's']);
/** Attributs dont la valeur est un texte lu par la personne. */
export const TEXT_ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'data-confirm', 'data-confirm-label', 'data-label', 'data-tip', 'data-empty', 'data-text', 'data-title', 'data-ok'];

const TOKEN = /<!--[\s\S]*?-->|<![a-zA-Z][^>]*>|<\/[a-zA-Z][^\s>]*\s*>|<[a-zA-Z][^\s/>]*(?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>|[^<]+|</g;

function parse(html) {
  const root = { t: 'root', kids: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(html))) {
    const raw = m[0];
    if (raw.startsWith('<!') || raw === '<') { top().kids.push({ t: 'raw', raw }); continue; }
    if (raw.startsWith('</')) {
      const name = /^<\/([a-zA-Z][^\s>]*)/.exec(raw)[1].toLowerCase();
      let i = stack.length - 1;
      while (i > 0 && stack[i].name !== name) i--;
      if (i === 0) { top().kids.push({ t: 'raw', raw }); continue; } // fermeture orpheline : recopiée
      stack[i].close = raw;
      stack.length = i;
      continue;
    }
    if (raw.startsWith('<')) {
      const name = /^<([a-zA-Z][^\s/>]*)/.exec(raw)[1].toLowerCase();
      const el = { t: 'el', name, open: raw, close: '', kids: [] };
      top().kids.push(el);
      if (VOID.has(name) || raw.endsWith('/>')) continue;
      if (RAW_TEXT.has(name)) { // le contenu brut va jusqu'à la fermeture : jamais analysé
        const end = html.toLowerCase().indexOf(`</${name}`, TOKEN.lastIndex);
        const stop = end < 0 ? html.length : end;
        if (stop > TOKEN.lastIndex) el.kids.push({ t: 'raw', raw: html.slice(TOKEN.lastIndex, stop) });
        const closeEnd = end < 0 ? html.length : html.indexOf('>', end) + 1;
        el.close = end < 0 ? '' : html.slice(end, closeEnd);
        TOKEN.lastIndex = closeEnd;
        continue;
      }
      stack.push(el);
      continue;
    }
    top().kids.push({ t: 'text', raw });
  }
  return root;
}

const serialize = (n) => (n.t === 'el' ? `${n.open}${n.kids.map(serialize).join('')}${n.close}` : n.t === 'root' ? n.kids.map(serialize).join('') : n.raw);

function attrValue(open, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(open);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

/** Traduit les attributs textuels d'une balise d'ouverture. */
function translateOpen(open, lookup, name) {
  let out = open;
  const names = [...TEXT_ATTRS];
  const type = (attrValue(open, 'type') || '').toLowerCase();
  if (name === 'input' && ['submit', 'button', 'reset'].includes(type)) names.push('value');
  if (name === 'meta') names.push('content');
  for (const a of names) {
    out = out.replace(new RegExp(`(\\s${a}\\s*=\\s*)(?:"([^"]*)"|'([^']*)')`, 'i'), (whole, pre, dq, sq) => {
      const raw = dq ?? sq;
      if (name === 'meta' && a === 'content') {
        const key = `${attrValue(open, 'name') || attrValue(open, 'property') || ''}`.toLowerCase();
        if (!/^(description|og:title|og:description|og:site_name|twitter:title|twitter:description)$/.test(key)) return whole;
      }
      const tr = lookup.text(decodeEntities(raw));
      return tr == null ? whole : `${pre}"${escapeAttr(tr)}"`;
    });
  }
  return out;
}

const isInlineTree = (n) => n.t === 'text' || n.t === 'raw' || (n.t === 'el' && INLINE.has(n.name) && n.kids.every(isInlineTree));

function walk(el, lookup) {
  if (el.t === 'el') {
    el.open = translateOpen(el.open, lookup, el.name);
    if (SKIP.has(el.name)) return;
    // Phrase avec balisage : traduite d'un bloc, puis les attributs d'origine sont remis
    const hasEl = el.kids.some((k) => k.t === 'el');
    if (hasEl && el.kids.every(isInlineTree) && el.kids.some((k) => k.t === 'text' && normalize(k.raw))) {
      const inner = el.kids.map(serialize).join('');
      const tr = lookup.inline(inner);
      const restored = tr == null ? null : restoreTags(tr, inner);
      if (restored != null) { el.kids = [{ t: 'raw', raw: restored }]; return; }
    }
  }
  for (const k of el.kids) {
    if (k.t === 'text') {
      const tr = lookup.text(decodeEntities(k.raw));
      if (tr != null) k.raw = escapeText(tr);
    } else if (k.t === 'el') walk(k, lookup);
  }
}

/** @param {string} html page en français  @param {{text:Function, inline:Function}} lookup  @param {string} lang code de la langue (fr, en, es) */
export function translateHtml(html, lookup, lang) {
  const tree = parse(String(html));
  walk(tree, withBrand(lookup || { text: () => null, inline: () => null }));
  return serialize(tree).replace(/(<html\b[^>]*?\blang=)(["'])[a-zA-Z-]+\2/i, `$1"${lang}"`);
}

export { canonInline };
