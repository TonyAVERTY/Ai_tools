// LinkedIn : un compte LinkedIn relié à un projet (OAuth, jeton chiffré), des brouillons de posts écrits par Claude, et la
// publication sur le profil relié. Rien n'est publié sans un clic explicite d'un administrateur du projet.
// API officielle : OAuth 2 « Sign In with LinkedIn using OpenID Connect » (profil) + « Share on LinkedIn » (w_member_social).
// Publier sur une PAGE (Community Management API : w_organization_social, rw_organization_admin) est possible quand l'application
// a ces droits (LINKEDIN_SCOPES) ; sinon tout reste comme avant, sur le profil.
import { createHash, timingSafeEqual } from 'node:crypto';
import { now } from './db.js';
import { encrypt, decrypt, randomId } from './crypto.js';
import { HttpError, parseCookies, setCookie, redirect } from './http.js';

const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const POST_URL = 'https://api.linkedin.com/v2/ugcPosts';
const REST = 'https://api.linkedin.com/rest';
const ORG_URN = /^urn:li:organization:\d{1,20}$/;
const PAGES_TTL = 600; // la liste des pages est mise en cache : les paliers d'accès de LinkedIn comptent chaque appel
const MAX_PAGES = 20;
const pagesCache = new Map(); // projet → { at, pages }
const STATE_TTL = 600;
const COOKIE = 'li_oauth_b';
const COOKIE_PATH = '/linkedin';
export const MAX_POST = 3000;
export const NOT_CONFIGURED = "LinkedIn n'est pas activé sur ce service (l'administrateur doit renseigner LINKEDIN_CLIENT_ID et LINKEDIN_CLIENT_SECRET).";

const hashBind = (v) => createHash('sha256').update(String(v)).digest('hex');
const fail = (status, message) => new HttpError(status, message, { expose: true });
export const linkedinAvailable = (cfg) => !!cfg.linkedin;

/** Compte LinkedIn relié au projet (sans le jeton), ou null. `expired` : le jeton (60 jours) n'est plus valable. */
export async function linkedinAccount(db, projectId) {
  const r = await db.prepare('SELECT project_id, member_urn, name, expires_at, connected_by, created_at, scope, target_urn, target_name FROM linkedin_accounts WHERE project_id = ?').get(Number(projectId));
  if (!r) return null;
  const scopes = scopeList(r.scope);
  return {
    projectId: Number(r.project_id), urn: r.member_urn, name: r.name || 'compte LinkedIn', expiresAt: r.expires_at, connectedAt: r.created_at, expired: !!r.expires_at && r.expires_at <= now(),
    // Ce que le compte relié a le droit de faire : publier sur le profil, sur des pages (et lister celles qu'il administre)
    canPersonal: scopes.includes('w_member_social'), canPages: scopes.includes('w_organization_social') && hasAnyScope(scopes, ['rw_organization_admin', 'r_organization_admin']),
    // Où part la publication : une page choisie, sinon le profil
    target: r.target_urn ? { urn: r.target_urn, name: r.target_name || 'page LinkedIn' } : null,
  };
}

export async function disconnectLinkedin(db, projectId) {
  pagesCache.delete(Number(projectId));
  await db.prepare('DELETE FROM linkedin_accounts WHERE project_id = ?').run(Number(projectId));
}

// LinkedIn renvoie les droits accordés séparés par des virgules (ou des espaces selon l'étape)
const scopeList = (s) => String(s ?? '').split(/[\s,]+/).filter(Boolean);
const hasAnyScope = (list, wanted) => wanted.some((w) => list.includes(w));
const restHeaders = (cfg, token) => ({ Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0', 'Linkedin-Version': cfg.linkedin.apiVersion });

/**
 * Le format de texte des posts de l'API Posts réserve | { } @ [ ] ( ) < > # \\ * _ ~ : sans échappement, le texte est tronqué ou refusé.
 * Un # suivi d'une lettre ou d'un chiffre reste un hashtag.
 */
export function escapeLittleText(text) {
  return String(text).replace(/[\\|{}@[\]()<>*_~]|#(?![\p{L}\p{N}])/gu, (c) => `\\${c}`);
}

// ---------- Brouillons ----------

export async function saveDraft(db, projectId, { body, direction = '' }) {
  const r = await db.prepare("INSERT INTO linkedin_posts(project_id, direction, body, status, created_at) VALUES(?, ?, ?, 'draft', ?)")
    .run(Number(projectId), String(direction).slice(0, 500) || null, String(body).slice(0, MAX_POST), now());
  return Number(r.lastInsertRowid);
}

/** Derniers corps de posts (brouillons et publiés) : donnés à Claude pour que « Régénérer » change vraiment de post. */
export async function recentDrafts(db, projectId, n = 4) {
  return (await db.prepare('SELECT body FROM linkedin_posts WHERE project_id = ? ORDER BY id DESC LIMIT ?').all(Number(projectId), n)).map((r) => r.body);
}

export async function listPosts(db, projectId, n = 10) {
  return (await db.prepare('SELECT id, direction, body, status, remote_id, created_at, published_at, author_name FROM linkedin_posts WHERE project_id = ? ORDER BY id DESC LIMIT ?').all(Number(projectId), n))
    .map((r) => ({ id: Number(r.id), direction: r.direction, body: r.body, status: r.status, remoteId: r.remote_id, createdAt: r.created_at, publishedAt: r.published_at, publishedOn: r.author_name || null }));
}

/** Modifie le texte d'un brouillon (jamais d'un post déjà publié). */
export async function editDraft(db, projectId, postId, body) {
  const text = String(body ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) throw fail(400, 'Le post est vide');
  if (text.length > MAX_POST) throw fail(400, `LinkedIn limite un post à ${MAX_POST} caractères (il en fait ${text.length}).`);
  const r = await db.prepare("UPDATE linkedin_posts SET body = ? WHERE id = ? AND project_id = ? AND status = 'draft'").run(text, Number(postId), Number(projectId));
  if (!r.changes) throw fail(404, 'Brouillon introuvable (ou déjà publié)');
}

// ---------- Connexion OAuth ----------

/** Démarre la connexion : state lié au compte, au projet et à ce navigateur, puis redirection vers LinkedIn. */
export async function startLinkedin(app, userId, projectId, res) {
  const { cfg, db } = app;
  if (!cfg.linkedin) throw fail(503, NOT_CONFIGURED);
  const state = randomId(24);
  const bind = randomId(24);
  await db.prepare('INSERT INTO oauth_states(state, provider, verifier, nonce, binding, created_at) VALUES(?, ?, ?, ?, ?, ?)')
    .run(state, 'linkedin', 'none', `${Number(userId)}:${Number(projectId)}`, hashBind(bind), now());
  setCookie(res, COOKIE, bind, { maxAge: STATE_TTL, path: COOKIE_PATH });
  const q = new URLSearchParams({ response_type: 'code', client_id: cfg.linkedin.clientId, redirect_uri: cfg.linkedin.redirectUri, state, scope: cfg.linkedin.scopes.join(' ') });
  redirect(res, `${AUTH_URL}?${q}`);
}

async function call(app, url, init, what) {
  let r;
  try { r = await (app.fetch || fetch)(url, { ...init, signal: AbortSignal.timeout(15_000) }); }
  catch { throw fail(502, `Impossible de joindre LinkedIn (${what}). Réessaie dans un instant.`); }
  return r;
}

/**
 * Retour de LinkedIn. `checkAccess(projectId)` vérifie que le compte peut encore régler ce projet (administrateur au moins).
 * Contrôles : state connu, à usage unique, non expiré, émis pour CE compte et CE navigateur.
 * @returns {Promise<number>} l'identifiant du projet relié
 */
export async function finishLinkedin(app, userId, params, req, res, checkAccess) {
  const { cfg, db } = app;
  const state = params.get('state');
  const row = state ? await db.prepare('SELECT * FROM oauth_states WHERE state = ? AND created_at > ?').get(String(state), now() - STATE_TTL) : null;
  if (state) await db.prepare('DELETE FROM oauth_states WHERE state = ?').run(String(state));
  setCookie(res, COOKIE, '', { maxAge: 0, path: COOKIE_PATH });
  if (!cfg.linkedin) throw fail(503, NOT_CONFIGURED);

  const [ownerId, projectId] = String(row?.nonce ?? '').split(':').map(Number);
  if (params.get('error')) throw fail(400, params.get('error') === 'user_cancelled_authorize' || params.get('error') === 'user_cancelled_login' ? 'Connexion LinkedIn annulée.' : 'LinkedIn a refusé la connexion.');
  if (!params.get('code') || !state) throw fail(400, 'Retour de LinkedIn incomplet : recommence.');
  if (!row || row.provider !== 'linkedin' || ownerId !== Number(userId) || !projectId) throw fail(400, 'Connexion expirée ou lancée depuis un autre compte : recommence.');
  const bind = parseCookies(req)[COOKIE];
  const a = Buffer.from(hashBind(bind || ''));
  const b = Buffer.from(String(row.binding));
  if (!bind || a.length !== b.length || !timingSafeEqual(a, b)) throw fail(400, 'Connexion lancée depuis un autre navigateur : recommence.');
  await checkAccess(projectId);

  const tok = await call(app, TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: String(params.get('code')), redirect_uri: cfg.linkedin.redirectUri,
      client_id: cfg.linkedin.clientId, client_secret: cfg.linkedin.clientSecret,
    }),
  }, 'échange du code');
  if (!tok.ok) throw fail(tok.status >= 500 ? 502 : 400, 'LinkedIn a refusé le code (expiré ou déjà utilisé). Recommence.');
  const t = await tok.json().catch(() => null);
  if (typeof t?.access_token !== 'string' || !t.access_token) throw fail(502, "Réponse inattendue de LinkedIn : la connexion n'a pas pu être terminée.");
  // Les droits réellement accordés (l'utilisateur peut en refuser) : au moins publier sur le profil, ou sur une page
  const granted = scopeList(t.scope ?? cfg.linkedin.scopes.join(' '));
  if (!hasAnyScope(granted, ['w_member_social', 'w_organization_social'])) throw fail(400, "LinkedIn n'a pas accordé le droit de publier (produit « Share on LinkedIn » ou « Community Management API » absent de l'application ?).");

  // Qui est ce compte : son profil si l'application a OpenID ; sinon (application « Community Management API » seule) l'identifiant
  // du membre qui figure dans ses droits d'accès aux pages
  let memberId;
  let name = null;
  if (granted.includes('openid')) {
    const me = await call(app, USERINFO_URL, { headers: { Authorization: `Bearer ${t.access_token}` } }, 'lecture du profil');
    if (!me.ok) throw fail(502, 'LinkedIn n\'a pas donné le profil du compte. Réessaie.');
    const info = await me.json().catch(() => null);
    if (!info?.sub) throw fail(502, 'Profil LinkedIn illisible. Réessaie.');
    memberId = String(info.sub).slice(0, 80);
    name = String(info.name || '').slice(0, 200) || null;
  } else {
    const acl = await call(app, `${REST}/organizationAcls?q=roleAssignee&state=APPROVED&count=1`, { headers: restHeaders(cfg, t.access_token) }, 'identification du compte');
    const first = acl.ok ? (await acl.json().catch(() => null))?.elements?.[0] : null;
    memberId = /^urn:li:person:(.{1,80})$/.exec(String(first?.roleAssignee ?? ''))?.[1];
    if (!memberId) throw fail(502, "LinkedIn n'a pas permis d'identifier le compte (aucune page administrée ?). Réessaie, ou vérifie que tu administres une page.");
  }

  pagesCache.delete(projectId);
  await db.prepare('DELETE FROM linkedin_accounts WHERE project_id = ?').run(projectId);
  await db.prepare('INSERT INTO linkedin_accounts(project_id, member_urn, name, token_enc, expires_at, connected_by, created_at, scope) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
    .run(projectId, `urn:li:person:${memberId}`, name, encrypt(cfg.secretKey, t.access_token),
      Number(t.expires_in) > 0 ? now() + Number(t.expires_in) : null, Number(userId), now(), granted.join(' '));
  return projectId;
}

// ---------- Pages ----------

/** Compte relié, jeton déchiffré : les mêmes contrôles pour lister les pages et publier. */
async function accountToken(app, projectId) {
  const acc = await app.db.prepare('SELECT member_urn, token_enc, expires_at, scope, target_urn, target_name FROM linkedin_accounts WHERE project_id = ?').get(Number(projectId));
  if (!acc) throw fail(400, "Aucun compte LinkedIn n'est relié à ce projet");
  if (acc.expires_at && acc.expires_at <= now()) throw fail(400, 'La connexion LinkedIn a expiré (elle dure 60 jours) : reconnecte le compte.');
  let token;
  try { token = decrypt(app.cfg.secretKey, acc.token_enc); } catch { token = null; }
  if (!token) throw fail(400, 'Le jeton LinkedIn est illisible : reconnecte le compte.');
  return { acc, token, scopes: scopeList(acc.scope) };
}

const refusal = (r, what) => {
  if (r.status === 401) return fail(400, 'LinkedIn a refusé le jeton (expiré ou révoqué) : reconnecte le compte.');
  if (r.status === 429) return fail(429, 'LinkedIn limite les appels : réessaie plus tard.');
  return fail(502, `LinkedIn n'a pas répondu normalement (${what}, HTTP ${r.status}). Réessaie plus tard.`);
};

/**
 * Les pages que le compte relié administre (urn, nom). Mises en cache 10 minutes ; `refresh` force un nouvel appel.
 * Un nom introuvable n'empêche pas de publier : la page s'affiche avec son numéro.
 * @returns {Promise<{urn:string, name:string}[]>}
 */
export async function listLinkedinPages(app, projectId, { refresh = false } = {}) {
  const cached = pagesCache.get(Number(projectId));
  if (!refresh && cached && now() - cached.at < PAGES_TTL) return cached.pages;
  const { token, scopes } = await accountToken(app, projectId);
  if (!hasAnyScope(scopes, ['rw_organization_admin', 'r_organization_admin'])) throw fail(400, "Ce compte a été relié sans le droit de voir tes pages : reconnecte-le pour l'autoriser.");
  const r = await call(app, `${REST}/organizationAcls?q=roleAssignee&state=APPROVED&count=50`, { headers: restHeaders(app.cfg, token) }, 'liste des pages');
  if (r.status === 403) throw fail(400, "LinkedIn refuse de lister tes pages : l'application n'a pas l'accès « Community Management API », ou tu n'administres aucune page.");
  if (!r.ok) throw refusal(r, 'liste des pages');
  const body = await r.json().catch(() => null);
  const urns = [...new Set((body?.elements ?? []).map((e) => String(e?.organizationTarget ?? e?.organization ?? '')).filter((u) => ORG_URN.test(u)))].slice(0, MAX_PAGES);
  const pages = await Promise.all(urns.map(async (urn) => {
    const id = urn.split(':').pop();
    try {
      const o = await call(app, `${REST}/organizations/${id}`, { headers: restHeaders(app.cfg, token) }, 'nom de la page');
      const info = o.ok ? await o.json().catch(() => null) : null;
      return { urn, name: String(info?.localizedName ?? info?.vanityName ?? '').slice(0, 200) || `Page ${id}` };
    } catch { return { urn, name: `Page ${id}` }; }
  }));
  pages.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  pagesCache.set(Number(projectId), { at: now(), pages });
  return pages;
}

/**
 * Choisit où partent les publications : une page, ou le profil (`urn` = 'me'). Une page n'est acceptée que si LinkedIn
 * la compte parmi celles que ce compte administre (liste relue ici, jamais crue sur parole).
 */
export async function setLinkedinTarget(app, projectId, urn) {
  const { db } = app;
  const { scopes } = await accountToken(app, projectId);
  if (!urn || urn === 'me') {
    if (!scopes.includes('w_member_social')) throw fail(400, "Ce compte n'a pas le droit de publier sur ton profil : choisis une page.");
    await db.prepare('UPDATE linkedin_accounts SET target_urn = NULL, target_name = NULL WHERE project_id = ?').run(Number(projectId));
    return null;
  }
  if (!ORG_URN.test(String(urn))) throw fail(400, 'Page LinkedIn invalide');
  if (!scopes.includes('w_organization_social')) throw fail(400, "Ce compte a été relié sans le droit de publier sur une page : reconnecte-le pour l'autoriser.");
  let page = (await listLinkedinPages(app, projectId)).find((p) => p.urn === urn);
  page ??= (await listLinkedinPages(app, projectId, { refresh: true })).find((p) => p.urn === urn); // la liste en cache a pu vieillir
  if (!page) throw fail(400, "Cette page n'est pas parmi celles que tu administres sur LinkedIn.");
  await db.prepare('UPDATE linkedin_accounts SET target_urn = ?, target_name = ? WHERE project_id = ?').run(page.urn, page.name, Number(projectId));
  return page;
}

// ---------- Publication ----------

/**
 * Publie un brouillon : sur la page choisie, sinon sur le profil relié. Une fois publié, il ne peut plus l'être une deuxième fois.
 * @returns {Promise<{remoteId:string|null, publishedOn:string|null}>} `publishedOn` : le nom de la page, null pour le profil
 */
export async function publishPost(app, projectId, postId) {
  const { db } = app;
  const post = await db.prepare('SELECT id, body, status FROM linkedin_posts WHERE id = ? AND project_id = ?').get(Number(postId), Number(projectId));
  if (!post) throw fail(404, 'Brouillon introuvable');
  if (post.status !== 'draft') throw fail(409, 'Ce post est déjà publié');
  const { acc, token, scopes } = await accountToken(app, projectId);
  const toPage = !!acc.target_urn;
  if (toPage && !ORG_URN.test(acc.target_urn)) throw fail(400, 'La page choisie est invalide : choisis-la de nouveau.');
  if (toPage && !scopes.includes('w_organization_social')) throw fail(400, "Ce compte n'a pas le droit de publier sur une page : reconnecte-le.");
  if (!toPage && !scopes.includes('w_member_social')) throw fail(400, "Ce compte n'a pas le droit de publier sur ton profil : choisis une page où publier.");
  // Verrou : on marque d'abord le brouillon pour qu'un double clic ne publie jamais deux fois
  const lock = await db.prepare("UPDATE linkedin_posts SET status = 'publishing' WHERE id = ? AND status = 'draft'").run(post.id);
  if (!lock.changes) throw fail(409, 'Publication déjà en cours');
  const unlock = () => db.prepare("UPDATE linkedin_posts SET status = 'draft' WHERE id = ?").run(post.id);

  const r = await (toPage
    ? call(app, `${REST}/posts`, {
      method: 'POST',
      headers: { ...restHeaders(app.cfg, token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: acc.target_urn, commentary: escapeLittleText(post.body), visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
      }),
    }, 'publication')
    : call(app, POST_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
      body: JSON.stringify({
        author: acc.member_urn, lifecycleState: 'PUBLISHED',
        specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: post.body }, shareMediaCategory: 'NONE' } },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
    }, 'publication')).catch(async (e) => { await unlock(); throw e; });

  if (!r.ok) {
    await unlock();
    if (r.status === 401) throw fail(400, 'LinkedIn a refusé le jeton (expiré ou révoqué) : reconnecte le compte.');
    if (r.status === 403) {
      throw fail(400, toPage
        ? `LinkedIn refuse la publication sur « ${acc.target_name || 'cette page'} » : ton rôle sur la page ne le permet pas, ou l'application n'a pas le droit « Community Management API » (w_organization_social).`
        : "LinkedIn refuse la publication : l'application n'a pas le droit « Share on LinkedIn » (w_member_social).");
    }
    if (r.status === 429) throw fail(429, 'LinkedIn limite les publications : réessaie plus tard.');
    throw fail(502, `LinkedIn n'a pas publié le post (HTTP ${r.status}). Le brouillon est conservé, réessaie plus tard.`);
  }
  const remote = r.headers?.get?.('x-restli-id') || (await r.json().catch(() => null))?.id || null;
  const publishedOn = toPage ? (acc.target_name || 'page LinkedIn') : null;
  await db.prepare("UPDATE linkedin_posts SET status = 'published', remote_id = ?, published_at = ?, author_name = ? WHERE id = ?")
    .run(remote ? String(remote).slice(0, 200) : null, now(), publishedOn, post.id);
  return { remoteId: remote, publishedOn };
}
