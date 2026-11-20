import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countView, countable, audienceStats, purgeAudience, dayOf } from '../src/services/audience.js';
import { startApp } from './helpers/server.js';

// Mesure d'audience sans cookie : compteurs par jour et par page, rien qui identifie un visiteur, « Ne pas me suivre » respecté.

const UA = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120';
const req = (headers = {}, method = 'GET') => ({ method, headers: { 'user-agent': UA, ...headers } });

test('seules les lectures de page par un navigateur, sans DNT ni GPC, sont comptées', () => {
  assert.equal(countable(req()), true);
  assert.equal(countable(req({}, 'POST')), false);
  assert.equal(countable(req({ dnt: '1' })), false);
  assert.equal(countable(req({ 'sec-gpc': '1' })), false);
  assert.equal(countable(req({ 'user-agent': 'Googlebot/2.1' })), false);
  assert.equal(countable({ method: 'GET', headers: {} }), false);
});

test('pages vues et sites d\'origine : compteurs seulement, un site d\'origine interne n\'est pas compté, purge à 13 mois', async () => {
  const s = await startApp();
  try {
    const t = 1_800_000_000;
    await countView(s.db, req({ referer: 'https://www.exemple.org/article?x=1' }), '/tarifs', 'https://iaboss.test', t);
    await countView(s.db, req({ referer: 'https://exemple.org/' }), '/tarifs', 'https://iaboss.test', t);
    await countView(s.db, req({ referer: 'https://iaboss.test/accueil' }), '/', 'https://iaboss.test', t);
    await countView(s.db, req({ dnt: '1' }), '/tarifs', 'https://iaboss.test', t);
    const st = await audienceStats(s.db, t - 86400);
    assert.equal(st.total, 3);
    assert.deepEqual(st.pages, [{ path: '/tarifs', n: 2 }, { path: '/', n: 1 }]);
    assert.deepEqual(st.referrers, [{ host: 'exemple.org', n: 2 }]);
    // Aucun identifiant : les tables n'ont que jour, page ou site, et compteur
    const cols = (await s.db.prepare('SELECT * FROM page_views').all())[0];
    assert.deepEqual(Object.keys(cols).sort(), ['day', 'path', 'views']);
    await purgeAudience(s.db, t + 400 * 86400);
    assert.equal((await audienceStats(s.db, 0)).total, 0);
    assert.ok(dayOf(t) > 0);
  } finally { await s.close(); }
});

test('une page du site public est comptée, sans poser le moindre cookie', async () => {
  const s = await startApp();
  try {
    const r = await fetch(`${s.base}/tarifs`, { headers: { 'user-agent': UA, accept: 'text/html' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.getSetCookie().length, 0);
    await new Promise((ok) => setTimeout(ok, 100));
    assert.equal((await s.db.prepare("SELECT COALESCE(SUM(views), 0) n FROM page_views WHERE path = '/tarifs'").get()).n, 1);
    await fetch(`${s.base}/tarifs`, { headers: { 'user-agent': UA, dnt: '1' } });
    await new Promise((ok) => setTimeout(ok, 100));
    assert.equal((await s.db.prepare("SELECT COALESCE(SUM(views), 0) n FROM page_views WHERE path = '/tarifs'").get()).n, 1);
  } finally { await s.close(); }
});
