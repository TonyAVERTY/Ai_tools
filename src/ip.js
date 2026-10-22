// Analyse des adresses IP : lecture IPv4/IPv6, adresses privées ou réservées, forme canonique.
// Sert au filtrage des hôtes saisis par l'utilisateur (netguard.js) et à la lecture de l'IP du client (ratelimit.js).
import { isIP } from 'node:net';

/** @returns {{family: 4|6, bytes: number[]} | null} */
export function parseIp(input) {
  let s = String(input ?? '').trim().replace(/^\[|\]$/g, '');
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const family = isIP(s);
  if (family === 4) return { family, bytes: s.split('.').map(Number) };
  if (family !== 6) return null;
  let head = s;
  const quad = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s); // ::ffff:127.0.0.1
  if (quad) head = `${quad[1]}${((+quad[2] << 8) | +quad[3]).toString(16)}:${((+quad[4] << 8) | +quad[5]).toString(16)}`;
  const [a, b] = head.split('::');
  const left = a ? a.split(':') : [];
  const right = b ? b.split(':') : [];
  const groups = b === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return { family, bytes: groups.flatMap((g) => { const v = parseInt(g, 16); return [v >> 8, v & 255]; }) };
}

const inV4 = (b, base, bits) => {
  let rest = bits;
  for (let i = 0; i < 4 && rest > 0; i++, rest -= 8) {
    const mask = rest >= 8 ? 0xff : (0xff << (8 - rest)) & 0xff;
    if ((b[i] & mask) !== (base[i] & mask)) return false;
  }
  return true;
};

const V4_BLOCKED = [
  [[0, 0, 0, 0], 8, 'adresse non routable'],
  [[10, 0, 0, 0], 8, 'réseau privé'],
  [[100, 64, 0, 0], 10, 'réseau partagé (CGNAT)'],
  [[127, 0, 0, 0], 8, 'boucle locale'],
  [[169, 254, 0, 0], 16, 'adresse locale (dont les métadonnées cloud)'],
  [[172, 16, 0, 0], 12, 'réseau privé'],
  [[192, 0, 0, 0], 24, 'adresse réservée'],
  [[192, 0, 2, 0], 24, 'adresse de documentation'],
  [[192, 168, 0, 0], 16, 'réseau privé'],
  [[198, 18, 0, 0], 15, 'adresse de test réseau'],
  [[198, 51, 100, 0], 24, 'adresse de documentation'],
  [[203, 0, 113, 0], 24, 'adresse de documentation'],
  [[224, 0, 0, 0], 4, 'multicast'],
  [[240, 0, 0, 0], 4, 'adresse réservée'],
];

function blockedV4(b) {
  for (const [base, bits, why] of V4_BLOCKED) if (inV4(b, base, bits)) return why;
  return null;
}

/** Raison du refus d'une adresse IP (texte pour l'utilisateur), ou null si elle est publique. Texte non IP : refusé. */
export function blockedReason(ip) {
  const p = parseIp(ip);
  if (!p) return 'adresse invalide';
  if (p.family === 4) return blockedV4(p.bytes);
  const b = p.bytes;
  const zeros = (from, to) => b.slice(from, to).every((x) => x === 0);
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) return blockedV4(b.slice(12)); // IPv4 mappée (::ffff:a.b.c.d)
  if (zeros(0, 12)) return 'boucle locale'; // ::, ::1 et ::a.b.c.d (IPv4 « compatible »)
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) { // NAT64 : l'IPv4 est dans les 4 derniers octets
    return zeros(4, 12) ? blockedV4(b.slice(12)) : 'adresse réservée (NAT64)';
  }
  if (b[0] === 0x20 && b[1] === 0x02) return blockedV4(b.slice(2, 6)); // 6to4 : l'IPv4 est dans les octets 2 à 5
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return 'adresse de tunnel (Teredo)';
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return 'adresse de documentation';
  if (b[0] === 0x01 && zeros(1, 8)) return 'adresse réservée'; // 100::/64
  if ((b[0] & 0xfe) === 0xfc) return 'réseau privé (fc00::/7)';
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return 'adresse locale (fe80::/10)';
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return 'adresse locale (fec0::/10)';
  if (b[0] === 0xff) return 'multicast';
  return null;
}

/** Forme canonique d'une adresse client : une IPv4 mappée (::ffff:1.2.3.4) redevient 1.2.3.4. */
export function normalizeIp(input) {
  const p = parseIp(input);
  if (!p) return String(input ?? '').trim();
  if (p.family === 4) return p.bytes.join('.');
  const b = p.bytes;
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) return b.slice(12).join('.');
  const g = []; for (let i = 0; i < 16; i += 2) g.push(((b[i] << 8) | b[i + 1]).toString(16));
  return g.join(':');
}

