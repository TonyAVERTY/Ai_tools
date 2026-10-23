// Comptes de test
import { encrypt } from '../../src/crypto.js';

let seq = 0;

/** Clé de chiffrement commune aux applications de test : les liaisons créées ici restent déchiffrables par elles. */
export const TEST_SECRET_KEY = Buffer.alloc(32, 7);
export const TEST_TOKEN = `sk-ant-oat01-${'t'.repeat(40)}`;
export const testTokenLink = (key = TEST_SECRET_KEY) => ({
  v: 1, mode: 'subscription_token', valid: true, linked_at: 1_700_000_000, validated_at: 1_700_000_000, secret_enc: encrypt(key, TEST_TOKEN),
});

/**
 * Crée un compte et renvoie son id. Admin et actif par défaut, avec une liaison par jeton d'abonnement (les tests historiques
 * lancent des jobs IA). `link` : null = aucune liaison, ou un objet claude_link_json complet.
 */
export async function addUser(db, { email, admin = true, status = 'active', provider = 'google', sub, name = null, link } = {}) {
  seq++;
  const linkJson = link === undefined ? (admin ? testTokenLink() : null) : link;
  const r = await db.prepare(`INSERT INTO users(email, name, provider, provider_sub, status, is_admin, plan, created_at, claude_link_json)
    VALUES(?, ?, ?, ?, ?, ?, 'free', ?, ?)`).run(email || `user${seq}@test.fr`, name, provider, sub || `sub-${seq}`, status, admin ? 1 : 0, 1_700_000_000, linkJson ? JSON.stringify(linkJson) : null);
  return Number(r.lastInsertRowid);
}

/** Projet minimal d'un utilisateur. */
export async function addProject(db, userId, { name = 'p', gitUrl } = {}) {
  seq++;
  const r = await db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)')
    .run(userId, name, gitUrl || `https://git.test/u/${seq}.git`, 1_700_000_000);
  return Number(r.lastInsertRowid);
}
