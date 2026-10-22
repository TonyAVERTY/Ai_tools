// Équipes : un propriétaire partage certains de ses projets (projects.team_id) avec des membres.
//
// Principe : sur un projet partagé, un membre AGIT COMME LE PROPRIÉTAIRE. Le projet, ses prospects, ses mails, son SMTP, son
// plan, ses plafonds et son accès Claude restent ceux du propriétaire (c'est son compte qui travaille) ; le membre n'ajoute
// aucune donnée à son propre compte. Seul le point d'entrée change : `accessOn` dit ce qu'un utilisateur a le droit de faire
// sur un projet, et tout le reste du code continue de travailler avec l'identifiant du propriétaire.
//
// Rôles : « member » travaille sur les projets (modèles, prospects, jobs, envois, notes), « admin » règle en plus les
// projets (SMTP, boîte de réception, base du récap, LinkedIn), le propriétaire seul gère l'équipe, partage et supprime.
import { createHash } from 'node:crypto';
import { now } from './db.js';
import { randomId } from './crypto.js';
import { HttpError } from './http.js';
import { getUser, normalizeEmail } from './users.js';
import { limitsFor } from './services/plans.js';
import { EMAIL_RE, createTransport } from './services/mailer.js';
import { pinSmtp } from './netguard.js';

export const ROLES = ['admin', 'member'];
export const ROLE_LABELS = { owner: 'Propriétaire', admin: 'Administrateur', member: 'Membre' };
export const INVITE_TTL = 7 * 86400;
const RANK = { member: 1, admin: 2, owner: 3 };
const hash = (token) => createHash('sha256').update(String(token)).digest('hex');
const forbidden = (msg) => new HttpError(403, msg, { expose: true });

/** Ce que `userId` peut faire sur un projet (ligne de la table projects) : 'owner' | 'admin' | 'member', ou null. */
export async function accessOn(db, project, userId) {
  if (!project) return null;
  if (Number(project.user_id) === Number(userId)) return 'owner';
  if (!project.team_id) return null;
  const m = await db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(Number(project.team_id), Number(userId));
  return m && RANK[m.role] ? m.role : null;
}

/** Refuse (403) si le niveau d'accès est insuffisant. Un accès absent est déjà un 404 en amont. */
export function needAccess(access, level, what = 'cette action') {
  if (!(RANK[access] >= RANK[level])) {
    throw forbidden(level === 'owner'
      ? `Seul le propriétaire du projet peut faire ${what}.`
      : `Il faut être administrateur de l'équipe pour faire ${what}.`);
  }
}

/** L'équipe dont `userId` est propriétaire, ou null. */
export async function ownedTeam(db, userId) {
  return (await db.prepare('SELECT id, owner_id, name, created_at FROM teams WHERE owner_id = ?').get(Number(userId))) || null;
}

/** Les équipes dont `userId` est membre (hors celle qu'il possède). */
export async function memberships(db, userId) {
  const rows = await db.prepare(`SELECT t.id, t.name, t.owner_id, u.email owner_email, m.role
    FROM team_members m JOIN teams t ON t.id = m.team_id JOIN users u ON u.id = t.owner_id
    WHERE m.user_id = ? ORDER BY LOWER(t.name)`).all(Number(userId));
  return rows.map((r) => ({ id: Number(r.id), name: r.name, ownerId: Number(r.owner_id), ownerEmail: r.owner_email, role: r.role }));
}

/** Ids des équipes auxquelles `userId` appartient comme membre. */
export async function memberTeamIds(db, userId) {
  return (await db.prepare('SELECT team_id FROM team_members WHERE user_id = ?').all(Number(userId))).map((r) => Number(r.team_id));
}

/** Places d'équipe selon le plan du propriétaire : propriétaire + membres + invitations en attente. */
export async function seatsInfo(db, team, owner) {
  const limit = limitsFor(owner).seats;
  const members = Number((await db.prepare('SELECT COUNT(*) n FROM team_members WHERE team_id = ?').get(team.id)).n);
  const pending = Number((await db.prepare('SELECT COUNT(*) n FROM team_invites WHERE team_id = ? AND expires_at > ?').get(team.id, now())).n);
  const used = 1 + members + pending;
  return { limit, members, pending, used, free: limit == null ? null : Math.max(0, limit - used) };
}

export async function createTeam(db, userId, name) {
  const user = await getUser(db, userId);
  if (!user) throw new HttpError(404, 'Compte introuvable');
  const label = String(name ?? '').trim().slice(0, 80);
  if (!label) throw new HttpError(400, "Donne un nom à l'équipe");
  const seats = limitsFor(user).seats;
  if (seats != null && seats < 2) throw forbidden("Ton offre ne comprend pas d'équipe : voir les tarifs (/tarifs).");
  if (await ownedTeam(db, userId)) throw new HttpError(409, 'Tu as déjà une équipe');
  try { await db.prepare('INSERT INTO teams(owner_id, name, created_at) VALUES(?, ?, ?)').run(user.id, label, now()); }
  catch (e) { if (await ownedTeam(db, userId)) throw new HttpError(409, 'Tu as déjà une équipe'); throw e; }
  return ownedTeam(db, userId);
}

/** Supprime l'équipe : les projets reviennent à leur seul propriétaire, les membres perdent tout accès. */
export async function deleteTeam(db, team) {
  await db.prepare('UPDATE projects SET team_id = NULL WHERE team_id = ?').run(team.id);
  await db.prepare('DELETE FROM teams WHERE id = ?').run(team.id);
}

/** Vue complète pour la page Équipe du propriétaire. */
export async function teamDetails(db, team) {
  const owner = await getUser(db, team.owner_id);
  const members = (await db.prepare(`SELECT u.id, u.email, u.name, m.role, m.created_at FROM team_members m
    JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY m.created_at`).all(team.id))
    .map((r) => ({ id: Number(r.id), email: r.email, name: r.name, role: r.role, since: r.created_at }));
  const invites = (await db.prepare('SELECT id, email, role, created_at, expires_at FROM team_invites WHERE team_id = ? AND expires_at > ? ORDER BY id').all(team.id, now()))
    .map((r) => ({ id: Number(r.id), email: r.email, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at }));
  const projects = (await db.prepare('SELECT id, name, team_id FROM projects WHERE user_id = ? ORDER BY LOWER(name)').all(team.owner_id))
    .map((r) => ({ id: Number(r.id), name: r.name, shared: Number(r.team_id) === Number(team.id) }));
  return { team: { id: Number(team.id), name: team.name }, owner: { id: owner.id, email: owner.email }, members, invites, projects, seats: await seatsInfo(db, team, owner) };
}

/**
 * Crée une invitation. Le jeton n'est renvoyé qu'ici (seule son empreinte est stockée) : à transmettre à la personne invitée.
 * Une même adresse n'a qu'une invitation à la fois (la plus récente remplace l'ancienne).
 */
export async function createInvite(db, team, { email, role, byUserId }) {
  const addr = normalizeEmail(email);
  if (!EMAIL_RE.test(addr)) throw new HttpError(400, 'Adresse email invalide');
  if (!ROLES.includes(role)) throw new HttpError(400, 'Rôle inconnu');
  const owner = await getUser(db, team.owner_id);
  if (normalizeEmail(owner.email) === addr) throw new HttpError(400, "C'est déjà ton adresse : tu es le propriétaire");
  const already = await db.prepare(`SELECT 1 FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? AND LOWER(u.email) = ?`).get(team.id, addr);
  if (already) throw new HttpError(409, 'Cette personne est déjà dans l\'équipe');
  await db.prepare('DELETE FROM team_invites WHERE team_id = ? AND email = ?').run(team.id, addr);
  const seats = await seatsInfo(db, team, owner);
  if (seats.limit != null && seats.free <= 0) {
    throw forbidden(`Ton offre comprend ${seats.limit} place${seats.limit > 1 ? 's' : ''} d'équipe, toutes utilisées (membres et invitations en attente). Voir les tarifs : /tarifs`);
  }
  const token = randomId(24);
  await db.prepare('INSERT INTO team_invites(team_id, email, role, token_hash, created_by, created_at, expires_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
    .run(team.id, addr, role, hash(token), Number(byUserId), now(), now() + INVITE_TTL);
  return { token, email: addr, role };
}

export async function revokeInvite(db, team, inviteId) {
  await db.prepare('DELETE FROM team_invites WHERE id = ? AND team_id = ?').run(Number(inviteId), team.id);
}

/** Adresse de l'invitation (lien à ouvrir une fois connecté). */
export const inviteUrl = (cfg, token) => `${cfg.appUrl}/team/join/${token}`;

/** Ce que montre la page de confirmation : l'équipe invitante, seulement si l'invitation est bien pour ce compte. */
export async function inspectInvite(db, user, token) {
  const inv = await db.prepare('SELECT * FROM team_invites WHERE token_hash = ?').get(hash(token));
  if (!inv || inv.expires_at <= now()) return { ok: false, message: "Invitation introuvable ou expirée. Demande-en une nouvelle au propriétaire de l'équipe." };
  if (normalizeEmail(user.email) !== normalizeEmail(inv.email)) {
    return { ok: false, message: `Cette invitation est destinée à ${inv.email}. Connecte-toi avec cette adresse (tu es connecté avec ${user.email}).` };
  }
  const t = await db.prepare('SELECT t.id, t.name, u.email owner_email FROM teams t JOIN users u ON u.id = t.owner_id WHERE t.id = ?').get(inv.team_id);
  if (!t) return { ok: false, message: "Cette équipe n'existe plus." };
  return { ok: true, team: { id: Number(t.id), name: t.name, ownerEmail: t.owner_email }, role: inv.role };
}

/**
 * Accepte une invitation. L'adresse du compte connecté (vérifiée par Google ou Apple) doit être celle de l'invitation :
 * un lien transmis à quelqu'un d'autre ne donne aucun accès. Le jeton est à usage unique.
 */
export async function acceptInvite(db, user, token) {
  const inv = await db.prepare('SELECT * FROM team_invites WHERE token_hash = ?').get(hash(token));
  if (!inv || inv.expires_at <= now()) throw new HttpError(404, 'Invitation introuvable ou expirée. Demande-en une nouvelle au propriétaire de l\'équipe.');
  if (normalizeEmail(user.email) !== normalizeEmail(inv.email)) {
    throw forbidden(`Cette invitation est destinée à ${inv.email}. Connecte-toi avec cette adresse.`);
  }
  const team = await db.prepare('SELECT id, owner_id, name FROM teams WHERE id = ?').get(inv.team_id);
  if (!team) throw new HttpError(404, 'Cette équipe n\'existe plus');
  if (Number(team.owner_id) === Number(user.id)) throw new HttpError(400, "Tu es le propriétaire de cette équipe");
  await db.prepare('DELETE FROM team_invites WHERE id = ?').run(inv.id);
  await db.prepare('INSERT OR IGNORE INTO team_members(team_id, user_id, role, created_at) VALUES(?, ?, ?, ?)').run(team.id, user.id, inv.role, now());
  return { id: Number(team.id), name: team.name };
}

export async function setMemberRole(db, team, userId, role) {
  if (!ROLES.includes(role)) throw new HttpError(400, 'Rôle inconnu');
  const r = await db.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?').run(role, team.id, Number(userId));
  if (!r.changes && !(await db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').get(team.id, Number(userId)))) throw new HttpError(404, 'Membre introuvable');
}

/** Retire un membre : son accès disparaît tout de suite (l'accès est relu à chaque requête). */
export async function removeMember(db, team, userId) {
  await db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(team.id, Number(userId));
}

/** Partage (ou retire du partage) un projet du propriétaire avec son équipe. */
export async function setProjectShared(db, team, projectId, shared) {
  const r = await db.prepare('UPDATE projects SET team_id = ? WHERE id = ? AND user_id = ?').run(shared ? team.id : null, Number(projectId), team.owner_id);
  if (!r.changes && !(await db.prepare('SELECT 1 FROM projects WHERE id = ? AND user_id = ?').get(Number(projectId), team.owner_id))) throw new HttpError(404, 'Projet introuvable');
}

/** Mail d'invitation via le SMTP du serveur (SYSTEM_SMTP_*). Sans lui, le lien est simplement affiché au propriétaire. */
export async function sendInviteMail(app, team, owner, invite) {
  const smtp = app.cfg.systemSmtp;
  if (!smtp) return { sent: false, reason: 'SMTP du serveur non configuré' };
  const url = inviteUrl(app.cfg, invite.token);
  const text = [
    'Bonjour,', '',
    `${owner.email} t'invite à rejoindre l'équipe « ${team.name} » sur AiTools (rôle : ${ROLE_LABELS[invite.role].toLowerCase()}).`, '',
    `Pour accepter, connecte-toi avec cette adresse (${invite.email}) puis ouvre : ${url}`, '',
    `Le lien est valable 7 jours et ne marche qu'avec ${invite.email}.`,
  ].join('\n');
  const transport = (app.createTransport || createTransport)(await pinSmtp(app, null, smtp));
  try {
    await transport.sendMail({ from: smtp.fromEmail, to: invite.email, subject: `Invitation à l'équipe « ${team.name} » sur AiTools`, text });
    return { sent: true };
  } catch (e) { return { sent: false, reason: `envoi impossible (${String(e.message).slice(0, 100)})` }; }
  finally { transport.close?.(); }
}

/** Purge des invitations expirées (appelée avec le nettoyage périodique). */
export async function purgeInvites(db) {
  await db.prepare('DELETE FROM team_invites WHERE expires_at < ?').run(now() - 86400);
}
