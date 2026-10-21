// Chiffrement AES-256-GCM des secrets stockés en BDD (mdp SMTP/BDD, token Forgejo).
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function encrypt(key, plain) {
  if (plain == null || plain === '') return null;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

export function decrypt(key, payload) {
  if (!payload) return null;
  const [v, iv, tag, data] = payload.split(':');
  if (v !== 'v1') throw new Error('Format de secret inconnu');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

export function encryptJson(key, obj) { return obj ? encrypt(key, JSON.stringify(obj)) : null; }
export function decryptJson(key, payload) { const s = decrypt(key, payload); return s ? JSON.parse(s) : null; }

// Token de désinscription sans état : HMAC de l'email
export function unsubToken(key, email) {
  return createHmac('sha256', key).update(`unsub:${email.toLowerCase()}`).digest('base64url').slice(0, 32);
}

export function verifyUnsubToken(key, email, token) {
  const expected = Buffer.from(unsubToken(key, email));
  const got = Buffer.from(String(token || ''));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export const randomId = (bytes = 32) => randomBytes(bytes).toString('base64url');
