// Migrations versionnées, en deux dialectes maintenus ENSEMBLE : MySQL/MariaDB (production)
// et SQLite en mémoire (tests locaux). Une entrée = une version, avec les mêmes tables et colonnes
// des deux côtés (test/schema.test.js le vérifie). Ne jamais modifier une migration déjà livrée,
// en ajouter une. Côté MySQL, chaque instruction est idempotente (CREATE ... IF NOT EXISTS) : MySQL
// valide implicitement chaque DDL, une migration interrompue peut donc être rejouée.

const T = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

export const MIGRATIONS = [
  {
    // Schéma initial = consolidation des 8 migrations SQLite historiques de l'instance perso
    name: 'initial',
    sqlite: [
      `CREATE TABLE sessions (
        id TEXT PRIMARY KEY, email TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      )`,
      `CREATE TABLE oauth_states (
        state TEXT PRIMARY KEY, verifier TEXT NOT NULL, nonce TEXT NOT NULL, created_at INTEGER NOT NULL
      )`,
      'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)',
      `CREATE TABLE projects (
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
        imap_enc TEXT,              -- config IMAP chiffrée
        inbox_json TEXT,            -- état de la dernière lecture IMAP
        daily_mail_cap INTEGER NOT NULL DEFAULT 30,
        followup_enabled INTEGER NOT NULL DEFAULT 0,
        followup_days INTEGER NOT NULL DEFAULT 7,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE templates (
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('initial', 'followup')),
        subject TEXT NOT NULL DEFAULT '',   -- relance : vide = "Re: <objet du 1er mail>"
        subject_b TEXT,                     -- objet B (premier mail uniquement)
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, kind)
      )`,
      `CREATE TABLE prospects (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        company TEXT NOT NULL, email TEXT NOT NULL, website TEXT, city TEXT, sector TEXT,
        hook TEXT,                  -- accroche perso (1 phrase)
        source TEXT,                -- page où l'email a été trouvé (RGPD : origine des données)
        score INTEGER,
        status TEXT NOT NULL DEFAULT 'new',  -- new | sent | replied | client | refused | bounced
        variant TEXT,               -- A | B
        sent_at INTEGER, created_at INTEGER NOT NULL,
        replied_at INTEGER, reply_subject TEXT,
        followup_at INTEGER,
        next_action TEXT, next_action_at INTEGER,
        UNIQUE(project_id, email)
      )`,
      'CREATE INDEX prospects_project ON prospects(project_id, status)',
      'CREATE TABLE blacklist (email TEXT PRIMARY KEY, reason TEXT, created_at INTEGER NOT NULL)',
      `CREATE TABLE jobs (
        id INTEGER PRIMARY KEY,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        type TEXT NOT NULL,         -- analyze | prospect | template | send | evolution…
        status TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | error | cancelled
        params_json TEXT, progress_json TEXT, result_json TEXT, error TEXT,
        cost_usd REAL, tokens_in INTEGER, tokens_out INTEGER,
        created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER,
        run_after INTEGER           -- ne pas démarrer avant (epoch s)
      )`,
      'CREATE INDEX jobs_status ON jobs(status, id)',
      `CREATE TABLE mail_log (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        prospect_id INTEGER, email TEXT NOT NULL, sent_at INTEGER NOT NULL, error TEXT,
        kind TEXT NOT NULL DEFAULT 'initial',
        variant TEXT, subject TEXT, message_id TEXT
      )`,
      'CREATE INDEX mail_log_day ON mail_log(project_id, sent_at)',
      'CREATE INDEX mail_log_msgid ON mail_log(message_id)',
      `CREATE TABLE prospect_notes (
        id INTEGER PRIMARY KEY,
        prospect_id INTEGER NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      'CREATE INDEX prospect_notes_p ON prospect_notes(prospect_id, created_at)',
      `CREATE TABLE metrics_daily (
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        day TEXT NOT NULL,          -- AAAA-MM-JJ, heure de Paris
        users REAL, clients REAL, revenue REAL,
        PRIMARY KEY (project_id, day)
      )`,
    ],
    mysql: [
      // Identifiants sensibles à la casse (base64url) : collation binaire
      `CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS oauth_states (
        state VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
        verifier VARCHAR(255) NOT NULL, nonce VARCHAR(255) NOT NULL, created_at BIGINT NOT NULL
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS settings (
        \`key\` VARCHAR(190) NOT NULL PRIMARY KEY,
        value TEXT
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS projects (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        git_url VARCHAR(500) NOT NULL,
        profile_json MEDIUMTEXT,    -- fiche projet générée par Claude
        profile_commit VARCHAR(64), -- commit analysé
        profile_at BIGINT,
        target_json TEXT,           -- cible déduite (modifiable)
        target_validated TINYINT NOT NULL DEFAULT 0,
        smtp_enc TEXT,              -- config SMTP chiffrée
        db_enc TEXT,                -- accès BDD chiffré (récap)
        imap_enc TEXT,              -- config IMAP chiffrée
        inbox_json TEXT,            -- état de la dernière lecture IMAP
        daily_mail_cap INT NOT NULL DEFAULT 30,
        followup_enabled TINYINT NOT NULL DEFAULT 0,
        followup_days INT NOT NULL DEFAULT 7,
        created_at BIGINT NOT NULL,
        UNIQUE KEY projects_git_url (git_url)
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS templates (
        project_id BIGINT NOT NULL,
        kind VARCHAR(20) NOT NULL,
        subject VARCHAR(500) NOT NULL DEFAULT '',   -- relance : vide = "Re: <objet du 1er mail>"
        subject_b VARCHAR(500),                     -- objet B (premier mail uniquement)
        body TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (project_id, kind),
        CONSTRAINT templates_kind CHECK (kind IN ('initial', 'followup')),
        CONSTRAINT templates_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS prospects (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        project_id BIGINT NOT NULL,
        company VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL,
        website VARCHAR(500), city VARCHAR(255), sector VARCHAR(255),
        hook TEXT,                  -- accroche perso (1 phrase)
        source TEXT,                -- page où l'email a été trouvé (RGPD : origine des données)
        score INT,
        status VARCHAR(20) NOT NULL DEFAULT 'new',  -- new | sent | replied | client | refused | bounced
        variant VARCHAR(4),         -- A | B
        sent_at BIGINT, created_at BIGINT NOT NULL,
        replied_at BIGINT, reply_subject TEXT,
        followup_at BIGINT,
        next_action VARCHAR(255), next_action_at BIGINT,
        UNIQUE KEY prospects_project_email (project_id, email),
        KEY prospects_project (project_id, status),
        CONSTRAINT prospects_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS blacklist (
        email VARCHAR(255) NOT NULL PRIMARY KEY, reason VARCHAR(255), created_at BIGINT NOT NULL
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS jobs (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        project_id BIGINT NULL,
        type VARCHAR(40) NOT NULL,         -- analyze | prospect | template | send | evolution…
        status VARCHAR(20) NOT NULL DEFAULT 'queued',  -- queued | running | done | error | cancelled
        params_json TEXT, progress_json TEXT, result_json MEDIUMTEXT, error TEXT,
        cost_usd DOUBLE, tokens_in BIGINT, tokens_out BIGINT,
        created_at BIGINT NOT NULL, started_at BIGINT, finished_at BIGINT,
        run_after BIGINT,                  -- ne pas démarrer avant (epoch s)
        KEY jobs_status (status, id),
        CONSTRAINT jobs_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS mail_log (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        project_id BIGINT NOT NULL,
        prospect_id BIGINT, email VARCHAR(255) NOT NULL, sent_at BIGINT NOT NULL, error TEXT,
        kind VARCHAR(20) NOT NULL DEFAULT 'initial',
        variant VARCHAR(4), subject TEXT, message_id VARCHAR(255),
        KEY mail_log_day (project_id, sent_at),
        KEY mail_log_msgid (message_id),
        CONSTRAINT mail_log_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS prospect_notes (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        prospect_id BIGINT NOT NULL,
        body TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        KEY prospect_notes_p (prospect_id, created_at),
        CONSTRAINT prospect_notes_prospect FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS metrics_daily (
        project_id BIGINT NOT NULL,
        day VARCHAR(10) NOT NULL,          -- AAAA-MM-JJ, heure de Paris
        users DOUBLE, clients DOUBLE, revenue DOUBLE,
        PRIMARY KEY (project_id, day),
        CONSTRAINT metrics_daily_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ${T}`,
    ],
  },
];
