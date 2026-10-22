// Comptes de test
let seq = 0;

/**
 * Crée un compte et renvoie son id. Admin et actif par défaut, avec la liaison « Claude du serveur » (les tests historiques
 * lancent des jobs IA). `link` : null = aucune liaison, ou un objet claude_link_json complet.
 */
export async function addUser(db, { email, admin = true, status = 'active', provider = 'google', sub, name = null, link } = {}) {
  seq++;
  const linkJson = link === undefined ? (admin ? { v: 1, mode: 'server', valid: true, linked_at: 1_700_000_000, validated_at: 1_700_000_000 } : null) : link;
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
