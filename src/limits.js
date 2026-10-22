// Configuration unique des seuils : débit, plafonds des plans, détection d'abus, ports autorisés.
// Tout ce qui se règle (fenêtre, nombre de requêtes, plafond d'un plan) se règle ICI et nulle part ailleurs ;
// les pages Tarifs et Fonctionnement lisent aussi ces valeurs, pour ne jamais annoncer un chiffre différent du code.

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * Limitation de débit, en mémoire. Chaque règle donne, par portée, un nombre maximal de requêtes sur une fenêtre glissante.
 *  - `ip` : adresse du client (voir TRUST_PROXY dans la configuration) ;
 *  - `user` : compte connecté.
 * Une requête passe seulement si toutes les portées de la règle l'acceptent.
 */
export const RATE_LIMITS = {
  // Connexion : démarrage (Google, Apple) et retours des fournisseurs
  auth_start: { ip: { max: 20, windowMs: 10 * MIN } },
  auth_callback: { ip: { max: 40, windowMs: 10 * MIN } },
  // Liaison Claude : chaque essai de clé ou de jeton coûte un appel réseau chez Anthropic
  link: { user: { max: 10, windowMs: 10 * MIN }, ip: { max: 30, windowMs: 10 * MIN } },
  // Export / import CSV
  csv: { user: { max: 10, windowMs: 10 * MIN } },
  // Envois : lancement d'un lot, rapport par mail, notification de test
  mail_send: { user: { max: 30, windowMs: HOUR } },
  // Création de projet (clone du dépôt, analyse)
  project_create: { user: { max: 10, windowMs: HOUR } },
  // Suppression de compte
  account_delete: { user: { max: 5, windowMs: HOUR }, ip: { max: 10, windowMs: HOUR } },
  // Tests de connexion vers les services de l'utilisateur (IMAP, base du récap, SMTP)
  conn_test: { user: { max: 20, windowMs: 10 * MIN } },
  // Back-office
  admin: { user: { max: 120, windowMs: MIN } },
};

/**
 * Plafonds par plan. `null` = illimité.
 *  - `projects` et `prospects` : totaux du compte ;
 *  - `mails` et `aiJobs` : par mois calendaire, heure de Paris.
 * Le plan « pro » n'est pas encore défini commercialement : illimité en attendant (voir docs/JOURNAL.md).
 */
export const PLAN_LIMITS = {
  free: { projects: 1, prospects: 50, mails: 100, aiJobs: 5 },
  pro: { projects: null, prospects: null, mails: null, aiJobs: null },
  admin: { projects: null, prospects: null, mails: null, aiJobs: null },
};
export const PLAN_LABELS = { free: 'gratuit', pro: 'pro', admin: 'administrateur' };
export const PAID_PLANS = ['free', 'pro']; // plans qu'un administrateur peut attribuer depuis le back-office

/** Détection d'abus à l'envoi : pause du compte quand trop de mails sont rejetés. */
export const ABUSE = {
  minSent: 50,        // pas de décision avant ce nombre de prospects contactés
  maxBounceRate: 0.10, // pause au-dessus de 10 % de rejets
  windowDays: 30,     // fenêtre d'observation
};

/** Comptes inactifs : avertissement avant suppression, durée de conservation du journal d'administration. */
export const INACTIVITY = {
  defaultMonths: 24,
  warningDays: 30,
  auditRetentionMonths: 12,
};

/** Pagination du back-office. */
export const ADMIN_PAGE_SIZE = 25;

/**
 * Ports autorisés pour les hôtes saisis par l'utilisateur. Les ports de services managés connus (DigitalOcean, par exemple)
 * sont inclus ; tout autre port est refusé, sauf pour un administrateur avec ALLOW_PRIVATE_HOSTS.
 */
export const ALLOWED_PORTS = {
  smtp: [25, 465, 587, 2525],
  imap: [143, 993],
  mysql: [3306, 3307, 25060],
  pg: [5432, 5433, 25061],
  git: [443, 8443],
};

/** Charge serveur : au-delà de ce rapport charge/cœurs, les nouveaux jobs IA attendent (reprise 0,1 plus bas). */
export const LOAD = { defaultMax: 0.9, resumeGap: 0.1 };
