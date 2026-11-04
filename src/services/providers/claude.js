// Fournisseur d'IA « Claude » (Anthropic) : tout ce qui est propre à Claude Code et à l'API Anthropic.
// Un fournisseur expose toujours la même forme (voir providers/index.js) : le reste de l'application ne parle qu'à cette forme.
import { runClaude, rateLimitWindows } from '../claude.js';
import { SECRET_ENV } from './secretenv.js';

/** Réponse qui signifie « ton accès est refusé » (jeton expiré ou révoqué, clé invalide) : au sens strict, jamais une panne réseau. */
export const isAuthRefusal = (text) => /invalid (bearer )?token|invalid (x-)?api[ _-]?key|authentication_error|please run \/login|not logged in|oauth token (has )?(expired|been revoked)|token (has )?(expired|been revoked)|invalid.{0,20}credential|unauthori[sz]ed|\b401\b/i.test(String(text ?? ''));

export const claudeProvider = {
  id: 'claude',
  label: 'Claude',
  company: 'Anthropic',
  /** Modes de connexion : variable d'environnement qui porte le secret dans le processus enfant. */
  modes: {
    api_key: { env: SECRET_ENV.claude.api_key, label: 'Clé API Anthropic' },
    subscription_token: { env: SECRET_ENV.claude.subscription_token, label: 'Abonnement Claude (jeton)' },
  },
  /** Exécutable du CLI, d'après la configuration du serveur. */
  bin: (cfg) => cfg.claudeBin,
  run: runClaude,
  rateLimitWindows,
  isAuthRefusal,
};
