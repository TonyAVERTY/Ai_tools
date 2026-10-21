import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Chaque entrée = une migration. Ne jamais modifier une migration déjà livrée, en ajouter une.
export const MIGRATIONS = [
  `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, email TEXT NOT NULL,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE oauth_states (
    state TEXT PRIMARY KEY, verifier TEXT NOT NULL, nonce TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    git_url TEXT NOT NULL UNIQUE,
    profile_json TEXT,          -- fiche projet générée par Claude
    profile_commit TEXT,        -- commit analysé
    profile_at INTEGER,
    target_json TEXT,           -- cible déduite (modifiable)
    target_validated INTEGER NOT NULL DEFAULT 0,
    smtp_enc TEXT,              -- config SMTP chiffrée
    db_enc TEXT,                -- accès BDD chiffré (récap)
    daily_mail_cap INTEGER NOT NULL DEFAULT 30,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE mail_templates (
    project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    subject TEXT NOT NULL, body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',   -- draft | validated
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE prospects (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    company TEXT NOT NULL, email TEXT NOT NULL, website TEXT, city TEXT, sector TEXT,
    hook TEXT,                  -- accroche perso (1 phrase)
    source TEXT,                -- page où l'email a été trouvé (RGPD : origine des données)
    score INTEGER,
    status TEXT NOT NULL DEFAULT 'new',  -- new | sent | replied | client | refused | bounced
    sent_at INTEGER, created_at INTEGER NOT NULL,
    UNIQUE(project_id, email)
  );
  CREATE INDEX prospects_project ON prospects(project_id, status);
  CREATE TABLE blacklist (email TEXT PRIMARY KEY, reason TEXT, created_at INTEGER NOT NULL);
  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL,         -- analyze | prospect | template | send | evolution
    status TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | error | cancelled
    params_json TEXT, progress_json TEXT, result_json TEXT, error TEXT,
    cost_usd REAL, tokens_in INTEGER, tokens_out INTEGER,
    created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER
  );
  CREATE INDEX jobs_status ON jobs(status, id);
  CREATE TABLE mail_log (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    prospect_id INTEGER, email TEXT NOT NULL, sent_at INTEGER NOT NULL, error TEXT
  );
  CREATE INDEX mail_log_day ON mail_log(project_id, sent_at);
  `,
  // 2 — modèles de mail par type (premier mail / relance)
  `
  CREATE TABLE templates (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('initial', 'followup')),
    subject TEXT NOT NULL DEFAULT '',   -- relance : vide = "Re: <objet du 1er mail>"
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, kind)
  );
  INSERT INTO templates(project_id, kind, subject, body, status, updated_at)
    SELECT project_id, 'initial', subject, body, status, updated_at FROM mail_templates;
  DROP TABLE mail_templates;
  `,
  // 3 — suivi des mails envoyés + test A/B de l'objet
  `
  ALTER TABLE templates ADD COLUMN subject_b TEXT;        -- objet B (premier mail uniquement)
  ALTER TABLE prospects ADD COLUMN variant TEXT;          -- A | B
  ALTER TABLE mail_log ADD COLUMN kind TEXT NOT NULL DEFAULT 'initial';
  ALTER TABLE mail_log ADD COLUMN variant TEXT;
  ALTER TABLE mail_log ADD COLUMN subject TEXT;
  ALTER TABLE mail_log ADD COLUMN message_id TEXT;
  CREATE INDEX mail_log_msgid ON mail_log(message_id);
  `,
  // 4 — détection des réponses via IMAP
  `
  ALTER TABLE prospects ADD COLUMN replied_at INTEGER;
  ALTER TABLE prospects ADD COLUMN reply_subject TEXT;
  ALTER TABLE projects ADD COLUMN imap_enc TEXT;
  ALTER TABLE projects ADD COLUMN inbox_json TEXT;        -- état de la dernière lecture IMAP
  `,
  // 5 — relance automatique
  `
  ALTER TABLE prospects ADD COLUMN followup_at INTEGER;
  ALTER TABLE projects ADD COLUMN followup_enabled INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE projects ADD COLUMN followup_days INTEGER NOT NULL DEFAULT 7;
  `,
];

export function openDb(dataDir) {
  let db;
  if (dataDir === ':memory:') db = new DatabaseSync(':memory:');
  else {
    mkdirSync(dataDir, { recursive: true });
    db = new DatabaseSync(join(dataDir, 'aitools.sqlite'));
  }
  // WAL + synchronous NORMAL : moins d'écritures sur la carte SD / SSD
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export const now = () => Math.floor(Date.now() / 1000);

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}
