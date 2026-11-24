// Longueurs maximales de TOUS les champs de saisie : une seule source, utilisée par les écrans (attribut `maxlength`) ET par les routes (refus 400).
// Règle (docs/UX.md, « Champs de saisie ») : un champ de N caractères attendus n'en accepte jamais plus de N ; un texte libre a toujours un maximum ;
// un nombre a un minimum et un maximum. Le navigateur aide, le serveur décide : une valeur trop longue est REFUSÉE (jamais tronquée en silence :
// tronquer un mot de passe ou un jeton le changerait).
import { HttpError } from './http.js';

export const LEN = {
  totp: 6,            // code d'une application d'authentification
  recovery: 11,       // code de secours « xxxxx-xxxxx »
  email: 254,         // longueur maximale d'une adresse (RFC 5321)
  host: 255,          // nom d'hôte (DNS)
  user: 255,          // identifiant d'un service (souvent une adresse e-mail)
  database: 64,       // nom de base MySQL / PostgreSQL
  password: 256,      // mot de passe d'un service tiers
  token: 600,         // clé API ou jeton d'accès
  url: 500,           // adresse d'un dépôt ou d'un serveur
  webhook: 300,       // adresse d'un webhook Discord ou Slack
  chat: 64,           // identifiant de conversation Telegram
  name: 100,          // nom, libellé
  fromName: 80,       // nom d'expéditeur
  search: 100,        // champ de recherche
  subject: 200,       // objet d'un mail
  description: 300,   // courte description
  mailBody: 5000,     // corps d'un mail modèle
  list: 2000,         // une liste saisie à la ligne (secteurs, requêtes)
  authFile: 20000,    // fichier de connexion collé (auth.json)
  amount: 12,         // montant saisi (« 12345,67 »)
  region: 40,         // région d'un service cloud
  deviceCode: 512,    // code à coller depuis le fournisseur d'IA
};
export const PORT = { min: 1, max: 65535 };

/**
 * Refuse (400) une valeur trop longue : `checkLengths(body, { host: [LEN.host, 'Hôte'], pass: [LEN.password, 'Mot de passe'] })`.
 * Seules les chaînes sont mesurées ; un champ absent n'est pas une erreur ici (la route décide s'il est obligatoire).
 */
export function checkLengths(body, spec) {
  for (const [field, [max, label]] of Object.entries(spec)) {
    const v = body?.[field];
    if (typeof v === 'string' && v.length > max) throw new HttpError(400, `${label} trop long : ${max} caractères au plus`, { expose: true });
  }
}
