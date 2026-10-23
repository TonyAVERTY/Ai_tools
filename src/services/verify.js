// Vérification d'une adresse avant envoi : forme, domaine jetable, serveur de réception (MX) existant.
// Aucun contact avec le serveur du destinataire (pas de « RCPT TO » : ça passe pour du sondage et abîme la réputation).
// Une panne passagère du DNS ne condamne jamais une adresse : seul un domaine qui n'existe pas, ou qui déclare ne pas
// recevoir de mail, est refusé.
import dns from 'node:dns/promises';
import { EMAIL_RE } from './mailer.js';

// Domaines de mails jetables les plus courants (liste volontairement courte : elle évite les cas évidents, pas tous)
export const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'yopmail.com', 'yopmail.fr', 'guerrillamail.com', 'guerrillamail.net', '10minutemail.com', 'tempmail.com',
  'temp-mail.org', 'trashmail.com', 'trashmail.net', 'throwawaymail.com', 'getnada.com', 'sharklasers.com', 'dispostable.com',
  'maildrop.cc', 'fakeinbox.com', 'mailnesia.com', 'mintemail.com', 'spamgourmet.com', 'tempinbox.com', 'jetable.org',
  'cool.fr.nf', 'courrier.jetable.fr', 'nospam.ze.tc', 'mytemp.email', 'emailondeck.com', 'tempr.email', 'discard.email',
]);

const TRANSIENT = new Set(['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EREFUSED', 'ENETUNREACH']);
const ABSENT = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

/** Serveurs de réception d'un domaine : MX, sinon (règle SMTP) son adresse A / AAAA. [] = le domaine ne reçoit pas de mail. */
export async function defaultMx(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    if (mx.length) return mx;
  } catch (e) {
    if (!ABSENT.has(e.code)) throw e;
  }
  for (const fn of [dns.resolve4, dns.resolve6]) {
    try { const a = await fn(domain); if (a.length) return [{ exchange: a[0], priority: 0 }]; } catch (e) { if (!ABSENT.has(e.code)) throw e; }
  }
  return [];
}

/**
 * @param {string} email
 * @param {{resolveMx?: Function, cache?: Map}} [o]  `cache` : un résultat par domaine (un lot ne résout pas 50 fois le même domaine)
 * @returns {Promise<{ok: boolean, reason?: string, uncertain?: boolean}>}
 */
export async function verifyAddress(email, { resolveMx = defaultMx, cache = new Map() } = {}) {
  const addr = String(email || '').trim().toLowerCase();
  if (addr.length > 254 || !EMAIL_RE.test(addr) || addr.includes('..')) return { ok: false, reason: 'adresse mal formée' };
  const [local, domain] = addr.split('@');
  if (local.length > 64 || addr.startsWith('.') || local.endsWith('.')) return { ok: false, reason: 'adresse mal formée' };
  if (DISPOSABLE_DOMAINS.has(domain)) return { ok: false, reason: 'adresse jetable' };
  if (!cache.has(domain)) {
    cache.set(domain, (async () => {
      try {
        const mx = await resolveMx(domain);
        if (!mx.length) return { ok: false, reason: 'le domaine ne reçoit pas de mail (aucun serveur MX)' };
        // « MX null » (RFC 7505) : le domaine déclare ne recevoir aucun mail
        if (mx.length === 1 && (mx[0].exchange === '' || mx[0].exchange === '.')) return { ok: false, reason: 'le domaine ne reçoit pas de mail' };
        return { ok: true };
      } catch (e) {
        if (ABSENT.has(e.code)) return { ok: false, reason: 'domaine introuvable' };
        if (TRANSIENT.has(e.code) || !e.code) return { ok: true, uncertain: true }; // DNS indisponible : on n'accuse pas l'adresse
        return { ok: true, uncertain: true };
      }
    })());
  }
  return cache.get(domain);
}
