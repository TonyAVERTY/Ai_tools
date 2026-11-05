// Fournisseur d'IA « Claude » (Anthropic) : tout ce qui est propre à Claude Code et à l'API Anthropic.
// Un fournisseur expose toujours la même forme (voir providers/index.js) : le reste de l'application ne parle qu'à cette forme.
import { runClaude, rateLimitWindows } from '../claude.js';
import { SECRET_ENV } from './secretenv.js';
import { HttpError } from '../../http.js';

const MODELS_URL = 'https://api.anthropic.com/v1/models';

/** Réponse qui signifie « ton accès est refusé » (jeton expiré ou révoqué, clé invalide) : au sens strict, jamais une panne réseau. */
export const isAuthRefusal = (text) => /invalid (bearer )?token|invalid (x-)?api[ _-]?key|authentication_error|please run \/login|not logged in|oauth token (has )?(expired|been revoked)|token (has )?(expired|been revoked)|invalid.{0,20}credential|unauthori[sz]ed|\b401\b/i.test(String(text ?? ''));

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

export const claudeProvider = {
  id: 'claude',
  label: 'Claude',
  company: 'Anthropic',
  /** Modes de connexion : variable d'environnement qui porte le secret dans le processus enfant. */
  modes: {
    api_key: { env: SECRET_ENV.claude.api_key, label: 'Clé API Anthropic' },
    subscription_token: { env: SECRET_ENV.claude.subscription_token, label: 'Abonnement Claude (jeton)' },
  },
  /** Clé API : format attendu, message si le format est mauvais, vérification sans coût auprès du fournisseur. */
  apiKey: { pattern: /^sk-ant-[A-Za-z0-9_-]{20,400}$/, invalidFormat: 'Clé API invalide (elle commence par sk-ant-)', validate: validateApiKey },
  /** Exécutable du CLI, d'après la configuration du serveur. */
  bin: (cfg) => cfg.claudeBin,
  run: runClaude,
  rateLimitWindows,
  isAuthRefusal,
};
