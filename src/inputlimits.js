// Longueurs maximales de TOUS les champs de saisie : une seule source, utilisée par les écrans (attribut `maxlength`) ET par les routes (refus 400).
// Règle (docs/UX.md, « Champs de saisie ») : un champ de N caractères attendus n'en accepte jamais plus de N ; un texte libre a toujours un maximum ;
// un nombre a un minimum et un maximum. Le navigateur aide, le serveur décide : une valeur trop longue est REFUSÉE (jamais tronquée en silence :
// tronquer un mot de passe ou un jeton le changerait).
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

// Champs dont le NOM est sans ambiguïté dans toute l'application (réglages de services, secrets, adresses) : une valeur plus longue est refusée par readBody (src/http.js),
// pour TOUTES les routes d'un coup. Les champs de contenu (description, objet, corps de mail…) ont leur propre plafond dans leur route, parce que leur nom sert à
// plusieurs écrans. Un suffixe `_<numéro>` (git_host_2, discord_url_0) est ignoré.
export const FIELD_LIMITS = {
  apiKey: [LEN.token, 'Clé API'], token: [LEN.token, 'Jeton'], authJson: [LEN.authFile, 'Fichier de connexion'], authFile: [LEN.authFile, 'Fichier de connexion'],
  code: [LEN.deviceCode, 'Code'], gitUrl: [LEN.url, 'Adresse du dépôt'], email: [LEN.email, 'Adresse e-mail'], confirm: [LEN.email, 'Confirmation'],
  host: [LEN.host, 'Hôte'], user: [LEN.user, 'Utilisateur'], pass: [LEN.password, 'Mot de passe'], password: [LEN.password, 'Mot de passe'], database: [LEN.database, 'Base de données'],
  fromEmail: [LEN.email, "Adresse d'envoi"], fromName: [LEN.fromName, "Nom d'expéditeur"],
  git_host: [LEN.url, 'Adresse du serveur Git'], git_token: [LEN.token, 'Jeton Git'], discord_url: [LEN.webhook, 'Lien du webhook'], slack_url: [LEN.webhook, 'Lien du webhook'],
  telegram_token: [100, 'Jeton Telegram'], telegram_chat: [LEN.chat, 'Conversation Telegram'], email_to: [LEN.email, 'Adresse e-mail'], notify_email: [LEN.email, 'Adresse e-mail'],
  github_token: [LEN.token, 'Jeton GitHub'], voiceKey: [LEN.token, 'Clé API'], voiceRegion: [LEN.region, 'Région'],
};

/** Premier champ connu dont la valeur dépasse sa limite : { field, label, max } ; sinon null. Ne mesure que les chaînes du premier niveau. */
export function findTooLong(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const [k, v] of Object.entries(body)) {
    if (typeof v !== 'string') continue;
    const lim = FIELD_LIMITS[k] || FIELD_LIMITS[k.replace(/_\d{1,2}$/, '')];
    if (lim && v.length > lim[0]) return { field: k, label: lim[1], max: lim[0] };
  }
  return null;
}
