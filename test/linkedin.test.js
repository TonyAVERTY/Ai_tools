// LinkedIn : connexion d'un compte à un projet (OAuth), posts écrits par Claude (direction facultative, régénération),
// publication. Aucun appel réel : LinkedIn est simulé par app.fetch, Claude par la fixture.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import { loadConfig } from '../src/config.js';
import { decrypt } from '../src/crypto.js';

const LI = { clientId: 'li-client', clientSecret: 'li-secret', redirectUri: 'https://ai.tony-averty.dev/linkedin/callback' };
const TOKEN = 'AQV-secret-token-of-linkedin-0123456789';
const PROFILE = { resume: 'Cartes de fidélité digitales.', proposition_valeur: 'Fidélisez sans carton.', arguments: ['simple'], ton: 'direct' };
let s, off;
const calls = [];
let linkedinReply = {};

before(async () => {
  s = await startApp({ worker: true, cfg: { linkedin: LI, claudeBin: resolve('test/fixtures/fake-claude.js') } });
  off = await startApp();
  s.app.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    const reply = (o) => ({ ok: (o.status ?? 200) < 400, status: o.status ?? 200, headers: { get: (k) => o.headers?.[k.toLowerCase()] ?? null }, json: async () => o.json ?? {} });
    if (u.includes('/oauth/v2/accessToken')) return reply(linkedinReply.token ?? { json: { access_token: TOKEN, expires_in: 5183999, scope: 'openid,profile,w_member_social' } });
    if (u.includes('/v2/userinfo')) return reply(linkedinReply.userinfo ?? { json: { sub: 'abc123', name: 'Tony Averty' } });
    if (u.includes('/v2/ugcPosts')) return reply(linkedinReply.post ?? { status: 201, headers: { 'x-restli-id': 'urn:li:share:123' }, json: {} });
    throw new Error(`appel inattendu : ${u}`);
  };
});
after(async () => { await s.close(); await off.close(); });

const jar = (r) => r.headers.getSetCookie().find((c) => c.startsWith('li_oauth_b='))?.split(';')[0];
const goto = (u, path, cookie) => fetch(`${s.base}${path}`, { redirect: 'manual', headers: { cookie: [u.cookie, cookie].filter(Boolean).join('; '), accept: 'text/html' } });
const location = (r) => decodeURIComponent(r.headers.get('location').replace(/\+/g, ' '));
const row = (sql, ...a) => s.db.prepare(sql).get(...a);

// Un propriétaire administrateur (accès Claude du serveur pour les jobs) avec un projet analysé
async function setup({ profile = true } = {}) {
  const owner = await s.newUser({ admin: true });
  const p = await addProject(s.db, owner.id, { name: 'Café Bzh' });
  if (profile) await s.db.prepare('UPDATE projects SET profile_json = ?, target_json = ? WHERE id = ?').run(JSON.stringify(PROFILE), JSON.stringify({ description: 'commerces' }), p);
  return { owner, p };
}
async function connect(u, p, query = {}) {
  const start = await goto(u, `/linkedin/connect?project=${p}`);
  assert.equal(start.status, 303);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  return goto(u, `/linkedin/callback?${new URLSearchParams({ code: 'code-1', state, ...query })}`, jar(start));
}
const generate = async (u, p, body = {}) => {
  const r = await u.post(`/api/projects/${p}/linkedin/generate`, body);
  if (r.status === 200) await s.app.worker.tick();
  return r;
};
const state = async (u, p) => (await u.get(`/api/projects/${p}/linkedin`)).json();

test('configuration : les deux clés ensemble, sinon LinkedIn est désactivé', async () => {
  const base = { APP_URL: 'https://x.fr', SECRET_KEY: 'a'.repeat(64), GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', DB_DRIVER: 'sqlite' };
  const keep = { ...process.env };
  const withEnv = (extra, fn) => {
    for (const k of ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_REDIRECT_URI']) delete process.env[k];
    Object.assign(process.env, base, extra);
    try { return fn(); } finally { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); }
  };
  assert.equal(withEnv({}, () => loadConfig().linkedin), null);
  assert.deepEqual(withEnv({ LINKEDIN_CLIENT_ID: 'a', LINKEDIN_CLIENT_SECRET: 'b' }, () => loadConfig().linkedin), { clientId: 'a', clientSecret: 'b', redirectUri: 'https://x.fr/linkedin/callback' });
  assert.throws(() => withEnv({ LINKEDIN_CLIENT_ID: 'a' }, loadConfig), /vont ensemble/);
  assert.throws(() => withEnv({ LINKEDIN_CLIENT_SECRET: 'b' }, loadConfig), /vont ensemble/);
});

test('sans clés LinkedIn : la section le dit, la connexion et la génération sont refusées', async () => {
  const owner = await off.newUser({ admin: true });
  const p = await addProject(off.db, owner.id, { name: 'P' });
  assert.equal((await (await owner.get(`/api/projects/${p}/linkedin`)).json()).configured, false);
  const r = await fetch(`${off.base}/linkedin/connect?project=${p}`, { redirect: 'manual', headers: { cookie: owner.cookie, accept: 'text/html' } });
  assert.match(location(r), /^\/\?li=error&m=LinkedIn n'est pas activé/);
  assert.equal((await owner.post(`/api/projects/${p}/linkedin/generate`, {})).status, 503);
});

test('connexion : vers LinkedIn avec le bon périmètre, retour contrôlé, jeton chiffré', async () => {
  const { owner, p } = await setup();
  assert.equal((await state(owner, p)).account, null);
  const start = await goto(owner, `/linkedin/connect?project=${p}`);
  const loc = new URL(start.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://www.linkedin.com/oauth/v2/authorization');
  assert.equal(loc.searchParams.get('client_id'), LI.clientId);
  assert.equal(loc.searchParams.get('redirect_uri'), LI.redirectUri);
  assert.equal(loc.searchParams.get('scope'), 'openid profile w_member_social');
  assert.match(start.headers.getSetCookie().find((c) => c.startsWith('li_oauth_b=')), /HttpOnly/);

  const cookie = jar(start);
  const st = loc.searchParams.get('state');
  const ok = await goto(owner, `/linkedin/callback?code=c1&state=${st}`, cookie);
  assert.match(location(ok), new RegExp(`^/\\?li=ok&p=${p}$`));
  const acc = (await state(owner, p)).account;
  assert.equal(acc.name, 'Tony Averty');
  assert.equal(acc.urn, 'urn:li:person:abc123');
  assert.equal(acc.expired, false);
  // Jeton chiffré en base, jamais renvoyé par l'API
  const stored = await row('SELECT token_enc FROM linkedin_accounts WHERE project_id = ?', p);
  assert.ok(!stored.token_enc.includes(TOKEN));
  assert.equal(decrypt(s.app.cfg.secretKey, stored.token_enc), TOKEN);
  assert.ok(!JSON.stringify(await state(owner, p)).includes(TOKEN));
  const exchange = calls.find((c) => c.url.includes('accessToken'));
  assert.match(String(exchange.init.body), /client_secret=li-secret/);
  assert.match(String(exchange.init.body), /code=c1/);

  // Usage unique du state
  assert.match(location(await goto(owner, `/linkedin/callback?code=c1&state=${st}`, cookie)), /^\/\?li=error/);
});

test('connexion : navigateur ou compte différent, annulation, droit de publier absent = refus sans rien enregistrer', async () => {
  const { owner, p } = await setup();
  const stranger = await s.newUser({ admin: true });
  const start = await goto(owner, `/linkedin/connect?project=${p}`);
  const st = new URL(start.headers.get('location')).searchParams.get('state');
  const bad = async (path, cookie, u = owner) => { const r = await goto(u, path, cookie); assert.match(location(r), /^\/\?li=error/, path); };
  await bad(`/linkedin/callback?code=c&state=${st}`, 'li_oauth_b=autre');
  const s2 = new URL((await goto(owner, `/linkedin/connect?project=${p}`)).headers.get('location')).searchParams.get('state');
  await bad(`/linkedin/callback?code=c&state=${s2}`, jar(start), stranger); // autre compte
  const start3 = await goto(owner, `/linkedin/connect?project=${p}`);
  await bad(`/linkedin/callback?error=user_cancelled_authorize&state=${new URL(start3.headers.get('location')).searchParams.get('state')}`, jar(start3));
  await bad('/linkedin/callback?code=c&state=inconnu', jar(start));
  // Le produit « Share on LinkedIn » manque : le périmètre accordé n'a pas w_member_social
  linkedinReply = { token: { json: { access_token: TOKEN, expires_in: 100, scope: 'openid,profile' } } };
  try { await bad(`/linkedin/callback?code=c&state=${new URL((await goto(owner, `/linkedin/connect?project=${p}`)).headers.get('location')).searchParams.get('state')}`, jar(await goto(owner, `/linkedin/connect?project=${p}`))); } catch { /* cookie propre à chaque démarrage */ }
  const st4 = await goto(owner, `/linkedin/connect?project=${p}`);
  const r = await goto(owner, `/linkedin/callback?code=c&state=${new URL(st4.headers.get('location')).searchParams.get('state')}`, jar(st4));
  assert.match(location(r), /droit de publier/);
  linkedinReply = {};
  assert.equal((await state(owner, p)).account, null, 'rien d\'enregistré');
  // Un étranger ne peut pas lancer la connexion sur le projet d'un autre
  assert.match(location(await goto(stranger, `/linkedin/connect?project=${p}`)), /Projet introuvable/);
});

test('post : sans direction Claude choisit le sujet, avec direction il la suit, « régénérer » donne un autre texte', async () => {
  const { owner, p } = await setup();
  assert.equal((await owner.post(`/api/projects/${p}/linkedin/generate`, {})).status, 400, 'il faut d\'abord un compte relié');
  await connect(owner, p);

  let r = await generate(owner, p, {});
  assert.equal(r.status, 200);
  let posts = (await state(owner, p)).posts;
  assert.equal(posts.length, 1);
  assert.match(posts[0].body, /Premier angle : sujet choisi par Claude/, 'direction vide : Claude choisit');
  assert.equal(posts[0].direction, null);
  assert.equal(posts[0].status, 'draft');

  r = await generate(owner, p, { direction: 'le lancement des cartes en version mobile' });
  assert.equal(r.status, 200);
  posts = (await state(owner, p)).posts;
  assert.equal(posts.length, 2);
  assert.match(posts[0].body, /sur le lancement des cartes en version mobile/);
  assert.equal(posts[0].direction, 'le lancement des cartes en version mobile');
  assert.match(posts[0].body, /^Autre angle/, 'régénérer : les brouillons précédents sont donnés à Claude pour changer d\'angle');
  assert.notEqual(posts[0].body, posts[1].body);

  // La direction est tronquée, et ce job compte comme un job IA
  await generate(owner, p, { direction: 'x'.repeat(900) });
  assert.equal((await state(owner, p)).posts[0].direction.length, 500);
  const job = await row("SELECT status FROM jobs WHERE project_id = ? AND type = 'linkedin_post' ORDER BY id DESC", p);
  assert.equal(job.status, 'done');
  assert.ok(Number((await row("SELECT COUNT(*) n FROM usage_events WHERE kind = 'ai_job' AND user_id = ?", owner.id)).n) >= 3);
});

test('post : projet non analysé ou connexion expirée = refus', async () => {
  const { owner, p } = await setup({ profile: false });
  await connect(owner, p);
  const r = await owner.post(`/api/projects/${p}/linkedin/generate`, {});
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Analyse le projet/);
  await s.db.prepare('UPDATE projects SET profile_json = ? WHERE id = ?').run(JSON.stringify(PROFILE), p);
  await s.db.prepare('UPDATE linkedin_accounts SET expires_at = 1 WHERE project_id = ?').run(p);
  assert.equal((await state(owner, p)).account.expired, true);
  assert.match((await (await owner.post(`/api/projects/${p}/linkedin/generate`, {})).json()).error, /expiré/);
});

test('brouillon : modifiable, texte vide ou trop long refusé, un post publié ne se modifie plus', async () => {
  const { owner, p } = await setup();
  await connect(owner, p);
  await generate(owner, p, {});
  const id = (await state(owner, p)).posts[0].id;
  assert.equal((await owner.post(`/api/projects/${p}/linkedin/post`, { postId: id, body: 'Mon texte relu\nsur deux lignes' })).status, 200);
  assert.equal((await state(owner, p)).posts[0].body, 'Mon texte relu\nsur deux lignes');
  assert.equal((await owner.post(`/api/projects/${p}/linkedin/post`, { postId: id, body: '   ' })).status, 400);
  assert.equal((await owner.post(`/api/projects/${p}/linkedin/post`, { postId: id, body: 'x'.repeat(3001) })).status, 400);
  assert.equal((await owner.post(`/api/projects/${p}/linkedin/post`, { postId: 999999, body: 'a' })).status, 404);
  // Le brouillon d'un autre projet est introuvable
  const other = await addProject(s.db, owner.id, { name: 'Autre' });
  assert.equal((await owner.post(`/api/projects/${other}/linkedin/post`, { postId: id, body: 'vol' })).status, 404);
});

test('publication : confirmation obligatoire, texte affiché = texte publié, une seule fois, erreurs sans perdre le brouillon', async () => {
  const { owner, p } = await setup();
  await connect(owner, p);
  await generate(owner, p, { direction: 'un sujet' });
  const id = (await state(owner, p)).posts[0].id;
  assert.equal((await owner.post(`/api/projects/${p}/linkedin/publish`, { postId: id })).status, 400, 'sans confirmation');
  assert.equal(calls.filter((c) => c.url.includes('ugcPosts')).length, 0);

  // LinkedIn refuse : le brouillon est conservé et peut être renvoyé
  for (const [status, re] of [[401, /reconnecte/], [403, /w_member_social/], [500, /conservé/]]) {
    linkedinReply = { post: { status } };
    const r = await owner.post(`/api/projects/${p}/linkedin/publish`, { postId: id, confirm: true });
    assert.ok(r.status >= 400, String(status));
    assert.match((await r.json()).error, re);
    assert.equal((await row('SELECT status FROM linkedin_posts WHERE id = ?', id)).status, 'draft', `${status} : brouillon conservé`);
  }
  linkedinReply = {};

  const r = await owner.post(`/api/projects/${p}/linkedin/publish`, { postId: id, confirm: true, body: 'Texte final relu.' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).remoteId, 'urn:li:share:123');
  const sent = calls.filter((c) => c.url.includes('ugcPosts')).at(-1);
  const payload = JSON.parse(sent.init.body);
  assert.equal(payload.author, 'urn:li:person:abc123');
  assert.equal(payload.specificContent['com.linkedin.ugc.ShareContent'].shareCommentary.text, 'Texte final relu.');
  assert.equal(payload.visibility['com.linkedin.ugc.MemberNetworkVisibility'], 'PUBLIC');
  assert.equal(sent.init.headers.Authorization, `Bearer ${TOKEN}`);
  const done = (await state(owner, p)).posts[0];
  assert.equal(done.status, 'published');
  assert.equal(done.body, 'Texte final relu.');
  assert.ok(done.publishedAt);
  // Pas deux fois, et plus modifiable
  assert.equal((await owner.post(`/api/projects/${p}/linkedin/publish`, { postId: id, confirm: true })).status, 409);
  assert.equal((await owner.post(`/api/projects/${p}/linkedin/post`, { postId: id, body: 'autre' })).status, 404);
  assert.equal(calls.filter((c) => c.url.includes('ugcPosts')).length, 4, '3 refus + 1 publication');
});

test('équipe : un membre génère et modifie les brouillons, seul un administrateur connecte, publie ou déconnecte', async () => {
  const { owner, p } = await setup();
  await connect(owner, p);
  await generate(owner, p, {});
  const id = (await state(owner, p)).posts[0].id;

  const member = await s.newUser({ admin: false, link: null });
  const admin = await s.newUser({ admin: false, link: null });
  const stranger = await s.newUser({ admin: false, link: null });
  await s.db.prepare("INSERT INTO teams(owner_id, name, created_at) VALUES(?, 'T', 1)").run(owner.id);
  const team = await row('SELECT id FROM teams WHERE owner_id = ?', owner.id);
  await s.db.prepare('UPDATE projects SET team_id = ? WHERE id = ?').run(team.id, p);
  await s.db.prepare("INSERT INTO team_members(team_id, user_id, role, created_at) VALUES(?, ?, 'member', 1), (?, ?, 'admin', 1)").run(team.id, member.id, team.id, admin.id);

  const m = await state(member, p);
  assert.equal(m.canManage, false);
  assert.equal(m.account.name, 'Tony Averty');
  assert.equal((await generate(member, p, { direction: 'avec l\'accès du propriétaire' })).status, 200, 'le membre génère avec l\'accès Claude du propriétaire');
  assert.equal((await member.post(`/api/projects/${p}/linkedin/post`, { postId: id, body: 'retouché par un membre' })).status, 200);
  assert.equal((await member.post(`/api/projects/${p}/linkedin/publish`, { postId: id, confirm: true })).status, 403);
  assert.equal((await member.post(`/api/projects/${p}/linkedin/disconnect`, {})).status, 403);
  assert.match(location(await goto(member, `/linkedin/connect?project=${p}`)), /^\/\?li=error/);
  // Aucun accès pour un étranger, nulle part
  // (sans accès Claude propre et sans équipe : 403 « relie ton accès » ; avec un accès, 404 — jamais de données)
  const denied = (st) => st === 404 || st === 403;
  assert.ok(denied((await stranger.get(`/api/projects/${p}/linkedin`)).status));
  assert.ok(denied((await stranger.post(`/api/projects/${p}/linkedin/publish`, { postId: id, confirm: true })).status));
  const linked = await s.newUser({ admin: true });
  assert.equal((await linked.get(`/api/projects/${p}/linkedin`)).status, 404);
  assert.equal((await linked.post(`/api/projects/${p}/linkedin/generate`, {})).status, 404);
  // L'administrateur de l'équipe peut publier, puis déconnecter
  assert.equal((await admin.post(`/api/projects/${p}/linkedin/publish`, { postId: id, confirm: true })).status, 200);
  assert.equal((await admin.post(`/api/projects/${p}/linkedin/disconnect`, {})).status, 200);
  assert.equal((await state(owner, p)).account, null);
  assert.equal((await generate(owner, p, {})).status, 400, 'déconnecté : plus de génération');
});

test('supprimer le projet efface le compte LinkedIn relié et les brouillons', async () => {
  const { owner, p } = await setup();
  await connect(owner, p);
  await generate(owner, p, {});
  assert.equal((await owner.post(`/api/projects/${p}/delete`, {})).status, 200);
  assert.equal(await row('SELECT 1 x FROM linkedin_accounts WHERE project_id = ?', p), undefined);
  assert.equal(await row('SELECT 1 x FROM linkedin_posts WHERE project_id = ?', p), undefined);
});
