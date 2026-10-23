// Filtrage des hôtes saisis par l'utilisateur (SMTP, IMAP, base du récap, Forgejo) : un compte ne doit pas pouvoir
// sonder le réseau interne du serveur (MySQL local, métadonnées cloud, autres sites CloudPanel).
//
// Principe : on RÉSOUT le nom, on refuse toute adresse privée, puis on SE CONNECTE À L'ADRESSE VÉRIFIÉE (et non au nom).
// La vérification porte donc sur l'IP réellement utilisée : un nom dont la réponse DNS change entre la saisie et la
// connexion (rebinding) est revérifié à chaque nouvelle connexion, et ne peut pas changer entre la vérification et l'usage.
import { isIP } from 'node:net';
import dns from 'node:dns/promises';
import { HttpError } from './http.js';
import { ALLOWED_PORTS } from './limits.js';
import { blockedReason } from './ip.js';

// ---------- Résolution ----------

/** Résolveur par défaut : getaddrinfo, toutes les adresses (comme le fera la connexion). */
export async function defaultResolve(host) {
  const out = await dns.lookup(host, { all: true, verbatim: true });
  return out.map((a) => ({ address: a.address, family: a.family }));
}

const HOST_RE = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9_-]{0,62})(\.[A-Za-z0-9_-]{1,63})*\.?$/;

/** Exception de développement : adresses privées autorisées (ALLOW_PRIVATE_HOSTS), en production pour les administrateurs seulement. */
export async function privateAllowed(app, userId) {
  if (!app.cfg.allowPrivateHosts) return false;
  if (!app.cfg.production) return true;
  if (userId == null) return false;
  return !!(await app.db.prepare('SELECT is_admin FROM users WHERE id = ?').get(Number(userId)))?.is_admin;
}

export function assertPort(kind, port, { allowPrivate = false } = {}) {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new HttpError(400, 'Port invalide', { expose: true });
  if (allowPrivate) return n;
  const allowed = ALLOWED_PORTS[kind];
  if (!allowed) throw new Error(`Type d'hôte inconnu : ${kind}`);
  if (!allowed.includes(n)) throw new HttpError(400, `Port ${n} refusé pour ce service (ports acceptés : ${allowed.join(', ')})`, { expose: true });
  return n;
}

/**
 * Résout `host` et refuse l'hôte si UNE SEULE de ses adresses est privée (un nom qui répond tantôt public, tantôt interne
 * ne passe pas). Une IP littérale est contrôlée telle quelle, sans DNS.
 * @returns {Promise<{address: string, family: 4|6, servername: string|null}>} adresse à utiliser pour la connexion
 */
export async function resolvePublic(host, { resolve = defaultResolve, allowPrivate = false, lenient = false } = {}) {
  const name = String(host ?? '').trim().replace(/^\[|\]$/g, '');
  const literal = isIP(name) ? name : null;
  if (!literal && !HOST_RE.test(name)) throw new HttpError(400, `Hôte invalide : « ${String(host).slice(0, 80)} »`, { expose: true });
  let addrs;
  if (literal) addrs = [{ address: literal, family: isIP(literal) }];
  else {
    try { addrs = await resolve(name); }
    catch {
      if (lenient) return null; // enregistrement d'un réglage : le nom pourra devenir résolvable plus tard, il sera revérifié à l'usage
      throw new HttpError(400, `Hôte introuvable : « ${name.slice(0, 80)} » ne répond pas au DNS`, { expose: true });
    }
  }
  if (!addrs?.length) {
    if (lenient) return null;
    throw new HttpError(400, `Hôte introuvable : « ${name.slice(0, 80)} » ne répond pas au DNS`, { expose: true });
  }
  if (!allowPrivate) {
    for (const a of addrs) {
      const why = blockedReason(a.address);
      if (why) throw new HttpError(400, `Hôte refusé : « ${name.slice(0, 80)} » pointe vers une adresse interne ou réservée (${why}). Seuls les serveurs publics sont acceptés.`, { expose: true });
    }
  }
  return { address: addrs[0].address, family: addrs[0].family || isIP(addrs[0].address), servername: literal ? null : name };
}

/**
 * Contrôle complet d'une cible saisie par l'utilisateur : port de la liste, résolution, adresses publiques.
 * `app.resolveHost` permet aux tests d'injecter un résolveur DNS. `lenient` : à l'enregistrement d'un réglage.
 * @param {'smtp'|'imap'|'mysql'|'pg'|'git'} kind
 * @returns {Promise<{address: string, family: 4|6, servername: string|null, port: number} | null>} null = hôte non résolu (lenient)
 */
export async function guardTarget(app, userId, kind, host, port, { lenient = false } = {}) {
  const allowPrivate = await privateAllowed(app, userId);
  const checkedPort = assertPort(kind, port, { allowPrivate });
  const r = await resolvePublic(host, { resolve: app.resolveHost || defaultResolve, allowPrivate, lenient });
  return r && { ...r, port: checkedPort };
}

// ---------- Cibles « épinglées » : on se connecte à l'adresse vérifiée, pas au nom ----------

/** SMTP : `host` devient l'IP vérifiée, `servername` garde le nom pour SNI et la vérification du certificat. */
export async function pinSmtp(app, userId, smtp, opts) {
  if (!smtp?.host) return smtp;
  const t = await guardTarget(app, userId, 'smtp', smtp.host, smtp.port || 587, opts);
  return t ? { ...smtp, host: t.address, ...(t.servername ? { servername: t.servername } : {}) } : smtp;
}

export async function pinImap(app, userId, imap, opts) {
  if (!imap?.host) return imap;
  const t = await guardTarget(app, userId, 'imap', imap.host, imap.port || 993, opts);
  return t ? { ...imap, host: t.address, ...(t.servername ? { servername: t.servername } : {}) } : imap;
}

/** Base du récap (MySQL ou PostgreSQL). */
export async function pinDb(app, userId, cfg, opts) {
  if (!cfg?.host) return cfg;
  const kind = cfg.type === 'pg' ? 'pg' : 'mysql';
  const t = await guardTarget(app, userId, kind, cfg.host, cfg.port || (kind === 'pg' ? 5432 : 3306), opts);
  return t ? { ...cfg, host: t.address, ...(t.servername ? { servername: t.servername } : {}) } : cfg;
}

/**
 * Forgejo : vérifie l'hôte de l'URL du dépôt et renvoie ce qu'il faut pour que git se connecte à l'adresse vérifiée
 * (http.curloptResolve). Une URL qui n'est pas en https est laissée à syncRepo, qui la refuse.
 * @returns {Promise<{host: string, port: number, address: string, family: 4|6} | null>}
 */
export async function pinGit(app, userId, url, opts) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const t = await guardTarget(app, userId, 'git', u.hostname, u.port || 443, opts);
  return t ? { host: u.hostname, port: t.port, address: t.address, family: t.family } : null;
}

/** « hôte » ou « hôte:port » du serveur Git personnel saisi dans Réglages : contrôle à l'enregistrement. */
export async function checkForgejoHost(app, userId, value) {
  const m = /^([^:/]+)(?::(\d{1,5}))?$/.exec(String(value || '').trim());
  if (!m) throw new HttpError(400, 'Hôte Git invalide (attendu : hôte ou hôte:port)', { expose: true });
  await guardTarget(app, userId, 'git', m[1], m[2] || 443, { lenient: true });
}
