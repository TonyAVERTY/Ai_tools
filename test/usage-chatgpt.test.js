import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt } from '../src/crypto.js';
import { now } from '../src/db.js';
import { parseLimits, windowLabel, tokenOf, currentChatgptLimits } from '../src/services/usagechatgpt.js';
import { startApp } from './helpers/server.js';

// Limites du compte ChatGPT (fenêtre de 5 h, semaine) : décodage des formats attendus, jeton expiré (jamais renouvelé ici), repli sur la dernière mesure,
// jamais de valeur inventée. Le vrai point d'accès d'OpenAI n'est PAS testé (aucun compte réel) : la réponse est simulée.
let s;
before(async () => { s = await startApp(); });
after(async () => { await s.close(); });

const jwt = (exp) => `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;
const auth = (exp = now() + 86400) => JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: 'id.' + 'I'.repeat(30), access_token: jwt(exp), refresh_token: 'ref.' + 'R'.repeat(30), account_id: 'acc-1' } });
const link = (a = auth(), linkedAt = 1000) => JSON.stringify({ v: 1, provider: 'openai', mode: 'chatgpt_account', valid: true, linked_at: linkedAt, secret_enc: encrypt(s.app.cfg.secretKey, a) });
const setLink = (u, raw) => s.db.prepare('UPDATE users SET claude_link_json = ? WHERE id = ?').run(raw, u.id);
const BODY = { rate_limit: { primary_window: { used_percent: 42, limit_window_seconds: 18000, reset_after_seconds: 3600 }, secondary_window: { used_percent: 7.5, limit_window_seconds: 604800, reset_at: 4_000_000_000 } } };

test('décodage : les deux formes connues, libellés des fenêtres, pourcentage borné, rien d\'inventé', () => {
  const p = parseLimits(BODY, 1000);
  assert.deepEqual(p.windows.map((w) => [w.label, w.utilization, w.resetsAt]), [['session 5 h', 0.42, 4600], ['semaine', 0.075, 4_000_000_000]]);
  const q = parseLimits({ rate_limits: { primary: { used_percent: 130, window_minutes: 300, resets_in_seconds: 60 }, secondary: { used_percent: 10, window_minutes: 10080, resets_at: 4_000_000_000_000 } } }, 1000);
  assert.deepEqual(q.windows.map((w) => [w.utilization, w.resetsAt]), [[1, 1060], [0.1, 4_000_000_000]], '130 % borné à 100 %, millisecondes converties');
  assert.equal(parseLimits({}), null);
  assert.equal(parseLimits(null), null);
  assert.equal(parseLimits({ rate_limit: { primary_window: { used_percent: 'beaucoup' } } }), null);
  assert.equal(windowLabel(300), 'session 5 h');
  assert.equal(windowLabel(10080), 'semaine');
  assert.equal(windowLabel(60), 'fenêtre de 1 h');
  assert.equal(windowLabel(null), 'limite');
});

test('jeton : lu dans le fichier de connexion, expiré reconnu, fichier illisible refusé', () => {
  assert.equal(tokenOf(auth(now() + 3600)).expired, false);
  assert.equal(tokenOf(auth(now() + 3600)).accountId, 'acc-1');
  assert.equal(tokenOf(auth(now() - 10)).expired, true);
  assert.equal(tokenOf('pas du json'), null);
  assert.equal(tokenOf(JSON.stringify({ tokens: {} })), null);
});

test('relevé en direct : envoyé avec le jeton du compte, mémorisé, repli sur la dernière mesure en cas d\'échec, jeton expiré jamais renouvelé', async () => {
  const u = await s.newUser({ admin: false });
  await setLink(u, link());
  const calls = [];
  let mode = 'ok';
  s.app.fetch = async (url, opts) => {
    calls.push({ url, headers: opts.headers });
    return mode === 'ok' ? { ok: true, status: 200, json: async () => BODY } : { ok: false, status: mode === 'denied' ? 401 : 500, json: async () => ({}) };
  };
  try {
    const t0 = now();
    const a = await currentChatgptLimits(s.app, u.id, { at: t0 });
    assert.equal(a.source, 'live');
    assert.equal(a.windows[0].utilization, 0.42);
    assert.match(calls[0].url, /\/wham\/usage$/);
    assert.match(calls[0].headers.Authorization, /^Bearer h\./);
    assert.equal(calls[0].headers['ChatGPT-Account-Id'], 'acc-1');
    await currentChatgptLimits(s.app, u.id, { at: t0 + 30 });
    assert.equal(calls.length, 1, 'un relevé toutes les 2 minutes au plus');
    mode = 'denied';
    const b = await currentChatgptLimits(s.app, u.id, { at: t0 + 200 });
    assert.equal(b.source, 'stored');
    assert.equal(b.error, 'denied');
    assert.equal(b.windows[0].utilization, 0.42, 'la dernière mesure reste affichée, marquée comme telle');
    const c = await currentChatgptLimits(s.app, u.id, { at: 4_000_000_001 });
    assert.equal(c.windows[1].expired, true, 'fenêtre remise à zéro : plus présentée comme une mesure');
    // jeton expiré : aucun appel, aucune tentative de renouvellement
    await setLink(u, link(auth(now() - 10)));
    s.app.chatgptUsageTried.clear();
    const n = calls.length;
    const d = await currentChatgptLimits(s.app, u.id, { at: now() });
    assert.equal(calls.length, n);
    assert.equal(d.error, 'expired');
    // autre compte ChatGPT relié depuis : l'ancienne mesure n'est plus la sienne
    await setLink(u, link(auth(), 2000));
    s.app.chatgptUsageTried.clear();
    mode = 'down';
    const e = await currentChatgptLimits(s.app, u.id, { at: now() });
    assert.deepEqual(e.windows, []);
  } finally { delete s.app.fetch; }
});

test('autres modes : aucun relevé ChatGPT ; /api/system expose les limites au compte ChatGPT seulement, sans jamais montrer le jeton', async () => {
  const api = await s.newUser({ admin: false });
  await setLink(api, JSON.stringify({ v: 1, provider: 'openai', mode: 'api_key', valid: true, secret_enc: encrypt(s.app.cfg.secretKey, 'sk-' + 'x'.repeat(30)) }));
  assert.equal(await currentChatgptLimits(s.app, api.id), null);
  assert.equal((await (await api.get('/api/system')).json()).chatgptLimits, null);

  const u = await s.newUser({ admin: false });
  await setLink(u, link());
  s.app.fetch = async () => ({ ok: true, status: 200, json: async () => BODY });
  try {
    const raw = await (await u.get('/api/system')).text();
    const sys = JSON.parse(raw);
    assert.equal(sys.provider, 'openai');
    assert.equal(sys.chatgptLimits.windows.length, 2);
    assert.equal(sys.claudeRateLimit, null);
    assert.doesNotMatch(raw, /ref\.R{30}|acc-1|h\.ey/, 'ni le jeton ni l\'identifiant du compte ne sortent');
    const other = await s.newUser({ admin: false });
    assert.ok(!(await (await other.get('/api/system')).json()).chatgptLimits, 'les limites d\'un compte ne sont pas celles d\'un autre');
  } finally { delete s.app.fetch; }
});

test('un job terminé depuis le dernier relevé : la carte est relue sans attendre les 2 minutes (15 s mini entre deux relevés)', async () => {
  const u = await s.newUser({ admin: false });
  await setLink(u, link());
  let calls = 0;
  s.app.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => BODY }; };
  try {
    const t0 = now();
    await currentChatgptLimits(s.app, u.id, { at: t0 });
    await currentChatgptLimits(s.app, u.id, { at: t0 + 20 });
    assert.equal(calls, 1, 'rien de nouveau : on attend les 2 minutes');
    await s.db.prepare("INSERT INTO jobs(user_id, type, status, created_at, finished_at) VALUES(?, 'prospect', 'done', ?, ?)").run(u.id, t0 + 25, t0 + 30);
    await currentChatgptLimits(s.app, u.id, { at: t0 + 35 });
    assert.equal(calls, 2, 'job terminé depuis le dernier relevé (plus de 15 s) : relu sans attendre les 2 minutes');
    await currentChatgptLimits(s.app, u.id, { at: t0 + 40 });
    assert.equal(calls, 2, 'jamais plus d\'une relecture toutes les 15 s, ni tant que le job est déjà compris dans la dernière mesure');
    await currentChatgptLimits(s.app, u.id, { at: t0 + 70 });
    assert.equal(calls, 2, 'puis retour au rythme normal');
  } finally { delete s.app.fetch; }
});
