// Quota réel du compte Claude : relevé en direct chez Anthropic (hors AiTools compris), repli sur la dernière mesure d'un job, jamais de valeur inventée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { testTokenLink, TEST_TOKEN } from './helpers/users.js';
import { parseUsage } from '../src/services/usagelive.js';
import { setSetting, getSetting, now } from '../src/db.js';

const HTML = { headers: { accept: 'application/json' } };
const live = (body, status = 200) => {
  const calls = [];
  const fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: status < 300, status, json: async () => body }; };
  return { fetch, calls };
};

test('parseUsage : pourcentages 0-100 en fractions, deux formats connus, rien d\'inventé', () => {
  const w = parseUsage({ five_hour: { utilization: 3, resets_at: '2026-10-23T15:00:00+00:00' }, seven_day: { utilization: 40.5, resets_at: '2026-10-28T09:00:00Z' } });
  assert.equal(w.fiveHour.utilization, 0.03);
  assert.equal(w.sevenDay.utilization, 0.405);
  assert.equal(w.fiveHour.resetsAt, Date.parse('2026-10-23T15:00:00Z') / 1000);
  const l = parseUsage({ five_hour: null, limits: [{ kind: 'session', percent: 12, resets_at: null }, { kind: 'weekly_all', percent: 90 }, { kind: 'weekly_scoped', percent: 5 }] });
  assert.equal(l.fiveHour.utilization, 0.12);
  assert.equal(l.sevenDay.utilization, 0.9);
  for (const bad of [null, {}, { five_hour: {} }, 'x', { limits: [] }]) assert.equal(parseUsage(bad), null);
});

test('/api/system : le quota vient du relevé en direct, une fois par minute, avec le jeton de la personne', async () => {
  const f = live({ five_hour: { utilization: 3, resets_at: '2099-01-01T00:00:00Z' }, seven_day: { utilization: 40, resets_at: '2099-01-02T00:00:00Z' } });
  const s = await startApp({ fetch: f.fetch });
  try {
    const u = await s.newUser({ admin: false, link: testTokenLink() });
    const r = await (await u.get('/api/system', HTML)).json();
    assert.equal(r.claudeRateLimit.source, 'live');
    assert.equal(r.claudeRateLimit.fiveHour.utilization, 0.03);
    assert.equal(r.claudeRateLimit.sevenDay.utilization, 0.4);
    assert.equal(r.claudeRateLimit.error, null);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, 'https://api.anthropic.com/api/oauth/usage');
    assert.equal(f.calls[0].opts.headers.Authorization, `Bearer ${TEST_TOKEN}`);
    assert.equal(f.calls[0].opts.headers['anthropic-beta'], 'oauth-2025-04-20');
    await u.get('/api/system', HTML);
    assert.equal(f.calls.length, 1, 'pas de nouvel appel dans la minute');
    // ce relevé sert aussi à décider si un job peut partir
    const stored = JSON.parse(await getSetting(s.db, u.id, 'claude_rate_limit_json'));
    assert.equal(stored.source, 'live');
    assert.ok(!JSON.stringify(r).includes(TEST_TOKEN), 'le jeton ne sort jamais');
  } finally { await s.close(); }
});

test('relevé refusé ou indisponible : dernière mesure d\'un job, marquée comme telle ; sinon « indisponible », pas de valeur inventée', async () => {
  const f = live({}, 403);
  const s = await startApp({ fetch: f.fetch });
  try {
    const u = await s.newUser({ admin: false, link: testTokenLink() });
    let r = await (await u.get('/api/system', HTML)).json();
    assert.deepEqual([r.claudeRateLimit.fiveHour, r.claudeRateLimit.sevenDay, r.claudeRateLimit.error], [null, null, 'denied']);

    const u2 = await s.newUser({ admin: false, link: testTokenLink() });
    await setSetting(s.db, u2.id, 'claude_rate_limit_json', JSON.stringify({ at: now() - 3600, fiveHour: { utilization: 0.5, resetsAt: now() + 600 }, sevenDay: { utilization: 0.2, resetsAt: now() - 10 } }));
    r = await (await u2.get('/api/system', HTML)).json();
    assert.equal(r.claudeRateLimit.source, 'jobs');
    assert.equal(r.claudeRateLimit.error, 'denied');
    assert.equal(r.claudeRateLimit.fiveHour.utilization, 0.5);
    assert.equal(r.claudeRateLimit.sevenDay.expired, true, 'fenêtre remise à zéro depuis : plus une mesure');
  } finally { await s.close(); }
});

test('clé API : aucun quota d\'abonnement, aucun appel à Anthropic', async () => {
  const f = live({});
  const s = await startApp({ fetch: f.fetch });
  try {
    const u = await s.newUser({ admin: false, link: { v: 1, mode: 'api_key', valid: true } });
    const r = await (await u.get('/api/system', HTML)).json();
    assert.equal(r.claudeRateLimit, null);
    assert.equal(f.calls.length, 0);
  } finally { await s.close(); }
});

test('jeton sans accès au point d\'accès « usage » : repli sur une requête minimale, dont les en-têtes donnent le quota du compte entier', async () => {
  const calls = [];
  const hdr = { 'anthropic-ratelimit-unified-5h-utilization': '0.07', 'anthropic-ratelimit-unified-5h-reset': '4000000000', 'anthropic-ratelimit-unified-7d-utilization': '41', 'anthropic-ratelimit-unified-7d-reset': '4000300000' };
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/api/oauth/usage')) return { ok: false, status: 403, json: async () => ({}) };
    return { ok: true, status: 200, headers: { get: (k) => hdr[k.toLowerCase()] ?? null }, json: async () => ({}) };
  };
  const s = await startApp({ fetch });
  try {
    const u = await s.newUser({ admin: false, link: testTokenLink() });
    const r = (await (await u.get('/api/system', HTML)).json()).claudeRateLimit;
    assert.equal(r.source, 'live');
    assert.equal(r.error, null);
    assert.equal(r.fiveHour.utilization, 0.07, 'fraction 0-1');
    assert.equal(r.sevenDay.utilization, 0.41, 'pourcentage 0-100 converti');
    assert.equal(r.fiveHour.resetsAt, 4_000_000_000);
    const probe = calls.find((c) => c.url.endsWith('/v1/messages'));
    assert.equal(probe.opts.headers.Authorization, `Bearer ${TEST_TOKEN}`);
    const body = JSON.parse(probe.opts.body);
    assert.equal(body.max_tokens, 1);
    assert.match(body.system[0].text, /Claude Code/);
    // pas de nouvel appel dans les 5 minutes, et le point d'accès refusé n'est pas réessayé aussitôt
    await u.get('/api/system', HTML);
    assert.equal(calls.length, 2);
  } finally { await s.close(); }
});
