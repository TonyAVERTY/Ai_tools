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
  // Événements de l'agenda (ajout, suppression)
  event: { user: { max: 60, windowMs: 10 * MIN } },
  chat: { user: { max: 40, windowMs: 10 * MIN } },
  chat_upload: { user: { max: 60, windowMs: 10 * MIN } },
  // Vidéos de promotion : un rendu coûte un appel Claude et plusieurs minutes de processeur
  promo: { user: { max: 20, windowMs: HOUR } },
  // Abonnement iCal (lien secret) : un agenda interroge au plus quelques fois par heure
  ical: { ip: { max: 60, windowMs: 10 * MIN } },
  // API (mode développeur) : par adresse avant authentification, par compte ensuite
  api_ip: { ip: { max: 300, windowMs: MIN } },
  api: { user: { max: 120, windowMs: MIN } },
  // Connexion : démarrage (Google, Apple) et retours des fournisseurs
  auth_start: { ip: { max: 20, windowMs: 10 * MIN } },
  auth_callback: { ip: { max: 40, windowMs: 10 * MIN } },
  // Désinscription (page publique, lien reçu par mail) : large pour un lecteur légitime, étroit pour un robot qui devine
  unsub: { ip: { max: 60, windowMs: 10 * MIN } },
  // Liaison Claude : chaque essai de clé ou de jeton coûte un appel réseau chez Anthropic
  link: { user: { max: 10, windowMs: 10 * MIN }, ip: { max: 30, windowMs: 10 * MIN } },
  // Export / import CSV
  csv: { user: { max: 10, windowMs: 10 * MIN } },
  // Envois : lancement d'un lot, rapport par mail, notification de test
  mail_send: { user: { max: 30, windowMs: HOUR } },
  // Régénération d'accroche : un appel Claude (lecture du site) à chaque fois
  enrich: { user: { max: 40, windowMs: HOUR } },
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
 *  - `mails` et `aiJobs` : par mois calendaire, heure de Paris ;
 *  - `seats` : places d'équipe, propriétaire compris (1 = pas d'équipe). L'équipe utilise le plan et les plafonds de son propriétaire.
 * Le plan « pro » est un ancien plan illimité attribué à la main : il reste tel quel pour ne retirer l'accès à personne,
 * mais il n'est pas proposé sur la page Tarifs.
 *
 * Les offres payantes respectent deux contraintes du serveur :
 *  - `mails` ne dépasse jamais 300 × 30 : un compte ne peut pas envoyer plus de 300 mails par 24 h (voir README) ;
 *  - `aiJobs` couvre au moins `prospects / 50` recherches (une recherche ramène 50 contacts au plus), plus l'analyse et les modèles.
 */
export const PLAN_LIMITS = {
  free: { projects: 1, prospects: 50, mails: 100, aiJobs: 6, seats: 1 },
  starter: { projects: 2, prospects: 300, mails: 500, aiJobs: 20, seats: 2 },
  growth: { projects: 5, prospects: 1000, mails: 1500, aiJobs: 60, seats: 3 },
  business: { projects: 10, prospects: 3000, mails: 4000, aiJobs: 150, seats: 10 },
  intensive: { projects: 25, prospects: 10000, mails: 8000, aiJobs: 400, seats: 25 },
  pro: { projects: null, prospects: null, mails: null, aiJobs: null, seats: null },
  admin: { projects: null, prospects: null, mails: null, aiJobs: null, seats: null },
};
export const PLAN_LABELS = {
  free: 'gratuit', starter: 'Démarrage', growth: 'Croissance', business: 'Business', intensive: 'Intensif',
  pro: 'pro (illimité)', admin: 'administrateur',
};

/**
 * Offres payantes : prix mensuel TTC en euros. L'éditeur est en franchise de TVA (art. 293 B du CGI) : le prix TTC est le prix payé.
 * En annuel, 2 mois sont offerts : on paie 10 mois et on en profite 12.
 */
export const PLAN_PRICES = { starter: 10, growth: 25, business: 50, intensive: 100 };
export const ANNUAL_FREE_MONTHS = 2;
export const annualPrice = (plan) => PLAN_PRICES[plan] * (12 - ANNUAL_FREE_MONTHS);
export const PAID_PLANS = ['free', ...Object.keys(PLAN_PRICES), 'pro']; // plans qu'un administrateur peut attribuer depuis le back-office

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
