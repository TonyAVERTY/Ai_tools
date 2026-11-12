// Client Stripe minimal, sans dépendance : appels REST (corps « formulaire »), vérification de la signature des événements (webhook) et prix des offres
// créés à la demande. iaboss ne voit JAMAIS un numéro de carte : le paiement et la gestion de l'abonnement se font sur les pages hébergées par Stripe
// (Checkout et portail client). La clé secrète ne quitte jamais le serveur et n'est jamais écrite dans un journal.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../http.js';
import { PLAN_PRICES, PLAN_LABELS, annualPrice } from '../limits.js';

const API = 'https://api.stripe.com/v1';
export const PERIODS = ['month', 'year'];
export const TOLERANCE_SEC = 300; // un événement plus vieux que cela est refusé (rejeu)

/** Objet imbriqué → paramètres « formulaire » de Stripe : { a: { b: 1 }, c: [x] } → a[b]=1&c[0]=x. */
export function formParams(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (x !== null && typeof x === 'object' ? formParams(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === 'object') formParams(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

const fetcher = (app) => app.fetch || fetch;

/** Un appel à l'API de Stripe. Une erreur de Stripe devient un message lisible (jamais la clé, jamais la requête). */
export async function stripeCall(app, method, path, params = null) {
  const cfg = app.cfg.stripe;
  if (!cfg) throw new HttpError(503, "Les paiements ne sont pas ouverts sur ce service.", { expose: true });
  const url = method === 'GET' && params ? `${API}${path}?${formParams(params)}` : `${API}${path}`;
  let r;
  try {
    r = await fetcher(app)(url, {
      method,
      headers: { Authorization: `Bearer ${cfg.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' },
      ...(method !== 'GET' && params ? { body: formParams(params).toString() } : {}),
      signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new HttpError(502, 'Stripe ne répond pas : réessaie dans un instant.', { expose: true }); }
  let data = {};
  try { data = await r.json(); } catch { data = {}; }
  if (!r.ok) {
    const why = String(data?.error?.message || `erreur ${r.status}`).replace(/sk_(test|live)_\w+|rk_(test|live)_\w+/g, '[clé masquée]').slice(0, 200);
    throw new HttpError(r.status === 429 ? 503 : 502, `Stripe a refusé la demande : ${why}`, { expose: true });
  }
  return data;
}

// ---------- Signature des événements ----------

/**
 * Vérifie l'en-tête Stripe-Signature (« t=…,v1=… ») d'un corps brut et renvoie l'événement. HMAC-SHA256 de « t.corps » avec le secret du point d'arrivée,
 * comparaison à temps constant, horodatage dans la tolérance. Lève une HttpError 400 sinon (jamais d'événement non signé).
 */
export function verifyWebhook(raw, header, secret, { at = Math.floor(Date.now() / 1000), tolerance = TOLERANCE_SEC } = {}) {
  const bad = (m) => new HttpError(400, m);
  const parts = String(header || '').split(',').map((p) => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v).filter(Boolean);
  if (!Number.isFinite(t) || !sigs.length) throw bad('Signature absente ou illisible');
  if (Math.abs(at - t) > tolerance) throw bad('Signature trop ancienne');
  const expected = createHmac('sha256', secret).update(`${t}.${raw}`).digest();
  const ok = sigs.some((s) => { const b = Buffer.from(s, 'hex'); return b.length === expected.length && timingSafeEqual(b, expected); });
  if (!ok) throw bad('Signature invalide');
  let event;
  try { event = JSON.parse(raw); } catch { throw bad('Événement illisible'); }
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') throw bad('Événement invalide');
  return event;
}

/** En-tête de signature valide, pour les tests (et la documentation). */
export const signPayload = (raw, secret, at = Math.floor(Date.now() / 1000)) => `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${raw}`).digest('hex')}`;

// ---------- Prix des offres ----------

/** Montant en centimes d'une offre pour une périodicité (annuel : 2 mois offerts, voir limits.js). */
export function amountCents(plan, period) {
  if (!PLAN_PRICES[plan]) throw new HttpError(400, 'Offre inconnue', { expose: true });
  if (!PERIODS.includes(period)) throw new HttpError(400, 'Périodicité inconnue', { expose: true });
  return Math.round((period === 'year' ? annualPrice(plan) : PLAN_PRICES[plan]) * 100);
}

const priceCache = new Map();

/**
 * Identifiant du prix Stripe d'une offre. Le prix est créé la première fois (avec sa clé de recherche « iaboss_plan_periode_centimes »), puis retrouvé :
 * si les tarifs changent dans limits.js, un nouveau prix est créé, les abonnements en cours gardent l'ancien.
 */
export async function ensurePrice(app, plan, period) {
  const cents = amountCents(plan, period);
  const key = `iaboss_${plan}_${period}_${cents}`;
  if (priceCache.has(key)) return priceCache.get(key);
  const find = async () => (await stripeCall(app, 'GET', '/prices', { lookup_keys: [key], active: 'true', limit: 1 })).data?.[0]?.id || null;
  let id = await find();
  if (!id) {
    try {
      id = (await stripeCall(app, 'POST', '/prices', {
        currency: 'eur', unit_amount: cents, recurring: { interval: period }, lookup_key: key,
        product_data: { name: `iaboss ${PLAN_LABELS[plan]}`, metadata: { plan } }, metadata: { plan, period },
      })).id;
    } catch (e) { id = await find(); if (!id) throw e; } // créé en même temps par une autre requête
  }
  priceCache.set(key, id);
  return id;
}

/** Les prix déjà connus sont gardés en mémoire ; pour les tests. */
export const resetPriceCache = () => priceCache.clear();
