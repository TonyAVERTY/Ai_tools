import { resolve } from 'node:path';
import { homedir } from 'node:os';
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
    // Configuration du CLI du serveur, montée seulement pour le mode « Claude du serveur » (admins)
    serverHome: env.HOME || homedir(),
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
    // Administrateurs : ces adresses seulement (la première est aussi propriétaire des données migrées)
    adminEmails: (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
    secretKey: Buffer.from(secretKey, 'hex'),
    db: dbConfigFromEnv(env),
    dataDir: resolve(env.DATA_DIR || './data'),
    claudeBin: env.CLAUDE_BIN || 'claude',
    // Mode « abonnement » (jeton claude setup-token) : désactivable globalement
    cliModeEnabled: flag(env.CLAUDE_CLI_MODE_ENABLED, true),
    sandbox: sandboxConfig(),
    thermalMax: Number(env.THERMAL_MAX || 75),
    // Derrière Nginx/CloudPanel : lire X-Forwarded-For, mais seulement depuis un proxy de confiance (voir ratelimit.js)
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
  };
}
