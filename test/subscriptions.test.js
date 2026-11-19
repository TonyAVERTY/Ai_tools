// Offres payantes (Stripe) : configuration, signature des événements, paiement, changement d'offre, résiliation, délai de grâce, suppression du compte,
// pages Tarifs et Mon compte. Aucun appel réel : Stripe est simulé par app.fetch.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, APP_URL } from './helpers/server.js';
import { loadConfig } from '../src/config.js';
import { PLAN_PRICES, SUBSCRIPTION } from '../src/limits.js';
import { formParams, verifyWebhook, signPayload, amountCents, resetPriceCache, TOLERANCE_SEC } from '../src/services/stripe.js';
import { applySubscription, expireGrace, subscriptionOf, billingView } from '../src/subscriptions.js';
import { now } from '../src/db.js';
import { testTokenLink } from './helpers/users.js';

const SK = 'sk_test_51AbCdEfGhIjKlMnOpQrSt';
const WH = 'whsec_AbCdEfGhIjKlMnOpQrStUv12345';
const DAY = 86_400;
let s, off;
let calls = [];
let stripe = {}; // réponses simulées, par « METHODE /chemin »

const reply = (o) => ({ ok: (o.status ?? 200) < 400, status: o.status ?? 200, headers: { get: () => null }, json: async () => o.json ?? {} });

before(async () => {
  s = await startApp({ cfg: { stripe: { secretKey: SK, webhookSecret: WH, live: false } } });
  off = await startApp(); // paiements non ouverts
  s.app.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || 'GET';
    const body = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : {};
    calls.push({ method, path: u.pathname.replace('/v1', ''), query: Object.fromEntries(u.searchParams), body, auth: init.headers?.Authorization });
    const key = `${method} ${u.pathname.replace('/v1', '')}`;
    const h = stripe[key] ?? stripe[`${method} *`] ?? (key.startsWith('GET /products/') ? stripe['GET /products/*'] : undefined);
    if (!h) return reply({ status: 404, json: { error: { message: `rien de prévu pour ${key}` } } });
    return reply(typeof h === 'function' ? h({ body, query: Object.fromEntries(u.searchParams) }) : h);
  };
});
after(async () => { await s.close(); await off.close(); });
beforeEach(() => { calls = []; stripe = {}; resetPriceCache(); });

const user = (email, opts = {}) => s.newUser({ email, admin: false, link: testTokenLink(), ...opts }); // une IA reliée : sinon toute route (hors Mon compte) renvoie vers la liaison
const loc = (r) => decodeURIComponent(String(r.headers.get('location')).replace(/\+/g, ' '));
const dbUser = (id) => s.db.prepare('SELECT id, plan, is_admin FROM users WHERE id = ?').get(id);
const sub = (over = {}) => ({
  id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, current_period_end: now() + 30 * DAY,
  metadata: { app: 'iaboss', user_id: '0', plan: 'starter', period: 'month' }, items: { data: [{ id: 'si_1' }] }, ...over,
});
const withUser = (u, over = {}) => sub({ ...over, metadata: { app: 'iaboss', user_id: String(u.id), plan: 'starter', period: 'month', ...(over.metadata || {}) } });
const event = (type, object, id = `evt_${Math.random().toString(36).slice(2)}`) => ({ id, type, data: { object } });
const webhook = (ev, { secret = WH, at, header, target = s } = {}) => {
  const raw = JSON.stringify(ev);
  return fetch(`${target.base}/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header ?? signPayload(raw, secret, at) }, body: raw });
};
const priceStub = () => {
  stripe['GET /prices'] = { json: { data: [] } };
  stripe['GET /products/*'] = { json: { id: 'produit' } };
  stripe['POST /prices'] = ({ body }) => ({ json: { id: `price_${body.lookup_key}` } });
};

test('configuration : les deux clés ensemble, bon format, mode test ou production', () => {
  const base = { APP_URL: 'https://x.fr', SECRET_KEY: 'a'.repeat(64), GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', DB_DRIVER: 'sqlite' };
  const keep = { ...process.env };
  const load = (extra) => {
    for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) delete process.env[k];
    Object.assign(process.env, base, extra);
    try { return loadConfig().stripe; } finally { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); }
  };
  assert.equal(load({}), null, 'sans clé, pas de paiement');
  assert.deepEqual(load({ STRIPE_SECRET_KEY: SK, STRIPE_WEBHOOK_SECRET: WH }), { secretKey: SK, webhookSecret: WH, live: false });
  assert.equal(load({ STRIPE_SECRET_KEY: 'sk_live_51AbCdEfGhIjKlMnOpQrSt', STRIPE_WEBHOOK_SECRET: WH }).live, true);
  assert.throws(() => load({ STRIPE_SECRET_KEY: SK }), /vont ensemble/);
  assert.throws(() => load({ STRIPE_WEBHOOK_SECRET: WH }), /vont ensemble/);
  assert.throws(() => load({ STRIPE_SECRET_KEY: 'pk_test_abcdefghijkl', STRIPE_WEBHOOK_SECRET: WH }), /clé secrète/);
  assert.throws(() => load({ STRIPE_SECRET_KEY: SK, STRIPE_WEBHOOK_SECRET: 'nope' }), /whsec_/);
});

test('outils Stripe : paramètres imbriqués, montants, signature des événements', () => {
  assert.equal(formParams({ a: { b: 1 }, c: ['x', { d: 2 }], e: null, f: undefined, g: 'é & =' }).toString(), 'a%5Bb%5D=1&c%5B0%5D=x&c%5B1%5D%5Bd%5D=2&g=%C3%A9+%26+%3D');
  assert.equal(amountCents('starter', 'month'), 900);
  assert.equal(amountCents('starter', 'year'), 9000, 'annuel : 2 mois offerts');
  assert.equal(amountCents('intensive', 'year'), 75_00 * 10);
  assert.throws(() => amountCents('inconnu', 'month'), /Offre inconnue/);
  assert.throws(() => amountCents('starter', 'week'), /Périodicité/);
  const raw = JSON.stringify(event('x.y', {}, 'evt_a'));
  const at = 1_800_000_000;
  assert.equal(verifyWebhook(raw, signPayload(raw, WH, at), WH, { at }).id, 'evt_a');
  assert.throws(() => verifyWebhook(raw, signPayload(raw, 'whsec_autreSecretAutreSecret', at), WH, { at }), /invalide/, 'mauvais secret');
  assert.throws(() => verifyWebhook(raw + ' ', signPayload(raw, WH, at), WH, { at }), /invalide/, 'corps modifié');
  assert.throws(() => verifyWebhook(raw, signPayload(raw, WH, at), WH, { at: at + TOLERANCE_SEC + 1 }), /ancienne/, 'rejeu tardif');
  assert.throws(() => verifyWebhook(raw, '', WH, { at }), /absente/);
  assert.throws(() => verifyWebhook(raw, 't=abc,v1=zz', WH, { at }), /absente/);
  const good = signPayload(raw, WH, at).split(',v1=')[1];
  assert.equal(verifyWebhook(raw, `t=${at},v1=00,v1=${good}`, WH, { at }).id, 'evt_a', 'plusieurs signatures : une bonne suffit');
});

test('paiement : « Choisir cette offre » ouvre la page de paiement Stripe avec le bon prix, le compte et le courriel', async () => {
  const u = await user('achat@x.fr');
  priceStub();
  stripe['POST /checkout/sessions'] = { json: { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' } };
  const r = await u.post('/abonnement/choisir', { plan: 'growth', period: 'year' }, { form: true });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), 'https://checkout.stripe.com/c/pay/cs_1');
  const price = calls.find((c) => c.method === 'POST' && c.path === '/prices');
  assert.equal(price.body.unit_amount, '19000', 'annuel : 10 mois de 19 €');
  assert.equal(price.body['recurring[interval]'], 'year');
  assert.equal(price.body.currency, 'eur');
  assert.equal(price.body.lookup_key, 'iaboss_growth_year_19000');
  const co = calls.find((c) => c.path === '/checkout/sessions').body;
  assert.equal(co.mode, 'subscription');
  assert.equal(co['line_items[0][price]'], 'price_iaboss_growth_year_19000');
  assert.equal(co.client_reference_id, String(u.id));
  assert.equal(co.customer_email, 'achat@x.fr');
  assert.equal(co['metadata[plan]'], 'growth');
  assert.equal(co['subscription_data[metadata][user_id]'], String(u.id));
  assert.equal(co.success_url, `${APP_URL}/account?abonnement=ok#usage`);
  assert.equal(co.cancel_url, `${APP_URL}/tarifs?abonnement=annule`);
  assert.ok(calls.every((c) => c.auth === `Bearer ${SK}`), 'la clé secrète part en en-tête, jamais ailleurs');
  assert.ok(!JSON.stringify(calls.map((c) => c.body)).includes(SK), 'jamais dans un corps');
  // Le prix déjà créé est retrouvé, pas recréé
  calls = [];
  stripe['GET /prices'] = { json: { data: [{ id: 'price_existant' }] } };
  await u.post('/abonnement/choisir', { plan: 'starter', period: 'month' }, { form: true });
  assert.ok(!calls.some((c) => c.method === 'POST' && c.path === '/prices'));
  assert.equal(calls.find((c) => c.path === '/checkout/sessions').body['line_items[0][price]'], 'price_existant');
});

test('paiement : refus clairs (offre ou période inconnue, visiteur, paiements fermés, administrateur, Stripe qui échoue)', async () => {
  const u = await user('refus@x.fr');
  assert.equal((await u.post('/abonnement/choisir', { plan: 'gratuit', period: 'month' }, { form: true })).status, 400);
  assert.equal((await u.post('/abonnement/choisir', { plan: 'starter', period: 'week' }, { form: true })).status, 400);
  const guest = await s.anon.post('/abonnement/choisir', { plan: 'starter', period: 'month' }, { form: true });
  assert.equal(guest.status, 303);
  assert.equal(guest.headers.get('location'), '/login', 'un visiteur est envoyé se connecter');
  const noPay = await off.newUser({ email: 'ferme2@x.fr', admin: false, link: testTokenLink() });
  const r = await noPay.post('/abonnement/choisir', { plan: 'starter', period: 'month' }, { form: true });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /paiements ne sont pas ouverts/);
  const admin = await s.newUser({ email: 'admin@x.fr', admin: true });
  const a = await admin.post('/abonnement/choisir', { plan: 'starter', period: 'month' }, { form: true });
  assert.match(loc(a), /aucun plafond/);
  assert.equal(calls.length, 0, 'aucun de ces refus n\'a coûté un appel à Stripe');
  priceStub();
  stripe['POST /checkout/sessions'] = { status: 400, json: { error: { message: `clé ${SK} invalide` } } };
  const bad = await (await user('stripe-ko@x.fr')).post('/abonnement/choisir', { plan: 'starter', period: 'month' }, { form: true });
  assert.equal(bad.status, 502);
  const msg = (await bad.json()).error;
  assert.match(msg, /Stripe a refusé la demande/);
  assert.ok(!msg.includes(SK), 'la clé n\'apparaît jamais dans un message');
});

test('événements : signature obligatoire, abonnement créé = plan du compte, événement rejoué ignoré, compte inconnu ignoré', async () => {
  const u = await user('webhook@x.fr');
  const ev = event('customer.subscription.created', withUser(u), 'evt_created');
  const unsigned = await fetch(`${s.base}/stripe/webhook`, { method: 'POST', body: JSON.stringify(ev) });
  assert.equal(unsigned.status, 400);
  assert.equal((await webhook(ev, { secret: 'whsec_autreSecretAutreSecret' })).status, 400);
  assert.equal((await webhook(ev, { at: now() - 3600 })).status, 400, 'signature trop ancienne');
  assert.equal((await dbUser(u.id)).plan, 'free', 'rien n\'a changé sans signature valide');
  const ok = await webhook(ev);
  assert.equal(ok.status, 200);
  assert.equal((await dbUser(u.id)).plan, 'starter');
  const row = await subscriptionOf(s.db, u.id);
  assert.equal(row.entitled, 1);
  assert.equal(row.customer_id, 'cus_1');
  assert.equal(row.period, 'month');
  const again = await webhook(ev);
  assert.equal((await again.json()).duplicate, true, 'le même événement n\'est traité qu\'une fois');
  // Un abonnement dont le compte n'existe pas (supprimé entre-temps) : on répond 200, rien à faire
  const ghost = await webhook(event('customer.subscription.updated', sub({ customer: 'cus_fantome', metadata: { app: 'iaboss', user_id: '99999999', plan: 'starter', period: 'month' } })));
  assert.equal(ghost.status, 200);
  assert.equal((await s.db.prepare("SELECT COUNT(*) n FROM subscriptions WHERE customer_id = 'cus_fantome'").get()).n, 0);
  // Les événements sans effet répondent 200 (Stripe ne doit pas les renvoyer)
  assert.equal((await webhook(event('invoice.paid', { id: 'in_1' }))).status, 200);
  // Pas de webhook quand les paiements ne sont pas ouverts
  assert.equal((await webhook(ev, { target: off })).status, 404);
});

test('paiement abouti : « checkout.session.completed » lie le client Stripe au compte et relit l\'abonnement', async () => {
  const u = await user('checkout@x.fr');
  stripe['GET /subscriptions/sub_9'] = { json: withUser(u, { id: 'sub_9', customer: 'cus_9', metadata: { plan: 'business', period: 'year' } }) };
  const ev = event('checkout.session.completed', { mode: 'subscription', customer: 'cus_9', subscription: 'sub_9', client_reference_id: String(u.id), metadata: { app: 'iaboss', user_id: String(u.id), plan: 'business', period: 'year' } });
  assert.equal((await webhook(ev)).status, 200);
  assert.equal((await dbUser(u.id)).plan, 'business');
  assert.equal((await subscriptionOf(s.db, u.id)).customer_id, 'cus_9');
  // Un paiement unique (pas un abonnement) n'est pas pour nous
  const other = await user('paiement-unique@x.fr');
  await webhook(event('checkout.session.completed', { mode: 'payment', customer: 'cus_x', client_reference_id: String(other.id) }));
  assert.equal(await subscriptionOf(s.db, other.id), null);
});

test('changement d\'offre : un abonnement actif est modifié (au prorata), jamais doublé', async () => {
  const u = await user('upgrade@x.fr');
  await applySubscription(s.db, withUser(u));
  assert.equal((await dbUser(u.id)).plan, 'starter');
  priceStub();
  stripe['GET /subscriptions/sub_1'] = { json: withUser(u) };
  stripe['POST /subscriptions/sub_1'] = ({ body }) => ({ json: withUser(u, { metadata: { plan: body['metadata[plan]'], period: body['metadata[period]'] } }) });
  const same = await u.post('/abonnement/choisir', { plan: 'starter', period: 'month' }, { form: true });
  assert.match(loc(same), /déjà cette offre/);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0, 'même offre : aucun appel');
  const r = await u.post('/abonnement/choisir', { plan: 'business', period: 'month' }, { form: true });
  assert.equal(r.status, 303);
  assert.match(loc(r), /Offre Business activée[^]*prorata/);
  assert.ok(!calls.some((c) => c.path === '/checkout/sessions'), 'pas de second abonnement');
  const upd = calls.find((c) => c.method === 'POST' && c.path === '/subscriptions/sub_1').body;
  assert.equal(upd['items[0][id]'], 'si_1');
  assert.equal(upd['items[0][price]'], 'price_iaboss_business_month_2900');
  assert.equal(upd.proration_behavior, 'create_prorations');
  assert.equal((await dbUser(u.id)).plan, 'business');
  // Un paiement refusé : on renvoie vers le portail, pas de changement
  await applySubscription(s.db, withUser(u, { status: 'past_due' }));
  calls = [];
  const late = await u.post('/abonnement/choisir', { plan: 'growth', period: 'month' }, { form: true });
  assert.match(loc(late), /paiement a échoué/);
  assert.equal(calls.length, 0);
});

test('paiement refusé : droits gardés pendant le délai de grâce, puis retour au gratuit ; régularisé, tout revient', async () => {
  const u = await user('grace@x.fr');
  const t0 = now();
  await applySubscription(s.db, withUser(u), { at: t0 });
  await applySubscription(s.db, withUser(u, { status: 'past_due' }), { at: t0 + DAY });
  let row = await subscriptionOf(s.db, u.id);
  assert.equal(row.entitled, 1);
  assert.equal(row.grace_until, t0 + DAY + SUBSCRIPTION.graceDays * DAY);
  assert.equal((await dbUser(u.id)).plan, 'starter', 'les droits sont gardés');
  // Une nouvelle tentative de Stripe ne repousse pas le délai
  await applySubscription(s.db, withUser(u, { status: 'past_due' }), { at: t0 + 3 * DAY });
  assert.equal((await subscriptionOf(s.db, u.id)).grace_until, t0 + DAY + SUBSCRIPTION.graceDays * DAY);
  await expireGrace(s.db, { at: t0 + 3 * DAY });
  assert.equal((await subscriptionOf(s.db, u.id)).entitled, 1, 'délai pas écoulé : les droits restent');
  assert.ok((await expireGrace(s.db, { at: t0 + DAY + SUBSCRIPTION.graceDays * DAY })) >= 1, 'délai écoulé'); // d'autres comptes du fichier peuvent être concernés aussi
  assert.equal((await dbUser(u.id)).plan, 'free');
  row = await subscriptionOf(s.db, u.id);
  assert.equal(row.entitled, 0);
  // La carte est mise à jour : l'abonnement redevient actif, le plan revient
  await applySubscription(s.db, withUser(u, { status: 'active' }), { at: t0 + 9 * DAY });
  assert.equal((await dbUser(u.id)).plan, 'starter');
  assert.equal((await subscriptionOf(s.db, u.id)).grace_until, null);
});

test('fin d\'abonnement : retour au plan gratuit, rien n\'est supprimé ; administrateurs et plan « pro » donné à la main jamais touchés', async () => {
  const u = await user('fin@x.fr');
  const { addProject } = await import('./helpers/users.js');
  const p = await addProject(s.db, u.id, { name: 'Mon projet', gitUrl: 'https://github.com/u/fin.git' });
  await webhook(event('customer.subscription.created', withUser(u)));
  assert.equal((await dbUser(u.id)).plan, 'starter');
  // Résiliation « à la fin de la période » : l'offre reste active
  await webhook(event('customer.subscription.updated', withUser(u, { cancel_at_period_end: true })));
  assert.equal((await dbUser(u.id)).plan, 'starter');
  assert.equal((await subscriptionOf(s.db, u.id)).cancel_at_period_end, 1);
  // La période se termine : Stripe supprime l'abonnement
  await webhook(event('customer.subscription.deleted', withUser(u)));
  assert.equal((await dbUser(u.id)).plan, 'free');
  assert.equal((await subscriptionOf(s.db, u.id)).entitled, 0);
  assert.ok(await s.db.prepare('SELECT id FROM projects WHERE id = ?').get(p), 'le projet est gardé');
  // Un administrateur qui aurait un abonnement garde sa situation
  const admin = await s.newUser({ email: 'admin-sub@x.fr', admin: true });
  await applySubscription(s.db, withUser(admin, { status: 'active' }));
  assert.equal((await dbUser(admin.id)).is_admin, 1);
  assert.notEqual((await dbUser(admin.id)).plan, 'starter', 'un administrateur n\'a pas de plan à changer');
  // Un plan « pro » attribué à la main n'est ni remplacé ni retiré
  const pro = await user('pro@x.fr');
  await s.db.prepare("UPDATE users SET plan = 'pro' WHERE id = ?").run(pro.id);
  await applySubscription(s.db, withUser(pro, { status: 'active' }));
  assert.equal((await dbUser(pro.id)).plan, 'pro');
  await applySubscription(s.db, withUser(pro, { status: 'canceled' }));
  assert.equal((await dbUser(pro.id)).plan, 'pro');
});

test('portail client : ouvert pour SON abonnement seulement, même sans IA reliée ; sans abonnement, un message', async () => {
  const u = await user('portail@x.fr', { link: false });
  const none = await u.post('/abonnement/portail', {}, { form: true });
  assert.match(loc(none), /pas d'abonnement/);
  await applySubscription(s.db, withUser(u, { customer: 'cus_portail' }));
  stripe['POST /billing_portal/sessions'] = ({ body }) => ({ json: { url: `https://billing.stripe.com/p/${body.customer}` } });
  const r = await u.post('/abonnement/portail', {}, { form: true });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), 'https://billing.stripe.com/p/cus_portail');
  assert.equal(calls[0].body.return_url, `${APP_URL}/account#usage`);
  const other = await user('portail-autre@x.fr');
  calls = [];
  const o = await other.post('/abonnement/portail', {}, { form: true });
  assert.match(loc(o), /pas d'abonnement/, 'un autre compte n\'ouvre jamais le portail d\'un autre');
  assert.equal(calls.length, 0);
});

test('suppression du compte : l\'abonnement est résilié chez Stripe d\'abord ; si Stripe échoue, rien n\'est supprimé', async () => {
  const u = await user('suppr@x.fr');
  await applySubscription(s.db, withUser(u, { id: 'sub_del', customer: 'cus_del' }));
  stripe['DELETE /subscriptions/sub_del'] = { status: 500, json: { error: { message: 'panne' } } };
  const ko = await u.post('/account/delete', { confirm: 'suppr@x.fr' }, { form: true });
  assert.match(loc(ko), /rien n'a été supprimé/);
  assert.ok(await s.db.prepare('SELECT id FROM users WHERE id = ?').get(u.id), 'le compte existe toujours');
  stripe['DELETE /subscriptions/sub_del'] = { json: { id: 'sub_del', status: 'canceled' } };
  const ok = await u.post('/account/delete', { confirm: 'suppr@x.fr' }, { form: true });
  assert.equal(ok.headers.get('location'), '/login?bye=1');
  assert.equal(await s.db.prepare('SELECT id FROM users WHERE id = ?').get(u.id), undefined);
  assert.equal(await subscriptionOf(s.db, u.id), null, 'la ligne d\'abonnement part avec le compte');
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.path === '/subscriptions/sub_del'));
  // Sans abonnement : suppression directe, aucun appel à Stripe
  const plain = await user('suppr2@x.fr');
  calls = [];
  assert.equal((await plain.post('/account/delete', { confirm: 'suppr2@x.fr' }, { form: true })).headers.get('location'), '/login?bye=1');
  assert.equal(calls.length, 0);
});

test('pages : Tarifs propose « Choisir cette offre » quand les paiements sont ouverts, « Me prévenir » sinon ; Mon compte montre l\'offre', async () => {
  const page = async (app, path, u) => (await fetch(`${app.base}${path}`, { headers: { accept: 'text/html', ...(u ? { cookie: u.cookie } : {}) } })).text();
  // Chrome applique « form-action » aux redirections : sans les adresses de Stripe, le bouton de paiement serait bloqué par le navigateur
  const csp = (await fetch(`${s.base}/tarifs`)).headers.get('content-security-policy');
  assert.match(csp, /form-action 'self'[^;]*https:\/\/checkout\.stripe\.com[^;]*https:\/\/billing\.stripe\.com/);
  const open = await page(s, '/tarifs');
  for (const k of Object.keys(PLAN_PRICES)) assert.match(open, new RegExp(`name="plan" value="${k}"`));
  assert.match(open, /action="\/abonnement\/choisir"[^]*Choisir cette offre/);
  assert.match(open, /name="period" value="month"/);
  assert.match(open, /name="period" value="year"/);
  assert.doesNotMatch(open, /Bientôt|Me prévenir à l'ouverture/);
  assert.match(open, /iaboss ne voit jamais ton numéro de carte/);
  assert.match(open, /Comment résilier un abonnement ?[^]*Gérer mon abonnement/);
  assert.doesNotMatch(open, /plans payants ouvriront prochainement/, 'la FAQ ne dit plus que ce n\'est pas ouvert');
  const closed = await page(off, '/tarifs');
  assert.match(closed, /Me prévenir à l'ouverture/);
  assert.match(closed, /plans payants ouvriront prochainement/);
  assert.doesNotMatch(closed, /\/abonnement\/choisir/);
  assert.match(await page(s, '/accueil'), /name="plan" value="growth"/, 'l\'accueil aussi');
  // Mon compte
  const u = await user('compte@x.fr');
  let acc = await page(s, '/account', u);
  assert.match(acc, /Tu es sur le plan gratuit[^]*Passer à une offre payante/);
  assert.match(acc, /Mode test : aucun paiement réel/);
  await applySubscription(s.db, withUser(u, { current_period_end: Math.floor(Date.UTC(2027, 0, 15, 12) / 1000) }));
  acc = await page(s, '/account', u);
  assert.match(acc, /Ton offre : Démarrage[^]*9 € TTC par mois[^]*Prochain paiement le 15 janvier 2027/);
  assert.match(acc, /action="\/abonnement\/portail"[^]*Gérer mon abonnement/);
  assert.match(acc, /Changer d'offre/);
  await applySubscription(s.db, withUser(u, { cancel_at_period_end: true, current_period_end: Math.floor(Date.UTC(2027, 0, 15, 12) / 1000) }));
  assert.match(await page(s, '/account', u), /Se termine le 15 janvier 2027 : tu repasseras ensuite au plan gratuit/);
  await applySubscription(s.db, withUser(u, { status: 'past_due' }));
  assert.match(await page(s, '/account', u), /Ton dernier paiement a échoué[^]*avant le/);
  await applySubscription(s.db, withUser(u, { status: 'canceled' }));
  assert.match(await page(s, '/account', u), /Ton abonnement est terminé : tu es revenu au plan gratuit[^]*Mes factures/);
  // Paiements fermés et aucun abonnement : le bloc n'apparaît pas
  const v = await off.newUser({ email: 'compte2@x.fr', admin: false, link: testTokenLink() });
  assert.doesNotMatch(await page(off, '/account', v), /Passer à une offre payante|Gérer mon abonnement/);
  assert.equal((await billingView(off.app, v.id)).enabled, false);
  // Les textes légaux suivent
  assert.match(await page(s, '/cgu'), /Les plans payants sont ouverts[^]*résilier à tout moment/);
  assert.match(await page(s, '/confidentialite'), /Stripe Payments Europe/);
  assert.match(await page(off, '/cgu'), /Ces plans ouvrent prochainement/);
  assert.doesNotMatch(await page(off, '/confidentialite'), /Stripe Payments Europe/);
});

test('compte Stripe partagé : les abonnements et paiements d\'un autre produit du même compte ne touchent jamais un compte iaboss', async () => {
  const u = await user('partage@x.fr');
  // Un autre produit du même compte Stripe qui réutilise les mêmes noms de métadonnées (user_id, plan) : sans marqueur « app », rien n'est appliqué
  const foreign = withUser(u, { id: 'sub_autre', customer: 'cus_autre', metadata: { app: undefined, plan: 'business' } });
  delete foreign.metadata.app;
  assert.equal((await webhook(event('customer.subscription.created', foreign))).status, 200);
  assert.equal((await dbUser(u.id)).plan, 'free', 'abonnement d\'un autre produit : plan inchangé');
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM subscriptions WHERE user_id = ?').get(u.id)).n, 0);
  const co = event('checkout.session.completed', { mode: 'subscription', customer: 'cus_autre', subscription: 'sub_autre', client_reference_id: String(u.id), metadata: { user_id: String(u.id), plan: 'business' } });
  assert.equal((await webhook(co)).status, 200);
  assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM subscriptions WHERE user_id = ?').get(u.id)).n, 0, 'paiement d\'un autre produit : aucun abonnement créé');
  // Le client Stripe d'un abonnement iaboss ne sert pas à rattacher un abonnement étranger
  assert.equal((await webhook(event('customer.subscription.created', withUser(u, { id: 'sub_ok', customer: 'cus_ok' })))).status, 200);
  assert.equal((await dbUser(u.id)).plan, 'starter');
  const sameCustomer = withUser(u, { id: 'sub_etranger', customer: 'cus_ok', status: 'canceled', metadata: { plan: 'growth' } });
  delete sameCustomer.metadata.app; delete sameCustomer.metadata.user_id;
  await webhook(event('customer.subscription.deleted', sameCustomer));
  assert.equal((await dbUser(u.id)).plan, 'starter', 'la fin d\'un abonnement étranger du même client ne rétrograde pas le compte');
});

test('articles : un produit Stripe par offre (identifiant fixe, libellé de relevé, marqueur iaboss), rattaché à ses prix mensuel et annuel', async () => {
  const u = await user('produit@x.fr');
  stripe['GET /prices'] = { json: { data: [] } };
  stripe['GET /products/iaboss_growth'] = { status: 404, json: { error: { message: 'No such product' } } };
  stripe['POST /products'] = ({ body }) => ({ json: { id: body.id } });
  stripe['POST /prices'] = ({ body }) => ({ json: { id: `price_${body.lookup_key}` } });
  stripe['POST /checkout/sessions'] = { json: { id: 'cs_p', url: 'https://checkout.stripe.com/c/pay/cs_p' } };
  await u.post('/abonnement/choisir', { plan: 'growth', period: 'month' }, { form: true });
  const prod = calls.find((c) => c.method === 'POST' && c.path === '/products').body;
  assert.equal(prod.id, 'iaboss_growth');
  assert.equal(prod.name, 'iaboss Croissance');
  assert.equal(prod.statement_descriptor, 'IABOSS CROISSANCE');
  assert.equal(prod['metadata[app]'], 'iaboss');
  assert.equal(prod['metadata[plan]'], 'growth');
  assert.equal(calls.find((c) => c.path === '/prices' && c.method === 'POST').body.product, 'iaboss_growth', 'le prix est rattaché au produit, pas à un produit créé en ligne');
  assert.ok(!calls.some((c) => c.method === 'POST' && c.path === '/prices' && 'product_data[name]' in c.body));
  // Le même produit sert au prix annuel, sans être recréé
  calls = [];
  await u.post('/abonnement/choisir', { plan: 'growth', period: 'year' }, { form: true });
  assert.ok(!calls.some((c) => c.path === '/products' && c.method === 'POST'), 'produit déjà créé : pas recréé');
  assert.equal(calls.find((c) => c.path === '/prices' && c.method === 'POST').body.product, 'iaboss_growth');
});
