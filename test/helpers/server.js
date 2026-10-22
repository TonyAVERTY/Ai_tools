// Serveur HTTP de test : vraie application sur un port libre, base de test, comptes créés à la demande.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { now } from '../../src/db.js';
import { createApp } from '../../src/server.js';
import { testDb } from './db.js';
import { addUser } from './users.js';

export const APP_URL = 'https://ai.tony-averty.dev';

export async function startApp({ cfg = {}, worker = false } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'aitools-srv-'));
  const config = {
    appUrl: APP_URL, google: { clientId: 'gid', clientSecret: 'gsecret' }, apple: null, adminEmails: [],
    secretKey: randomBytes(32), dataDir: tmp, claudeBin: 'claude', thermalMax: 75, ...cfg,
  };
  const app = await createApp(config, { db: await testDb(), worker });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  /** Requêtes avec la session d'un cookie (ou sans). */
  const client = (cookie) => ({
    get: (p, opts = {}) => fetch(base + p, { redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), accept: 'application/json', ...opts.headers } }),
    post: (p, body = {}, { origin = APP_URL, form = false } = {}) => fetch(base + p, {
      method: 'POST', redirect: 'manual',
      headers: {
        ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), accept: 'application/json',
        'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
      },
      body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
    }),
  });

  /** Crée un compte avec une session ouverte. */
  let n = 0;
  const newUser = async (opts = {}) => {
    n++;
    const email = opts.email || `user${n}@test.fr`;
    const id = await addUser(app.db, { ...opts, email });
    const sid = `sess-${id}-${n}`;
    await app.db.prepare('INSERT INTO sessions(id, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)').run(sid, id, now(), now() + 3600);
    const cookie = `sid=${sid}`;
    return { id, email, cookie, ...client(cookie) };
  };

  const close = async () => { await app.close(); rmSync(tmp, { recursive: true, force: true }); };
  return { app, db: app.db, base, tmp, client, newUser, close, anon: client(null) };
}
