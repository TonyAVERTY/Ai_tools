// Test du token GitHub : qui, quels dépôts, quels projets. GitHub est simulé par app.fetch (aucun appel réel).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { testTokenLink, addProject } from './helpers/users.js';
import { repoOfUrl, MAX_REPOS } from '../src/githubcheck.js';
import { encrypt } from '../src/crypto.js';
import { setSetting } from '../src/db.js';

let s;
const calls = [];
let github;
const FINE = 'github_pat_FINEGRAINED0123456789';
const CLASSIC = 'ghp_CLASSIC0123456789abcdef';

before(async () => {
  s = await startApp();
  s.app.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers });
    const r = github(String(url), init);
    return { ok: r.status < 400, status: r.status, headers: { get: (k) => r.headers?.[k.toLowerCase()] ?? null }, json: async () => r.json ?? {} };
  };
});
after(async () => { await s.close(); });

const repo = (full, priv = true) => ({ full_name: full, private: priv });
const happy = (repos, extra = {}) => (url) => {
  if (url.endsWith('/user')) return { status: 200, json: { login: 'tonyaverty' }, headers: extra.userHeaders };
  if (url.includes('/user/repos')) return { status: 200, json: repos, headers: extra.listHeaders };
  throw new Error(`appel inattendu : ${url}`);
};
const user = () => s.newUser({ admin: false, link: testTokenLink() });
const test_ = (u, body = {}) => u.post('/settings/github/test', body);

test('repoOfUrl : owner/repo en minuscules, seulement pour GitHub', () => {
  assert.equal(repoOfUrl('https://github.com/TonyAVERTY/Ai_tools.git'), 'tonyaverty/ai_tools');
  assert.equal(repoOfUrl('https://github.com/TonyAVERTY/Ai_tools'), 'tonyaverty/ai_tools');
  assert.equal(repoOfUrl('https://github.com/a/b/'), 'a/b');
  assert.equal(repoOfUrl('https://git.mon-serveur.fr/a/b.git'), null);
  assert.equal(repoOfUrl('https://github.com.evil.fr/a/b.git'), null);
  assert.equal(repoOfUrl('pas une url'), null);
});

test('token valide : compte, dépôts accessibles, et quels projets en font partie', async () => {
  const u = await user();
  await addProject(s.db, u.id, { name: 'Ai_tools', gitUrl: 'https://github.com/TonyAVERTY/Ai_tools.git' });
  await addProject(s.db, u.id, { name: 'Autre', gitUrl: 'https://github.com/TonyAVERTY/Autre.git' });
  await addProject(s.db, u.id, { name: 'Sur mon serveur', gitUrl: 'https://git.mon-serveur.fr/Tony/App.git' });
  github = happy([repo('TonyAVERTY/Ai_tools'), repo('TonyAVERTY/public-demo', false)], { userHeaders: { 'github-authentication-token-expiration': '2026-12-01 00:00:00 UTC' } });
  calls.length = 0;
  const r = await test_(u, { token: FINE });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.login, 'tonyaverty');
  assert.equal(j.kind, 'fine-grained');
  assert.equal(j.warning, null);
  assert.equal(j.expiresAt, '2026-12-01 00:00:00 UTC');
  assert.deepEqual(j.repos, [{ name: 'TonyAVERTY/Ai_tools', private: true }, { name: 'TonyAVERTY/public-demo', private: false }]);
  assert.equal(j.truncated, false);
  // les projets GitHub seulement : celui du serveur perso n'apparaît pas ; l'absent est dit inaccessible
  assert.deepEqual(j.projects, [
    { name: 'Ai_tools', repo: 'tonyaverty/ai_tools', access: true },
    { name: 'Autre', repo: 'tonyaverty/autre', access: false },
  ]);
  // appels : API GitHub uniquement, avec le bon en-tête, jamais le token dans l'URL
  assert.deepEqual(calls.map((c) => new URL(c.url).host), ['api.github.com', 'api.github.com']);
  assert.equal(calls[0].headers.Authorization, `Bearer ${FINE}`);
  assert.equal(calls[0].headers['User-Agent'], 'iaboss');
  assert.ok(calls.every((c) => !c.url.includes(FINE)));
  // le token n'est jamais renvoyé
  assert.ok(!JSON.stringify(j).includes(FINE));
});

test('le token tapé passe avant celui qui est enregistré, qui sert à défaut, et sans rien : 400', async () => {
  const u = await user();
  github = happy([]);
  let r = await test_(u, {});
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Aucun token à tester/);

  await setSetting(s.db, u.id, 'github_token_enc', encrypt(s.app.cfg.secretKey, 'github_pat_ENREGISTRE'));
  calls.length = 0;
  r = await test_(u, { token: '   ' });
  assert.equal(r.status, 200);
  assert.equal(calls[0].headers.Authorization, 'Bearer github_pat_ENREGISTRE', 'à défaut, le token enregistré');
  calls.length = 0;
  await test_(u, { token: FINE });
  assert.equal(calls[0].headers.Authorization, `Bearer ${FINE}`, 'le token tapé prime');
  // tester ne modifie rien : le token enregistré reste celui d'avant
  calls.length = 0;
  await test_(u, {});
  assert.equal(calls[0].headers.Authorization, 'Bearer github_pat_ENREGISTRE');
});

test('token classique : avertissement (accès à tous les dépôts, souvent en écriture)', async () => {
  const u = await user();
  github = happy([repo('a/b')], { userHeaders: { 'x-oauth-scopes': 'repo, read:org' } });
  const j = await (await test_(u, { token: CLASSIC })).json();
  assert.equal(j.kind, 'classique');
  assert.match(j.warning, /fine-grained/);
});

test('liste tronquée : on ne dit pas « inaccessible » à tort', async () => {
  const u = await user();
  await addProject(s.db, u.id, { name: 'Loin', gitUrl: 'https://github.com/TonyAVERTY/Loin.git' });
  const many = Array.from({ length: MAX_REPOS + 5 }, (_, i) => repo(`TonyAVERTY/r${i}`));
  github = happy(many, { listHeaders: { link: '<https://api.github.com/user/repos?page=2>; rel="next"' } });
  const j = await (await test_(u, { token: FINE })).json();
  assert.equal(j.truncated, true);
  assert.equal(j.repos.length, MAX_REPOS, 'borné');
  assert.deepEqual(j.projects, [{ name: 'Loin', repo: 'tonyaverty/loin', access: null }]);
});

test('refus de GitHub : message clair, sans erreur serveur, et le token n\'y figure pas', async () => {
  const u = await user();
  github = () => ({ status: 401 });
  let r = await test_(u, { token: FINE });
  assert.equal(r.status, 200);
  let j = await r.json();
  assert.equal(j.ok, false);
  assert.match(j.message, /invalide, expiré ou révoqué/);
  assert.ok(!JSON.stringify(j).includes(FINE));

  github = () => ({ status: 403 });
  j = await (await test_(u, { token: FINE })).json();
  assert.equal(j.ok, false);
  assert.match(j.message, /limite temporairement/);

  github = () => ({ status: 500 });
  r = await test_(u, { token: FINE });
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /HTTP 500/);

  s.app.fetch = async () => { throw new Error('ECONNRESET'); };
  try {
    r = await test_(u, { token: FINE });
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /Impossible de joindre GitHub/);
  } finally {
    s.app.fetch = async (url, init = {}) => { calls.push({ url: String(url), headers: init.headers }); const x = github(String(url), init); return { ok: x.status < 400, status: x.status, headers: { get: (k) => x.headers?.[k.toLowerCase()] ?? null }, json: async () => x.json ?? {} }; };
  }
});

test('cloisonnement : sans session c\'est refusé, et les projets d\'un autre compte ne sont jamais listés', async () => {
  calls.length = 0;
  const anon = await s.anon.post('/settings/github/test', { token: FINE });
  assert.ok([303, 401].includes(anon.status), `statut ${anon.status} : renvoyé vers la connexion`);
  assert.equal(calls.length, 0, 'aucun appel à GitHub sans session');
  const a = await user();
  const b = await user();
  await addProject(s.db, a.id, { name: 'Secret de A', gitUrl: 'https://github.com/A/secret.git' });
  github = happy([repo('A/secret')]);
  const j = await (await test_(b, { token: FINE })).json();
  assert.deepEqual(j.projects, [], 'B ne voit pas le projet de A');
  assert.ok(!JSON.stringify(j).includes('Secret de A'));
});

test('page : le bouton, la zone de résultat, et aucune valeur de token', async () => {
  const u = await user();
  await setSetting(s.db, u.id, 'github_token_enc', encrypt(s.app.cfg.secretKey, 'github_pat_DANS_LA_PAGE'));
  const html = await (await u.get('/settings', { headers: { accept: 'text/html' } })).text();
  assert.match(html, /data-github-test/);
  assert.match(html, /Tester ce token/);
  assert.match(html, /data-github-result role="status" aria-live="polite" hidden/);
  assert.ok(!html.includes('DANS_LA_PAGE'));
});
