// Journal de sécurité : une ligne JSON par événement, sur la sortie standard (visible avec `pm2 logs`), pour repérer les comportements suspects
// (échecs de code A2F, verrouillages, désactivation de l'A2F, accès administrateur refusé). Jamais de secret, de code, de jeton ni d'adresse e-mail :
// seulement le numéro de compte, et l'adresse IP tronquée (dernier octet IPv4 / 80 derniers bits IPv6 mis à zéro), donnée personnelle minimisée.
import { now } from './db.js';

/** Adresse IP rendue moins précise : 203.0.113.42 devient 203.0.113.0 ; en IPv6, on garde les 3 premiers groupes. */
export function coarseIp(ip) {
  const v = String(ip ?? '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return `${v.split('.').slice(0, 3).join('.')}.0`;
  if (v.includes(':')) return `${v.split(':').slice(0, 3).join(':')}::`;
  return '';
}

export const EVENTS = [
  'mfa_failed', 'mfa_locked', 'mfa_enabled', 'mfa_disabled', 'mfa_recovery_used', 'mfa_recovery_regenerated', 'mfa_device_trusted',
  'admin_mfa_required', 'login_failed', 'session_rotated',
];

/** `securityLog('mfa_failed', { userId, ip })`. Écrit `{"ts":…,"type":"security","event":…}` ; ne lève jamais. */
export function securityLog(event, { userId = null, ip = '', detail = '' } = {}, out = console.log) {
  try {
    out(JSON.stringify({ ts: now(), type: 'security', event, userId, ip: coarseIp(ip), ...(detail ? { detail: String(detail).slice(0, 120) } : {}) }));
  } catch { /* le journal ne fait jamais échouer une requête */ }
}
