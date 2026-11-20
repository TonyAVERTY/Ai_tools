import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrInfo, qrSvg, reedSolomon } from '../src/qr.js';
import { otpauthUrl } from '../src/totp.js';

// QR code : vecteur de référence de la norme, puis relecture complète de la matrice (zigzag, masque, blocs, correction d'erreur, texte).

test('Reed-Solomon : « HELLO WORLD » en version 1-M (exemple de la norme)', () => {
  assert.deepEqual(reedSolomon([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

const MASKS = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];

/** Relit le QR code comme un lecteur : format (deux copies), démasquage, mots de code, blocs, correction, texte. */
function decode({ matrix: m, fixed, mask, groups, ecLen, version }) {
  const size = m.length;
  const fmt = (cells) => cells.reduce((n, [x, y], i) => n | ((m[y][x] ? 1 : 0) << i), 0);
  const first = []; const second = [];
  for (let i = 0; i < 15; i++) {
    first.push(i < 6 ? [8, i] : i === 6 ? [8, 7] : i === 7 ? [8, 8] : i === 8 ? [7, 8] : [14 - i, 8]);
    second.push(i < 8 ? [size - 1 - i, 8] : [8, size - 15 + i]);
  }
  const f1 = fmt(first); const f2 = fmt(second);
  assert.equal(f1, f2, 'les deux copies du format sont identiques');
  assert.equal((f1 ^ 0x5412) >>> 10, mask, 'le format annonce le masque retenu (niveau M)');
  const bits = [];
  for (let right = size - 1, up = true; right >= 1; right -= 2, up = !up) {
    if (right === 6) right = 5;
    for (let n = 0; n < size; n++) for (let j = 0; j < 2; j++) {
      const x = right - j; const y = up ? size - 1 - n : n;
      if (!fixed[y][x]) bits.push((m[y][x] !== MASKS[mask](y, x)) ? 1 : 0);
    }
  }
  const words = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) words.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  const sizes = groups.flatMap(([count, len]) => Array(count).fill(len));
  const total = sizes.reduce((a, b) => a + b, 0) + ecLen * sizes.length;
  const blocks = sizes.map(() => ({ d: [], e: [] }));
  let at = 0;
  for (let i = 0; i < Math.max(...sizes); i++) blocks.forEach((b, k) => { if (i < sizes[k]) b.d.push(words[at++]); });
  for (let i = 0; i < ecLen; i++) blocks.forEach((b) => b.e.push(words[at++]));
  assert.equal(at, total, 'tous les mots de code sont lus');
  for (const b of blocks) assert.deepEqual(reedSolomon(b.d, ecLen), b.e, 'la correction d\'erreur de chaque bloc est juste');
  const data = blocks.flatMap((b) => b.d);
  const bitstr = data.map((w) => w.toString(2).padStart(8, '0')).join('');
  assert.equal(bitstr.slice(0, 4), '0100', 'mode octets');
  const cb = version < 10 ? 8 : 16;
  const len = parseInt(bitstr.slice(4, 4 + cb), 2);
  const out = []; for (let i = 0; i < len; i++) out.push(parseInt(bitstr.slice(4 + cb + 8 * i, 12 + cb + 8 * i), 2));
  return Buffer.from(out).toString('utf8');
}

test('le QR code se relit à l\'identique, de la version 1 à la version 10', () => {
  for (const n of [5, 14, 30, 50, 80, 100, 120, 150, 180, 200]) {
    const text = Array.from({ length: n }, (_, i) => String.fromCharCode(97 + ((i * 7) % 26))).join('');
    const info = qrInfo(text);
    assert.equal(decode(info), text, `${n} octets (version ${info.version})`);
  }
  assert.equal(decode(qrInfo('é€ accentué')), 'é€ accentué');
});

test('motifs fixes : repères, synchronisation et module sombre ; adresse otpauth de l\'A2F', () => {
  const url = otpauthUrl('7FW2MF2HUIVBQKPQOTV4I72PF3E4E2JT', 'user1@test.fr');
  const info = qrInfo(url);
  assert.equal(decode(info), url);
  const m = info.matrix; const n = m.length;
  for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    for (let d = 0; d < 7; d++) { assert.ok(m[oy][ox + d] && m[oy + 6][ox + d] && m[oy + d][ox] && m[oy + d][ox + 6], 'bord sombre du repère'); }
    assert.ok(m[oy + 3][ox + 3], 'centre sombre du repère');
  }
  for (let i = 8; i < n - 8; i++) assert.equal(m[6][i], i % 2 === 0, 'synchronisation');
  assert.ok(m[n - 8][8], 'module sombre');
  assert.throws(() => qrInfo('x'.repeat(300)), /trop long/);
});

test('SVG : un seul tracé, aucun style en ligne, nom pour les lecteurs d\'écran', () => {
  const svg = qrSvg('https://exemple.fr', 'QR code de test');
  assert.match(svg, /^<svg class="qr"/);
  assert.match(svg, /role="img" aria-label="QR code de test"/);
  assert.equal((svg.match(/<path/g) || []).length, 1);
  assert.ok(!/style=|<script/.test(svg));
});
