import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { verifyCaptcha } from '../src/captcha.js';
import { loadConfig } from '../src/config.js';
import { startApp, APP_URL } from './helpers/server.js';

// reCAPTCHA v3 : vérification serveur (jeton absent, invalide, score bas…), chargement automatique sur la page de connexion,
// CSP limitée à la page de connexion. Aucun appel réel à Google : tout passe par app.fetch.

const SITE = 'site-key-test';
const SECRET = 'secret-key-test';
const RC = { siteKey: SITE, secret: SECRET, minScore: 0.5 };
const HOST = new URL(APP_URL).hostname;
const answer = (o = {}) => ({ success: true, score: 0.9, action: 'login', hostname: HOST, ...o });

const fakeFetch = (reply, calls = []) => async (url, opts = {}) => {
  calls.push({ url, body: Object.fromEntries(new URLSearchParams(opts.body)) });
  if (reply instanceof Error) throw reply;
  return { ok: reply.ok ?? true, status: reply.status ?? 200, json: async () => reply.data ?? reply };
};
const appWith = (reply, calls, rc = RC) => ({ cfg: { recaptcha: rc, appUrl: APP_URL }, fetch: fakeFetch(reply, calls) });

// ---------- Vérification ----------

test('sans clés configurées, reCAPTCHA est désactivé (et n\'appelle jamais Google)', async () => {
  const calls = [];
  const app = { cfg: { recaptcha: null, appUrl: APP_URL }, fetch: fakeFetch(answer(), calls) };
  assert.deepEqual(await verifyCaptcha(app, undefined), { skipped: true });
  assert.equal(calls.length, 0);
});

test('jeton absent : refus 400 sans appel à Google', async () => {
  for (const token of [undefined, null, '', '   ', 42, {}, []]) {
    const calls = [];
    await assert.rejects(verifyCaptcha(appWith(answer(), calls), token), { status: 400, code: 'captcha_missing' }, String(token));
    assert.equal(calls.length, 0);
  }
});

test('jeton invalide ou rejeté par Google : refus 403', async () => {
  await assert.rejects(verifyCaptcha(appWith({ success: false, 'error-codes': ['invalid-input-response'] }), 'tok'), { status: 403, code: 'captcha_invalid' });
  await assert.rejects(verifyCaptcha(appWith({ success: false, 'error-codes': ['timeout-or-duplicate'] }), 'tok'), { status: 403 });
  await assert.rejects(verifyCaptcha(appWith(answer(), []), 'x'.repeat(5000)), { status: 403 }, 'jeton démesuré');
  await assert.rejects(verifyCaptcha(appWith({}), 'tok'), { status: 403 }, 'réponse vide');
});

test('score bas : refus ; le seuil est inclus (0,5 passe, 0,49 non) et réglable', async () => {
  await assert.rejects(verifyCaptcha(appWith(answer({ score: 0.3 })), 'tok'), { status: 403, code: 'captcha_low_score' });
  await assert.rejects(verifyCaptcha(appWith(answer({ score: 0.49 })), 'tok'), { status: 403, code: 'captcha_low_score' });
  await assert.rejects(verifyCaptcha(appWith(answer({ score: undefined })), 'tok'), { status: 403 }, 'pas de score : refus');
  assert.deepEqual(await verifyCaptcha(appWith(answer({ score: 0.5 })), 'tok'), { score: 0.5 });
  await assert.rejects(verifyCaptcha(appWith(answer({ score: 0.7 }), [], { ...RC, minScore: 0.8 }), 'tok'), { status: 403 });
  assert.deepEqual(await verifyCaptcha(appWith(answer({ score: 0.1 }), [], { ...RC, minScore: 0 }), 'tok'), { score: 0.1 });
});

test('jeton produit pour une autre action ou un autre site : refus', async () => {
  await assert.rejects(verifyCaptcha(appWith(answer({ action: 'homepage' })), 'tok'), { status: 403 });
  await assert.rejects(verifyCaptcha(appWith(answer({ action: undefined })), 'tok'), { status: 403 });
  await assert.rejects(verifyCaptcha(appWith(answer({ hostname: 'evil.example' })), 'tok'), { status: 403 });
  await assert.rejects(verifyCaptcha(appWith(answer({ hostname: undefined })), 'tok'), { status: 403 });
});

test('Google injoignable ou en erreur : 503, jamais un passage faute de réponse', async () => {
  await assert.rejects(verifyCaptcha(appWith(new Error('ECONNRESET')), 'tok'), { status: 503, code: 'captcha_unavailable' });
  await assert.rejects(verifyCaptcha(appWith({ ok: false, status: 500, data: answer() }), 'tok'), { status: 503 });
});

test('jeton valide : la requête vers Google porte le secret et le jeton, sans adresse IP', async () => {
  const calls = [];
  assert.deepEqual(await verifyCaptcha(appWith(answer({ score: 0.9 }), calls), 'le-jeton'), { score: 0.9 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.google.com/recaptcha/api/siteverify');
  assert.deepEqual(calls[0].body, { secret: SECRET, response: 'le-jeton' });
});

// ---------- Configuration ----------

test('configuration : les deux clés ensemble, seuil par défaut 0,5, aucun contournement', () => {
  const base = { APP_URL: 'https://x.fr', SECRET_KEY: 'a'.repeat(64), GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', DB_DRIVER: 'sqlite' };
  const keep = { ...process.env };
  const withEnv = (extra, fn) => {
    for (const k of ['RECAPTCHA_SITE_KEY', 'RECAPTCHA_SECRET', 'RECAPTCHA_MIN_SCORE']) delete process.env[k];
    Object.assign(process.env, base, extra);
    try { return fn(); } finally {
      for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
      Object.assign(process.env, keep);
    }
  };
  assert.equal(withEnv({}, () => loadConfig().recaptcha), null);
  assert.deepEqual(withEnv({ RECAPTCHA_SITE_KEY: 'a', RECAPTCHA_SECRET: 'b' }, () => loadConfig().recaptcha), { siteKey: 'a', secret: 'b', minScore: 0.5 });
  assert.equal(withEnv({ RECAPTCHA_SITE_KEY: 'a', RECAPTCHA_SECRET: 'b', RECAPTCHA_MIN_SCORE: '0.7' }, () => loadConfig().recaptcha.minScore), 0.7);
  assert.throws(() => withEnv({ RECAPTCHA_SITE_KEY: 'a' }, loadConfig), /vont ensemble/);
  assert.throws(() => withEnv({ RECAPTCHA_SECRET: 'b' }, loadConfig), /vont ensemble/);
  assert.throws(() => withEnv({ RECAPTCHA_SITE_KEY: 'a', RECAPTCHA_SECRET: 'b', RECAPTCHA_MIN_SCORE: '2' }, loadConfig), /entre 0 et 1/);
  assert.throws(() => withEnv({ RECAPTCHA_SITE_KEY: 'a', RECAPTCHA_SECRET: 'b', RECAPTCHA_MIN_SCORE: 'abc' }, loadConfig), /entre 0 et 1/);
  // Aucune variable ne désactive la vérification quand les clés sont là
  const src = readFileSync('src/captcha.js', 'utf8') + readFileSync('src/config.js', 'utf8').match(/function recaptchaConfig[\s\S]*?\n}\n/)[0];
  assert.doesNotMatch(src, /process\.env|env\.(RECAPTCHA_)?(DISABLE|SKIP|BYPASS)/i);
});

// ---------- Page de connexion et démarrage du flux ----------

test('page de connexion : vérification automatique, rien de Google dans la page, boutons inactifs jusqu\'au chargement', async () => {
  const s = await startApp({ cfg: { recaptcha: RC, apple: { teamId: 't', keyId: 'k', clientId: 'c', privateKey: 'p' } } });
  try {
    const r = await s.anon.get('/login', { headers: { accept: 'text/html' } });
    const h = await r.text();
    assert.match(h, /data-captcha/);
    assert.match(h, new RegExp(`data-sitekey="${SITE}"`));
    assert.match(h, /Vérification anti-robot en cours/);
    assert.doesNotMatch(h, /Charger la vérification anti-robot/, 'plus de clic à faire');
    assert.match(h, /data-captcha-load hidden/, 'le bouton « Réessayer » n\'apparaît qu\'en cas d\'échec');
    // Deux scripts, ceux de l'application ; aucune URL de script, de cadre ou d'image vers Google
    assert.deepEqual([...h.matchAll(/<script[^>]*\ssrc="([^"?]+)(?:\?v=[0-9a-f]{10})?"/g)].map((m) => m[1]), ['/static/site.js', '/static/captcha.js']);
    assert.doesNotMatch(h, /<(script|iframe|img|link)[^>]*(gstatic|google\.com\/recaptcha)/i);
    assert.doesNotMatch(h, /recaptcha\/api\.js/);
    assert.doesNotMatch(h, /<script(?![^>]*src=)/i, 'aucun script en ligne (CSP)');
    // Les boutons sont des formulaires POST désactivés, pour Google et pour Apple
    const forms = [...h.matchAll(/<form method="post" action="(\/auth\/\w+)" data-captcha-form>[\s\S]*?<button[^>]*disabled/g)].map((m) => m[1]);
    assert.deepEqual(forms, ['/auth/google', '/auth/apple']);
    assert.doesNotMatch(h, /<a [^>]*href="\/auth\//, 'plus de lien direct vers /auth');
    // Mentions exigées par Google quand le badge est masqué
    assert.match(h, /policies\.google\.com\/privacy/);
    assert.match(h, /policies\.google\.com\/terms/);
    // Sans reCAPTCHA, la page reste sans script et avec de simples liens
    const plain = await startApp();
    try {
      const p = await (await plain.anon.get('/login', { headers: { accept: 'text/html' } })).text();
      assert.doesNotMatch(p, /captcha\.js|data-captcha/);
      assert.match(p, /href="\/auth\/google"/);
    } finally { await plain.close(); }
  } finally { await s.close(); }
});

test('CSP : les domaines reCAPTCHA ne sont autorisés que sur la page de connexion, et seulement s\'il est configuré', async () => {
  const on = await startApp({ cfg: { recaptcha: RC } });
  const off = await startApp();
  try {
    const csp = async (s, path) => (await s.anon.get(path, { headers: { accept: 'text/html' } })).headers.get('content-security-policy');
    const login = await csp(on, '/login');
    assert.match(login, /script-src 'self' https:\/\/www\.google\.com\/recaptcha\/ https:\/\/www\.gstatic\.com\/recaptcha\//);
    assert.match(login, /frame-src https:\/\/www\.google\.com\/recaptcha\/ https:\/\/recaptcha\.google\.com\/recaptcha\//);
    assert.match(login, /default-src 'self'/);
    assert.match(login, /frame-ancestors 'none'/);
    assert.doesNotMatch(login, /unsafe-inline|unsafe-eval|\*/);
    assert.equal((await csp(on, '/login?e=x')), login, 'la page d\'erreur de connexion aussi');
    for (const p of ['/', '/tarifs', '/confidentialite', '/cgu', '/fonctionnement', '/inexistant', '/static/captcha.js']) {
      const c = await csp(on, p);
      assert.doesNotMatch(c, /recaptcha|gstatic|recaptcha.google/i, `${p} : pas de domaine reCAPTCHA`);
      assert.match(c, /script-src 'self'; /, p);
      assert.doesNotMatch(c, /frame-src/, p);
    }
    assert.doesNotMatch(await csp(off, '/login'), /recaptcha|gstatic|frame-src/i, 'sans clés : aucune ouverture');
  } finally { await on.close(); await off.close(); }
});

test('POST /auth/google : jeton absent, invalide ou score bas = aucun flux démarré ; jeton valide = redirection vers Google', async () => {
  const s = await startApp({ cfg: { recaptcha: RC } });
  try {
    const calls = [];
    const states = async () => (await s.db.prepare('SELECT COUNT(*) n FROM oauth_states').get()).n;
    const post = (body, headers = {}) => fetch(`${s.base}/auth/google`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP_URL, ...headers }, body: new URLSearchParams(body).toString(),
    });
    const failure = (r) => decodeURIComponent(new URL(r.headers.get('location'), s.base).searchParams.get('e') || '');

    s.app.fetch = fakeFetch(answer(), calls);
    let r = await post({});
    assert.equal(r.status, 303);
    assert.match(r.headers.get('location'), /^\/login\?e=/);
    assert.match(failure(r), /Vérification anti-robot manquante/);
    assert.equal(await states(), 0);
    assert.equal(calls.length, 0, 'pas d\'appel à Google sans jeton');

    s.app.fetch = fakeFetch({ success: false });
    r = await post({ captcha: 'faux' });
    assert.match(failure(r), /refusée/);
    s.app.fetch = fakeFetch(answer({ score: 0.2 }));
    r = await post({ captcha: 'bot' });
    assert.match(failure(r), /suspecte/);
    s.app.fetch = fakeFetch(new Error('réseau coupé'));
    r = await post({ captcha: 'tok' });
    assert.match(failure(r), /indisponible/);
    assert.equal(await states(), 0, 'aucun état OAuth créé pour un refus');
    assert.deepEqual(r.headers.getSetCookie().filter((c) => c.startsWith('oauth_b=')), [], 'pas de cookie de liaison');

    // Origine étrangère ou absente : refus (le jeton ne suffit pas)
    s.app.fetch = fakeFetch(answer());
    r = await post({ captcha: 'ok' }, { origin: 'https://evil.example' });
    assert.match(failure(r), /Origine refusée/);
    assert.equal(await states(), 0);

    r = await post({ captcha: 'ok' });
    assert.equal(r.status, 303);
    const loc = new URL(r.headers.get('location'));
    assert.equal(loc.origin + loc.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(await states(), 1);
    assert.ok(r.headers.getSetCookie().some((c) => c.startsWith('oauth_b=')));

    // Le lien direct (GET) ne démarre plus rien tant que reCAPTCHA est actif
    r = await fetch(`${s.base}/auth/google`, { redirect: 'manual' });
    assert.equal(r.status, 303);
    assert.match(r.headers.get('location'), /^\/login\?e=/);
    assert.equal(await states(), 1);
  } finally { await s.close(); }
});

test('POST /auth/apple : mêmes règles ; sans reCAPTCHA, le démarrage reste direct', async () => {
  const apple = { teamId: 't', keyId: 'k', clientId: 'c', privateKey: 'p' };
  const s = await startApp({ cfg: { recaptcha: RC, apple } });
  const plain = await startApp({ cfg: { apple } });
  try {
    const post = (base, body) => fetch(`${base}/auth/apple`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP_URL }, body: new URLSearchParams(body).toString(),
    });
    s.app.fetch = fakeFetch(answer({ score: 0.1 }));
    assert.match((await post(s.base, { captcha: 'x' })).headers.get('location'), /^\/login\?e=/);
    s.app.fetch = fakeFetch(answer());
    const ok = await post(s.base, { captcha: 'x' });
    assert.match(ok.headers.get('location'), /^https:\/\/appleid\.apple\.com\/auth\/authorize\?/);
    // Pas de clés : le lien direct fonctionne comme avant (développement)
    const direct = await fetch(`${plain.base}/auth/apple`, { redirect: 'manual' });
    assert.match(direct.headers.get('location'), /^https:\/\/appleid\.apple\.com\/auth\/authorize\?/);
  } finally { await s.close(); await plain.close(); }
});

// ---------- Script de la page : rien avant le clic ----------

test('captcha.js : chargé tout seul à l\'ouverture, boutons actifs ensuite, puis le jeton dans le formulaire au clic', async () => {
  const s = await startApp({ cfg: { recaptcha: RC } });
  try {
    const src = await (await s.anon.get('/static/captcha.js')).text();
    assert.match(src, /api\.js\?render=/);

    // Faux DOM minimal
    const el = (extra = {}) => ({ dataset: {}, hidden: false, disabled: false, textContent: '', listeners: {}, addEventListener(n, f) { this.listeners[n] = f; }, ...extra });
    const status = el(), retry = el();
    const box = el({ dataset: { sitekey: SITE }, querySelector: (q) => (q === '[data-captcha-status]' ? status : retry) });
    const mkForm = () => {
      const button = el({ disabled: true }), input = el({ value: '' });
      const f = el({ submitted: 0, submit() { this.submitted++; }, querySelector: (q) => (q === 'button' ? button : input) });
      f.button = button; f.input = input; return f;
    };
    const forms = [mkForm(), mkForm()];
    const appended = [];
    const grecaptcha = { ready: (cb) => cb(), execute: async (k, o) => { grecaptcha.last = [k, o]; return 'jeton-xyz'; } };
    const window = { grecaptcha };
    const document = {
      querySelector: (q) => (q === '[data-captcha]' ? box : null), querySelectorAll: () => forms,
      createElement: () => ({ remove() {} }), head: { append: (n) => appended.push(n) },
    };
    vm.runInNewContext(src, { document, window, encodeURIComponent });

    assert.equal(appended.length, 1, 'le script de Google se charge tout seul, sans clic');
    assert.equal(appended[0].src, `https://www.google.com/recaptcha/api.js?render=${SITE}`);
    assert.ok(forms.every((f) => f.button.disabled), 'boutons inactifs tant que la vérification n\'est pas prête');
    appended[0].onload();
    assert.ok(forms.every((f) => f.button.disabled === false), 'boutons actifs une fois chargé');
    let prevented = 0;
    await forms[0].listeners.submit({ preventDefault: () => prevented++ });
    await new Promise((r) => setImmediate(r));
    assert.equal(prevented, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(grecaptcha.last)), [SITE, { action: 'login' }]);
    assert.equal(forms[0].input.value, 'jeton-xyz');
    assert.equal(forms[0].submitted, 1);

    // Échec du chargement (bloqueur de pub, réseau) : message et bouton « Réessayer », qui relance le chargement
    appended[0].onerror();
    assert.equal(retry.hidden, false);
    retry.listeners.click();
    assert.equal(appended.length, 2);
  } finally { await s.close(); }
});

// ---------- Pages légales ----------

test('confidentialité : le paragraphe reCAPTCHA, ses cookies et le consentement n\'apparaissent que s\'il est configuré', async () => {
  const on = await startApp({ cfg: { recaptcha: RC } });
  const off = await startApp();
  try {
    const page = async (s) => (await s.anon.get('/confidentialite', { headers: { accept: 'text/html' } })).text();
    const a = await page(on);
    for (const f of ['Google reCAPTCHA', 'chargé automatiquement', 'Base légale : l\'intérêt légitime', 'Cookies de Google reCAPTCHA', 'se charge toute seule']) {
      assert.ok(a.includes(f), f);
    }
    assert.doesNotMatch(a, /Charger la vérification anti-robot|Base légale : ton consentement/);
    assert.doesNotMatch(a, /<!--/);
    assert.match(a, /Adresse IP/);
    const b = await page(off);
    assert.doesNotMatch(b, /reCAPTCHA/);
  } finally { await on.close(); await off.close(); }
});
