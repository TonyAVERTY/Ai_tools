// Coloration syntaxique minimale (JSON, shell, JavaScript, Python) fabriquée côté serveur : aucune bibliothèque, aucun script.
// Le code est découpé en jetons AVANT d'être échappé : chaque morceau est échappé séparément, rien n'est jamais injecté tel quel.
import { esc } from '../http.js';

const RULES = {
  json: [
    ['k', /"(?:\\.|[^"\\])*"(?=\s*:)/y], ['s', /"(?:\\.|[^"\\])*"/y], ['b', /\b(?:true|false|null)\b/y], ['n', /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y],
  ],
  bash: [
    ['c', /#[^\n]*/y], ['s', /"(?:\\.|[^"\\])*"|'[^']*'/y], ['f', /(?<=\s)--?[A-Za-z][\w-]*/y], ['k', /\b(?:curl|claude|node|npm|export)\b/y], ['n', /\b\d+\b/y],
  ],
  js: [
    ['c', /\/\/[^\n]*/y], ['s', /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/y],
    ['k', /\b(?:const|let|await|async|import|from|return|new|if|else|throw|function|for|of)\b/y], ['b', /\b(?:true|false|null|undefined)\b/y], ['n', /\b\d+(?:\.\d+)?\b/y],
  ],
  python: [
    ['c', /#[^\n]*/y], ['s', /"""[\s\S]*?"""|f?"(?:\\.|[^"\\])*"|f?'(?:\\.|[^'\\])*'/y],
    ['k', /\b(?:import|from|def|return|with|as|if|else|for|in|print|raise)\b/y], ['b', /\b(?:True|False|None)\b/y], ['n', /\b\d+(?:\.\d+)?\b/y],
  ],
};
RULES.sh = RULES.bash; RULES.javascript = RULES.js; RULES.py = RULES.python;

/** @returns {string} HTML sûr : le texte de `code`, échappé, avec des <span class="tk-…"> autour des jetons. */
export function highlight(code, lang = '') {
  const rules = RULES[String(lang).toLowerCase()];
  const src = String(code);
  if (!rules) return esc(src);
  let out = '';
  let plain = '';
  for (let i = 0; i < src.length;) {
    let hit = null;
    for (const [cls, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(src);
      if (m && m.index === i && m[0].length) { hit = [cls, m[0]]; break; }
    }
    if (hit) { out += esc(plain); plain = ''; out += `<span class="tk-${hit[0]}">${esc(hit[1])}</span>`; i += hit[1].length; }
    else { plain += src[i]; i++; }
  }
  return out + esc(plain);
}
