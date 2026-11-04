// Registre des fournisseurs d'IA. Chaque utilisateur a UNE IA active ; ce module dit ce qu'elle sait faire.
//
// Forme d'un fournisseur :
//   id, label, company      identité (id stable, stocké dans la liaison)
//   modes                   { mode: { env, label } } : manières de se connecter, et variable d'environnement du secret
//   apiKey                  { pattern, invalidFormat, validate(key, fetch) } : clé API (format, message, vérification sans coût)
//   bin(cfg)                exécutable du CLI
//   run(options)            lance le CLI dans le bac à sable ; résout toujours { ok, subtype, text, allText, costUsd, tokensIn, tokensOut, turns, rateLimit }
//   rateLimitWindows(info)  quota remonté par le CLI → { fiveHour, sevenDay } ou null (pas de quota affiché)
//   isAuthRefusal(text)     la réponse dit-elle « accès refusé » ?
import { claudeProvider } from './claude.js';
import { geminiProvider } from './gemini.js';

export const DEFAULT_PROVIDER = 'claude';

const PROVIDERS = new Map([claudeProvider, geminiProvider].map((p) => [p.id, p]));

export const providerIds = () => [...PROVIDERS.keys()];
export const listProviders = () => [...PROVIDERS.values()];
export const hasProvider = (id) => PROVIDERS.has(id);

/** Fournisseur d'un identifiant ; une liaison sans identifiant (créée avant les autres IA) est une liaison Claude. */
export function getProvider(id = DEFAULT_PROVIDER) {
  const p = PROVIDERS.get(id ?? DEFAULT_PROVIDER);
  if (!p) throw new Error(`Fournisseur d'IA inconnu : ${id}`);
  return p;
}
