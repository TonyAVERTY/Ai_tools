// Abonnements payants : ce que Stripe annonce (événements signés) devient le plan du compte. Règles :
//  - le plan ne change QUE pour un compte qui a un abonnement ; un administrateur et un plan « pro » attribué à la main ne sont jamais touchés ;
//  - paiement refusé (« past_due ») : les droits de l'offre sont gardés SUBSCRIPTION.graceDays jours, le temps de mettre la carte à jour ;
//  - abonnement terminé (résilié, impayé, expiré) : retour au plan gratuit. Rien n'est supprimé : les plafonds ne bloquent que les NOUVELLES actions ;
//  - un événement déjà traité l'est une seule fois (Stripe peut renvoyer le même, dans le désordre).
import { now } from './db.js';
import { PLAN_PRICES, SUBSCRIPTION } from './limits.js';
import { PERIODS, stripeCall } from './services/stripe.js';

const DAY = 86_400;
const STRIPE_PLANS = Object.keys(PLAN_PRICES);

export const subscriptionOf = async (db, userId) => (await db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(Number(userId))) || null;

const periodEnd = (sub) => Number(sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end) || null; // selon la version d'API, l'échéance est sur l'abonnement ou sur sa ligne

/** Le compte d'un abonnement : celui que nous avons noté en le créant (metadata.user_id), sinon celui déjà lié à ce client Stripe. */
async function userFor(db, sub) {
  const viaMeta = Number(sub.metadata?.user_id);
  if (viaMeta) {
    const u = await db.prepare('SELECT id FROM users WHERE id = ?').get(viaMeta);
    if (u) return Number(u.id);
  }
  const row = sub.customer ? await db.prepare('SELECT user_id FROM subscriptions WHERE customer_id = ?').get(String(sub.customer)) : null;
  return row ? Number(row.user_id) : null;
}

/** Applique l'état d'un abonnement Stripe au compte. Renvoie { userId, entitled, plan } ou null si l'abonnement n'est celui d'aucun compte. */
export async function applySubscription(db, sub, { at = now() } = {}) {
  const userId = await userFor(db, sub);
  if (!userId) return null;
  const prev = await subscriptionOf(db, userId);
  const status = String(sub.status || '');
  const plan = STRIPE_PLANS.includes(sub.metadata?.plan) ? sub.metadata.plan : prev?.plan || null;
  const period = PERIODS.includes(sub.metadata?.period) ? sub.metadata.period : prev?.period || null;
  let entitled;
  let graceUntil = null;
  if (status === 'active' || status === 'trialing') entitled = true;
  else if (status === 'past_due') {
    // Le délai court à partir du premier paiement refusé, pas à chaque nouvelle tentative de Stripe
    graceUntil = prev?.status === 'past_due' && prev.grace_until ? Number(prev.grace_until) : at + SUBSCRIPTION.graceDays * DAY;
    entitled = at < graceUntil;
  } else if (status === 'incomplete') entitled = !!prev?.entitled; // paiement pas encore abouti : rien ne change
  else entitled = false; // canceled, unpaid, incomplete_expired, paused
  const cancelAtEnd = sub.cancel_at_period_end ? 1 : 0;
  const values = [String(sub.customer || prev?.customer_id || ''), sub.id || prev?.subscription_id || null, plan, period, status, entitled ? 1 : 0, periodEnd(sub), cancelAtEnd, graceUntil, at];
  if (prev) {
    await db.prepare(`UPDATE subscriptions SET customer_id = ?, subscription_id = ?, plan = ?, period = ?, status = ?, entitled = ?, current_period_end = ?, cancel_at_period_end = ?,
      grace_until = ?, updated_at = ? WHERE user_id = ?`).run(...values, userId);
  } else {
    await db.prepare(`INSERT INTO subscriptions(customer_id, subscription_id, plan, period, status, entitled, current_period_end, cancel_at_period_end, grace_until, updated_at, user_id, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...values, userId, at);
  }
  await syncPlan(db, userId, entitled ? plan : null);
  return { userId, entitled, plan };
}

/** Plan du compte d'après son abonnement : `plan` si les droits sont acquis, sinon gratuit. Jamais pour un administrateur ni pour un plan « pro » donné à la main. */
async function syncPlan(db, userId, plan) {
  if (plan) await db.prepare("UPDATE users SET plan = ? WHERE id = ? AND is_admin = 0 AND plan <> 'pro' AND plan <> 'admin'").run(plan, Number(userId));
  else await db.prepare(`UPDATE users SET plan = 'free' WHERE id = ? AND is_admin = 0 AND plan IN (${STRIPE_PLANS.map(() => '?').join(',')})`).run(Number(userId), ...STRIPE_PLANS);
}

/** Délai de grâce écoulé : les comptes dont le paiement n'a pas été régularisé repassent au plan gratuit. Lancé par le planificateur. */
export async function expireGrace(db, { at = now() } = {}) {
  const rows = await db.prepare("SELECT user_id FROM subscriptions WHERE entitled = 1 AND status = 'past_due' AND grace_until IS NOT NULL AND grace_until <= ?").all(at);
  for (const { user_id: userId } of rows) {
    await db.prepare('UPDATE subscriptions SET entitled = 0, updated_at = ? WHERE user_id = ?').run(at, Number(userId));
    await syncPlan(db, userId, null);
  }
  return rows.length;
}

/**
 * Un événement de Stripe. Les événements déjà traités sont ignorés ; un événement qui échoue n'est PAS noté comme traité (Stripe le renverra).
 * @returns {Promise<{handled: boolean, duplicate?: boolean}>}
 */
export async function handleEvent(app, event, { at = now() } = {}) {
  const { db } = app;
  if (await db.prepare('SELECT 1 AS x FROM stripe_events WHERE id = ?').get(event.id)) return { handled: false, duplicate: true };
  const obj = event.data?.object || {};
  let handled = true;
  switch (event.type) {
    case 'checkout.session.completed': {
      if (obj.mode !== 'subscription') { handled = false; break; }
      const userId = Number(obj.client_reference_id || obj.metadata?.user_id);
      const user = userId ? await db.prepare('SELECT id FROM users WHERE id = ?').get(userId) : null;
      if (!user || !obj.customer) { handled = false; break; }
      // Le client Stripe est lié au compte dès maintenant ; l'état exact de l'abonnement est relu chez Stripe
      if (!(await subscriptionOf(db, userId))) {
        await db.prepare("INSERT INTO subscriptions(user_id, customer_id, subscription_id, status, entitled, cancel_at_period_end, created_at, updated_at) VALUES(?, ?, ?, 'incomplete', 0, 0, ?, ?)")
          .run(userId, String(obj.customer), obj.subscription || null, at, at);
      }
      if (obj.subscription) {
        const sub = await stripeCall(app, 'GET', `/subscriptions/${encodeURIComponent(obj.subscription)}`);
        await applySubscription(db, { ...sub, metadata: { ...obj.metadata, ...sub.metadata } }, { at });
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      handled = !!(await applySubscription(db, event.type.endsWith('deleted') ? { ...obj, status: 'canceled' } : obj, { at }));
      break;
    default:
      handled = false; // facture payée, paiement refusé… : l'état de l'abonnement suffit, il arrive par « customer.subscription.updated »
  }
  await db.prepare('INSERT OR IGNORE INTO stripe_events(id, type, at) VALUES(?, ?, ?)').run(event.id, String(event.type).slice(0, 80), at);
  return { handled };
}

/** Les événements notés depuis plus de 90 jours sont oubliés (Stripe ne rejoue pas aussi tard). */
export async function purgeEvents(db, { at = now() } = {}) {
  await db.prepare('DELETE FROM stripe_events WHERE at < ?').run(at - 90 * DAY);
}

/** Ce que Mon compte affiche de l'abonnement. `enabled` : les paiements sont-ils ouverts sur ce service ? */
export async function billingView(app, userId) {
  const row = await subscriptionOf(app.db, userId);
  return {
    enabled: !!app.cfg.stripe, live: !!app.cfg.stripe?.live,
    sub: row ? {
      plan: row.plan, period: row.period, status: row.status, entitled: !!Number(row.entitled), periodEnd: row.current_period_end ? Number(row.current_period_end) : null,
      cancelAtEnd: !!Number(row.cancel_at_period_end), graceUntil: row.grace_until ? Number(row.grace_until) : null, hasCustomer: !!row.customer_id,
    } : null,
  };
}
