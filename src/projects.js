import { join } from 'node:path';
import { now, getSetting } from './db.js';
import { encryptJson, decryptJson, decrypt } from './crypto.js';
import { HttpError } from './http.js';
import { getUser } from './users.js';
import { assertRoom, withUserLock } from './services/plans.js';

// Un dossier de clones par utilisateur : data/repos/<utilisateur>/<projet>
export const repoDir = (cfg, userId, id) => join(cfg.dataDir, 'repos', String(Number(userId)), String(Number(id)));

const parse = (s) => (s ? JSON.parse(s) : null);

// Secret illisible (SECRET_KEY changée, donnée abîmée) : on le traite comme absent pour que le
// panel reste utilisable, il suffira de le ressaisir.
function readSecret(key, payload, what) {
  try { return decryptJson(key, payload); }
  catch { console.warn(`[secrets] ${what} illisible (SECRET_KEY changée ?), à ressaisir`); return null; }
}

/**
 * Projet d'un utilisateur. `userId` est obligatoire : un projet d'un autre compte est introuvable (404),
 * exactement comme un projet qui n'existe pas. Les tâches de fond passent le propriétaire lu en base.
 */
export async function getProject(app, id, { userId, secrets = false } = {}) {
  if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) throw new Error('getProject : userId requis');
  const p = await app.db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(Number(id), Number(userId));
  if (!p) throw new HttpError(404, 'Projet introuvable');
  const out = {
    id: p.id, userId: Number(p.user_id), name: p.name, gitUrl: p.git_url,
    profile: parse(p.profile_json), profileCommit: p.profile_commit, profileAt: p.profile_at,
    target: parse(p.target_json), targetValidated: !!p.target_validated,
    dailyMailCap: p.daily_mail_cap, createdAt: p.created_at,
    hasSmtp: !!p.smtp_enc, hasDb: !!p.db_enc, hasImap: !!p.imap_enc,
    inbox: parse(p.inbox_json),
    followupEnabled: !!p.followup_enabled, followupDays: p.followup_days,
  };
  if (secrets) {
    out.smtp = readSecret(app.cfg.secretKey, p.smtp_enc, `SMTP du projet ${p.id}`);
    out.dbCfg = readSecret(app.cfg.secretKey, p.db_enc, `accès BDD du projet ${p.id}`);
    out.imapCfg = readSecret(app.cfg.secretKey, p.imap_enc, `IMAP du projet ${p.id}`);
    out.imap = imapCredentials(out.imapCfg, out.smtp);
  }
  return out;
}

export async function listProjects(app, userId) {
  const rows = await app.db.prepare('SELECT id FROM projects WHERE user_id = ? ORDER BY LOWER(name)').all(Number(userId));
  return Promise.all(rows.map((r) => getProject(app, r.id, { userId })));
}

export async function createProject(app, { userId, name, gitUrl }) {
  const user = await getUser(app.db, userId);
  if (!user) throw new HttpError(404, 'Compte introuvable');
  return withUserLock(user.id, async () => {
    await assertRoom(app.db, user, 'projects', 1, { note: 'Supprime un projet pour en créer un autre.' });
    const r = await app.db.prepare('INSERT INTO projects(user_id, name, git_url, created_at) VALUES(?, ?, ?, ?)').run(user.id, name, gitUrl, now());
    return Number(r.lastInsertRowid);
  });
}

// Les secrets vides dans le formulaire = on garde l'ancien (le formulaire ne les réaffiche jamais)
export async function saveSecretConfig(app, id, column, incoming, secretField) {
  if (!['smtp_enc', 'db_enc', 'imap_enc'].includes(column)) throw new Error('Colonne invalide');
  const row = await app.db.prepare(`SELECT ${column} c FROM projects WHERE id = ?`).get(id);
  const current = readSecret(app.cfg.secretKey, row?.c, column) || {};
  const next = { ...current, ...incoming };
  if (!incoming[secretField]) next[secretField] = current[secretField];
  await app.db.prepare(`UPDATE projects SET ${column} = ? WHERE id = ?`).run(encryptJson(app.cfg.secretKey, next), id);
}

// Version "affichable" d'une config secrète (sans mot de passe)
export function publicConfig(cfg, secretField) {
  if (!cfg) return {};
  const { [secretField]: _omit, ...rest } = cfg;
  return { ...rest, [`${secretField}Set`]: !!_omit };
}

export async function forgejoToken(app, userId) {
  try { return decrypt(app.cfg.secretKey, await getSetting(app.db, userId, 'forgejo_token_enc')); }
  catch { console.warn('[secrets] token Forgejo illisible, à ressaisir'); return null; }
}

export async function globalSmtp(app, userId) {
  return readSecret(app.cfg.secretKey, await getSetting(app.db, userId, 'smtp_enc'), 'SMTP global');
}

export async function prospectStats(db, projectId) {
  const rows = await db.prepare('SELECT status, COUNT(*) n FROM prospects WHERE project_id = ? GROUP BY status').all(projectId);
  const out = { total: 0 };
  for (const r of rows) { out[r.status] = r.n; out.total += r.n; }
  return out;
}

/** Envois réussis depuis `since` : tous les projets de l'utilisateur, ou un seul projet (déjà vérifié comme étant le sien). */
export async function sentSince(db, since, userId, projectId = null) {
  if (projectId == null) {
    return (await db.prepare(`SELECT COUNT(*) n FROM mail_log m JOIN projects p ON p.id = m.project_id
      WHERE m.sent_at > ? AND m.error IS NULL AND p.user_id = ?`).get(since, Number(userId))).n;
  }
  return (await db.prepare(`SELECT COUNT(*) n FROM mail_log m JOIN projects p ON p.id = m.project_id
    WHERE m.sent_at > ? AND m.error IS NULL AND p.user_id = ? AND m.project_id = ?`).get(since, Number(userId), projectId)).n;
}

// IMAP : utilisateur vide = mêmes identifiants que le SMTP du projet (cas le plus courant)
export function imapCredentials(imap, smtp) {
  if (!imap?.host) return null;
  const reuse = !imap.user;
  const user = reuse ? smtp?.user : imap.user;
  const pass = reuse ? smtp?.pass : imap.pass;
  if (!user || !pass) return null;
  return { host: imap.host, port: Number(imap.port || 993), user, pass, reuseSmtp: reuse };
}

// ---------- Modèles de mail ----------
export const TEMPLATE_KINDS = ['initial', 'followup'];

export async function getTemplate(db, projectId, kind, { validatedOnly = false } = {}) {
  const row = await db.prepare('SELECT * FROM templates WHERE project_id = ? AND kind = ?').get(projectId, kind);
  if (!row || (validatedOnly && row.status !== 'validated')) return null;
  return row;
}

export async function saveTemplate(db, projectId, kind, { subject = '', subjectB = null, body, status = 'draft' }) {
  if (!TEMPLATE_KINDS.includes(kind)) throw new HttpError(400, 'Type de modèle inconnu');
  await db.prepare(`INSERT INTO templates(project_id, kind, subject, subject_b, body, status, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, kind) DO UPDATE SET subject = excluded.subject, subject_b = excluded.subject_b,
      body = excluded.body, status = excluded.status, updated_at = excluded.updated_at`)
    .run(projectId, kind, subject, kind === 'initial' ? (subjectB || null) : null, body, status, now());
}

// Objet A ou B : on équilibre les envois (B seulement si un objet B est défini)
export async function pickVariant(db, projectId, template) {
  if (!template.subject_b) return 'A';
  const rows = await db.prepare(`SELECT variant, COUNT(*) n FROM mail_log
    WHERE project_id = ? AND kind = 'initial' AND error IS NULL AND variant IN ('A', 'B') GROUP BY variant`).all(projectId);
  const count = { A: 0, B: 0 };
  for (const r of rows) count[r.variant] = r.n;
  return count.B < count.A ? 'B' : 'A';
}

// Taux de réponse par objet (A/B) sur les premiers mails
export async function abStats(db, projectId) {
  const rows = await db.prepare(`SELECT m.variant v, COUNT(*) sent, SUM(p.replied_at IS NOT NULL) replied
    FROM mail_log m JOIN prospects p ON p.id = m.prospect_id
    WHERE m.project_id = ? AND m.kind = 'initial' AND m.error IS NULL AND m.variant IS NOT NULL
    GROUP BY m.variant ORDER BY m.variant`).all(projectId);
  return rows.map((r) => ({ variant: r.v, sent: r.sent, replied: r.replied, rate: r.sent ? r.replied / r.sent : 0 }));
}
