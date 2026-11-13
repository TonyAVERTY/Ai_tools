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
  // Toute écriture d'un compte connecté sur une route sans règle propre : large pour un humain (une par seconde en moyenne), étroit pour une boucle
  write: { user: { max: 600, windowMs: 10 * MIN } },
  // Événements de l'agenda (ajout, suppression)
  event: { user: { max: 60, windowMs: 10 * MIN } },
  chat: { user: { max: 40, windowMs: 10 * MIN } },
  chat_upload: { user: { max: 60, windowMs: 10 * MIN } },
  // Ajout, modification et suppression de prospects ; aperçu d'un mail (rendu sans envoi)
  // Recherche (⌘K) : une requête par frappe ralentie côté navigateur
  search: { user: { max: 300, windowMs: 10 * MIN } },
  prospect_write: { user: { max: 120, windowMs: 10 * MIN } },
  preview: { user: { max: 120, windowMs: 10 * MIN } },
  // Contrôle du sens d'un mail dans l'aperçu : chacun coûte un appel à l'IA de la personne
  sense: { user: { max: 40, windowMs: 10 * MIN } },
  // Tâches des postes : chacune coûte un appel Claude
  poste: { user: { max: 40, windowMs: HOUR } },
  // Vidéos de promotion : un rendu coûte un appel Claude et plusieurs minutes de processeur
  promo: { user: { max: 20, windowMs: HOUR } },
  // Extraits d'écoute des voix : chacun interroge un service de voix extérieur (mis en cache côté serveur)
  promo_voice: { user: { max: 60, windowMs: 10 * MIN } },
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
  // Abonnement : ouverture du paiement ou du portail (chacun crée une session chez Stripe)
  billing: { user: { max: 20, windowMs: 10 * MIN } },
  // Événements de Stripe (webhook public, signé) : large, Stripe peut en envoyer des rafales
  stripe_webhook: { ip: { max: 600, windowMs: MIN } },
  // Liaison Claude : chaque essai de clé ou de jeton coûte un appel réseau chez Anthropic
  link: { user: { max: 10, windowMs: 10 * MIN }, ip: { max: 30, windowMs: 10 * MIN } },
  // Connexion guidée ChatGPT : la page demande où en est la connexion toutes les 2 s pendant 15 minutes au plus (lecture seule, aucun appel réseau
  // vers OpenAI). Elle ne doit JAMAIS compter dans « link » ci-dessus, sinon elle l'épuise en quelques secondes.
  link_poll: { user: { max: 600, windowMs: 10 * MIN }, ip: { max: 900, windowMs: 10 * MIN } },
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
  // Comptabilité : saisie, envoi des justificatifs ; export de l'archive (plusieurs Mo, lecture de tous les fichiers)
  compta: { user: { max: 120, windowMs: 10 * MIN } },
  compta_export: { user: { max: 10, windowMs: 10 * MIN } },
  // Back-office
  admin: { user: { max: 120, windowMs: MIN } },
};

/**
 * Plafonds par plan. `null` = illimité.
 *  - `projects` et `prospects` : totaux du compte ;
 *  - `mails` et `aiJobs` : par SEMAINE (du lundi 0 h au lundi suivant, heure de Paris), comme le quota de l'IA ;
 *  - `parallelJobs` : jobs IA qu'un compte peut faire tourner EN MÊME TEMPS (multi jobs). 1 = un à la fois : c'est l'offre gratuite ; le multi jobs
 *    est réservé aux offres payantes et grandit avec l'offre. Aucune limite globale sur le serveur : seule l'offre compte ;
 *  - `seats` : places d'équipe, propriétaire compris (1 = pas d'équipe). L'équipe utilise le plan et les plafonds de son propriétaire.
 * Le plan « pro » est un ancien plan illimité attribué à la main : il reste tel quel pour ne retirer l'accès à personne,
 * mais il n'est pas proposé sur la page Tarifs.
 *
 * Les offres payantes respectent deux contraintes du serveur :
 *  - `mails` ne dépasse jamais 300 × 7 : un compte ne peut pas envoyer plus de 300 mails par 24 h (voir README) ;
 *  - `aiJobs` × 4 semaines couvre au moins `prospects / 50` recherches (une recherche ramène 50 contacts au plus), plus l'analyse et les modèles.
 */
export const PLAN_LIMITS = {
  free: { projects: 2, prospects: 100, mails: 50, aiJobs: 4, parallelJobs: 1, seats: 1 },
  starter: { projects: 3, prospects: 500, mails: 250, aiJobs: 12, parallelJobs: 2, seats: 2 },
  growth: { projects: 8, prospects: 1500, mails: 700, aiJobs: 35, parallelJobs: 3, seats: 3 },
  business: { projects: 15, prospects: 5000, mails: 1400, aiJobs: 90, parallelJobs: 4, seats: 10 },
  intensive: { projects: 40, prospects: 15000, mails: 2100, aiJobs: 220, parallelJobs: 6, seats: 25 },
  pro: { projects: null, prospects: null, mails: null, aiJobs: null, parallelJobs: 6, seats: null },
  admin: { projects: null, prospects: null, mails: null, aiJobs: null, parallelJobs: 6, seats: null },
};
export const PLAN_LABELS = {
  free: 'gratuit', starter: 'Démarrage', growth: 'Croissance', business: 'Business', intensive: 'Intensif',
  pro: 'pro (illimité)', admin: 'administrateur',
};

/**
 * Offres payantes : prix mensuel TTC en euros. L'éditeur est en franchise de TVA (art. 293 B du CGI) : le prix TTC est le prix payé.
 * En annuel, 2 mois sont offerts : on paie 10 mois et on en profite 12.
 */
export const PLAN_PRICES = { starter: 9, growth: 19, business: 29, intensive: 75 };

/**
 * Fonctionnalités réservées à une offre : chacune donne la PREMIÈRE offre qui la comprend (les offres au-dessus l'ont aussi).
 * Les plans « pro » et administrateur ont tout. Ce qui n'est pas listé ici est inclus dès le plan gratuit.
 * Seul le LANCEMENT d'un nouveau travail est refusé : ce qui existe déjà (documents, vidéos, brouillons, jetons) reste lisible, rien n'est supprimé.
 */
export const PLAN_ORDER = ['free', 'starter', 'growth', 'business', 'intensive'];
export const FEATURES = {
  content: { plan: 'starter', label: 'Posts LinkedIn, Instagram et newsletter' },
  billing: { plan: 'starter', label: 'Devis et factures (génération et relecture par l\'IA)' },
  poste: { plan: 'growth', label: 'Postes (rôles) : tâches IA métier' },
  comptaExport: { plan: 'growth', label: 'Export de la comptabilité (archive et journal CSV)' },
  api: { plan: 'growth', label: 'Mode développeur : API et serveur MCP' },
  promo: { plan: 'business', label: 'Vidéos de promotion' },
};
export const ANNUAL_FREE_MONTHS = 2;
export const annualPrice = (plan) => PLAN_PRICES[plan] * (12 - ANNUAL_FREE_MONTHS);
/** Abonnement payant : après un paiement refusé, les droits de l'offre sont gardés ce nombre de jours (le temps de mettre la carte à jour), puis retour au plan gratuit. Aucune donnée n'est supprimée. */
export const SUBSCRIPTION = { graceDays: 7 };
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
