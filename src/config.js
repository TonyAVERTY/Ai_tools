import { resolve } from 'node:path';

const env = process.env;

function required(name) {
  const v = env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
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
    allowedEmails: required('ALLOWED_EMAILS').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
    secretKey: Buffer.from(secretKey, 'hex'),
    dataDir: resolve(env.DATA_DIR || './data'),
    claudeBin: env.CLAUDE_BIN || 'claude',
    thermalMax: Number(env.THERMAL_MAX || 75),
  };
}
