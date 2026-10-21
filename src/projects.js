import { join } from 'node:path';
import { now, getSetting } from './db.js';
import { encryptJson, decryptJson, decrypt } from './crypto.js';
import { HttpError } from './http.js';

export const repoDir = (cfg, id) => join(cfg.dataDir, 'repos', String(id));

const parse = (s) => (s ? JSON.parse(s) : null);

export function getProject(app, id, { secrets = false } = {}) {
  const p = app.db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id));
  if (!p) throw new HttpError(404, 'Projet introuvable');
  const out = {
    id: p.id, name: p.name, gitUrl: p.git_url,
    profile: parse(p.profile_json), profileCommit: p.profile_commit, profileAt: p.profile_at,
    target: parse(p.target_json), targetValidated: !!p.target_validated,
    dailyMailCap: p.daily_mail_cap, createdAt: p.created_at,
    hasSmtp: !!p.smtp_enc, hasDb: !!p.db_enc,
  };
  if (secrets) {
    out.smtp = decryptJson(app.cfg.secretKey, p.smtp_enc);
    out.dbCfg = decryptJson(app.cfg.secretKey, p.db_enc);
  }
  return out;
}

export function listProjects(app) {
  return app.db.prepare('SELECT id FROM projects ORDER BY name COLLATE NOCASE').all().map((r) => getProject(app, r.id));
}

export function createProject(app, { name, gitUrl }) {
  const r = app.db.prepare('INSERT INTO projects(name, git_url, created_at) VALUES(?, ?, ?)').run(name, gitUrl, now());
  return Number(r.lastInsertRowid);
}

// Les secrets vides dans le formulaire = on garde l'ancien (le formulaire ne les réaffiche jamais)
export function saveSecretConfig(app, id, column, incoming, secretField) {
  if (!['smtp_enc', 'db_enc'].includes(column)) throw new Error('Colonne invalide');
  const current = decryptJson(app.cfg.secretKey, app.db.prepare(`SELECT ${column} c FROM projects WHERE id = ?`).get(id)?.c) || {};
  const next = { ...current, ...incoming };
  if (!incoming[secretField]) next[secretField] = current[secretField];
  app.db.prepare(`UPDATE projects SET ${column} = ? WHERE id = ?`).run(encryptJson(app.cfg.secretKey, next), id);
}

// Version "affichable" d'une config secrète (sans mot de passe)
export function publicConfig(cfg, secretField) {
  if (!cfg) return {};
  const { [secretField]: _omit, ...rest } = cfg;
  return { ...rest, [`${secretField}Set`]: !!_omit };
}

export function forgejoToken(app) {
  return decrypt(app.cfg.secretKey, getSetting(app.db, 'forgejo_token_enc'));
}

export function globalSmtp(app) {
  return decryptJson(app.cfg.secretKey, getSetting(app.db, 'smtp_enc'));
}

export function prospectStats(db, projectId) {
  const rows = db.prepare('SELECT status, COUNT(*) n FROM prospects WHERE project_id = ? GROUP BY status').all(projectId);
  const out = { total: 0 };
  for (const r of rows) { out[r.status] = r.n; out.total += r.n; }
  return out;
}

export function sentSince(db, since, projectId = null) {
  const sql = projectId == null
    ? 'SELECT COUNT(*) n FROM mail_log WHERE sent_at > ? AND error IS NULL'
    : 'SELECT COUNT(*) n FROM mail_log WHERE sent_at > ? AND error IS NULL AND project_id = ?';
  return (projectId == null ? db.prepare(sql).get(since) : db.prepare(sql).get(since, projectId)).n;
}

// ---------- Modèles de mail ----------
export const TEMPLATE_KINDS = ['initial', 'followup'];

export function getTemplate(db, projectId, kind, { validatedOnly = false } = {}) {
  const row = db.prepare('SELECT * FROM templates WHERE project_id = ? AND kind = ?').get(projectId, kind);
  if (!row || (validatedOnly && row.status !== 'validated')) return null;
  return row;
}

export function saveTemplate(db, projectId, kind, { subject = '', body, status = 'draft' }) {
  if (!TEMPLATE_KINDS.includes(kind)) throw new HttpError(400, 'Type de modèle inconnu');
  db.prepare(`INSERT INTO templates(project_id, kind, subject, body, status, updated_at) VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, kind) DO UPDATE SET subject = excluded.subject,
      body = excluded.body, status = excluded.status, updated_at = excluded.updated_at`)
    .run(projectId, kind, subject, body, status, now());
}
