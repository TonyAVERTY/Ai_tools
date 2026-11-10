// Instagram : connexion d'un compte professionnel à un projet (OAuth), publication et programmation d'un brouillon de Communication (post ou story),
// renouvellement du jeton. Aucun appel réel : Meta est simulé par app.fetch, la conversion JPEG par app.toJpeg.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import { loadConfig } from '../src/config.js';
import { decrypt } from '../src/crypto.js';
import { saveDraft } from '../src/contentdrafts.js';
import { publishDueInstagram, refreshInstagramTokens } from '../src/instagram.js';

const IG = { appId: '1805917243982329', appSecret: 'ig-secret', configId: '2203028057765474', redirectUri: 'https://ai.tony-averty.dev/instagram/callback', apiVersion: 'v23.0', publicBase: 'https://ai.tony-averty.dev' };
const LONG = 'EAAB-long-token-0123456789';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
let s, off;
let calls = [];
let reply = {};
const GRANTED = () => ({ data: { scopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list'], granular_scopes: [{ scope: 'instagram_basic', target_ids: ['1784140000'] }, { scope: 'instagram_content_publish', target_ids: ['1784140000'] }], expires_at: Math.floor(Date.now() / 1000) + 5183944 } });
let mediaSeen = null;

before(async () => {
  s = await startApp({ cfg: { instagram: IG } });
  off = await startApp();
  s.app.toJpeg = async () => JPG;
  s.app.instagramPollMs = 0;
  s.app.fetch = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null;
    calls.push({ url: u, body });
    const res = (o) => ({ ok: (o.status ?? 200) < 400, status: o.status ?? 200, headers: { get: () => null }, json: async () => o.json ?? {} });
    if (u.includes('/oauth/access_token?') && u.includes('fb_exchange_token')) return res(reply.long ?? { json: { access_token: LONG, token_type: 'bearer', expires_in: 5183944 } });
    if (u.includes('/oauth/access_token?')) return res(reply.token ?? { json: { access_token: 'EAAB-short', token_type: 'bearer', expires_in: 3600 } });
    if (u.includes('/debug_token?')) return res(reply.debug ?? { json: GRANTED() });
    if (/\/me\?/.test(u)) return res(reply.identity ?? { json: { id: '10001' } });
    if (u.includes('/me/accounts?')) return res(reply.accounts ?? { json: { data: [] } });
    if (/\/1784140000\?fields=username/.test(u)) return res(reply.me ?? { json: { username: 'cafe_bzh', id: '1784140000' } });
    if (/\/media$/.test(u)) {
      // Instagram va chercher l'image à l'adresse donnée : elle doit être servie, sans session, en JPEG
      const img = await fetch(body.image_url.replace(IG.publicBase, s.base));
      mediaSeen = { status: img.status, type: img.headers.get('content-type'), len: (await img.arrayBuffer()).byteLength };
      return res(reply.container ?? { json: { id: '17900000000000001' } });
    }
    if (u.includes('/17900000000000001?')) return res(reply.status ?? { json: { status_code: 'FINISHED' } });
    if (/\/media_publish$/.test(u)) return res(reply.publish ?? { json: { id: '18000000000000002' } });
    if (u.includes('/18000000000000002?')) return res({ json: { permalink: 'https://www.instagram.com/p/ABC123/' } });
    throw new Error(`appel inattendu : ${u}`);
  };
});
after(async () => { await s.close(); await off.close(); });

const jar = (r) => r.headers.getSetCookie().find((c) => c.startsWith('ig_oauth_b='))?.split(';')[0];
const goto = (u, path, cookie) => fetch(`${s.base}${path}`, { redirect: 'manual', headers: { cookie: [u.cookie, cookie].filter(Boolean).join('; '), accept: 'text/html' } });
const location = (r) => decodeURIComponent(r.headers.get('location').replace(/\+/g, ' '));
const row = (sql, ...a) => s.db.prepare(sql).get(...a);
const reset = () => { calls = []; reply = {}; mediaSeen = null; };

async function setup() {
  reset();
  const owner = await s.newUser({ admin: true });
  const p = await addProject(s.db, owner.id, { name: 'Café Bzh' });
  return { owner, p };
}
async function connect(u, p, query = {}) {
  const start = await goto(u, `/instagram/connect?project=${p}`);
  assert.equal(start.status, 303);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  return goto(u, `/instagram/callback?${new URLSearchParams({ code: 'code-1#_', state, ...query })}`, jar(start));
}
const draft = (p, extra = {}, body = 'Une légende pour le café.') => saveDraft(s.db, p, 'instagram', { body, extra: { hashtags: ['#cafe', '#bzh'], format: 'carre', width: 1080, height: 1080, ...extra }, image: PNG });
const view = async (u, p) => (await (await u.get(`/api/projects/${p}/content/instagram`)).json());

test('configuration : les trois variables Meta ensemble, sinon Instagram est désactivé', async () => {
  const base = { APP_URL: 'https://x.fr', SECRET_KEY: 'a'.repeat(64), GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', DB_DRIVER: 'sqlite' };
  const keep = { ...process.env };
  const withEnv = (extra, fn) => {
    for (const k of ['META_APP_ID', 'META_APP_SECRET', 'META_LOGIN_CONFIG_ID', 'META_REDIRECT_URI', 'META_API_VERSION']) delete process.env[k];
    Object.assign(process.env, base, extra);
    try { return fn(); } finally { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); }
  };
  const ok = { META_APP_ID: '1805917243982329', META_APP_SECRET: 'b', META_LOGIN_CONFIG_ID: '2203028057765474' };
  assert.equal(withEnv({}, () => loadConfig().instagram), null);
  assert.deepEqual(withEnv(ok, () => loadConfig().instagram), { appId: '1805917243982329', appSecret: 'b', configId: '2203028057765474', redirectUri: 'https://x.fr/instagram/callback', apiVersion: 'v23.0', publicBase: 'https://x.fr' });
  assert.throws(() => withEnv({ META_APP_ID: '1805917243982329' }, loadConfig), /vont ensemble/);
  assert.throws(() => withEnv({ ...ok, META_LOGIN_CONFIG_ID: '' }, loadConfig), /vont ensemble/);
  assert.throws(() => withEnv({ ...ok, META_APP_ID: 'abc' }, loadConfig), /META_APP_ID/);
  assert.throws(() => withEnv({ ...ok, META_API_VERSION: 'latest' }, loadConfig), /META_API_VERSION/);
});

test('sans clés Instagram : la section le dit, la connexion et la publication sont refusées', async () => {
  const owner = await off.newUser({ admin: true });
  const p = await addProject(off.db, owner.id, { name: 'P' });
  assert.equal((await (await owner.get(`/api/projects/${p}/content/instagram`)).json()).instagram.configured, false);
  const r = await fetch(`${off.base}/instagram/connect?project=${p}`, { redirect: 'manual', headers: { cookie: owner.cookie, accept: 'text/html' } });
  assert.match(location(r), new RegExp(`^/p/${p}/communication\\?ig=error&m=Instagram n'est pas activé`));
  assert.equal((await owner.post(`/api/projects/${p}/instagram/publish`, { draftId: 1, confirm: true })).status, 503);
});

test('connexion : vers Meta avec la configuration, retour contrôlé, jeton chiffré, compte et droit exigés', async () => {
  const { owner, p } = await setup();
  assert.equal((await view(owner, p)).instagram.account, null);
  const start = await goto(owner, `/instagram/connect?project=${p}`);
  const loc = new URL(start.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://www.facebook.com/dialog/oauth');
  assert.equal(loc.searchParams.get('client_id'), IG.appId);
  assert.equal(loc.searchParams.get('redirect_uri'), IG.redirectUri);
  assert.equal(loc.searchParams.get('config_id'), IG.configId, 'les droits viennent de la configuration de connexion');
  assert.equal(loc.searchParams.get('response_type'), 'code');
  assert.equal(loc.searchParams.get('override_default_response_type'), 'true');
  assert.equal(loc.searchParams.get('prompt'), 'login');
  assert.equal(loc.searchParams.get('scope'), null);
  assert.match(start.headers.getSetCookie().find((c) => c.startsWith('ig_oauth_b=')), /HttpOnly/);

  const st = loc.searchParams.get('state');
  const ok = await goto(owner, `/instagram/callback?code=c1&state=${st}`, jar(start));
  assert.equal(location(ok), `/p/${p}/communication?ig=ok`);
  const acc = (await view(owner, p)).instagram.account;
  assert.equal(acc.username, 'cafe_bzh');
  assert.equal(acc.userId, '1784140000');
  assert.equal(acc.expired, false);
  // Le code est échangé, puis le jeton de 60 jours demandé avec le secret, puis les droits et le compte lus chez Meta
  assert.ok(calls.some((c) => c.url.includes('/oauth/access_token?') && c.url.includes('code=c1') && !c.url.includes('fb_exchange_token')));
  assert.ok(calls.some((c) => c.url.includes('fb_exchange_token=EAAB-short') && c.url.includes('client_secret=ig-secret')));
  assert.ok(calls.some((c) => c.url.includes('/debug_token?') && c.url.includes(`access_token=${IG.appId}%7Cig-secret`)));
  // Jeton chiffré en base, jamais renvoyé par l'API
  const enc = (await row('SELECT token_enc FROM instagram_accounts WHERE project_id = ?', p)).token_enc;
  assert.ok(!enc.includes(LONG));
  assert.equal(decrypt(s.app.cfg.secretKey, enc), LONG);
  assert.ok(!JSON.stringify(await view(owner, p)).includes(LONG));
  // Le state est à usage unique
  assert.match(location(await goto(owner, `/instagram/callback?code=c1&state=${st}`, jar(start))), /ig=error/);

  // Aucun compte Instagram autorisé : refusé, avec le remède
  reset(); reply.debug = { json: { data: { scopes: ['instagram_content_publish'], granular_scopes: [], expires_at: 0 } } };
  assert.match(location(await connect(owner, p)), /ig=error&m=Aucun compte Instagram professionnel/);
  // Le compte retrouvé par la Page Facebook quand la configuration ne désigne aucun élément
  reset(); reply.debug = { json: { data: { scopes: ['instagram_content_publish'], granular_scopes: [], expires_at: 0 } } };
  reply.accounts = { json: { data: [{ id: '1', instagram_business_account: { id: '1784140000', username: 'cafe_bzh' } }] } };
  assert.equal(location(await connect(owner, p)), `/p/${p}/communication?ig=ok`);
  assert.equal((await view(owner, p)).instagram.account.expiresAt, null, 'un jeton qui n\'expire pas (expires_at 0) n\'a pas de date');
  // Connexion par Instagram : l'identité de la personne est elle-même le compte (id + nom d'utilisateur)
  reset(); reply.debug = { json: { data: { scopes: ['instagram_content_publish'], granular_scopes: [], expires_at: 0 } } };
  reply.identity = { json: { id: '1784140000', username: 'cafe_bzh' } };
  assert.equal(location(await connect(owner, p)), `/p/${p}/communication?ig=ok`);
  assert.equal((await view(owner, p)).instagram.account.userId, '1784140000');
  // Le droit de publier n'a pas été accordé
  reset(); reply.debug = { json: { data: { scopes: ['instagram_basic'], granular_scopes: [{ scope: 'instagram_basic', target_ids: ['1784140000'] }] } } };
  assert.match(location(await connect(owner, p)), /instagram_content_publish/);
});

test('connexion : autre navigateur, autre compte, refus et annulation sont refusés', async () => {
  const { owner, p } = await setup();
  const start = await goto(owner, `/instagram/connect?project=${p}`);
  const st = new URL(start.headers.get('location')).searchParams.get('state');
  // Sans le cookie du navigateur qui a démarré la connexion
  assert.match(location(await goto(owner, `/instagram/callback?code=c&state=${st}`)), /autre navigateur/);
  // Un autre compte
  const other = await s.newUser({});
  const st2 = new URL((await goto(owner, `/instagram/connect?project=${p}`)).headers.get('location')).searchParams.get('state');
  assert.match(location(await goto(other, `/instagram/callback?code=c&state=${st2}`)), /ig=error/);
  // Un compte qui n'est pas administrateur du projet ne peut pas lancer la connexion
  assert.match(location(await goto(other, `/instagram/connect?project=${p}`)), /ig=error/);
  // Annulation par l'utilisateur
  const st3 = new URL((await goto(owner, `/instagram/connect?project=${p}`)).headers.get('location')).searchParams.get('state');
  assert.match(location(await goto(owner, `/instagram/callback?error=access_denied&state=${st3}`)), /Connexion Instagram annulée/);
  assert.equal(Number((await row('SELECT COUNT(*) n FROM instagram_accounts WHERE project_id = ?', p)).n), 0);
});

test('publier un post : conteneur avec la légende et les hashtags, image JPEG servie sans session, publication, adresse du post', async () => {
  const { owner, p } = await setup();
  await connect(owner, p);
  const id = await draft(p);
  calls = [];
  assert.equal((await owner.post(`/api/projects/${p}/instagram/publish`, { draftId: id, as: 'post' })).status, 400, 'sans confirmation rien ne part');
  const r = await owner.post(`/api/projects/${p}/instagram/publish`, { draftId: id, as: 'post', confirm: true });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).permalink, 'https://www.instagram.com/p/ABC123/');
  const create = calls.find((c) => /\/1784140000\/media$/.test(c.url));
  assert.match(create.body.image_url, /^https:\/\/ai\.tony-averty\.dev\/ig-media\/[A-Za-z0-9_-]{20,}\.jpg$/);
  assert.equal(create.body.caption, 'Une légende pour le café.\n\n#cafe #bzh');
  assert.equal(create.body.media_type, undefined);
  assert.equal(create.body.access_token, LONG);
  assert.deepEqual(mediaSeen, { status: 200, type: 'image/jpeg', len: JPG.length });
  assert.ok(calls.some((c) => /\/media_publish$/.test(c.url) && c.body.creation_id === '17900000000000001'));
  const d = (await view(owner, p)).drafts[0];
  assert.equal(d.status, 'published');
  assert.equal(d.publishAs, 'post');
  assert.equal(d.permalink, 'https://www.instagram.com/p/ABC123/');
  // Pas deux fois, et plus modifiable
  assert.equal((await owner.post(`/api/projects/${p}/instagram/publish`, { draftId: id, confirm: true })).status, 409);
  assert.equal((await owner.post(`/api/projects/${p}/content/instagram/edit`, { draftId: id, body: 'autre' })).status, 409);
  // L'image n'est plus accessible sous un jeton inconnu
  assert.equal((await fetch(`${s.base}/ig-media/inconnu.jpg`)).status, 404);
});

test('publier une story : l\'image seule, sans légende', async () => {
  const { owner, p } = await setup();
  await connect(owner, p);
  const id = await draft(p, { format: 'story', height: 1920 });
  calls = [];
  assert.equal((await owner.post(`/api/projects/${p}/instagram/publish`, { draftId: id, as: 'story', confirm: true })).status, 200);
  const create = calls.find((c) => /\/media$/.test(c.url));
  assert.equal(create.body.media_type, 'STORIES');
  assert.equal(create.body.caption, undefined);
  assert.equal((await view(owner, p)).drafts[0].publishAs, 'story');
});

test('échecs : jeton refusé, image refusée, pas de compte, pas d\'image ; le brouillon revient avec la raison et peut repartir', async () => {
  const { owner, p } = await setup();
  const id = await draft(p);
  assert.match(await (await owner.post(`/api/projects/${p}/instagram/publish`, { draftId: id, confirm: true })).text(), /Aucun compte Instagram/);
  await connect(owner, p);
  reply.container = { status: 400, json: { error: { message: 'Invalid OAuth access token', code: 190 } } };
  const r = await owner.post(`/api/projects/${p}/instagram/publish`, { draftId: id, confirm: true });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /reconnecte le compte/);
  let d = (await view(owner, p)).drafts[0];
  assert.equal(d.status, 'draft');
  assert.match(d.publishError, /reconnecte le compte/);
  // Instagram prépare l'image mais échoue
  reply = { status: { json: { status_code: 'ERROR', status: 'Error: Media upload has failed with error code 2207026' } } };
  assert.match(await (await owner.post(`/api/projects/${p}/instagram/publish`, { draftId: id, confirm: true })).text(), /n'a pas pu préparer l'image/);
  // Réessai : tout passe
  reply = {};
  assert.equal((await owner.post(`/api/projects/${p}/instagram/publish`, { draftId: id, confirm: true })).status, 200);
  // Sans image
  await s.db.prepare("UPDATE content_drafts SET image = NULL WHERE id = ?").run(id);
  const id2 = await saveDraft(s.db, p, 'instagram', { body: 'sans image', extra: {} });
  assert.match(await (await owner.post(`/api/projects/${p}/instagram/publish`, { draftId: id2, confirm: true })).text(), /pas d'image/);
});

test('programmer : le brouillon se verrouille, part à l\'heure dite, se déprogramme ; une date trop proche est refusée', async () => {
  const { owner, p } = await setup();
  await connect(owner, p);
  const id = await draft(p);
  const t = Math.floor(Date.now() / 1000);
  assert.equal((await owner.post(`/api/projects/${p}/instagram/schedule`, { draftId: id, at: t + 60, confirm: true })).status, 400);
  assert.equal((await owner.post(`/api/projects/${p}/instagram/schedule`, { draftId: id, at: t + 3600 })).status, 400, 'confirmation requise');
  assert.equal((await owner.post(`/api/projects/${p}/instagram/schedule`, { draftId: id, as: 'story', at: t + 3600, confirm: true })).status, 200);
  let d = (await view(owner, p)).drafts[0];
  assert.equal(d.status, 'scheduled');
  assert.equal(d.publishAs, 'story');
  assert.equal((await owner.post(`/api/projects/${p}/content/instagram/edit`, { draftId: id, body: 'x' })).status, 409);
  // Avant l'heure : rien ne part
  calls = [];
  assert.deepEqual(await publishDueInstagram(s.app, { at: t + 1800 }), { published: 0, failed: 0 });
  assert.equal(calls.length, 0);
  // Annuler la programmation
  assert.equal((await owner.post(`/api/projects/${p}/instagram/unschedule`, { draftId: id })).status, 200);
  assert.equal((await view(owner, p)).drafts[0].status, 'draft');
  // Reprogrammer, puis l'heure passe
  await owner.post(`/api/projects/${p}/instagram/schedule`, { draftId: id, as: 'post', at: t + 3600, confirm: true });
  assert.deepEqual(await publishDueInstagram(s.app, { at: t + 3700 }), { published: 1, failed: 0 });
  d = (await view(owner, p)).drafts[0];
  assert.equal(d.status, 'published');
  assert.equal(d.publishAs, 'post');
  assert.deepEqual(await publishDueInstagram(s.app, { at: t + 3800 }), { published: 0, failed: 0 }, 'jamais deux fois');
});

test('programmation qui échoue : retour en brouillon avec la raison, une notification, pas de nouvel essai', async () => {
  const { owner, p } = await setup();
  await connect(owner, p);
  const id = await draft(p);
  const t = Math.floor(Date.now() / 1000);
  await owner.post(`/api/projects/${p}/instagram/schedule`, { draftId: id, at: t + 3600, confirm: true });
  reply.container = { status: 400, json: { error: { message: 'Invalid OAuth access token', code: 190 } } };
  assert.deepEqual(await publishDueInstagram(s.app, { at: t + 3700 }), { published: 0, failed: 1 });
  const d = (await view(owner, p)).drafts[0];
  assert.equal(d.status, 'draft');
  assert.equal(d.scheduledAt, null);
  assert.match(d.publishError, /reconnecte/);
  assert.deepEqual(await publishDueInstagram(s.app, { at: t + 3800 }), { published: 0, failed: 0 });
});

test('déconnexion : le compte part, ce qui était programmé repasse en brouillon avec la raison', async () => {
  const { owner, p } = await setup();
  await connect(owner, p);
  const id = await draft(p);
  await owner.post(`/api/projects/${p}/instagram/schedule`, { draftId: id, at: Math.floor(Date.now() / 1000) + 3600, confirm: true });
  assert.equal((await owner.post(`/api/projects/${p}/instagram/disconnect`, {})).status, 200);
  const v = await view(owner, p);
  assert.equal(v.instagram.account, null);
  assert.equal(v.drafts[0].status, 'draft');
  assert.match(v.drafts[0].publishError, /déconnecté/);
});

test('jeton : renouvelé quand il expire dans moins de 10 jours, pas avant ; un échec prévient', async () => {
  const { owner, p } = await setup();
  await connect(owner, p);
  const t = Math.floor(Date.now() / 1000);
  calls = [];
  assert.deepEqual(await refreshInstagramTokens(s.app, { at: t + 86400 * 2 }), { refreshed: 0, failed: 0 }, 'trop tôt : il lui reste ~58 jours');
  await s.db.prepare('UPDATE instagram_accounts SET expires_at = ?, refreshed_at = ? WHERE project_id = ?').run(t + 5 * 86400, t - 3 * 86400, p);
  reply.long = { json: { access_token: 'EAAB-refreshed', expires_in: 5183944 } };
  assert.deepEqual(await refreshInstagramTokens(s.app, { at: t }), { refreshed: 1, failed: 0 });
  const r = await row('SELECT token_enc, expires_at FROM instagram_accounts WHERE project_id = ?', p);
  assert.equal(decrypt(s.app.cfg.secretKey, r.token_enc), 'EAAB-refreshed');
  assert.ok(r.expires_at > t + 50 * 86400);
  // Échec : prévenu, et pas de nouvel essai avant 24 h
  await s.db.prepare('UPDATE instagram_accounts SET expires_at = ?, refreshed_at = ? WHERE project_id = ?').run(t + 5 * 86400, t - 3 * 86400, p);
  reply.long = { status: 400, json: { error: { message: 'token invalide', code: 190 } } };
  assert.deepEqual(await refreshInstagramTokens(s.app, { at: t }), { refreshed: 0, failed: 1 });
  assert.deepEqual(await refreshInstagramTokens(s.app, { at: t + 3600 }), { refreshed: 0, failed: 0 });
});

test('isolation : un autre compte ne voit ni ne publie le brouillon d\'un projet qui n\'est pas le sien', async () => {
  const { owner, p } = await setup();
  await connect(owner, p);
  const id = await draft(p);
  const other = await s.newUser({});
  assert.equal((await other.post(`/api/projects/${p}/instagram/publish`, { draftId: id, confirm: true })).status, 404);
  assert.equal((await other.get(`/api/projects/${p}/content/instagram`)).status, 404);
});
