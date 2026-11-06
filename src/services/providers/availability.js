// Quelles IA peut-on proposer sur CE serveur ? Un fournisseur dont le CLI n'est pas installé ferait échouer tous les jobs de celui qui relierait sa clé :
// sa carte est alors grisée sur la page de liaison. Claude est toujours proposé (son CLI est un prérequis de l'application).
import { resolveBin } from '../sandbox.js';

/**
 * @returns {Record<string, boolean>} identifiant du fournisseur → utilisable sur ce serveur. Gemini a deux moteurs : Gemini CLI (clé API, `geminiKey`) et, si
 * l'administrateur l'a activé (`deps.googleEnabled`), Antigravity CLI (compte Google, `googleAccount`) ; la carte est proposée si l'un des deux est installé.
 */
export function availableProviders(cfg, deps = {}) {
  const has = deps.resolveBin || resolveBin;
  const geminiKey = !!has(cfg.geminiBin || 'gemini');
  const googleAccount = !!deps.googleEnabled && !!has(cfg.agyBin || 'agy');
  return { claude: true, openai: !!has(cfg.codexBin || 'codex'), gemini: geminiKey || googleAccount, geminiKey, googleAccount };
}
