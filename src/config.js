import { resolve } from 'node:path';
import { dbConfigFromEnv } from './db.js';

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
    // Administrateurs : ces adresses seulement (la première est aussi propriétaire des données migrées)
    adminEmails: (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
    secretKey: Buffer.from(secretKey, 'hex'),
    db: dbConfigFromEnv(env),
    dataDir: resolve(env.DATA_DIR || './data'),
    claudeBin: env.CLAUDE_BIN || 'claude',
    thermalMax: Number(env.THERMAL_MAX || 75),
  };
}
