// Routes des offres payantes (Stripe) : choisir une offre (page de paiement hébergée par Stripe, ou changement d'offre d'un abonnement en cours),
// ouvrir le portail client (moyen de paiement, factures, résiliation) et recevoir les événements signés de Stripe.
import { HttpError, json, redirect, readBody } from './http.js';
import { PLAN_PRICES, PLAN_LABELS } from './limits.js';
import { PERIODS, stripeCall, ensurePrice, verifyWebhook } from './services/stripe.js';
import { subscriptionOf, applySubscription, handleEvent } from './subscriptions.js';

const fail = (status, message) => new HttpError(status, message, { expose: true });
const MAX_EVENT = 512 * 1024;

async function rawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_EVENT) throw fail(413, 'Requête trop volumineuse');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function registerSubscriptionRoutes(router, app) {
  const { db, cfg } = app;
  const back = (res, q) => redirect(res, `/account?${new URLSearchParams(q)}#usage`);

  // Choisir une offre. Sans abonnement en cours : page de paiement Stripe. Avec un abonnement actif : changement d'offre (au prorata), sans second abonnement.
  router.post('/abonnement/choisir', async ({ req, res, session }) => {
    if (!cfg.stripe) throw fail(503, "Les paiements ne sont pas ouverts sur ce service : écris-nous pour passer à une offre.");
    const b = await readBody(req);
    const plan = String(b.plan || '');
    const period = String(b.period || 'month');
    if (!PLAN_PRICES[plan]) throw fail(400, 'Offre inconnue');
    if (!PERIODS.includes(period)) throw fail(400, 'Périodicité inconnue');
    if (session.user.isAdmin || session.user.plan === 'pro') return back(res, { e: "Ton compte n'a pas besoin d'offre : il n'a aucun plafond." });
    const row = await subscriptionOf(db, session.userId);
    const live = row?.subscription_id && ['active', 'trialing'].includes(row.status);
    if (row?.status === 'past_due') return back(res, { e: 'Ton dernier paiement a échoué : mets ta carte à jour dans « Gérer mon abonnement » avant de changer d\'offre.' });
    if (live) {
      if (row.plan === plan && row.period === period && !row.cancel_at_period_end) return back(res, { t: 'ok', m: 'Tu as déjà cette offre.' });
      const price = await ensurePrice(app, plan, period);
      const current = await stripeCall(app, 'GET', `/subscriptions/${encodeURIComponent(row.subscription_id)}`);
      const item = current.items?.data?.[0]?.id;
      if (!item) throw fail(502, "Stripe n'a pas renvoyé la ligne de ton abonnement : réessaie dans un instant.");
      const updated = await stripeCall(app, 'POST', `/subscriptions/${encodeURIComponent(row.subscription_id)}`, {
        items: [{ id: item, price }], proration_behavior: 'create_prorations', cancel_at_period_end: 'false',
        metadata: { user_id: session.userId, plan, period },
      });
      await applySubscription(db, { ...updated, metadata: { ...updated.metadata, user_id: session.userId, plan, period } });
      return back(res, { t: 'ok', m: `Offre ${PLAN_LABELS[plan]} activée : la différence est calculée au prorata sur ta prochaine facture.` });
    }
    const price = await ensurePrice(app, plan, period);
    const meta = { user_id: session.userId, plan, period };
    const checkout = await stripeCall(app, 'POST', '/checkout/sessions', {
      mode: 'subscription', locale: 'fr', client_reference_id: session.userId,
      line_items: [{ price, quantity: 1 }],
      ...(row?.customer_id ? { customer: row.customer_id } : { customer_email: session.user.email }),
      metadata: meta, subscription_data: { metadata: meta },
      success_url: `${cfg.appUrl}/account?abonnement=ok#usage`, cancel_url: `${cfg.appUrl}/tarifs?abonnement=annule`,
    });
    if (!checkout.url) throw fail(502, "Stripe n'a pas renvoyé la page de paiement : réessaie dans un instant.");
    redirect(res, checkout.url);
  }, { limit: 'billing' });

  // Le portail client de Stripe : moyen de paiement, factures, résiliation. Accessible même sans IA reliée (on doit toujours pouvoir résilier).
  router.post('/abonnement/portail', async ({ res, session }) => {
    if (!cfg.stripe) throw fail(503, "Les paiements ne sont pas ouverts sur ce service.");
    const row = await subscriptionOf(db, session.userId);
    if (!row?.customer_id) return back(res, { e: "Tu n'as pas d'abonnement à gérer." });
    const portal = await stripeCall(app, 'POST', '/billing_portal/sessions', { customer: row.customer_id, return_url: `${cfg.appUrl}/account#usage`, locale: 'fr' });
    if (!portal.url) throw fail(502, "Stripe n'a pas renvoyé le portail : réessaie dans un instant.");
    redirect(res, portal.url);
  }, { limit: 'billing' });

  // Événements de Stripe : publics, mais JAMAIS crus sans leur signature. Une erreur de traitement répond 500 : Stripe renverra l'événement.
  router.post('/stripe/webhook', async ({ req, res }) => {
    if (!cfg.stripe) throw fail(404, 'Page introuvable');
    const raw = await rawBody(req);
    const event = verifyWebhook(raw, req.headers['stripe-signature'], cfg.stripe.webhookSecret);
    const r = await handleEvent(app, event);
    json(res, { received: true, ...(r.duplicate ? { duplicate: true } : {}) });
  }, { public: true, limit: 'stripe_webhook' });
}
