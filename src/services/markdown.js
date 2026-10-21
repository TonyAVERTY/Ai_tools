// Mini rendu Markdown (le sous-ensemble que Claude produit) sans dépendance.
// Tout le texte est échappé AVANT la mise en forme : le contenu vient d'un repo et du web, jamais de HTML brut.
import { esc } from '../http.js';

const noStyle = () => '';

/** Gras, italique, code et liens http(s) sur une ligne. `st(tag)` ajoute un style inline (mails). */
export function inlineMd(text, st = noStyle) {
  const codes = [];
  let out = esc(text).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  out = out
    .replace(/\*\*([^*]+)\*\*/g, (_, t) => `<strong${st('strong')}>${t}</strong>`)
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, (_, p, t) => `${p}<em>${t}</em>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => `<a href="${u}"${st('a')} target="_blank" rel="noopener noreferrer">${t}</a>`);
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code${st('code')}>${codes[i]}</code>`);
}

/**
 * Titres, paragraphes, listes (un niveau d'imbrication), citations, blocs de code, séparateurs.
 * @param {string} md
 * @param {{styles?: Record<string,string>}} [o]  styles inline par balise (pour les clients mail)
 */
export function renderMarkdown(md, { styles = {} } = {}) {
  const st = (tag) => (styles[tag] ? ` style="${styles[tag]}"` : '');
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // { type: 'ul'|'ol', items: [{ text, sub: [] }] }

  const flushPara = () => {
    if (para.length) out.push(`<p${st('p')}>${inlineMd(para.join(' '), st)}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((i) => `<li${st('li')}>${inlineMd(i.text, st)}${i.sub.length
      ? `<ul${st('ul')}>${i.sub.map((s) => `<li${st('li')}>${inlineMd(s, st)}</li>`).join('')}</ul>` : ''}</li>`).join('');
    out.push(`<${list.type}${st(list.type)}>${items}</${list.type}>`);
    list = null;
  };
  const flush = () => { flushPara(); flushList(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (/^\s*```/.test(line)) {
      flush();
      const code = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      out.push(`<pre${st('pre')}><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (!line.trim()) {
      flush();
    } else if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      flush();
      const n = m[1].length;
      out.push(`<h${n}${st(`h${n}`)}>${inlineMd(m[2], st)}</h${n}>`);
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push(`<hr${st('hr')}>`);
    } else if (list && (m = /^\s{2,}[-*+]\s+(.*)$/.exec(line))) {
      list.items.at(-1).sub.push(m[1]);
    } else if ((m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line))) {
      flushPara();
      const type = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (list?.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push({ text: m[2], sub: [] });
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flush();
      out.push(`<blockquote${st('blockquote')}>${inlineMd(m[1], st)}</blockquote>`);
    } else if (list && /^\s{2,}\S/.test(line)) {
      const last = list.items.at(-1);
      if (last.sub.length) last.sub[last.sub.length - 1] += ` ${line.trim()}`;
      else last.text += ` ${line.trim()}`;
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flush();
  return out.join('\n');
}

/** Découpe la réponse « Évolution » (### N. Titre + puces) en fiches. [] si le format n'est pas reconnu. */
export function parseEvolutions(md) {
  const parts = String(md ?? '').replace(/\r\n?/g, '\n').split(/^###\s+/m);
  parts.shift(); // texte avant le premier titre (normalement vide)
  return parts.map((p, idx) => {
    const [head, ...rest] = p.split('\n');
    const m = /^(\d+)[.)]\s*(.*)$/.exec(head.trim());
    let effort = null, effortNote = '';
    // [ \t] et pas \s : sinon la ligne suivante serait avalée comme « note » de l'effort
    const body = rest.join('\n').replace(/^[ \t]*[-*][ \t]*\*\*Effort\*\*[ \t]*:?[ \t]*\**[ \t]*([SML])\b\**[ \t]*(.*)(?:\n|$)/mi, (_, e, note) => {
      effort = e.toUpperCase();
      effortNote = note.replace(/^[\s()–—-]+|[\s()]+$/g, '');
      return '';
    }).trim();
    return { n: m ? Number(m[1]) : idx + 1, title: (m ? m[2] : head).trim(), effort, effortNote, body };
  }).filter((e) => e.title);
}

export const EFFORTS = { S: 'Rapide', M: 'Moyen', L: 'Gros chantier' };

/** Fiches d'évolution pour le panel (classes CSS, pas de style inline : CSP stricte). */
export function evolutionHtml(md) {
  const items = parseEvolutions(md);
  if (!items.length) return `<div class="md">${renderMarkdown(md)}</div>`;
  return `<ol class="evos">${items.map((e) => `<li class="evo">
  <div class="evo-head">
    <span class="evo-n">${e.n}</span>
    <h5>${inlineMd(e.title)}</h5>
    ${e.effort ? `<span class="effort e-${e.effort}"${e.effortNote ? ` title="${esc(e.effortNote)}"` : ''}>${e.effort} · ${EFFORTS[e.effort]}</span>` : ''}
  </div>
  <div class="md">${renderMarkdown(e.body)}</div>
</li>`).join('')}</ol>`;
}
