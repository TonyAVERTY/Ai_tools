// LinkedIn : publier sur une PAGE (Community Management API). LinkedIn est simulé par app.fetch : aucun appel réel,
// donc ces tests vérifient ce que l'application ENVOIE et traite, pas la réponse du vrai service.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { addProject } from './helpers/users.js';
import { loadConfig } from '../src/config.js';
import { saveDraft, escapeLittleText } from '../src/linkedin.js';

const base = { clientId: 'li-client', clientSecret: 'li-secret', redirectUri: 'https://ai.tony-averty.dev/linkedin/callback', apiVersion: '202604' };
const BOTH = { ...base, scopes: ['openid', 'profile', 'w_member_social', 'w_organization_social', 'rw_organization_admin'], pages: true };
const ORG_ONLY = { ...base, scopes: ['w_organization_social', 'rw_organization_admin'], pages: true };
const PROFILE_ONLY = { ...base, scopes: ['openid', 'profile', 'w_member_social'], pages: false };
const TOKEN = 'AQV-page-token-0123456789';
const ACME = 'urn:li:organization:111';
const AITOOLS = 'urn:li:organization:222';

let both, orgOnly, plain;
const calls = [];
let world; // ce que LinkedIn répond, réglé par chaque test

const resetWorld = () => {
  world = {
    tokenScope: 'openid,profile,w_member_social,w_organization_social,rw_organization_admin',
    acls: { status: 200, json: { elements: [
      { organizationTarget: AITOOLS, roleAssignee: 'urn:li:person:abc123', role: 'ADMINISTRATOR', state: 'APPROVED' },
      { organizationTarget: ACME, roleAssignee: 'urn:li:person:abc123', role: 'ADMINISTRATOR', state: 'APPROVED' },
      { organizationTarget: AITOOLS, roleAssignee: 'urn:li:person:abc123', role: 'CONTENT_ADMINISTRATOR', state: 'APPROVED' }, // doublon
      { organizationTarget: 'pas-une-urn', roleAssignee: 'urn:li:person:abc123' },
    ] } },
    names: { 111: 'Acme Bzh', 222: 'AI_Tools' },
    post: { status: 201, headers: { 'x-restli-id': 'urn:li:share:777' }, json: {} },
  };
};

const fetchOf = () => async (url, init = {}) => {
  calls.push({ url: String(url), init });
  const u = new URL(String(url));
  const reply = (o) => ({ ok: (o.status ?? 200) < 400, status: o.status ?? 200, headers: { get: (k) => o.headers?.[k.toLowerCase()] ?? null }, json: async () => o.json ?? {} });
  if (u.pathname === '/oauth/v2/accessToken') return reply({ json: { access_token: TOKEN, expires_in: 5183999, scope: world.tokenScope } });
  if (u.pathname === '/v2/userinfo') return reply({ json: { sub: 'abc123', name: 'Tony Averty' } });
  if (u.pathname === '/rest/organizationAcls') return reply(world.acls);
  const org = /^\/rest\/organizations\/(\d+)$/.exec(u.pathname);
  if (org) return world.names[org[1]] ? reply({ json: { localizedName: world.names[org[1]] } }) : reply({ status: 403 });
  if (u.pathname === '/rest/posts') return reply(world.post);
  if (u.pathname === '/v2/ugcPosts') return reply({ status: 201, headers: { 'x-restli-id': 'urn:li:share:123' } });
  throw new Error(`appel inattendu : ${url}`);
};

before(async () => {
  [both, orgOnly, plain] = await Promise.all([startApp({ cfg: { linkedin: BOTH } }), startApp({ cfg: { linkedin: ORG_ONLY } }), startApp({ cfg: { linkedin: PROFILE_ONLY } })]);
  for (const a of [both, orgOnly, plain]) a.app.fetch = fetchOf();
  resetWorld();
});
after(async () => { await Promise.all([both.close(), orgOnly.close(), plain.close()]); });

const jar = (r) => r.headers.getSetCookie().find((c) => c.startsWith('li_oauth_b='))?.split(';')[0];
const goto = (srv, u, path, cookie) => fetch(`${srv.base}${path}`, { redirect: 'manual', headers: { cookie: [u.cookie, cookie].filter(Boolean).join('; '), accept: 'text/html' } });
const state = async (u, p) => (await u.get(`/api/projects/${p}/linkedin`)).json();

async function setup(srv) {
  resetWorld();
  const owner = await srv.newUser({ admin: true });
  const p = await addProject(srv.db, owner.id, { name: 'Projet' });
  return { owner, p };
}
async function connect(srv, u, p) {
  const start = await goto(srv, u, `/linkedin/connect?project=${p}`);
  assert.equal(start.status, 303);
  const url = new URL(start.headers.get('location'));
  const r = await goto(srv, u, `/linkedin/callback?${new URLSearchParams({ code: 'c', state: url.searchParams.get('state') })}`, jar(start));
  return { url, result: r.headers.get('location') };
}
const draft = (srv, p, body = 'Un post.') => saveDraft(srv.db, p, { body });
const publish = (u, p, id) => u.post(`/api/projects/${p}/linkedin/publish`, { postId: id, confirm: true });
const restCalls = (path) => calls.filter((c) => new URL(c.url).pathname === path);

test('configuration : droits et version réglables, défauts inchangés, fautes refusées au démarrage', () => {
  const env = { APP_URL: 'https://x.fr', SECRET_KEY: 'a'.repeat(64), GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', DB_DRIVER: 'sqlite', LINKEDIN_CLIENT_ID: 'a', LINKEDIN_CLIENT_SECRET: 'b' };
  const keep = { ...process.env };
  const cfgOf = (extra) => {
    for (const k of ['LINKEDIN_SCOPES', 'LINKEDIN_API_VERSION']) delete process.env[k];
    Object.assign(process.env, env, extra);
    try { return loadConfig().linkedin; } finally { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); }
  };
  const def = cfgOf({});
  assert.deepEqual(def.scopes, ['openid', 'profile', 'w_member_social']);
  assert.equal(def.pages, false);
  assert.equal(def.apiVersion, '202604');
  const pages = cfgOf({ LINKEDIN_SCOPES: 'w_organization_social, rw_organization_admin', LINKEDIN_API_VERSION: '202610' });
  assert.deepEqual(pages.scopes, ['w_organization_social', 'rw_organization_admin']);
  assert.equal(pages.pages, true);
  assert.equal(pages.apiVersion, '202610');
  assert.equal(cfgOf({ LINKEDIN_SCOPES: 'w_organization_social' }).pages, false, 'sans droit de lister les pages : pas de choix possible');
  assert.equal(cfgOf({ LINKEDIN_SCOPES: 'openid w_member_social w_organization_social r_organization_admin' }).pages, true);
  assert.throws(() => cfgOf({ LINKEDIN_SCOPES: 'openid w_member_social w_organisation_social' }), /droits inconnus \(w_organisation_social\)/);
  assert.throws(() => cfgOf({ LINKEDIN_SCOPES: 'openid profile' }), /w_member_social.*w_organization_social/);
  assert.throws(() => cfgOf({ LINKEDIN_API_VERSION: '2026-04' }), /AAAAMM/);
});

test('texte de post : les caractères réservés de l\'API Posts sont échappés, les hashtags restent', () => {
  assert.equal(escapeLittleText('Bonjour (équipe) #ia #prospection'), 'Bonjour \\(équipe\\) #ia #prospection');
  assert.equal(escapeLittleText('a | b {c} [d] <e> @f * _ ~ \\'), 'a \\| b \\{c\\} \\[d\\] \\<e\\> \\@f \\* \\_ \\~ \\\\');
  assert.equal(escapeLittleText('# seul'), '\\# seul');
  assert.equal(escapeLittleText('50 % de remise, 3 € : ok.'), '50 % de remise, 3 € : ok.');
});

test('connexion : les droits demandés sont ceux de la configuration, et ceux accordés sont retenus', async () => {
  const { owner, p } = await setup(both);
  const { url, result } = await connect(both, owner, p);
  assert.equal(url.searchParams.get('scope'), 'openid profile w_member_social w_organization_social rw_organization_admin');
  assert.match(result, new RegExp(`li=ok&p=${p}`));
  const st = await state(owner, p);
  assert.equal(st.pagesEnabled, true);
  assert.equal(st.account.canPersonal, true);
  assert.equal(st.account.canPages, true);
  assert.equal(st.account.target, null);
  assert.equal(st.account.name, 'Tony Averty');

  // l'utilisateur refuse les droits « page » : la connexion marche pour le profil, sans les pages
  const second = await setup(both);
  world.tokenScope = 'openid,profile,w_member_social';
  await connect(both, second.owner, second.p);
  const refused = (await state(second.owner, second.p)).account;
  assert.equal(refused.canPersonal, true);
  assert.equal(refused.canPages, false);
});

test('pages : la liste vient de LinkedIn (doublons et valeurs invalides écartés), avec les bons en-têtes, puis du cache', async () => {
  const { owner, p } = await setup(both);
  await connect(both, owner, p);
  calls.length = 0;
  const r = await owner.get(`/api/projects/${p}/linkedin/pages`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.pages, [{ urn: ACME, name: 'Acme Bzh' }, { urn: AITOOLS, name: 'AI_Tools' }], 'triées par nom');
  assert.equal(j.target, null);
  const acl = restCalls('/rest/organizationAcls');
  assert.equal(acl.length, 1);
  assert.equal(new URL(acl[0].url).searchParams.get('q'), 'roleAssignee');
  assert.equal(new URL(acl[0].url).searchParams.get('state'), 'APPROVED');
  assert.equal(acl[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(acl[0].init.headers['X-Restli-Protocol-Version'], '2.0.0');
  assert.equal(acl[0].init.headers['Linkedin-Version'], '202604');
  assert.equal(calls.filter((c) => c.url.includes('/rest/organizations/')).length, 2, 'un nom par page distincte');
  // cache : pas de nouvel appel ; « actualiser » en refait un
  calls.length = 0;
  await owner.get(`/api/projects/${p}/linkedin/pages`);
  assert.equal(calls.length, 0);
  await owner.get(`/api/projects/${p}/linkedin/pages?refresh=1`);
  assert.equal(restCalls('/rest/organizationAcls').length, 1);
  // un nom introuvable n'empêche pas de choisir la page
  world.names = { 111: 'Acme Bzh' };
  const j2 = await (await owner.get(`/api/projects/${p}/linkedin/pages?refresh=1`)).json();
  assert.deepEqual(j2.pages.map((x) => x.name).sort(), ['Acme Bzh', 'Page 222']);
});

test('pages : refus clairs (service sans droits pages, compte relié sans le droit, LinkedIn refuse, jeton expiré)', async () => {
  // le service n'a pas activé les pages
  const a = await setup(plain);
  await connect(plain, a.owner, a.p);
  const off = await a.owner.get(`/api/projects/${a.p}/linkedin/pages`);
  assert.equal(off.status, 400);
  assert.match((await off.json()).error, /n'est pas activé sur ce service/);
  assert.equal((await state(a.owner, a.p)).pagesEnabled, false);

  // compte relié avant l'activation des pages : il doit se reconnecter
  const b = await setup(both);
  world.tokenScope = 'openid,profile,w_member_social';
  await connect(both, b.owner, b.p);
  let r = await b.owner.get(`/api/projects/${b.p}/linkedin/pages`);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /reconnecte-le/);
  r = await b.owner.post(`/api/projects/${b.p}/linkedin/target`, { urn: ACME });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /reconnecte-le/);

  // LinkedIn refuse de lister (pas d'accès Community Management API) ou le jeton est périmé
  const c = await setup(both);
  await connect(both, c.owner, c.p);
  world.acls = { status: 403 };
  r = await c.owner.get(`/api/projects/${c.p}/linkedin/pages?refresh=1`);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Community Management API/);
  world.acls = { status: 401 };
  r = await c.owner.get(`/api/projects/${c.p}/linkedin/pages?refresh=1`);
  assert.match((await r.json()).error, /expiré ou révoqué/);
  await both.db.prepare('UPDATE linkedin_accounts SET expires_at = 1 WHERE project_id = ?').run(c.p);
  assert.match((await (await c.owner.get(`/api/projects/${c.p}/linkedin/pages?refresh=1`)).json()).error, /a expiré/);
});

test('cible : une page n\'est acceptée que si LinkedIn la compte parmi celles du compte, le nom vient de LinkedIn, « me » revient au profil', async () => {
  const { owner, p } = await setup(both);
  await connect(both, owner, p);
  const target = (body) => owner.post(`/api/projects/${p}/linkedin/target`, body);

  let r = await target({ urn: AITOOLS, name: 'Nom truqué' });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).target, { urn: AITOOLS, name: 'AI_Tools' });
  assert.deepEqual((await state(owner, p)).account.target, { urn: AITOOLS, name: 'AI_Tools' });

  r = await target({ urn: 'urn:li:organization:999' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /pas parmi celles que tu administres/);
  r = await target({ urn: 'urn:li:person:abc123' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /invalide/);
  assert.equal((await target({ urn: "urn:li:organization:1' OR 1=1" })).status, 400);
  assert.deepEqual((await state(owner, p)).account.target, { urn: AITOOLS, name: 'AI_Tools' }, 'un refus ne change rien');

  assert.equal((await target({ urn: 'me' })).status, 200);
  assert.equal((await state(owner, p)).account.target, null);
  // une page ajoutée sur LinkedIn après la mise en cache est vue (la liste est relue une fois)
  world.acls = { status: 200, json: { elements: [{ organizationTarget: 'urn:li:organization:333', roleAssignee: 'urn:li:person:abc123' }, { organizationTarget: AITOOLS }] } };
  world.names[333] = 'Nouvelle page';
  assert.equal((await target({ urn: 'urn:li:organization:333' })).status, 200);
  assert.equal((await state(owner, p)).account.target.name, 'Nouvelle page');
});

test('publication sur une page : /rest/posts, texte échappé, nom conservé ; sans page choisie le profil reste inchangé', async () => {
  const { owner, p } = await setup(both);
  await connect(both, owner, p);

  // sans cible : le profil, par l'ancienne route, comme avant
  calls.length = 0;
  let id = await draft(both, p, 'Sur mon profil.');
  assert.equal((await publish(owner, p, id)).status, 200);
  assert.equal(restCalls('/v2/ugcPosts').length, 1);
  assert.equal(restCalls('/rest/posts').length, 0);
  assert.equal(JSON.parse(restCalls('/v2/ugcPosts')[0].init.body).author, 'urn:li:person:abc123');

  // avec une page : l'API Posts, l'auteur est la page
  await owner.post(`/api/projects/${p}/linkedin/target`, { urn: AITOOLS });
  calls.length = 0;
  id = await draft(both, p, 'Offre (2026) : -20 % #prospection [en savoir plus] @moi');
  const r = await publish(owner, p, id);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.remoteId, 'urn:li:share:777');
  assert.equal(j.publishedOn, 'AI_Tools');
  assert.equal(restCalls('/v2/ugcPosts').length, 0, 'rien ne part sur le profil');
  const sent = restCalls('/rest/posts');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].init.method, 'POST');
  assert.equal(sent[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(sent[0].init.headers['Linkedin-Version'], '202604');
  assert.equal(sent[0].init.headers['X-Restli-Protocol-Version'], '2.0.0');
  assert.equal(sent[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(sent[0].init.body), {
    author: AITOOLS, commentary: 'Offre \\(2026\\) : -20 % #prospection \\[en savoir plus\\] \\@moi', visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
  });
  // l'historique dit où le post est parti
  const posts = (await state(owner, p)).posts;
  assert.equal(posts[0].publishedOn, 'AI_Tools');
  assert.equal(posts[1].publishedOn, null);
  // une seule fois
  assert.equal((await publish(owner, p, id)).status, 409);
});

test('publication sur une page : refus de LinkedIn (rôle, jeton, quota), le brouillon est gardé', async () => {
  const { owner, p } = await setup(both);
  await connect(both, owner, p);
  await owner.post(`/api/projects/${p}/linkedin/target`, { urn: ACME });
  const id = await draft(both, p, 'Texte');
  for (const [status, re] of [[403, /« Acme Bzh ».*rôle.*w_organization_social/], [401, /reconnecte/], [429, /limite/], [500, /conservé/]]) {
    world.post = { status };
    const r = await publish(owner, p, id);
    assert.ok(r.status >= 400, String(status));
    assert.match((await r.json()).error, re, String(status));
    assert.equal((await both.db.prepare('SELECT status FROM linkedin_posts WHERE id = ?').get(id)).status, 'draft', `${status} : brouillon gardé`);
  }
});

test('application « Community Management API » seule (sans OpenID) : le compte est identifié par ses pages, il faut choisir une page', async () => {
  const { owner, p } = await setup(orgOnly);
  world.tokenScope = 'w_organization_social,rw_organization_admin';
  calls.length = 0;
  const { url } = await connect(orgOnly, owner, p);
  assert.equal(url.searchParams.get('scope'), 'w_organization_social rw_organization_admin');
  assert.equal(calls.filter((c) => c.url.includes('/v2/userinfo')).length, 0, 'pas de profil OpenID demandé');
  const acc = (await state(owner, p)).account;
  assert.equal(acc.urn, 'urn:li:person:abc123', 'l\'identifiant du membre vient de ses droits sur les pages');
  assert.equal(acc.name, 'compte LinkedIn');
  assert.equal(acc.canPersonal, false);
  assert.equal(acc.canPages, true);

  // pas de profil possible : il faut une page
  const id = await draft(orgOnly, p, 'Texte');
  let r = await publish(owner, p, id);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /choisis une page/);
  r = await owner.post(`/api/projects/${p}/linkedin/target`, { urn: 'me' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /choisis une page/);

  assert.equal((await owner.post(`/api/projects/${p}/linkedin/target`, { urn: AITOOLS })).status, 200);
  r = await publish(owner, p, id);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).publishedOn, 'AI_Tools');
});

test('application « Community Management API » seule : sans aucune page administrée, la connexion est refusée sans rien enregistrer', async () => {
  const { owner, p } = await setup(orgOnly);
  world.tokenScope = 'w_organization_social,rw_organization_admin';
  world.acls = { status: 200, json: { elements: [] } };
  const { result } = await connect(orgOnly, owner, p);
  assert.match(decodeURIComponent(result.replace(/\+/g, ' ')), /^\/\?li=error.*identifier le compte/);
  assert.equal((await state(owner, p)).account, null);
});

test('droits : seul un administrateur du projet liste les pages et choisit la cible ; un étranger n\'a rien', async () => {
  const { owner, p } = await setup(both);
  await connect(both, owner, p);
  const member = await both.newUser({ admin: false, link: null });
  const stranger = await both.newUser({ admin: true });
  await both.db.prepare("INSERT INTO teams(owner_id, name, created_at) VALUES(?, 'T', 1)").run(owner.id);
  const team = await both.db.prepare('SELECT id FROM teams WHERE owner_id = ?').get(owner.id);
  await both.db.prepare('UPDATE projects SET team_id = ? WHERE id = ?').run(team.id, p);
  await both.db.prepare("INSERT INTO team_members(team_id, user_id, role, created_at) VALUES(?, ?, 'member', 1)").run(team.id, member.id);

  calls.length = 0;
  assert.equal((await member.get(`/api/projects/${p}/linkedin/pages`)).status, 403);
  assert.equal((await member.post(`/api/projects/${p}/linkedin/target`, { urn: ACME })).status, 403);
  assert.equal((await stranger.get(`/api/projects/${p}/linkedin/pages`)).status, 404);
  assert.equal((await stranger.post(`/api/projects/${p}/linkedin/target`, { urn: ACME })).status, 404);
  assert.equal((await both.anon.get(`/api/projects/${p}/linkedin/pages`)).status, 401);
  assert.equal(calls.length, 0, 'aucun appel à LinkedIn pour un refus');
  // le membre voit où partent les posts, sans pouvoir le changer
  const m = await state(member, p);
  assert.equal(m.canManage, false);
  assert.equal(m.pagesEnabled, true);
});

test('page : le sélecteur « Publier sur » est servi par le front, sans style en ligne ; le token n\'est jamais dans les réponses', async () => {
  const { owner, p } = await setup(both);
  await connect(both, owner, p);
  await owner.post(`/api/projects/${p}/linkedin/target`, { urn: AITOOLS });
  for (const path of [`/api/projects/${p}/linkedin`, `/api/projects/${p}/linkedin/pages`]) {
    assert.ok(!(await (await owner.get(path)).text()).includes(TOKEN), path);
  }
  const js = await (await fetch(`${both.base}/static/app.js`)).text();
  assert.match(js, /data-li-pages/);
  assert.match(js, /data-li-target-save/);
  assert.match(js, /Publier sur \$\{esc\(acc\.target \? acc\.target\.name : 'LinkedIn'\)\}/);
});
