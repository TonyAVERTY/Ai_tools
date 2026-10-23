import { resolve } from 'node:path';
import { dbConfigFromEnv } from './db.js';
import { parseTrustProxy } from './ratelimit.js';

const env = process.env;

function required(name) {
  const v = env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

// Connexion Apple : les quatre variables ensemble, ou aucune (le bouton Apple est alors masqué)
function appleConfig() {
  const keys = ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_CLIENT_ID', 'APPLE_PRIVATE_KEY'];
  const set = keys.filter((k) => env[k]);
  if (!set.length) return null;
  if (set.length < keys.length) {
    throw new Error(`Connexion Apple : variables incomplètes (manque ${keys.filter((k) => !env[k]).join(', ')})`);
  }
  return {
    teamId: env.APPLE_TEAM_ID, keyId: env.APPLE_KEY_ID, clientId: env.APPLE_CLIENT_ID,
    // Le PEM tient sur une ligne dans un .env : les séquences \n littérales redeviennent des retours à la ligne
    privateKey: env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
}

// Google reCAPTCHA v3 sur le démarrage de la connexion : les deux clés ensemble, ou aucune (reCAPTCHA désactivé, développement)
// Droits LinkedIn que l'application peut demander (liste fermée : une faute de frappe fait échouer toutes les connexions)
const LINKEDIN_SCOPES = ['openid', 'profile', 'email', 'w_member_social', 'w_organization_social', 'rw_organization_admin', 'r_organization_admin', 'r_organization_social'];

/**
 * LinkedIn (connexion d'un compte à un projet, publication de posts). Désactivé sans clés : il faut une application sur
 * developer.linkedin.com avec les produits « Sign In with LinkedIn using OpenID Connect » et « Share on LinkedIn ».
 *
 * Publier sur une PAGE demande la « Community Management API », qui doit être le seul produit de son application (LinkedIn
 * grise la demande sinon) : cette application-là n'a ni OpenID ni « Share ». Les droits demandés sont donc réglables
 * (LINKEDIN_SCOPES), avec par défaut ceux d'une publication sur le profil. Une page demande au moins w_organization_social
 * (publier) et rw_organization_admin ou r_organization_admin (lister les pages administrées).
 */
function linkedinConfig(appUrl) {
  const clientId = (env.LINKEDIN_CLIENT_ID || '').trim();
  const clientSecret = (env.LINKEDIN_CLIENT_SECRET || '').trim();
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) throw new Error('LinkedIn : LINKEDIN_CLIENT_ID et LINKEDIN_CLIENT_SECRET vont ensemble');
  const scopes = [...new Set((env.LINKEDIN_SCOPES || 'openid profile w_member_social').split(/[\s,]+/).filter(Boolean))];
  const unknown = scopes.filter((s) => !LINKEDIN_SCOPES.includes(s));
  if (unknown.length) throw new Error(`LinkedIn : LINKEDIN_SCOPES contient des droits inconnus (${unknown.join(', ')}). Autorisés : ${LINKEDIN_SCOPES.join(', ')}`);
  if (!scopes.some((s) => s === 'w_member_social' || s === 'w_organization_social')) throw new Error('LinkedIn : LINKEDIN_SCOPES doit contenir w_member_social (profil) ou w_organization_social (page)');
  const apiVersion = (env.LINKEDIN_API_VERSION || '202604').trim();
  if (!/^\d{6}$/.test(apiVersion)) throw new Error('LinkedIn : LINKEDIN_API_VERSION doit être au format AAAAMM (ex. 202604)');
  return {
    clientId, clientSecret, redirectUri: (env.LINKEDIN_REDIRECT_URI || `${appUrl}/linkedin/callback`).trim(),
    scopes, apiVersion,
    // Publier sur une page : le droit d'écrire pour elle, et de lister celles que le compte administre
    pages: scopes.includes('w_organization_social') && (scopes.includes('rw_organization_admin') || scopes.includes('r_organization_admin')),
  };
}

function recaptchaConfig() {
  const siteKey = (env.RECAPTCHA_SITE_KEY || '').trim();
  const secret = (env.RECAPTCHA_SECRET || '').trim();
  if (!siteKey && !secret) return null;
  if (!siteKey || !secret) throw new Error('reCAPTCHA : RECAPTCHA_SITE_KEY et RECAPTCHA_SECRET vont ensemble');
  const raw = (env.RECAPTCHA_MIN_SCORE || '').trim();
  const minScore = raw === '' ? 0.5 : Number(raw);
  if (!(minScore >= 0 && minScore <= 1)) throw new Error('RECAPTCHA_MIN_SCORE doit être un nombre entre 0 et 1');
  return { siteKey, secret, minScore };
}

function positive(v, def, name) {
  if (v == null || String(v).trim() === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 64) throw new Error(`${name} doit être un entier entre 1 et 64`);
  return n;
}
function ratio(v, def, name) {
  if (v == null || String(v).trim() === '') return def;
  const n = Number(v);
  if (!(n > 0.1 && n <= 4)) throw new Error(`${name} doit être un nombre entre 0,1 et 4 (charge divisée par le nombre de cœurs)`);
  return n;
}

// SMTP du serveur (mails système : avertissement avant suppression d'un compte inactif). Facultatif ; toutes les variables ensemble.
function systemSmtpConfig() {
  const keys = ['SYSTEM_SMTP_HOST', 'SYSTEM_SMTP_USER', 'SYSTEM_SMTP_PASSWORD', 'SYSTEM_SMTP_FROM'];
  const set = keys.filter((k) => env[k]);
  if (!set.length) return null;
  if (set.length < keys.length) throw new Error(`SMTP du serveur : variables incomplètes (manque ${keys.filter((k) => !env[k]).join(', ')})`);
  return { host: env.SYSTEM_SMTP_HOST, port: Number(env.SYSTEM_SMTP_PORT || 587), user: env.SYSTEM_SMTP_USER, pass: env.SYSTEM_SMTP_PASSWORD, fromEmail: env.SYSTEM_SMTP_FROM };
}

function inactiveMonths() {
  const raw = (env.INACTIVE_ACCOUNT_MONTHS || '').trim();
  if (raw === '') return 24;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 120) throw new Error('INACTIVE_ACCOUNT_MONTHS doit être un nombre entier de mois entre 0 (désactivé) et 120');
  return n;
}

const flag = (v, def) => (v == null || v === '' ? def : !/^(0|false|off|no|non)$/i.test(String(v).trim()));

// Bac à sable des exécutions Claude. En production il est obligatoire : SANDBOX=off n'y est pas pris en compte.
// En développement, SANDBOX=off le désactive (avertissement au démarrage).
function sandboxConfig() {
  const production = env.NODE_ENV === 'production';
  const off = String(env.SANDBOX || '').trim().toLowerCase() === 'off';
  return {
    production,
    enabled: production || !off,
    offIgnored: production && off,
    bwrapBin: env.BWRAP_BIN || 'bwrap',
    // Dossiers supplémentaires montés en lecture seule (ex. Node installé hors de /usr), séparés par des virgules
    roBinds: (env.SANDBOX_RO_BINDS || '').split(',').map((p) => p.trim()).filter(Boolean),
  };
}

export function loadConfig() {
  const secretKey = required('SECRET_KEY');
  if (!/^[0-9a-f]{64}$/i.test(secretKey)) {
    throw new Error('SECRET_KEY doit faire 32 octets en hexadécimal (64 caractères)');
  }
  return {
    appUrl: required('APP_URL').replace(/\/$/, ''),
    port: Number(env.PORT || 3100),
    host: env.HOST || '127.0.0.1',
    google: {
      clientId: required('GOOGLE_CLIENT_ID'),
      clientSecret: required('GOOGLE_CLIENT_SECRET'),
    },
    apple: appleConfig(),
    recaptcha: recaptchaConfig(),
    linkedin: linkedinConfig(required('APP_URL').replace(/\/$/, '')),
    systemSmtp: systemSmtpConfig(),
    inactiveMonths: inactiveMonths(),
    production: env.NODE_ENV === 'production',
    // Développement : autorise les hôtes privés (SMTP local, etc.). En production, seulement pour les administrateurs.
    allowPrivateHosts: flag(env.ALLOW_PRIVATE_HOSTS, false),
    // Administrateurs : ces adresses seulement (la première est aussi propriétaire des données migrées)
    adminEmails: (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
    secretKey: Buffer.from(secretKey, 'hex'),
    db: dbConfigFromEnv(env),
    dataDir: resolve(env.DATA_DIR || './data'),
    claudeBin: env.CLAUDE_BIN || 'claude',
    // Mode « abonnement » (jeton claude setup-token) : désactivable globalement
    cliModeEnabled: flag(env.CLAUDE_CLI_MODE_ENABLED, true),
    sandbox: sandboxConfig(),
    // Jobs IA simultanés sur le serveur (un seul par utilisateur) et charge (charge/cœurs) au-delà de laquelle les nouveaux jobs attendent
    maxAiJobs: positive(env.MAX_AI_JOBS, 4, 'MAX_AI_JOBS'),
    loadMax: ratio(env.LOAD_MAX, 0.9, 'LOAD_MAX'),
    // Derrière Nginx/CloudPanel : lire X-Forwarded-For, mais seulement depuis un proxy de confiance (voir ratelimit.js)
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
  };
}
