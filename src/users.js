// Comptes : création à la première connexion, rôle admin (ADMIN_EMAILS), suspension, suppression.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { now } from './db.js';
import { HttpError } from './http.js';
import { clearRecapCache } from './services/recap.js';

export const PROVIDER_LABELS = { google: 'Google', apple: 'Apple' };

export const normalizeEmail = (e) => String(e ?? '').trim().toLowerCase();
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COLUMNS = 'id, email, name, provider, provider_sub, status, is_admin, plan, created_at, last_login_at';

// Forme exposée au reste de l'application (booléens, jamais claude_link_json)
function publicUser(r) {
  if (!r) return null;
  return {
    id: Number(r.id), email: r.email, name: r.name, provider: r.provider, providerSub: r.provider_sub,
    status: r.status, isAdmin: !!r.is_admin, plan: r.plan, createdAt: r.created_at, lastLoginAt: r.last_login_at,
  };
}

export async function getUser(db, id) {
  return publicUser(await db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(Number(id)));
}

/** ADMIN_EMAILS fait foi : les admins sont exactement ces adresses (au démarrage et à chaque connexion). */
export async function syncAdmins(db, adminEmails) {
  const list = adminEmails.map(normalizeEmail).filter(Boolean);
  if (!list.length) { await db.prepare('UPDATE users SET is_admin = 0').run(); return; }
  await db.prepare(`UPDATE users SET is_admin = CASE WHEN email IN (${list.map(() => '?').join(', ')}) THEN 1 ELSE 0 END`).run(...list);
}

/**
 * Trouve ou crée le compte d'une identité vérifiée par le fournisseur.
 *  1. (fournisseur, sub) connu → ce compte ;
 *  2. sinon même email : compte préparé par la migration (sans fournisseur) → rattaché à cette identité ;
 *     compte déjà lié à un autre fournisseur → refus (pas de fusion automatique de comptes) ;
 *  3. sinon inscription automatique (plan gratuit). Le compte suspendu est refusé.
 */
export async function loginIdentity(db, cfg, { provider, sub, email, name }) {
  email = normalizeEmail(email);
  sub = String(sub || '');
  if (!sub) throw new HttpError(401, 'Identité fournisseur invalide');
  if (!EMAIL_SHAPE.test(email) || email.length > 255) throw new HttpError(401, 'Email invalide');
  const cleanName = name ? String(name).trim().slice(0, 200) || null : null;
  const t = now();

  let row = await db.prepare(`SELECT ${COLUMNS} FROM users WHERE provider = ? AND provider_sub = ?`).get(provider, sub);
  if (!row) {
    const byEmail = await db.prepare(`SELECT ${COLUMNS} FROM users WHERE email = ?`).get(email);
    if (byEmail) {
      if (byEmail.provider) {
        throw new HttpError(409, `Cet email est déjà associé à un compte ${PROVIDER_LABELS[byEmail.provider] || byEmail.provider} : connecte-toi avec ce fournisseur.`);
      }
      await db.prepare('UPDATE users SET provider = ?, provider_sub = ? WHERE id = ? AND provider IS NULL').run(provider, sub, byEmail.id);
      row = { ...byEmail, provider, provider_sub: sub };
    }
  }
  if (!row) {
    try {
      const r = await db.prepare(`INSERT INTO users(email, name, provider, provider_sub, status, is_admin, plan, created_at, last_login_at)
        VALUES(?, ?, ?, ?, 'active', ?, 'free', ?, ?)`).run(email, cleanName, provider, sub, cfg.adminEmails.includes(email) ? 1 : 0, t, t);
      row = await db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(Number(r.lastInsertRowid));
    } catch (e) {
      // Deux premières connexions simultanées du même compte : la seconde retrouve la ligne de la première
      row = await db.prepare(`SELECT ${COLUMNS} FROM users WHERE provider = ? AND provider_sub = ?`).get(provider, sub);
      if (!row) throw e;
    }
  }
  if (row.status !== 'active') throw new HttpError(403, 'Compte suspendu');
  // L'identité est le (fournisseur, sub) ; le rôle suit ADMIN_EMAILS, relu à chaque connexion
  await db.prepare('UPDATE users SET last_login_at = ?, is_admin = ?, name = COALESCE(?, name) WHERE id = ?')
    .run(t, cfg.adminEmails.includes(normalizeEmail(row.email)) ? 1 : 0, cleanName, row.id);
  return getUser(db, row.id);
}

export const userRepoRoot = (cfg, userId) => join(cfg.dataDir, 'repos', String(Number(userId)));
/** Pièces jointes de la page IA (images, PDF, vidéos…) de cet utilisateur : un dossier par compte, supprimé avec lui. */
export const userChatRoot = (cfg, userId) => join(cfg.dataDir, 'chat', String(Number(userId)));
/** Justificatifs de la comptabilité : un dossier par compte, un sous-dossier par ligne. Supprimé avec le compte. */
export const userAccountingRoot = (cfg, userId) => join(cfg.dataDir, 'compta', String(Number(userId)));
export const userPromoRoot = (cfg, userId) => join(cfg.dataDir, 'promo', String(Number(userId)));

/**
 * Supprime le compte et TOUTES ses données : projets, prospects, notes, modèles, journaux d'envoi, jobs,
 * métriques, réglages, conversations de la page IA et sessions (cascade des clés étrangères), puis les clones git et les pièces jointes du disque.
 * La liste d'opposition (blacklist) est volontairement conservée : c'est un registre d'adresses qui ont refusé
 * d'être contactées, pas une donnée du compte.
 */
export async function deleteUser(app, userId) {
  const { db, cfg } = app;
  const user = await getUser(db, userId);
  if (!user) throw new HttpError(404, 'Compte introuvable');
  const projects = await db.prepare('SELECT id FROM projects WHERE user_id = ?').all(user.id);
  await db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  for (const p of projects) clearRecapCache(p.id);
  rmSync(userRepoRoot(cfg, user.id), { recursive: true, force: true });
  rmSync(userChatRoot(cfg, user.id), { recursive: true, force: true });
  rmSync(userPromoRoot(cfg, user.id), { recursive: true, force: true });
  rmSync(userAccountingRoot(cfg, user.id), { recursive: true, force: true });
}
