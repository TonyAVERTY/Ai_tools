// Liaison Claude de chaque utilisateur : clé API Anthropic, jeton d'abonnement (claude setup-token) ou, pour les admins,
// configuration du CLI du serveur. Le secret est chiffré (AES-256-GCM) dans users.claude_link_json ; il ne sort jamais
// de ce module que sous forme d'environnement du processus enfant, et toujours à partir du user_id du job.
import { execFile } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { now, getSetting, setSetting } from './db.js';
import { encrypt, decrypt, randomId } from './crypto.js';
import { HttpError, parseCookies, setCookie, redirect } from './http.js';
import { getUser } from './users.js';
import { runClaude } from './services/claude.js';
import { buildChildEnv } from './services/sandbox.js';
import { AI_JOBS } from './services/budget.js';

const execFileP = promisify(execFile);

export const MODES = { api_key: 'api_key', subscription_token: 'subscription_token', server: 'server' };
export const MODE_LABELS = {
  api_key: 'Clé API Anthropic',
  subscription_token: 'Abonnement Claude (jeton)',
  server: 'Claude du serveur',
};
export const LINK_REQUIRED_MESSAGE = 'Relie ton accès Claude pour utiliser cette fonction';
export const LINK_INVALID_MESSAGE = "Ta liaison Claude n'est plus valide : teste-la ou relie-la de nouveau (Mon compte)";
export const CLI_DISABLED_MESSAGE = "Le mode abonnement est désactivé sur ce service : relie une clé API";
export const SERVER_MODE_MESSAGE = 'Le mode « Claude du serveur » est réservé aux administrateurs';

// Texte de l'avertissement affiché avant le mode abonnement. Toute modification change la version : l'acceptation
// enregistrée en base indique à quelle version du texte l'utilisateur a consenti.
export const CONSENT_VERSION = '2026-10-22.1';
export const CONSENT_TEXT = [
  "Utiliser un abonnement Claude (Pro, Max) à travers une application tierce peut contrevenir aux conditions d'utilisation d'Anthropic et entraîner la suspension ou la fermeture de ton compte Claude.",
  'AiTools ne peut en être tenu responsable. Tu utilises ton abonnement à tes propres risques.',
  "La clé API Anthropic reste l'option recommandée : elle est prévue pour cet usage.",
];
export const CONSENT_CHECKBOX = "J'ai compris et j'accepte ce risque";

const API_KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,400}$/;
const TOKEN_RE = /^[A-Za-z0-9_.-]{20,800}$/;
const MODELS_URL = 'https://api.anthropic.com/v1/models';
const SECRET_ENV = { api_key: 'ANTHROPIC_API_KEY', subscription_token: 'CLAUDE_CODE_OAUTH_TOKEN' };

const truthy = (v) => v === true || v === 'true' || v === 'on' || v === '1' || v === 1;

async function readLink(db, userId) {
  const row = await db.prepare('SELECT claude_link_json FROM users WHERE id = ?').get(Number(userId));
  if (!row?.claude_link_json) return null;
  try { return JSON.parse(row.claude_link_json); } catch { return null; }
}

async function writeLink(db, userId, link) {
  await db.prepare('UPDATE users SET claude_link_json = ? WHERE id = ?').run(link ? JSON.stringify(link) : null, Number(userId));
}

/** Forme exposée à l'interface : jamais le secret, seulement ses 4 derniers caractères pour la clé API. */
export function publicLink(link) {
  if (!link?.mode) return null;
  return {
    mode: link.mode, label: MODE_LABELS[link.mode], valid: !!link.valid,
    linkedAt: link.linked_at ?? null, validatedAt: link.validated_at ?? null, lastTestAt: link.last_test_at ?? null,
    last4: link.mode === 'api_key' ? link.last4 ?? null : null,
    consentAt: link.consent?.at ?? null, consentVersion: link.consent?.version ?? null,
  };
}

export async function getLinkState(db, userId) {
  return publicLink(await readLink(db, userId));
}

// Quota d'abonnement et alertes : propres à un compte Claude, repartent de zéro quand la liaison change
async function resetQuotaState(db, userId) {
  await setSetting(db, userId, 'claude_rate_limit_json', null);
  await setSetting(db, userId, 'claude_quota_notified_json', null);
}

/**
 * Pourquoi cet utilisateur ne peut pas lancer de job IA (message destiné à l'écran), ou null s'il le peut.
 * Garde unique, appelée par les routes, enqueue, le worker et le wrapper claude().
 */
export async function aiRefusal(db, userId, { cliModeEnabled = true } = {}) {
  const user = await getUser(db, userId);
  if (!user) return 'Compte supprimé';
  if (user.status !== 'active') return 'Compte suspendu';
  const link = await readLink(db, userId);
  if (!link?.mode || !MODES[link.mode]) return LINK_REQUIRED_MESSAGE;
  if (!link.valid) return LINK_INVALID_MESSAGE;
  if (link.mode === MODES.server && !user.isAdmin) return SERVER_MODE_MESSAGE;
  if (link.mode === MODES.subscription_token && !cliModeEnabled) return CLI_DISABLED_MESSAGE;
  return null;
}

export async function assertCanRunAi(db, userId, opts) {
  const msg = await aiRefusal(db, userId, opts);
  if (msg) throw new HttpError(403, msg);
}

/** L'utilisateur a-t-il une liaison utilisable ? Sert à l'onboarding bloquant. */
export async function hasUsableLink(db, userId, opts) {
  return (await aiRefusal(db, userId, opts)) === null;
}

/**
 * Identifiants d'exécution du job : lus dans la ligne de CET utilisateur, jamais ailleurs.
 * @returns {{mode:string, secretEnv:Record<string,string>, serverConfig:boolean}}
 */
export async function resolveCredentials(app, userId) {
  await assertCanRunAi(app.db, userId, { cliModeEnabled: app.cfg.cliModeEnabled !== false });
  const link = await refreshIfNeeded(app, userId, await readLink(app.db, userId));
  if (link.mode === MODES.server) return { mode: link.mode, secretEnv: {}, serverConfig: true };
  let secret;
  try { secret = decrypt(app.cfg.secretKey, link.secret_enc); }
  catch { throw new HttpError(403, 'Secret de liaison illisible : relie de nouveau ton accès Claude'); }
  if (!secret) throw new HttpError(403, LINK_REQUIRED_MESSAGE);
  return { mode: link.mode, secretEnv: { [SECRET_ENV[link.mode]]: secret }, serverConfig: false };
}

// ---------- Validation ----------

/**
 * Valide une clé API par un appel qui ne consomme aucun token : GET /v1/models.
 * 401/403 : refusée ; erreur réseau ou réponse inattendue : message distinct (la clé n'est pas jugée).
 * @returns {Promise<void>}
 */
export async function validateApiKey(key, fetchFn = fetch) {
  let r;
  try {
    r = await fetchFn(MODELS_URL, {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(502, "Impossible de joindre Anthropic pour vérifier la clé (réseau). Réessaie dans un instant.", { expose: true });
  }
  if (r.status === 401 || r.status === 403) throw new HttpError(400, 'Clé API refusée par Anthropic');
  if (!r.ok) throw new HttpError(502, `Anthropic ne répond pas normalement (HTTP ${r.status}) : la clé n'a pas pu être vérifiée. Réessaie plus tard.`, { expose: true });
}

// Appel minimal du CLI avec le jeton (modèle le plus petit, 1 tour, aucun outil). Ce n'est PAS gratuit : quelques tokens
// sont décomptés de l'abonnement. Aucune commande du CLI ne vérifie un jeton sans appel au modèle.
export async function validateSubscriptionToken(app, token) {
  let r;
  try {
    r = await runClaude({
      bin: app.cfg.claudeBin, prompt: 'Réponds uniquement : ok', model: 'haiku', maxTurns: 1, tools: [], timeoutMs: 90_000,
      sandbox: app.cfg.sandbox, secretEnv: { CLAUDE_CODE_OAUTH_TOKEN: token },
    });
  } catch {
    throw new HttpError(502, "Le CLI Claude n'a pas pu être lancé sur le serveur (bac à sable ou installation). Préviens l'administrateur.", { expose: true });
  }
  if (r.ok) return;
  if (/auth|login|token|credential|401|403|invalid|expired|unauthor/i.test(`${r.text} ${r.subtype}`)) {
    throw new HttpError(400, 'Jeton refusé par Claude (invalide ou expiré)');
  }
  throw new HttpError(502, "Le jeton n'a pas pu être vérifié (réponse inattendue du CLI). Réessaie plus tard.", { expose: true });
}

// ---------- Liaison ----------

export async function saveLink(app, userId, link) {
  const t = now();
  await writeLink(app.db, userId, { v: 1, valid: true, linked_at: t, validated_at: t, last_test_at: t, ...link });
  await resetQuotaState(app.db, userId);
}

/** Mode A : clé API. Validée, chiffrée, jamais réaffichée. */
export async function linkApiKey(app, userId, apiKey) {
  const key = String(apiKey ?? '').trim();
  if (!API_KEY_RE.test(key)) throw new HttpError(400, 'Clé API invalide (elle commence par sk-ant-)');
  await (app.validateApiKey || validateApiKey)(key, app.fetch || fetch);
  await saveLink(app, userId, { mode: MODES.api_key, secret_enc: encrypt(app.cfg.secretKey, key), last4: key.slice(-4) });
}

/**
 * Mode B : jeton d'abonnement (claude setup-token, généré par l'utilisateur sur sa machine).
 * Le consentement est vérifié AVANT tout (sans case cochée : 400, rien n'est stocké ni validé).
 */
export async function linkSubscriptionToken(app, userId, { token, accept }) {
  if (app.cfg.cliModeEnabled === false) throw new HttpError(403, CLI_DISABLED_MESSAGE);
  if (!truthy(accept)) throw new HttpError(400, `Tu dois cocher « ${CONSENT_CHECKBOX} » pour utiliser ton abonnement`);
  const tok = String(token ?? '').trim();
  if (/^sk-ant-api/.test(tok)) throw new HttpError(400, "Ceci est une clé API : utilise l'option « Clé API Anthropic »");
  if (!TOKEN_RE.test(tok)) throw new HttpError(400, 'Jeton invalide : colle le jeton affiché par « claude setup-token », en entier');
  await (app.validateToken || ((t) => validateSubscriptionToken(app, t)))(tok);
  const consent = { at: now(), version: CONSENT_VERSION };
  await saveLink(app, userId, { mode: MODES.subscription_token, secret_enc: encrypt(app.cfg.secretKey, tok), consent });
  // Trace d'acceptation conservée même si l'utilisateur délie ensuite (supprimée avec le compte)
  await setSetting(app.db, userId, 'claude_cli_consent_json', JSON.stringify(consent));
}

// ---------- Connexion automatique avec Claude (OAuth, PKCE) ----------
// L'utilisateur clique, Anthropic lui demande d'autoriser AiTools, puis le navigateur revient sur /link/claude/callback
// où le serveur échange le code contre un jeton et le range chiffré, comme le jeton collé à la main (mode abonnement).
const OAUTH_STATE_TTL = 600;
const OAUTH_COOKIE = 'claude_oauth_b';
const OAUTH_COOKIE_PATH = '/link/claude';
export const OAUTH_UNAVAILABLE_MESSAGE = "La connexion automatique avec Claude n'est pas activée sur ce service.";
const hashBind = (v) => createHash('sha256').update(String(v)).digest('hex');

/** Le bouton « Se connecter avec Claude » est-il utilisable sur ce service ? */
export const oauthAvailable = (cfg) => !!cfg.claudeOauth && cfg.cliModeEnabled !== false;

/**
 * Démarre le flux : consentement obligatoire (rien n'est créé sans la case cochée), state + PKCE en base,
 * cookie qui lie le retour à CE navigateur, puis redirection vers la page d'autorisation d'Anthropic.
 */
export async function startClaudeOauth(app, userId, { accept }, res) {
  const { cfg, db } = app;
  if (cfg.cliModeEnabled === false) throw new HttpError(403, CLI_DISABLED_MESSAGE);
  if (!cfg.claudeOauth) throw new HttpError(503, OAUTH_UNAVAILABLE_MESSAGE, { expose: true });
  if (!truthy(accept)) throw new HttpError(400, `Tu dois cocher « ${CONSENT_CHECKBOX} » pour utiliser ton abonnement`);
  const oc = cfg.claudeOauth;
  const state = randomId(24);
  const verifier = randomId(48);
  const bind = randomId(24);
  await db.prepare('INSERT INTO oauth_states(state, provider, verifier, nonce, binding, created_at) VALUES(?, ?, ?, ?, ?, ?)')
    .run(state, 'claude', verifier, String(userId), hashBind(bind), now());
  setCookie(res, OAUTH_COOKIE, bind, { maxAge: OAUTH_STATE_TTL, path: OAUTH_COOKIE_PATH });
  const q = new URLSearchParams({
    client_id: oc.clientId, response_type: 'code', redirect_uri: oc.redirectUri, scope: oc.scope, state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  });
  redirect(res, `${oc.authorizeUrl}?${q}`);
}

async function tokenRequest(app, body) {
  let r;
  try {
    r = await (app.fetch || fetch)(app.cfg.claudeOauth.tokenUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError(502, "Impossible de joindre Anthropic pour terminer la connexion. Réessaie dans un instant.", { expose: true });
  }
  if (r.status === 400 || r.status === 401 || r.status === 403) throw new HttpError(400, 'Anthropic a refusé la connexion (autorisation expirée ou déjà utilisée). Recommence.');
  if (!r.ok) throw new HttpError(502, `Anthropic ne répond pas normalement (HTTP ${r.status}). Réessaie plus tard.`, { expose: true });
  const data = await r.json().catch(() => null);
  if (typeof data?.access_token !== 'string' || !TOKEN_RE.test(data.access_token)) throw new HttpError(502, "Réponse inattendue d'Anthropic : la connexion n'a pas pu être terminée.", { expose: true });
  return data;
}

// Ce que le jeton donne en plus de son secret : de quoi le renouveler avant son échéance
const oauthFields = (app, data) => ({
  ...(data.refresh_token ? { refresh_enc: encrypt(app.cfg.secretKey, String(data.refresh_token)) } : {}),
  ...(Number(data.expires_in) > 0 ? { expires_at: now() + Number(data.expires_in) } : {}),
});

/**
 * Retour d'Anthropic : state connu, à usage unique, non expiré, émis pour CE compte et CE navigateur ;
 * échange du code (PKCE) puis même vérification et même stockage que le jeton collé.
 */
export async function finishClaudeOauth(app, userId, params, req, res) {
  const { cfg, db } = app;
  const state = params.get('state');
  const row = state ? await db.prepare('SELECT * FROM oauth_states WHERE state = ? AND created_at > ?').get(String(state), now() - OAUTH_STATE_TTL) : null;
  if (state) await db.prepare('DELETE FROM oauth_states WHERE state = ?').run(String(state));
  setCookie(res, OAUTH_COOKIE, '', { maxAge: 0, path: OAUTH_COOKIE_PATH });

  if (params.get('error')) throw new HttpError(400, params.get('error') === 'access_denied' ? 'Connexion annulée : tu as refusé l\'accès sur Claude.' : 'Claude a refusé la connexion.');
  const code = params.get('code');
  if (!code || !state) throw new HttpError(400, 'Retour de Claude incomplet : recommence.');
  if (!row || row.provider !== 'claude' || String(row.nonce) !== String(userId)) throw new HttpError(400, 'Connexion expirée ou lancée depuis un autre compte : recommence.');
  const bind = parseCookies(req)[OAUTH_COOKIE];
  const a = Buffer.from(hashBind(bind || ''));
  const b = Buffer.from(String(row.binding));
  if (!bind || a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(400, 'Connexion lancée depuis un autre navigateur : recommence.');
  if (cfg.cliModeEnabled === false) throw new HttpError(403, CLI_DISABLED_MESSAGE);
  if (!cfg.claudeOauth) throw new HttpError(503, OAUTH_UNAVAILABLE_MESSAGE, { expose: true });

  const oc = cfg.claudeOauth;
  const data = await tokenRequest(app, {
    grant_type: 'authorization_code', code: String(code), state: String(state), redirect_uri: oc.redirectUri,
    client_id: oc.clientId, code_verifier: row.verifier, expires_in: oc.expiresIn,
  });
  await (app.validateToken || ((t) => validateSubscriptionToken(app, t)))(data.access_token);
  const consent = { at: now(), version: CONSENT_VERSION };
  await saveLink(app, userId, { mode: MODES.subscription_token, secret_enc: encrypt(cfg.secretKey, data.access_token), consent, via: 'oauth', ...oauthFields(app, data) });
  await setSetting(db, userId, 'claude_cli_consent_json', JSON.stringify(consent));
}

/** Jeton OAuth proche de son échéance (moins de 5 minutes) : on le renouvelle avec le refresh_token, sinon la liaison est à refaire. */
async function refreshIfNeeded(app, userId, link) {
  if (link?.via !== 'oauth' || !link.expires_at || link.expires_at - now() > 300) return link;
  let refresh;
  try { refresh = link.refresh_enc ? decrypt(app.cfg.secretKey, link.refresh_enc) : null; } catch { refresh = null; }
  if (!refresh || !app.cfg.claudeOauth) throw new HttpError(403, LINK_INVALID_MESSAGE);
  let data;
  try { data = await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: refresh, client_id: app.cfg.claudeOauth.clientId }); }
  catch (e) {
    if (e instanceof HttpError && e.status === 400) { await writeLink(app.db, userId, { ...link, valid: false }); throw new HttpError(403, LINK_INVALID_MESSAGE); }
    throw e;
  }
  const next = { ...link, secret_enc: encrypt(app.cfg.secretKey, data.access_token), ...oauthFields(app, data) };
  await writeLink(app.db, userId, next);
  return next;
}

/** Mode « Claude du serveur » : administrateurs seulement, aucun secret stocké. */
export async function linkServer(app, userId) {
  const user = await getUser(app.db, userId);
  if (!user?.isAdmin) throw new HttpError(403, SERVER_MODE_MESSAGE);
  await saveLink(app, userId, { mode: MODES.server });
}

/**
 * Délie : supprime le secret chiffré, annule les jobs IA en file ou en cours de CET utilisateur.
 * @returns {Promise<number>} jobs annulés
 */
export async function unlink(app, userId) {
  await writeLink(app.db, userId, null);
  await resetQuotaState(app.db, userId);
  const types = [...AI_JOBS];
  const r = await app.db.prepare(`UPDATE jobs SET status = 'cancelled', finished_at = ?
    WHERE user_id = ? AND status IN ('queued','running') AND type IN (${types.map(() => '?').join(', ')})`).run(now(), Number(userId), ...types);
  app.worker?.abortUserAi(userId);
  return r.changes || 0;
}

/**
 * Teste la liaison. Une réponse d'authentification négative invalide la liaison ; une erreur réseau ou du CLI ne la touche pas.
 * @returns {Promise<{ok:boolean, message:string}>}
 */
export async function testLink(app, userId) {
  let link = await readLink(app.db, userId);
  if (!link?.mode) throw new HttpError(400, LINK_REQUIRED_MESSAGE);
  try { link = await refreshIfNeeded(app, userId, link); } catch (e) { if (!(e instanceof HttpError)) throw e; return { ok: false, message: e.message }; }
  const mark = async (valid) => writeLink(app.db, userId, { ...link, valid, last_test_at: now(), ...(valid ? { validated_at: now() } : {}) });
  try {
    if (link.mode === MODES.server) {
      const user = await getUser(app.db, userId);
      if (!user?.isAdmin) throw new HttpError(400, SERVER_MODE_MESSAGE);
      try { await execFileP(app.cfg.claudeBin, ['--version'], { env: buildChildEnv(process.env, { home: app.cfg.sandbox?.serverHome || '/tmp' }), timeout: 15_000 }); }
      catch { throw new HttpError(502, 'Le CLI Claude du serveur est introuvable ou ne répond pas', { expose: true }); }
    } else {
      let secret;
      try { secret = decrypt(app.cfg.secretKey, link.secret_enc); } catch { secret = null; }
      if (!secret) { await mark(false); return { ok: false, message: 'Secret illisible : relie de nouveau ton accès Claude' }; }
      if (link.mode === MODES.api_key) await (app.validateApiKey || validateApiKey)(secret, app.fetch || fetch);
      else {
        if (app.cfg.cliModeEnabled === false) return { ok: false, message: CLI_DISABLED_MESSAGE };
        await (app.validateToken || ((t) => validateSubscriptionToken(app, t)))(secret);
      }
    }
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    // 400 = refus d'authentification (liaison invalide) ; 502 = impossible de juger (réseau, CLI) : on ne touche à rien
    if (e.status === 400) await mark(false);
    return { ok: false, message: e.message };
  }
  await mark(true);
  return { ok: true, message: 'Liaison valide' };
}

/** Dernière acceptation du risque du mode abonnement (conservée après « Délier »). */
export async function lastConsent(db, userId) {
  const raw = await getSetting(db, userId, 'claude_cli_consent_json');
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** Routes accessibles sans liaison valide : lier, Mon compte, déconnexion, suppression du compte. */
export function isLinkExempt(method, pathname) {
  if (pathname === '/link' || pathname.startsWith('/link/')) return true;
  if (pathname === '/account' || pathname === '/account/delete') return true;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return true; // les administrateurs gèrent les comptes même sans liaison
  return method === 'POST' && pathname === '/logout';
}
