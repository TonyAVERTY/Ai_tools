// Comptes de test
let seq = 0;

/** Crée un compte et renvoie son id. Admin et actif par défaut (les tests historiques lancent des jobs IA). */
export async function addUser(db, { email, admin = true, status = 'active', provider = 'google', sub, name = null } = {}) {
  seq++;
  const r = await db.prepare(`INSERT INTO users(email, name, provider, provider_sub, status, is_admin, plan, created_at)
    VALUES(?, ?, ?, ?, ?, ?, 'free', ?)`).run(email || `user${seq}@test.fr`, name, provider, sub || `sub-${seq}`, status, admin ? 1 : 0, 1_700_000_000);
  return Number(r.lastInsertRowid);
}

/** Projet minimal d'un utilisateur. */
export async function addProject(db, userId, { name = 'p', gitUrl } = {}) {
  seq++;
  const r = await db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)')
    .run(userId, name, gitUrl || `https://git.test/u/${seq}.git`, 1_700_000_000);
  return Number(r.lastInsertRowid);
}
