// Liaison Claude de chaque utilisateur : clé API Anthropic ou jeton d'abonnement (claude setup-token). Aucun accès Claude
// n'est partagé : le CLI du serveur n'est jamais utilisé à la place d'un utilisateur. Le secret est chiffré (AES-256-GCM) dans users.claude_link_json ; il ne sort jamais
// de ce module que sous forme d'environnement du processus enfant, et toujours à partir du user_id du job.
import { now, getSetting, setSetting } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { HttpError } from './http.js';
import { getUser } from './users.js';
import { runClaude } from './services/claude.js';
import { AI_JOBS } from './services/budget.js';
import { withUserLock } from './services/userlock.js';
import { getProvider, hasProvider, DEFAULT_PROVIDER } from './services/providers/index.js';
import { isAuthRefusal, validateApiKey } from './services/providers/claude.js';
import { tokenSecrets } from './services/providers/agy.js';
export { isAuthRefusal, validateApiKey };

export const MODES = { api_key: 'api_key', subscription_token: 'subscription_token', chatgpt_account: 'chatgpt_account', google_account: 'google_account' };
export const MODE_LABELS = {
  api_key: 'Clé API Anthropic',
  subscription_token: 'Abonnement Claude (jeton)',
  chatgpt_account: 'Compte ChatGPT',
  google_account: 'Compte Google',
};
/** Tout mode qui n'est pas une clé API est un abonnement : même avertissement, même interrupteur (CLAUDE_CLI_MODE_ENABLED). */
export const isSubscriptionMode = (mode) => mode === MODES.subscription_token || mode === MODES.chatgpt_account || mode === MODES.google_account;
export const LINK_REQUIRED_MESSAGE = 'Relie ton accès Claude pour utiliser cette fonction';
export const LINK_INVALID_MESSAGE = "Ta liaison Claude n'est plus valide : teste-la ou relie-la de nouveau (Mon compte)";
export const CLI_DISABLED_MESSAGE = "Le mode abonnement est désactivé sur ce service : relie une clé API";
export const GOOGLE_DISABLED_MESSAGE = "La connexion par compte Google est désactivée sur ce service : relie une clé API Google AI Studio";

// Connexion par compte Google (Antigravity CLI) : désactivée tant que l'administrateur ne l'a pas activée (GOOGLE_ACCOUNT_ENABLED), car la règle de
// Google sur l'usage depuis un autre logiciel n'est pas tranchée. Fixée au démarrage du serveur (createApp) ; un drapeau de module plutôt qu'une
// option de plus à faire passer par chaque appelant de aiRefusal.
let googleEnabled = false;
export const setGoogleAccountEnabled = (on) => { googleEnabled = !!on; };
export const googleAccountEnabled = () => googleEnabled;

// Texte de l'avertissement affiché avant le mode abonnement. Toute modification change la version : l'acceptation
// enregistrée en base indique à quelle version du texte l'utilisateur a consenti.
export const CONSENT_VERSION = '2026-10-22.1';
export const CONSENT_TEXT = [
  "Utiliser un abonnement Claude (Pro, Max) à travers une application tierce peut contrevenir aux conditions d'utilisation d'Anthropic et entraîner la suspension ou la fermeture de ton compte Claude.",
  'iaboss ne peut en être tenu responsable. Tu utilises ton abonnement à tes propres risques.',
  "La clé API Anthropic reste l'option recommandée : elle est prévue pour cet usage.",
];
export const CONSENT_CHECKBOX = "J'ai compris et j'accepte ce risque";

// Même avertissement pour le compte ChatGPT, avec sa propre version (l'acceptation enregistrée dit à quel texte l'utilisateur a consenti).
export const OPENAI_CONSENT_VERSION = '2026-11-04.1';
export const OPENAI_CONSENT_TEXT = [
  "Utiliser ton compte ChatGPT (Plus, Pro, Business) à travers une application tierce peut contrevenir aux conditions d'utilisation d'OpenAI et entraîner la suspension ou la fermeture de ton compte.",
  "iaboss ne peut en être tenu responsable. Tu utilises ton abonnement à tes propres risques. OpenAI recommande une clé API pour ce type d'usage, et réserve la connexion de compte aux environnements privés de confiance.",
  "Tes tâches passent l'une après l'autre : un seul exécutable utilise ta connexion à la fois. Elle peut te demander de te reconnecter de temps en temps.",
  "La clé API OpenAI reste l'option recommandée : elle est prévue pour cet usage.",
];

// Même avertissement pour le compte Google (abonnement Google AI), avec sa propre version. Ici la règle de Google n'est PAS tranchée : le texte le dit.
export const GOOGLE_CONSENT_VERSION = '2026-11-06.1';
export const GOOGLE_CONSENT_TEXT = [
  "Utiliser ton abonnement Google AI (Plus, Pro, Ultra) à travers une application tierce n'est pas clairement autorisé par Google. Pour Gemini CLI, Google l'interdit explicitement et a suspendu des comptes ; pour Antigravity CLI, il n'a pas répondu clairement. Ton compte Google pourrait être limité ou suspendu.",
  "iaboss ne peut en être tenu responsable. Tu utilises ton abonnement à tes propres risques. Une clé API Google AI Studio est prévue pour cet usage et reste l'option recommandée.",
  "Tes tâches passent l'une après l'autre : un seul exécutable utilise ta connexion à la fois. Elle peut te demander de te reconnecter de temps en temps.",
  "Chaque tâche envoie les consignes d'Antigravity CLI avant ta demande : quelques milliers de tokens de plus par appel sont décomptés de ton abonnement.",
];

const TOKEN_RE = /^[A-Za-z0-9_.-]{20,800}$/;


const truthy = (v) => v === true || v === 'true' || v === 'on' || v === '1' || v === 1;

async function readLink(db, userId) {
  const row = await db.prepare('SELECT claude_link_json FROM users WHERE id = ?').get(Number(userId));
  if (!row?.claude_link_json) return null;
  try { return JSON.parse(row.claude_link_json); } catch { return null; }
}

async function writeLink(db, userId, link) {
  await db.prepare('UPDATE users SET claude_link_json = ? WHERE id = ?').run(link ? JSON.stringify(link) : null, Number(userId));
}

/** Un job a reçu un refus d'authentification : la liaison est marquée invalide (le secret reste en base), l'interface demande de se reconnecter. */
export async function markLinkInvalid(db, userId) {
  const link = await readLink(db, userId);
  if (!link?.mode || !link.valid) return false;
  await writeLink(db, userId, { ...link, valid: false, last_test_at: now() });
  return true;
}

/** Libellé du mode de connexion d'une liaison brute (colonne en base), pour la liste des comptes de l'administration. */
export function modeLabelOf(link) {
  const p = hasProvider(link?.provider ?? DEFAULT_PROVIDER) ? getProvider(link?.provider) : null;
  return p?.modes[link?.mode]?.label ?? MODE_LABELS[link?.mode] ?? link?.mode;
}

/** Forme exposée à l'interface : jamais le secret, seulement ses 4 derniers caractères pour la clé API. */
export function publicLink(link) {
  if (!link?.mode || !MODES[link.mode]) return null; // un ancien mode « serveur » compte comme « pas de liaison »
  if (!hasProvider(link.provider ?? DEFAULT_PROVIDER)) return null; // fournisseur retiré : « pas de liaison »
  const provider = getProvider(link.provider);
  return {
    provider: provider.id, providerLabel: provider.label, providerCompany: provider.company,
    mode: link.mode, label: provider.modes[link.mode]?.label ?? MODE_LABELS[link.mode], valid: !!link.valid,
    linkedAt: link.linked_at ?? null, validatedAt: link.validated_at ?? null, lastTestAt: link.last_test_at ?? null,
    last4: link.mode === 'api_key' ? link.last4 ?? null : null,
    consentAt: link.consent?.at ?? null, consentVersion: link.consent?.version ?? null,
  };
}

/** Compte relié par clé API : seul cas où les jobs sont facturés à l'usage (donc où un montant en $ a un sens). Avec un abonnement Claude, rien n'est facturé en plus. */
export async function isPriced(db, userId) {
  return (await getLinkState(db, userId))?.mode === MODES.api_key;
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
  if (isSubscriptionMode(link.mode) && !cliModeEnabled) return CLI_DISABLED_MESSAGE;
  if (link.mode === MODES.google_account && !googleEnabled) return GOOGLE_DISABLED_MESSAGE;
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
 * Un secret en variable d'environnement (`secretEnv`) pour une clé API ou un jeton ; pour une connexion de compte, le contenu du fichier
 * de connexion du CLI (`authFile`), les valeurs à masquer partout (`secrets`) et la date de liaison (`linkedAt`) qui sert à ne pas écraser
 * une liaison refaite entre-temps quand le CLI a renouvelé ses jetons.
 * @returns {{provider:string, mode:string, secretEnv:Record<string,string>, authFile?:string, secrets?:string[], linkedAt?:number}}
 */
export async function resolveCredentials(app, userId) {
  await assertCanRunAi(app.db, userId, { cliModeEnabled: app.cfg.cliModeEnabled !== false });
  const link = await readLink(app.db, userId);
  let secret;
  try { secret = decrypt(app.cfg.secretKey, link.secret_enc); }
  catch {
    // Clé SECRET_KEY changée ou secret abîmé : la liaison est inutilisable, l'interface propose de se reconnecter
    await markLinkInvalid(app.db, userId);
    throw new HttpError(403, 'Secret de liaison illisible : relie de nouveau ton accès');
  }
  if (!secret) throw new HttpError(403, LINK_REQUIRED_MESSAGE);
  const provider = getProvider(link.provider);
  const mode = provider.modes[link.mode];
  if (!mode) throw new HttpError(403, LINK_REQUIRED_MESSAGE);
  if (mode.file) return { provider: provider.id, mode: link.mode, secretEnv: {}, authFile: secret, secrets: link.mode === MODES.google_account ? tokenSecrets(secret) : authSecrets(secret), linkedAt: link.linked_at ?? null };
  return { provider: provider.id, mode: link.mode, secretEnv: { [mode.env]: secret } };
}

// ---------- Connexion de compte ChatGPT (fichier auth.json de Codex) ----------

/** Jetons contenus dans un fichier de connexion : à masquer dans tout ce qui sort (journaux, erreurs, réponses). */
export function authSecrets(authJson) {
  try {
    const t = JSON.parse(authJson)?.tokens || {};
    return [t.access_token, t.refresh_token, t.id_token].filter((v) => typeof v === 'string' && v.length >= 8);
  } catch { return []; }
}

/**
 * Vérifie qu'un fichier de connexion est bien celui d'un compte ChatGPT que Codex peut renouveler, et le renvoie compact.
 * La documentation d'OpenAI : `auth_mode` vaut « chatgpt » et `tokens.refresh_token` existe.
 */
export function parseAuthJson(text) {
  const raw = String(text ?? '').trim();
  const bad = () => new HttpError(400, "Ce n'est pas un fichier de connexion ChatGPT : colle le contenu complet de ~/.codex/auth.json, obtenu avec « codex login »");
  if (raw.length < 50 || raw.length > 100_000) throw bad();
  let j;
  try { j = JSON.parse(raw); } catch { throw bad(); }
  if (!j || j.auth_mode !== 'chatgpt' || typeof j.tokens?.refresh_token !== 'string' || !j.tokens.refresh_token) throw bad();
  return JSON.stringify(j);
}

/**
 * Codex a renouvelé ses jetons pendant un job : le fichier mis à jour remplace celui de la base, sauf si l'utilisateur a refait sa liaison
 * entre-temps (date de liaison différente) ou l'a supprimée. Jamais d'erreur vers l'appelant : un job réussi ne doit pas échouer ici.
 */
/** Fichier de connexion d'un compte Google (Antigravity CLI) : opaque, il suffit qu'il ne soit pas vide ni démesuré. */
export function checkOpaqueAuth(text) {
  const raw = String(text ?? '').trim();
  if (raw.length < 8 || raw.length > 100_000) throw new HttpError(400, "Ce n'est pas un fichier de connexion Google valable");
  return raw;
}

export async function saveRefreshedAuth(app, userId, linkedAt, authJson) {
  try {
    const link = await readLink(app.db, userId);
    if (!link || ![MODES.chatgpt_account, MODES.google_account].includes(link.mode) || (link.linked_at ?? null) !== linkedAt) return false;
    // Compte ChatGPT : fichier JSON vérifié ; compte Google : fichier opaque, seulement non vide et de taille raisonnable
    const compact = link.mode === MODES.google_account ? checkOpaqueAuth(authJson) : parseAuthJson(authJson);
    if (decrypt(app.cfg.secretKey, link.secret_enc) === compact) return false;
    await writeLink(app.db, userId, { ...link, secret_enc: encrypt(app.cfg.secretKey, compact), refreshed_at: now() });
    return true;
  } catch (e) {
    console.warn(`[liaison] connexion renouvelée mais non enregistrée (utilisateur ${Number(userId)}) : ${String(e.message).slice(0, 120)}`);
    return false;
  }
}

/**
 * Compte Google (abonnement Google AI) : fichier de connexion d'Antigravity CLI, collé par l'utilisateur ou produit par la connexion guidée
 * (src/googlelogin.js). Désactivé tant que l'administrateur n'a pas mis GOOGLE_ACCOUNT_ENABLED. Le consentement est vérifié AVANT tout, la connexion
 * par un appel minimal à agy (quelques milliers de tokens décomptés de l'abonnement).
 */
export async function linkGoogleAccount(app, userId, { authFile, accept, via = 'paste' }) {
  assertGoogleConsent(app.cfg, accept);
  const provider = getProvider('gemini');
  const compact = checkOpaqueAuth(authFile);
  const checked = await (app.validateGoogleAccount || provider.validateAccount)(app, compact);
  const stored = checked?.authFile ? checkOpaqueAuth(checked.authFile) : compact; // le test a pu renouveler le fichier : on garde le plus récent
  const consent = { at: now(), version: GOOGLE_CONSENT_VERSION };
  await saveLink(app, userId, { provider: 'gemini', mode: MODES.google_account, secret_enc: encrypt(app.cfg.secretKey, stored), consent, via });
  await setSetting(app.db, userId, 'google_consent_json', JSON.stringify(consent));
}

/** Consentement obligatoire avant tout lancement d'une connexion Google (guidée ou collée), et mode activé par l'administrateur. */
export function assertGoogleConsent(cfg, accept) {
  if (cfg.cliModeEnabled === false) throw new HttpError(403, CLI_DISABLED_MESSAGE);
  if (!googleEnabled) throw new HttpError(403, GOOGLE_DISABLED_MESSAGE);
  if (!truthy(accept)) throw new HttpError(400, `Tu dois cocher « ${CONSENT_CHECKBOX} » pour utiliser ton abonnement Google`);
}

/**
 * Compte ChatGPT : fichier de connexion collé par l'utilisateur, ou produit par la connexion guidée (src/chatgptlogin.js).
 * Le consentement est vérifié AVANT tout. La connexion est vérifiée par un appel minimal à Codex (quelques tokens décomptés de l'abonnement).
 */
export async function linkChatgptAccount(app, userId, { authJson, accept, via = 'paste' }) {
  if (app.cfg.cliModeEnabled === false) throw new HttpError(403, CLI_DISABLED_MESSAGE);
  if (!truthy(accept)) throw new HttpError(400, `Tu dois cocher « ${CONSENT_CHECKBOX} » pour utiliser ton compte ChatGPT`);
  const provider = getProvider('openai');
  const compact = parseAuthJson(authJson);
  const checked = await (app.validateAccount || provider.validateAccount)(app, compact);
  const stored = checked?.authFile ? parseAuthJson(checked.authFile) : compact; // le test a pu renouveler les jetons : on garde les plus récents
  const consent = { at: now(), version: OPENAI_CONSENT_VERSION };
  await saveLink(app, userId, { provider: 'openai', mode: MODES.chatgpt_account, secret_enc: encrypt(app.cfg.secretKey, stored), consent, via });
  await setSetting(app.db, userId, 'openai_consent_json', JSON.stringify(consent));
}

// ---------- Validation ----------

// Appel minimal du CLI avec le jeton (modèle le plus petit, 1 tour, aucun outil). Ce n'est PAS gratuit : quelques tokens
// sont décomptés de l'abonnement. Aucune commande du CLI ne vérifie un jeton sans appel au modèle.
export async function validateSubscriptionToken(app, token) {
  let r;
  try {
    r = await runClaude({
      bin: app.cfg.claudeBin, prompt: 'Réponds uniquement : ok', model: 'haiku', maxTurns: 1, tools: [], timeoutMs: 90_000,
      sandbox: app.cfg.sandbox, secretEnv: { CLAUDE_CODE_OAUTH_TOKEN: token },
    });
  } catch (e) {
    console.warn(`Vérification du jeton d'abonnement : le CLI n'a pas pu s'exécuter : ${String(e.message).slice(0, 300)}`);
    throw new HttpError(502, "Le CLI Claude n'a pas pu être lancé sur le serveur (bac à sable ou installation). Préviens l'administrateur.", { expose: true });
  }
  if (r.ok) return;
  // Ce que Claude a vraiment répondu : affiché à l'utilisateur et journalisé (le secret est déjà masqué par runClaude)
  const said = String(r.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 240) || `(sans texte, ${r.subtype ?? 'erreur'})`;
  console.warn(`Vérification du jeton d'abonnement refusée (${r.subtype ?? 'erreur'}) : ${said}`);
  // Refus d'authentification, au sens strict : on n'invalide la liaison que pour ces réponses-là
  if (isAuthRefusal(`${r.text} ${r.subtype}`)) {
    throw new HttpError(400, `Jeton refusé par Claude (invalide ou expiré). Réponse de Claude : ${said}`);
  }
  throw new HttpError(502, `Le jeton n'a pas pu être vérifié : Claude a répondu « ${said} ». Réessaie plus tard.`, { expose: true });
}

// ---------- Liaison ----------

/** IA de l'utilisateur (une liaison sans fournisseur est une liaison Claude) ; Claude aussi quand il n'a rien relié. */
export async function userProvider(db, userId) {
  const id = (await readLink(db, userId))?.provider ?? DEFAULT_PROVIDER;
  return hasProvider(id) ? id : DEFAULT_PROVIDER;
}

/** Dernier changement d'IA de l'utilisateur ({ from, to, at } avec les noms affichables), pour le lui dire dans les Réglages ; null s'il n'en a pas fait. */
export async function aiSwitchOf(db, userId) {
  try {
    const j = JSON.parse(await getSetting(db, userId, 'ai_switch_json') || 'null');
    if (!j || !hasProvider(j.from) || !hasProvider(j.to) || j.from === j.to) return null;
    return { from: getProvider(j.from).label, to: getProvider(j.to).label, at: j.at };
  } catch { return null; }
}

/** Nom affichable de l'IA de l'utilisateur (« Claude », « ChatGPT », « Gemini »). */
export async function providerLabelOf(db, userId) {
  return getProvider(await userProvider(db, userId)).label;
}

// Réglages de modèle : ceux d'une IA n'existent pas chez une autre
const MODEL_SETTINGS = ['analyze_model', 'prospect_model', 'write_model', 'chat_model'];

/**
 * L'utilisateur change d'IA : ses choix de modèle repartent du défaut de la nouvelle (ils sont lus avec le catalogue de CE fournisseur).
 * La date et les IA concernées sont gardées pour le dire à l'écran. Ses consignes personnalisées restent en base (masquées tant qu'il n'est pas revenu).
 */
async function resetModelsOnSwitch(db, userId, from, to) {
  for (const k of MODEL_SETTINGS) await setSetting(db, userId, k, null);
  await setSetting(db, userId, 'ai_switch_json', JSON.stringify({ from, to, at: now() }));
}

export async function saveLink(app, userId, link) {
  const t = now();
  const before = await readLink(app.db, userId);
  const to = link.provider ?? DEFAULT_PROVIDER;
  if (before?.mode && (before.provider ?? DEFAULT_PROVIDER) !== to) await resetModelsOnSwitch(app.db, userId, before.provider ?? DEFAULT_PROVIDER, to);
  await writeLink(app.db, userId, { v: 1, provider: DEFAULT_PROVIDER, valid: true, linked_at: t, validated_at: t, last_test_at: t, ...link });
  await resetQuotaState(app.db, userId);
}

/** Mode A : clé API (de l'IA choisie : Claude par défaut). Validée, chiffrée, jamais réaffichée. */
export async function linkApiKey(app, userId, apiKey, providerId = DEFAULT_PROVIDER) {
  if (!hasProvider(providerId)) throw new HttpError(400, 'IA inconnue');
  const provider = getProvider(providerId);
  const key = String(apiKey ?? '').trim();
  if (!provider.apiKey.pattern.test(key)) throw new HttpError(400, provider.apiKey.invalidFormat);
  await (app.validateApiKey || provider.apiKey.validate)(key, app.fetch || fetch);
  await saveLink(app, userId, { provider: provider.id, mode: MODES.api_key, secret_enc: encrypt(app.cfg.secretKey, key), last4: key.slice(-4) });
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

/**
 * Jeton obtenu par la connexion guidée (src/claudelogin.js), déjà vérifié par l'appelant avant d'arriver ici.
 * Le consentement est exigé au démarrage de la connexion, et enregistré ici avec sa date.
 */
export async function linkLoginToken(app, userId, token) {
  if (app.cfg.cliModeEnabled === false) throw new HttpError(403, CLI_DISABLED_MESSAGE);
  const tok = String(token ?? '').trim();
  if (!TOKEN_RE.test(tok)) throw new HttpError(502, "Claude n'a pas renvoyé de jeton utilisable. Recommence.", { expose: true });
  const consent = { at: now(), version: CONSENT_VERSION };
  await saveLink(app, userId, { mode: MODES.subscription_token, secret_enc: encrypt(app.cfg.secretKey, tok), consent, via: 'login' });
  await setSetting(app.db, userId, 'claude_cli_consent_json', JSON.stringify(consent));
}

/** Consentement obligatoire avant de lancer la connexion guidée (même exigence que le jeton collé). */
export function assertLoginConsent(cfg, accept) {
  if (cfg.cliModeEnabled === false) throw new HttpError(403, CLI_DISABLED_MESSAGE);
  if (!truthy(accept)) throw new HttpError(400, `Tu dois cocher « ${CONSENT_CHECKBOX} » pour utiliser ton abonnement`);
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
  const link = await readLink(app.db, userId);
  if (!link?.mode || !MODES[link.mode]) throw new HttpError(400, LINK_REQUIRED_MESSAGE);
  const mark = async (valid) => writeLink(app.db, userId, { ...(await readLink(app.db, userId) ?? link), valid, last_test_at: now(), ...(valid ? { validated_at: now() } : {}) });
  try {
    let secret;
    try { secret = decrypt(app.cfg.secretKey, link.secret_enc); } catch { secret = null; }
    if (!secret) { await mark(false); return { ok: false, message: 'Secret illisible : relie de nouveau ton accès Claude' }; }
    if (link.mode === MODES.api_key) await (app.validateApiKey || getProvider(link.provider).apiKey.validate)(secret, app.fetch || fetch);
    else if (link.mode === MODES.chatgpt_account || link.mode === MODES.google_account) {
      if (app.cfg.cliModeEnabled === false) return { ok: false, message: CLI_DISABLED_MESSAGE };
      if (link.mode === MODES.google_account && !googleEnabled) return { ok: false, message: GOOGLE_DISABLED_MESSAGE };
      // File d'attente du compte : un test ne passe jamais en même temps qu'un job (le jeton de rafraîchissement est à usage unique)
      await withUserLock(userId, async () => {
        const fresh = await readLink(app.db, userId);
        const cur = fresh ? decrypt(app.cfg.secretKey, fresh.secret_enc) : secret;
        const c = await (app.validateAccount || getProvider(link.provider).validateAccount)(app, cur);
        if (c?.authFile) await saveRefreshedAuth(app, userId, fresh?.linked_at ?? null, c.authFile);
      });
    } else {
      if (app.cfg.cliModeEnabled === false) return { ok: false, message: CLI_DISABLED_MESSAGE };
      await (app.validateToken || ((t) => validateSubscriptionToken(app, t)))(secret);
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
  if (pathname === '/raccourcis') return true; // une page d'aide, sans accès à l'IA
  if (pathname === '/abonnement/portail') return true; // on doit toujours pouvoir gérer ou résilier son abonnement, même sans IA reliée
  if (pathname === '/welcome' || pathname === '/welcome/skip') return true; // le profil ne demande pas d'accès Claude
  if (pathname.startsWith('/instagram/')) return true; // relier Instagram ne demande pas d'accès à l'IA
  if (pathname.startsWith('/linkedin/')) return true; // un administrateur d'équipe relie LinkedIn avec l'accès Claude du propriétaire
  if (pathname === '/team' || pathname.startsWith('/team/')) return true; // on peut gérer son équipe ou accepter une invitation sans avoir relié Claude
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return true; // les administrateurs gèrent les comptes même sans liaison
  return method === 'POST' && pathname === '/logout';
}
