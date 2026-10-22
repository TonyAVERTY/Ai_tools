// Mini-terminal : rejoue la sortie brute d'un programme à interface texte (le CLI `claude`) et rend ce qui est réellement
// affiché à l'écran. Nécessaire parce que ce CLI ne réécrit que les cases qui changent et saute les autres par des
// déplacements de curseur : le flux brut n'est pas du texte lisible (« Request » devient « Requ<déplacement>st »).
// Gère : caractères, \r \n \b, déplacements (A B C D E F G H f d), effacements (K J X), sauvegarde du curseur (ESC 7/8, s/u),
// séquences de couleur et modes (ignorés), OSC (liens, titres : ignorés). Pas de défilement : l'écran est petit et on ne
// lit que son état final.
const MAX_ROWS = 400;

export function screenText(out) {
  const rows = [[]];
  let r = 0;
  let c = 0;
  let saved = [0, 0];
  const line = (i) => { while (rows.length <= i && rows.length < MAX_ROWS) rows.push([]); return rows[Math.min(i, MAX_ROWS - 1)]; };
  const clamp = (n) => Math.max(0, Math.min(n, MAX_ROWS - 1));
  const put = (ch) => { const l = line(r); while (l.length < c) l.push(' '); l[c] = ch; c++; };
  const n = (p, i = 0, d = 1) => { const v = parseInt((p.split(';')[i] ?? ''), 10); return Number.isFinite(v) && v > 0 ? v : d; };

  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (ch === '\x1b') {
      const nx = out[i + 1];
      if (nx === '[') {
        let j = i + 2;
        while (j < out.length && !/[@-~]/.test(out[j])) j++;
        const params = out.slice(i + 2, j).replace(/^[?<>=]/, '');
        const fin = out[j];
        const priv = /^[?<>=]/.test(out.slice(i + 2, j));
        i = j;
        if (priv) continue;
        switch (fin) {
          case 'A': r = clamp(r - n(params)); break;
          case 'B': r = clamp(r + n(params)); line(r); break;
          case 'C': c += n(params); break;
          case 'D': c = Math.max(0, c - n(params)); break;
          case 'E': r = clamp(r + n(params)); c = 0; line(r); break;
          case 'F': r = clamp(r - n(params)); c = 0; break;
          case 'G': c = n(params) - 1; break;
          case 'd': r = clamp(n(params) - 1); line(r); break;
          case 'H': case 'f': r = clamp(n(params, 0) - 1); c = n(params, 1) - 1; line(r); break;
          case 'K': {
            const l = line(r); const m = parseInt(params || '0', 10);
            if (m === 2) l.length = 0;
            else if (m === 1) for (let k = 0; k <= c && k < l.length; k++) l[k] = ' ';
            else l.length = Math.min(l.length, c);
            break;
          }
          case 'J': {
            const m = parseInt(params || '0', 10);
            if (m === 2 || m === 3) { rows.length = 1; rows[0] = []; }
            else if (m === 0) { line(r).length = Math.min(line(r).length, c); rows.length = r + 1; }
            break;
          }
          case 'X': { const l = line(r); for (let k = 0; k < n(params) && c + k < l.length; k++) l[c + k] = ' '; break; }
          case 's': saved = [r, c]; break;
          case 'u': [r, c] = saved; break;
          default: break; // couleurs (m), modes, régions de défilement : sans effet sur le texte
        }
      } else if (nx === ']') {
        let j = i + 2;
        while (j < out.length && out[j] !== '\x07' && !(out[j] === '\x1b' && out[j + 1] === '\\')) j++;
        i = out[j] === '\x07' ? j : j + 1;
      } else if (nx === '7') { saved = [r, c]; i++; }
      else if (nx === '8') { [r, c] = saved; i++; }
      else if (nx === 'M') { r = clamp(r - 1); i++; }
      else i++; // autre séquence à un caractère
    } else if (ch === '\r') c = 0;
    else if (ch === '\n') { r = clamp(r + 1); line(r); }
    else if (ch === '\b') c = Math.max(0, c - 1);
    else if (ch === '\x07' || ch < ' ') continue;
    else put(ch);
  }
  return rows.map((l) => l.join('').trimEnd());
}
