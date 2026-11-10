// Instagram : un compte professionnel relié à un projet (API « Instagram avec connexion Instagram », OAuth 2, jeton chiffré), puis publication ou
// programmation d'un post ou d'une story à partir d'un brouillon de la section Communication. Rien ne part sans un clic explicite d'un administrateur.
// Publier se fait en trois temps : créer un « conteneur » média (Instagram va chercher l'image à une adresse publique), attendre qu'il soit prêt, le publier.
// L'API n'accepte que le JPEG : le PNG du brouillon est converti, puis servi quelques minutes sous une adresse secrète (/ig-media/<jeton>.jpg).
import { createHash, timingSafeEqual } from 'node:crypto';
import { now } from './db.js';
import { encrypt, decrypt, randomId } from './crypto.js';
import { HttpError, parseCookies, setCookie, redirect } from './http.js';
import { notify } from './services/notify.js';
import { pngToJpeg } from './services/stillimage.js';
import { INSTAGRAM_FORMATS, getDraft, getImage } from './contentdrafts.js';

const AUTH_URL = 'https://www.instagram.com/oauth/authorize';
const TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const GRAPH = 'https://graph.instagram.com';
export const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];
const STATE_TTL = 600;
const COOKIE = 'ig_oauth_b';
const COOKIE_PATH = '/instagram';
const MEDIA_TTL = 15 * 60;          // une image reste servie 15 minutes au plus : le temps qu'Instagram la récupère
const REFRESH_WITHIN = 10 * 86400;  // un jeton (60 jours) est renouvelé quand il lui reste moins de 10 jours
const REFRESH_AFTER = 86400;        // Instagram ne renouvelle un jeton qu'après 24 h
export const SCHEDULE_MIN_SECONDS = 5 * 60;
export const SCHEDULE_MAX_SECONDS = 75 * 86400; // l'API d'Instagram ne garde pas de programmation : c'est iaboss qui publie, au plus ~75 jours plus tard
export const NOT_CONFIGURED = "Instagram n'est pas activé sur ce service (l'administrateur doit renseigner INSTAGRAM_APP_ID et INSTAGRAM_APP_SECRET).";

const hashBind = (v) => createHash('sha256').update(String(v)).digest('hex');
const fail = (status, message) => new HttpError(status, message, { expose: true });
export const instagramAvailable = (cfg) => !!cfg.instagram;

// Images servies à Instagram : jeton → { jpg, exp }. En mémoire (jamais écrites en clair ailleurs), perdues au redémarrage (la publication en cours échoue et revient en brouillon).
const media = new Map();
function putMedia(jpg) {
  const t = now();
  for (const [k, v] of media) if (v.exp <= t) media.delete(k);
  const token = randomId(24);
  media.set(token, { jpg, exp: t + MEDIA_TTL });
  return token;
}
export function getMedia(token) {
  const m = media.get(String(token));
  if (!m || m.exp <= now()) { media.delete(String(token)); return null; }
  return m.jpg;
}

/** Compte relié au projet (sans le jeton), ou null. `expired` : le jeton n'est plus valable, il faut reconnecter. */
export async function instagramAccount(db, projectId) {
  const r = await db.prepare('SELECT project_id, ig_user_id, username, account_type, expires_at, created_at FROM instagram_accounts WHERE project_id = ?').get(Number(projectId));
  if (!r) return null;
  return { projectId: Number(r.project_id), userId: r.ig_user_id, username: r.username || '', type: r.account_type || '', expiresAt: r.expires_at ? Number(r.expires_at) : null, connectedAt: Number(r.created_at), expired: !!r.expires_at && Number(r.expires_at) <= now() };
}

export async function disconnectInstagram(db, projectId) {
  await db.prepare('DELETE FROM instagram_accounts WHERE project_id = ?').run(Number(projectId));
  // Ce qui était programmé ne peut plus partir : retour en brouillon, avec la raison
  await db.prepare("UPDATE content_drafts SET status = 'draft', scheduled_at = NULL, publish_error = ? WHERE project_id = ? AND kind = 'instagram' AND status = 'scheduled'")
    .run('Le compte Instagram a été déconnecté : la programmation est annulée.', Number(projectId));
}

async function call(app, url, init, what) {
  let r;
  try { r = await (app.fetch || fetch)(url, { ...init, signal: AbortSignal.timeout(20_000) }); }
  catch { throw fail(502, `Impossible de joindre Instagram (${what}). Réessaie dans un instant.`); }
  return r;
}

/** Ce que dit Instagram d'une erreur : sa raison (courte), et le remède quand on le connaît. */
export async function graphError(r, what) {
  const body = await r.json().catch(() => null);
  const e = body?.error ?? {};
  const code = Number(e.code);
  const why = String(e.error_user_msg || e.message || '').replace(/\s+/g, ' ').slice(0, 220);
  if (r.status === 401 || code === 190) return fail(400, 'Instagram a refusé le jeton (expiré ou révoqué) : reconnecte le compte.');
  if (code === 4 || code === 17 || code === 32 || code === 613 || r.status === 429) return fail(429, 'Instagram limite les appels : réessaie plus tard.');
  if (code === 9 || /limit/i.test(why) && /publish|post/i.test(why)) return fail(400, `Instagram limite le nombre de publications par jour${why ? ` (${why})` : ''} : réessaie demain.`);
  if (code === 10 || code === 200 || r.status === 403) return fail(400, `Instagram refuse l'action (${what}) : l'application n'a pas le droit de publier (instagram_business_content_publish), ou le compte n'est pas professionnel${why ? ` — ${why}` : ''}.`);
  if (code === 9004 || code === 9007 || (code === 100 && Number(e.error_subcode) >= 2207000)) return fail(400, `Instagram n'a pas accepté l'image${why ? ` : ${why}` : ''}. Vérifie son format et que le service est joignable depuis Internet.`);
  return fail(502, `Instagram n'a pas répondu normalement (${what}, HTTP ${r.status}${why ? ` : ${why}` : ''}). Réessaie plus tard.`);
}

/** Retour d'Instagram refusant la connexion : la cause et le remède. */
export function refusalMessage(code, why, redirectUri) {
  if (code === 'access_denied') return 'Connexion Instagram annulée (ou refusée).';
  if (/redirect/i.test(`${code} ${why}`)) return `Instagram refuse l'adresse de retour. Dans developers.facebook.com → ton application → Instagram → Configuration de l'API avec la connexion Instagram → « Configurer la connexion d'entreprise », ajoute exactement cette adresse dans « URL de redirection OAuth » : ${redirectUri}`;
  if (/invalid_client|unauthorized_client/i.test(code)) return "Instagram ne reconnaît pas l'application : vérifie INSTAGRAM_APP_ID et INSTAGRAM_APP_SECRET dans le .env du serveur (ceux de l'application Instagram, pas ceux de l'application Meta).";
  if (/scope/i.test(`${code} ${why}`)) return "Instagram refuse un des droits demandés : ajoute le produit « Instagram » à l'application et les droits instagram_business_basic et instagram_business_content_publish.";
  return `Instagram a refusé la connexion (${code}${why ? ` : ${why}` : ''}).`;
}

// ---------- Connexion OAuth ----------

/** Démarre la connexion : state lié au compte, au projet et à ce navigateur, puis redirection vers Instagram. */
export async function startInstagram(app, userId, projectId, res) {
  const { cfg, db } = app;
  if (!cfg.instagram) throw fail(503, NOT_CONFIGURED);
  const state = randomId(24);
  const bind = randomId(24);
  await db.prepare('INSERT INTO oauth_states(state, provider, verifier, nonce, binding, created_at) VALUES(?, ?, ?, ?, ?, ?)')
    .run(state, 'instagram', 'none', `${Number(userId)}:${Number(projectId)}`, hashBind(bind), now());
  setCookie(res, COOKIE, bind, { maxAge: STATE_TTL, path: COOKIE_PATH });
  const q = new URLSearchParams({ client_id: cfg.instagram.appId, redirect_uri: cfg.instagram.redirectUri, response_type: 'code', scope: SCOPES.join(','), state });
  redirect(res, `${AUTH_URL}?${q}`);
}

/**
 * Retour d'Instagram : mêmes contrôles que LinkedIn (state connu, à usage unique, non expiré, émis pour CE compte et CE navigateur), puis échange du code
 * contre un jeton court, du jeton court contre un jeton de 60 jours, et lecture du profil.
 * @returns {Promise<number>} l'identifiant du projet relié
 */
export async function finishInstagram(app, userId, params, req, res, checkAccess) {
  const { cfg, db } = app;
  const state = params.get('state');
  const row = state ? await db.prepare('SELECT * FROM oauth_states WHERE state = ? AND created_at > ?').get(String(state), now() - STATE_TTL) : null;
  if (state) await db.prepare('DELETE FROM oauth_states WHERE state = ?').run(String(state));
  setCookie(res, COOKIE, '', { maxAge: 0, path: COOKIE_PATH });
  if (!cfg.instagram) throw fail(503, NOT_CONFIGURED);

  const [ownerId, projectId] = String(row?.nonce ?? '').split(':').map(Number);
  if (params.get('error')) {
    const code = String(params.get('error')).slice(0, 80);
    const why = String(params.get('error_description') ?? params.get('error_reason') ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200);
    if (code !== 'access_denied') console.warn(`[instagram] connexion refusée par Instagram : ${code}${why ? ` : ${why}` : ''}`);
    throw fail(400, refusalMessage(code, why, cfg.instagram.redirectUri));
  }
  if (!params.get('code') || !state) throw fail(400, "Retour d'Instagram incomplet : recommence.");
  if (!row || row.provider !== 'instagram' || ownerId !== Number(userId) || !projectId) throw fail(400, 'Connexion expirée ou lancée depuis un autre compte : recommence.');
  const bind = parseCookies(req)[COOKIE];
  const a = Buffer.from(hashBind(bind || ''));
  const b = Buffer.from(String(row.binding));
  if (!bind || a.length !== b.length || !timingSafeEqual(a, b)) throw fail(400, 'Connexion lancée depuis un autre navigateur : recommence.');
  await checkAccess(projectId);

  // Instagram renvoie parfois « # _ » collé au code
  const code = String(params.get('code')).replace(/#_$/, '');
  const tok = await call(app, TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.instagram.appId, client_secret: cfg.instagram.appSecret, grant_type: 'authorization_code', redirect_uri: cfg.instagram.redirectUri, code }),
  }, 'échange du code');
  if (!tok.ok) throw fail(tok.status >= 500 ? 502 : 400, "Instagram a refusé le code (expiré ou déjà utilisé) ou l'adresse de retour ne correspond pas. Recommence.");
  const t0 = await tok.json().catch(() => null);
  const short = Array.isArray(t0?.data) ? t0.data[0] : t0; // deux formes de réponse selon la version
  if (typeof short?.access_token !== 'string' || !short.access_token) throw fail(502, "Réponse inattendue d'Instagram : la connexion n'a pas pu être terminée.");
  const granted = String(short.permissions ?? '').split(/[\s,]+/).filter(Boolean);
  if (granted.length && !granted.includes('instagram_business_content_publish')) throw fail(400, "Instagram n'a pas accordé le droit de publier : recommence et accepte tous les droits demandés.");

  const lt = await call(app, `${GRAPH}/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: cfg.instagram.appSecret, access_token: short.access_token })}`, {}, 'jeton de 60 jours');
  if (!lt.ok) throw await graphError(lt, 'jeton de 60 jours');
  const long = await lt.json().catch(() => null);
  if (typeof long?.access_token !== 'string') throw fail(502, "Réponse inattendue d'Instagram (jeton de 60 jours).");

  const me = await call(app, `${GRAPH}/${cfg.instagram.apiVersion}/me?${new URLSearchParams({ fields: 'user_id,username,account_type', access_token: long.access_token })}`, {}, 'lecture du profil');
  if (!me.ok) throw await graphError(me, 'lecture du profil');
  const info = await me.json().catch(() => null);
  const igId = String(info?.user_id ?? info?.id ?? short.user_id ?? '').replace(/\D/g, '').slice(0, 30);
  if (!igId) throw fail(502, "Instagram n'a pas donné l'identifiant du compte. Réessaie.");
  if (info?.account_type && !/BUSINESS|MEDIA_CREATOR/i.test(String(info.account_type))) throw fail(400, 'Ce compte Instagram est personnel : passe-le en compte professionnel (Instagram → Paramètres → Type de compte et outils), puis recommence.');

  await db.prepare('DELETE FROM instagram_accounts WHERE project_id = ?').run(projectId);
  await db.prepare('INSERT INTO instagram_accounts(project_id, ig_user_id, username, account_type, token_enc, expires_at, connected_by, created_at, refreshed_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(projectId, igId, String(info?.username ?? '').slice(0, 100) || null, String(info?.account_type ?? '').slice(0, 40) || null, encrypt(cfg.secretKey, long.access_token),
      Number(long.expires_in) > 0 ? now() + Number(long.expires_in) : now() + 60 * 86400, Number(userId), now(), now());
  return projectId;
}

/** Compte relié, jeton déchiffré : les mêmes contrôles avant chaque appel. */
async function accountToken(app, projectId) {
  const acc = await app.db.prepare('SELECT ig_user_id, username, token_enc, expires_at FROM instagram_accounts WHERE project_id = ?').get(Number(projectId));
  if (!acc) throw fail(400, "Aucun compte Instagram n'est relié à ce projet");
  if (acc.expires_at && Number(acc.expires_at) <= now()) throw fail(400, 'La connexion Instagram a expiré (elle dure 60 jours) : reconnecte le compte.');
  let token;
  try { token = decrypt(app.cfg.secretKey, acc.token_enc); } catch { token = null; }
  if (!token) throw fail(400, "Le jeton Instagram est illisible : reconnecte le compte.");
  return { acc, token };
}

/**
 * Renouvelle les jetons qui expirent bientôt (60 jours de plus à chaque fois). Appelé par le planificateur : tant que le service tourne,
 * un compte relié ne demande jamais de reconnexion. Un échec prévient le propriétaire du projet (une fois par jour au plus).
 */
export async function refreshInstagramTokens(app, { at = now() } = {}) {
  if (!app.cfg.instagram) return { refreshed: 0, failed: 0 };
  const rows = await app.db.prepare(`SELECT i.project_id, i.token_enc, p.user_id, p.name FROM instagram_accounts i JOIN projects p ON p.id = i.project_id JOIN users u ON u.id = p.user_id
    WHERE u.status = 'active' AND i.expires_at > ? AND i.expires_at <= ? AND (i.refreshed_at IS NULL OR i.refreshed_at <= ?) LIMIT 20`).all(at, at + REFRESH_WITHIN, at - REFRESH_AFTER);
  const out = { refreshed: 0, failed: 0 };
  for (const r of rows) {
    try {
      const token = decrypt(app.cfg.secretKey, r.token_enc);
      const res = await call(app, `${GRAPH}/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token })}`, {}, 'renouvellement du jeton');
      if (!res.ok) throw await graphError(res, 'renouvellement du jeton');
      const j = await res.json().catch(() => null);
      if (typeof j?.access_token !== 'string') throw fail(502, 'Réponse inattendue au renouvellement du jeton.');
      await app.db.prepare('UPDATE instagram_accounts SET token_enc = ?, expires_at = ?, refreshed_at = ? WHERE project_id = ?')
        .run(encrypt(app.cfg.secretKey, j.access_token), at + (Number(j.expires_in) > 0 ? Number(j.expires_in) : 60 * 86400), at, r.project_id);
      out.refreshed++;
    } catch (e) {
      out.failed++;
      await app.db.prepare('UPDATE instagram_accounts SET refreshed_at = ? WHERE project_id = ?').run(at, r.project_id); // pas de nouvel essai avant 24 h
      await notify(app, r.user_id, 'job_error', { title: `${r.name} · Instagram à reconnecter`, level: 'error', description: `Le jeton Instagram n'a pas pu être renouvelé (${String(e.message || '').slice(0, 200)}). Reconnecte le compte dans Communication avant son expiration, sinon les posts programmés ne partiront pas.` });
    }
  }
  return out;
}

// ---------- Programmation ----------

const AS = ['post', 'story'];
const cleanAs = (v) => (AS.includes(v) ? v : 'post');

/** Programme la publication d'un brouillon à `at` (secondes). Le planificateur la fait partir (au plus ~15 minutes après l'heure). */
export async function scheduleInstagram(app, projectId, draftId, { at, as = 'post', clock = now() }) {
  const t = Math.floor(Number(at));
  if (!Number.isFinite(t) || t < clock + SCHEDULE_MIN_SECONDS) throw fail(400, 'Choisis une date au moins 5 minutes dans le futur');
  if (t > clock + SCHEDULE_MAX_SECONDS) throw fail(400, 'Programme un post au plus 75 jours à l\'avance (iaboss le publie lui-même à l\'heure dite)');
  await assertPublishable(app, projectId, draftId);
  const r = await app.db.prepare("UPDATE content_drafts SET status = 'scheduled', scheduled_at = ?, publish_as = ?, publish_error = NULL WHERE id = ? AND project_id = ? AND kind = 'instagram' AND status = 'draft'")
    .run(t, cleanAs(as), Number(draftId), Number(projectId));
  if (!r.changes) throw fail(404, 'Brouillon introuvable (ou déjà programmé ou publié)');
  return t;
}

export async function unscheduleInstagram(db, projectId, draftId) {
  const r = await db.prepare("UPDATE content_drafts SET status = 'draft', scheduled_at = NULL WHERE id = ? AND project_id = ? AND kind = 'instagram' AND status = 'scheduled'")
    .run(Number(draftId), Number(projectId));
  if (!r.changes) throw fail(404, 'Aucun post programmé');
}

/** Un brouillon ne peut partir que s'il a une image, une légende dans les limites, et un compte valable relié au projet. */
async function assertPublishable(app, projectId, draftId) {
  const d = await getDraft(app.db, projectId, 'instagram', draftId);
  if (!d) throw fail(404, 'Brouillon introuvable');
  if (!d.hasImage) throw fail(400, "Ce brouillon n'a pas d'image : Instagram en exige une.");
  await accountToken(app, projectId);
  return d;
}

/** Légende complète : texte puis hashtags (2 200 caractères au plus, la limite d'Instagram). */
export function fullCaption(draft) {
  const tags = (draft.extra?.hashtags || []).join(' ');
  return (tags ? `${draft.body}\n\n${tags}` : draft.body).slice(0, 2200);
}

/**
 * Publie les brouillons programmés dont l'heure est passée. Un échec remet le brouillon en « brouillon » avec la raison et prévient l'utilisateur :
 * jamais de nouvelle tentative en boucle, et jamais de double publication (verrou de publishInstagram).
 */
export async function publishDueInstagram(app, { at = now() } = {}) {
  if (!app.cfg.instagram) return { published: 0, failed: 0 };
  const { db } = app;
  const due = await db.prepare(`SELECT c.id, c.project_id, c.publish_as, p.user_id, p.name FROM content_drafts c JOIN projects p ON p.id = c.project_id JOIN users u ON u.id = p.user_id
    WHERE c.kind = 'instagram' AND c.status = 'scheduled' AND c.scheduled_at <= ? AND u.status = 'active' ORDER BY c.scheduled_at LIMIT 10`).all(at);
  const out = { published: 0, failed: 0 };
  for (const d of due) {
    try {
      await publishInstagram(app, d.project_id, d.id, { as: d.publish_as });
      out.published++;
    } catch (e) {
      out.failed++;
      const reason = String(e.message || 'Erreur inconnue').slice(0, 400);
      await db.prepare("UPDATE content_drafts SET status = 'draft', scheduled_at = NULL, publish_error = ? WHERE id = ? AND status IN ('scheduled', 'publishing')").run(reason, d.id);
      await notify(app, d.user_id, 'job_error', { title: `${d.name} · post Instagram non publié`, level: 'error', description: `${reason}\nLe brouillon est conservé : reprogramme-le ou publie-le à la main.` });
    }
  }
  return out;
}

// ---------- Publication ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Publie un brouillon maintenant, comme post ou comme story. Une fois publié, il ne peut plus l'être une deuxième fois.
 * @returns {Promise<{remoteId:string, permalink:string|null}>}
 */
export async function publishInstagram(app, projectId, draftId, { as = 'post' } = {}) {
  const { db, cfg } = app;
  if (!cfg.instagram) throw fail(503, NOT_CONFIGURED);
  const kindAs = cleanAs(as);
  const draft = await assertPublishable(app, projectId, draftId);
  const row = await db.prepare("SELECT status FROM content_drafts WHERE id = ? AND project_id = ? AND kind = 'instagram'").get(Number(draftId), Number(projectId));
  if (!['draft', 'scheduled'].includes(row?.status)) throw fail(409, 'Ce post est déjà publié (ou en cours de publication)');
  const before = row.status;
  const { acc, token } = await accountToken(app, projectId);
  // Verrou : un double clic ne publie jamais deux fois
  const lock = await db.prepare("UPDATE content_drafts SET status = 'publishing', publish_as = ?, publish_error = NULL WHERE id = ? AND status IN ('draft', 'scheduled')").run(kindAs, Number(draftId));
  if (!lock.changes) throw fail(409, 'Publication déjà en cours');
  const unlock = (msg) => db.prepare('UPDATE content_drafts SET status = ?, scheduled_at = NULL, publish_error = ? WHERE id = ?').run(before === 'scheduled' ? 'draft' : before, msg ? String(msg).slice(0, 480) : null, Number(draftId));
  let token_;
  try {
    const png = await getImage(db, projectId, draftId);
    if (!png) throw fail(400, "Ce brouillon n'a plus d'image.");
    const fmt = INSTAGRAM_FORMATS[draft.extra?.format] ?? INSTAGRAM_FORMATS.carre;
    const jpg = await (app.toJpeg || pngToJpeg)({ cfg, png, width: draft.extra?.width || fmt.width, height: draft.extra?.height || fmt.height });
    token_ = putMedia(jpg);
    const imageUrl = `${cfg.instagram.publicBase}/ig-media/${token_}.jpg`;
    const v = `${GRAPH}/${cfg.instagram.apiVersion}`;
    const authed = (obj) => new URLSearchParams({ ...obj, access_token: token });

    // 1. Le conteneur : Instagram va chercher l'image à imageUrl
    const form = { image_url: imageUrl };
    if (kindAs === 'story') form.media_type = 'STORIES'; else form.caption = fullCaption(draft);
    const c = await call(app, `${v}/${acc.ig_user_id}/media`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: authed(form) }, 'création du média');
    if (!c.ok) throw await graphError(c, 'création du média');
    const creationId = String((await c.json().catch(() => null))?.id ?? '');
    if (!/^\d{1,30}$/.test(creationId)) throw fail(502, "Instagram n'a pas donné d'identifiant de média.");

    // 2. Attendre qu'il soit prêt (quelques secondes en général)
    const wait = app.instagramPollMs ?? 3000;
    let status = 'IN_PROGRESS';
    for (let i = 0; i < 20 && status === 'IN_PROGRESS'; i++) {
      if (i) await sleep(wait);
      const s = await call(app, `${v}/${creationId}?${new URLSearchParams({ fields: 'status_code,status', access_token: token })}`, {}, 'état du média');
      if (!s.ok) throw await graphError(s, 'état du média');
      const j = await s.json().catch(() => null);
      status = String(j?.status_code ?? 'IN_PROGRESS');
      if (status === 'ERROR' || status === 'EXPIRED') throw fail(400, `Instagram n'a pas pu préparer l'image (${String(j?.status || status).slice(0, 200)}).`);
    }
    if (status !== 'FINISHED') throw fail(504, "Instagram met trop de temps à préparer l'image : réessaie dans un instant.");

    // 3. Publier
    const pub = await call(app, `${v}/${acc.ig_user_id}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: authed({ creation_id: creationId }) }, 'publication');
    if (!pub.ok) throw await graphError(pub, 'publication');
    const remoteId = String((await pub.json().catch(() => null))?.id ?? '');
    if (!remoteId) throw fail(502, "Instagram n'a pas confirmé la publication : vérifie sur ton compte avant de réessayer.");

    let permalink = null;
    try {
      const pl = await call(app, `${v}/${remoteId}?${new URLSearchParams({ fields: 'permalink', access_token: token })}`, {}, 'adresse du post');
      const link = pl.ok ? (await pl.json().catch(() => null))?.permalink : null;
      if (typeof link === 'string' && /^https:\/\/(www\.)?instagram\.com\//.test(link)) permalink = link.slice(0, 480);
    } catch { /* le post est publié : l'adresse n'est qu'un confort */ }
    await db.prepare("UPDATE content_drafts SET status = 'published', scheduled_at = NULL, published_at = ?, remote_id = ?, permalink = ?, publish_error = NULL WHERE id = ?")
      .run(now(), remoteId.slice(0, 100), permalink, Number(draftId));
    return { remoteId, permalink };
  } catch (e) {
    // Le post a pu partir avant l'erreur (réseau coupé après media_publish) : on ne le remet en brouillon qu'avec la raison, à toi de vérifier avant de réessayer
    await unlock(e.message);
    throw e;
  } finally { if (token_) setTimeout(() => media.delete(token_), 60_000).unref?.(); }
}
