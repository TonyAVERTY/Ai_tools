// Fonctionnalités réservées à une offre (FEATURES dans limits.js) : qui peut lancer quoi, selon le plan.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { addProject, testTokenLink } from './helpers/users.js';
import { FEATURES, PLAN_ORDER, PLAN_PRICES, PLAN_LABELS } from '../src/limits.js';
import { hasFeature, assertFeature } from '../src/services/plans.js';

let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

const user = async (plan) => {
  const u = await s.newUser({ admin: false, link: testTokenLink() });
  await s.db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, u.id);
  return u;
};

test('chaque fonctionnalité demande une offre qui existe, et les offres au-dessus l\'ont aussi', () => {
  for (const [key, f] of Object.entries(FEATURES)) {
    assert.ok(PLAN_ORDER.includes(f.plan), `${key} : offre inconnue`);
    assert.ok(f.plan !== 'free', `${key} : réservée à une offre payante`);
    const first = PLAN_ORDER.indexOf(f.plan);
    PLAN_ORDER.forEach((plan, i) => assert.equal(hasFeature({ plan }, key), i >= first, `${key} avec ${plan}`));
    assert.equal(hasFeature({ plan: 'pro' }, key), true, 'plan pro : tout');
    assert.equal(hasFeature({ plan: 'free', isAdmin: true }, key), true, 'administrateur : tout');
    assert.equal(hasFeature({ plan: 'inconnu' }, key), false, 'plan inconnu : retombe sur gratuit, jamais sur tout');
  }
  assert.throws(() => hasFeature({ plan: 'free' }, 'nimporte'), /inconnue/);
});

test('le refus dit quelle offre ouvre la fonctionnalité et que rien n\'est supprimé', () => {
  assert.throws(() => assertFeature({ plan: 'free' }, 'promo'), (e) => e.status === 403 && e.message.includes(PLAN_LABELS[FEATURES.promo.plan]) && /rien n'est supprimé/.test(e.message) && e.message.includes('/tarifs'));
});

test('les prix restent croissants avec l\'offre', () => {
  const prices = PLAN_ORDER.slice(1).map((p) => PLAN_PRICES[p]);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
});

test('posts, devis et factures : refusés en gratuit, ouverts dès Démarrage', async () => {
  const free = await user('free');
  const pf = await addProject(s.db, free.id, { name: 'A', gitUrl: 'https://github.com/u/a.git' });
  await s.db.prepare('UPDATE projects SET profile_json = ? WHERE id = ?').run('{"resume":"x"}', pf);
  const r = await free.post(`/api/projects/${pf}/content/newsletter/generate`, {});
  assert.equal(r.status, 403);
  assert.match(await r.text(), /à partir de l'offre Démarrage/);
  const start = await user('starter');
  const ps = await addProject(s.db, start.id, { name: 'B', gitUrl: 'https://github.com/u/b.git' });
  await s.db.prepare('UPDATE projects SET profile_json = ? WHERE id = ?').run('{"resume":"x"}', ps);
  assert.equal((await start.post(`/api/projects/${ps}/content/newsletter/generate`, {})).status, 200);
});

test('postes : refusés en Démarrage, ouverts en Croissance', async () => {
  for (const [plan, status] of [['starter', 403], ['growth', 200]]) {
    const u = await user(plan);
    const pid = await addProject(s.db, u.id, { name: 'P', gitUrl: `https://github.com/u/${plan}.git` });
    await s.db.prepare('UPDATE projects SET profile_json = ? WHERE id = ?').run('{"resume":"x"}', pid);
    assert.equal((await u.post(`/api/projects/${pid}/poste/faq`, {})).status, status, plan);
  }
});

test('mode développeur et API : à partir de Croissance, et une API déjà en service est coupée si l\'offre redescend', async () => {
  const starter = await user('starter');
  assert.equal((await starter.post('/account/developer', { enabled: 'on' })).status, 403);
  const growth = await user('growth');
  const on = await growth.post('/account/developer', { enabled: 'on' });
  assert.ok(on.status < 400, `activation : ${on.status}`);
  const { authenticateApi, createApiToken } = await import('../src/apitokens.js');
  const t = await createApiToken(s.db, growth.id, { name: 't', scopes: ['read'] });
  const req = { headers: { authorization: `Bearer ${t.token}` } };
  assert.equal((await authenticateApi(s.db, req)).userId, growth.id);
  await s.db.prepare("UPDATE users SET plan = 'starter' WHERE id = ?").run(growth.id);
  await assert.rejects(authenticateApi(s.db, req), (e) => e.status === 403 && e.code === 'plan_required');
});

test('export de la comptabilité : refusé avant Croissance, la saisie reste libre', async () => {
  const starter = await user('starter');
  assert.equal((await starter.get('/compta/journal.csv')).status, 403);
  assert.equal((await starter.get('/compta')).status, 200, 'la page reste ouverte');
  const growth = await user('growth');
  assert.equal((await growth.get('/compta/journal.csv')).status, 200);
});

test('la page Tarifs liste les fonctionnalités par offre', async () => {
  const html = await (await s.anon.get('/tarifs')).text();
  assert.match(html, /Fonctionnalités par offre/);
  for (const f of Object.values(FEATURES)) assert.ok(html.includes(f.label.replace(/'/g, '&#39;')) || html.includes(f.label), f.label);
});
