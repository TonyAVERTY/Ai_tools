// Générateur de QR code (ISO 18004), sans dépendance : mode octets, correction d'erreur M, versions 1 à 10 (jusqu'à 213 octets).
// Sert à l'activation de l'A2F : l'adresse otpauth:// se scanne avec l'application d'authentification.
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
const mul = (a, b) => (a && b ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0);

/** Reste de la division du message par le polynôme générateur de degré `degree` (Reed-Solomon sur GF(256)). */
export function reedSolomon(data, degree) {
  let gen = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(gen.length + 1).fill(0);
    gen.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, GF_EXP[i]); });
    gen = next;
  }
  const rem = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

// Niveau M : [mots de code au total, mots de correction par bloc, [[nombre de blocs, mots de données par bloc], …], positions des motifs d'alignement]
const VERSIONS = [
  null,
  [26, 10, [[1, 16]], []],
  [44, 16, [[1, 28]], [6, 18]],
  [70, 26, [[1, 44]], [6, 22]],
  [100, 18, [[2, 32]], [6, 26]],
  [134, 24, [[2, 43]], [6, 30]],
  [172, 16, [[4, 27]], [6, 34]],
  [196, 18, [[4, 31]], [6, 22, 38]],
  [242, 22, [[2, 38], [2, 39]], [6, 24, 42]],
  [292, 22, [[3, 36], [2, 37]], [6, 26, 46]],
  [346, 26, [[4, 43], [1, 44]], [6, 28, 50]],
];

const dataCapacity = (v) => VERSIONS[v][2].reduce((n, [count, len]) => n + count * len, 0);
const countBits = (v) => (v < 10 ? 8 : 16);

// Codes BCH de la norme : 15 bits pour le format (5 bits de données), 18 bits pour la version (6 bits de données)
const formatBits = (data) => { let r = data; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); return ((data << 10) | r) ^ 0x5412; };
const versionBits = (v) => { let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25); return (v << 12) | r; };

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Mots de code (données + correction, blocs entrelacés) d'un texte encodé en octets pour la version `v`. */
function codewords(bytes, v) {
  const bits = [];
  const push = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4); push(bytes.length, countBits(v));
  for (const b of bytes) push(b, 8);
  const cap = dataCapacity(v) * 8;
  push(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < dataCapacity(v); pad ^= 0xec ^ 0x11) data.push(pad);
  const [, ecLen, groups] = VERSIONS[v];
  const blocks = []; let at = 0;
  for (const [count, len] of groups) for (let i = 0; i < count; i++) { const d = data.slice(at, at + len); at += len; blocks.push({ d, e: reedSolomon(d, ecLen) }); }
  const out = [];
  for (let i = 0; i < Math.max(...blocks.map((b) => b.d.length)); i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

/** Matrice (tableau de lignes de booléens, true = module sombre) du QR code de `text`. Lève une erreur au-delà de 213 octets. */
export const qrMatrix = (text) => qrInfo(text).matrix;

/** Comme qrMatrix, avec la version, le masque retenu et la carte des modules fonctionnels (pour les tests). */
export function qrInfo(text) {
  const bytes = [...Buffer.from(String(text), 'utf8')];
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((n) => bytes.length <= dataCapacity(n) - (countBits(n) === 8 ? 2 : 3));
  if (!v) throw new Error('Texte trop long pour le QR code');
  const size = 17 + 4 * v;
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false)); // modules fonctionnels (jamais masqués)
  const base = Array.from({ length: size }, () => new Array(size).fill(false));
  const put = (x, y, dark) => { base[y][x] = dark; fixed[y][x] = true; };

  // Motifs de repérage (7×7) et leurs séparateurs
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx; const y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      put(x, y, d !== 2 && d !== 4);
    }
  }
  // Alignement
  const pos = VERSIONS[v][3];
  for (const cy of pos) for (const cx of pos) {
    if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) put(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // Synchronisation
  for (let i = 0; i < size; i++) { if (!fixed[6][i]) put(i, 6, i % 2 === 0); if (!fixed[i][6]) put(6, i, i % 2 === 0); }
  // Version (à partir de 7)
  if (v >= 7) {
    const bits = versionBits(v);
    for (let i = 0; i < 18; i++) { const b = ((bits >>> i) & 1) === 1; const a = size - 11 + (i % 3); const c = Math.floor(i / 3); put(a, c, b); put(c, a, b); }
  }
  // Emplacements réservés au format (écrits après le choix du masque) et module sombre
  const formatCells = [];
  for (let i = 0; i < 15; i++) {
    const first = i < 6 ? [8, i] : i === 6 ? [8, 7] : i === 7 ? [8, 8] : i === 8 ? [7, 8] : [14 - i, 8];
    const second = i < 8 ? [size - 1 - i, 8] : [8, size - 15 + i];
    formatCells.push([first, second]);
  }
  for (const [a, b] of formatCells) { fixed[a[1]][a[0]] = true; fixed[b[1]][b[0]] = true; }
  put(8, size - 8, true);

  // Données en zigzag, par paires de colonnes depuis le coin bas droit
  const words = codewords(bytes, v);
  const dataBits = [];
  for (const w of words) for (let i = 7; i >= 0; i--) dataBits.push((w >>> i) & 1);
  const cells = [];
  for (let right = size - 1, up = true; right >= 1; right -= 2, up = !up) {
    if (right === 6) right = 5;
    for (let n = 0; n < size; n++) for (let j = 0; j < 2; j++) {
      const x = right - j; const y = up ? size - 1 - n : n;
      if (!fixed[y][x]) cells.push([x, y]);
    }
  }
  const build = (mask) => {
    const m = base.map((row) => row.slice());
    cells.forEach(([x, y], i) => { const bit = i < dataBits.length && dataBits[i] === 1; m[y][x] = MASKS[mask](y, x) ? !bit : bit; });
    const fbits = formatBits(mask); // niveau de correction M = 00, puis le numéro du masque
    formatCells.forEach(([a, b], i) => { const d = ((fbits >>> i) & 1) === 1; m[a[1]][a[0]] = d; m[b[1]][b[0]] = d; });
    return m;
  };
  let best = null; let bestScore = Infinity; let bestMask = 0;
  for (let mask = 0; mask < 8; mask++) {
    const m = build(mask); const s = penalty(m);
    if (s < bestScore) { best = m; bestScore = s; bestMask = mask; }
  }
  return { matrix: best, version: v, mask: bestMask, fixed, groups: VERSIONS[v][2], ecLen: VERSIONS[v][1] };
}

/** Pénalité d'un masque (règles 1 à 4 de la norme) : le plus faible l'emporte. */
export function penalty(m) {
  const n = m.length; let score = 0;
  const line = (get) => {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b <= n; b++) {
        if (b < n && get(a, b) === get(a, b - 1)) run++;
        else { if (run >= 5) score += 3 + run - 5; run = 1; }
      }
      for (let b = 0; b + 11 <= n; b++) {
        const w = []; for (let k = 0; k < 11; k++) w.push(get(a, b + k) ? 1 : 0);
        const s = w.join('');
        if (s === '10111010000' || s === '00001011101') score += 40;
      }
    }
  };
  line((a, b) => m[a][b]); line((a, b) => m[b][a]);
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
  const dark = m.flat().filter(Boolean).length;
  score += 10 * (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1);
  return score;
}

/** QR code en SVG : un seul tracé noir sur fond blanc, avec la marge de 4 modules exigée par les lecteurs. `label` décrit l'image aux lecteurs d'écran. */
export function qrSvg(text, label = 'QR code') {
  const m = qrMatrix(text); const n = m.length; const q = 4;
  let d = '';
  m.forEach((row, y) => { for (let x = 0; x < n; x++) if (row[x]) d += `M${x + q} ${y + q}h1v1h-1z`; });
  const esc = String(label).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" role="img" aria-label="${esc}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
