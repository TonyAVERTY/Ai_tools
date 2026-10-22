// Limitation de débit en mémoire (fenêtre glissante), sans dépendance. Une règle de src/limits.js donne, par portée
// (adresse IP, compte), un nombre maximal de requêtes par fenêtre. Les compteurs vivent dans le processus : un redémarrage
// les remet à zéro, et plusieurs instances ne les partagent pas (une seule instance en production, voir le cadrage).
import { BlockList, isIP } from 'node:net';
import { RATE_LIMITS } from './limits.js';
import { parseIp, normalizeIp } from './ip.js';
import { HttpError } from './http.js';

// ---------- Adresse du client ----------

/**
 * TRUST_PROXY : vide, `false` ou `0` (défaut) = on ne lit jamais X-Forwarded-For ; `true`, `1` ou `loopback` = on le lit
 * seulement si la connexion arrive d'un proxy local (Nginx sur la même machine) ; sinon une liste d'adresses ou de
 * plages CIDR séparées par des virgules (`127.0.0.1,10.0.0.0/8`) : les proxys de confiance.
 * @returns {{trusts: (ip: string) => boolean} | null}
 */
export function parseTrustProxy(value) {
  if (value && typeof value === 'object' && typeof value.trusts === 'function') return value;
  const v = String(value ?? '').trim();
  if (!v || /^(0|false|off|no|non)$/i.test(v)) return null;
  const entries = /^(1|true|on|yes|oui|loopback)$/i.test(v) ? ['127.0.0.0/8', '::1'] : v.split(',').map((x) => x.trim()).filter(Boolean);
  const list = new BlockList();
  for (const e of entries) {
    const [addr, bits] = e.split('/');
    const family = isIP(addr);
    if (!family || (bits !== undefined && !/^\d{1,3}$/.test(bits))) throw new Error(`TRUST_PROXY : entrée invalide « ${e} » (adresse IP ou plage CIDR attendue)`);
    const kind = family === 4 ? 'ipv4' : 'ipv6';
    if (bits === undefined) list.addAddress(addr, kind); else list.addSubnet(addr, Number(bits), kind);
  }
  return { trusts: (ip) => { const f = isIP(ip); return f ? list.check(ip, f === 4 ? 'ipv4' : 'ipv6') : false; } };
}

/**
 * Adresse du client. Sans proxy de confiance, c'est celle de la connexion : un en-tête X-Forwarded-For forgé ne change
 * rien. Avec TRUST_PROXY, et seulement si la connexion vient d'un proxy de confiance, on lit X-Forwarded-For de droite à
 * gauche et on garde la première adresse qui n'est pas un proxy de confiance (les entrées de gauche, que le client peut
 * inventer, ne sont jamais crues).
 */
export function clientIp(req, trust = null) {
  const peer = normalizeIp(req.socket?.remoteAddress || '') || 'inconnue';
  if (!trust || !trust.trusts(peer)) return peer;
  const raw = [].concat(req.headers['x-forwarded-for'] || []).join(',');
  const chain = raw.split(',').map((x) => x.trim()).filter(Boolean);
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!parseIp(chain[i])) return peer; // entrée illisible : on ne devine pas
    const ip = normalizeIp(chain[i]);
    if (!trust.trusts(ip)) return ip;
  }
  return peer;
}

// ---------- Limiteur ----------

const human = (s) => (s < 90 ? `${s} seconde${s > 1 ? 's' : ''}` : s < 5400 ? `${Math.ceil(s / 60)} minutes` : `${Math.ceil(s / 3600)} heures`);

export class RateLimiter {
  /** `clock` (ms) est injectable pour les tests. */
  constructor({ rules = RATE_LIMITS, clock = Date.now, maxKeys = 100_000 } = {}) {
    this.rules = rules;
    this.clock = clock;
    this.maxKeys = maxKeys;
    this.hits = new Map(); // clé → { times: number[], windowMs }
    this.calls = 0;
  }

  /**
   * Compte une requête si la règle l'accepte. Une requête refusée n'est PAS comptée : insister ne prolonge pas l'attente.
   * @returns {{ok: true} | {ok: false, retryAfter: number, scope: string, rule: string}} retryAfter en secondes
   */
  check(rule, { ip, userId } = {}) {
    const spec = this.rules[rule];
    if (!spec) throw new Error(`Règle de débit inconnue : ${rule}`);
    const t = this.clock();
    if (++this.calls % 500 === 0 || this.hits.size > this.maxKeys) this.sweep(t);
    const pending = [];
    for (const [scope, conf] of Object.entries(spec)) {
      const id = scope === 'ip' ? ip : userId;
      if (id == null) continue;
      const key = `${rule}|${scope}|${id}`;
      let e = this.hits.get(key);
      if (!e) e = { times: [], windowMs: conf.windowMs };
      while (e.times.length && e.times[0] <= t - conf.windowMs) e.times.shift();
      if (e.times.length >= conf.max) {
        return { ok: false, rule, scope, retryAfter: Math.max(1, Math.ceil((e.times[0] + conf.windowMs - t) / 1000)) };
      }
      pending.push([key, e]);
    }
    for (const [key, e] of pending) { e.times.push(t); this.hits.set(key, e); }
    return { ok: true };
  }

  /** Refuse (429 avec Retry-After) si la règle est dépassée. */
  enforce(rule, who) {
    const r = this.check(rule, who);
    if (r.ok) return;
    throw new HttpError(429, `Trop de requêtes : réessaie dans ${human(r.retryAfter)}.`, {
      expose: true, code: 'rate_limited', headers: { 'Retry-After': String(r.retryAfter) }, data: { retryAfter: r.retryAfter },
    });
  }

  /** Efface les compteurs expirés ; si la table reste trop grande, les plus anciens sont oubliés (garde-fou mémoire). */
  sweep(t = this.clock()) {
    for (const [key, e] of this.hits) {
      if (!e.times.length || e.times[e.times.length - 1] <= t - e.windowMs) this.hits.delete(key);
    }
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break;
      this.hits.delete(key);
    }
  }
}
