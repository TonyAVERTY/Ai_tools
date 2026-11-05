// Quelles IA peut-on proposer sur CE serveur ? Un fournisseur dont le CLI n'est pas installé ferait échouer tous les jobs de celui qui relierait sa clé :
// sa carte est alors grisée sur la page de liaison. Claude est toujours proposé (son CLI est un prérequis de l'application).
import { resolveBin } from '../sandbox.js';

/** @returns {Record<string, boolean>} identifiant du fournisseur → utilisable sur ce serveur */
export function availableProviders(cfg, deps = {}) {
  const has = deps.resolveBin || resolveBin;
  return { claude: true, openai: !!has(cfg.codexBin || 'codex'), gemini: !!has(cfg.geminiBin || 'gemini') };
}
