// Authentification à deux facteurs : codes à usage unique à 6 chiffres (TOTP, RFC 6238 : HMAC-SHA1, pas de 30 s) lus dans une application
// d'authentification, plus des codes de secours à usage unique. Le secret est chiffré en base ; les codes de secours n'y sont que sous forme d'empreinte.
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP = 30;

export const base32 = (buf) => {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
};

export const unbase32 = (text) => {
  let bits = 0; let value = 0; const out = [];
  for (const ch of String(text).toUpperCase().replace(/[\s=-]/g, '')) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Clé invalide');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
};

/** Nouvelle clé secrète de 160 bits, en base 32 (ce que saisit ou scanne l'application d'authentification). */
export const newSecret = () => base32(randomBytes(20));

/** Code à 6 chiffres du pas de temps `step` (RFC 4226 : troncature dynamique). */
export function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', unbase32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

const same = (a, b) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/**
 * Vérifie un code saisi, avec une tolérance d'un pas avant et après (horloges décalées). Renvoie le pas accepté, ou null.
 * `lastStep` : le dernier pas déjà utilisé ; un code ne sert qu'une fois (on refuse tout pas ≤ lastStep).
 */
export function verifyTotp(secret, input, { at = Math.floor(Date.now() / 1000), lastStep = 0 } = {}) {
  const code = String(input ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return null;
  const now = Math.floor(at / STEP);
  let hit = null;
  for (const step of [now - 1, now, now + 1]) if (same(codeAt(secret, step), code) && step > Number(lastStep || 0)) hit = step;
  return hit;
}

/** Adresse à scanner ou à ouvrir dans l'application d'authentification. */
export const otpauthUrl = (secret, account, issuer = 'iaboss') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;

// ---------- Codes de secours ----------

export const RECOVERY_COUNT = 10;
const hashCode = (code) => createHash('sha256').update(normalizeRecovery(code)).digest('hex');
export const normalizeRecovery = (code) => String(code ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Dix codes « xxxxx-xxxxx » : affichés une seule fois, seules leurs empreintes sont gardées. */
export function newRecoveryCodes() {
  const codes = Array.from({ length: RECOVERY_COUNT }, () => { const s = randomBytes(8).toString('hex').slice(0, 10); return `${s.slice(0, 5)}-${s.slice(5)}`; });
  return { codes, hashes: codes.map(hashCode) };
}

/** Si `input` est un code de secours encore valide : renvoie la liste d'empreintes sans lui ; sinon null. */
export function consumeRecovery(hashes, input) {
  const h = hashCode(input);
  if (normalizeRecovery(input).length < 10) return null;
  const i = hashes.findIndex((x) => same(x, h));
  return i < 0 ? null : hashes.filter((_, j) => j !== i);
}
