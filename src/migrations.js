// Migrations versionnées, en deux dialectes maintenus ENSEMBLE : MySQL/MariaDB (production)
// et SQLite en mémoire (tests locaux). Une entrée = une version, avec les mêmes tables et colonnes
// des deux côtés (test/schema.test.js le vérifie). Ne jamais modifier une migration déjà livrée,
// en ajouter une. Côté MySQL, chaque instruction est idempotente (CREATE ... IF NOT EXISTS) : MySQL
// valide implicitement chaque DDL, une migration interrompue peut donc être rejouée.
//
// Une instruction est soit une chaîne SQL, soit { sql, params?(ctx), when?(q, ctx) } ou { run(q, ctx, exec) } (étape JavaScript) :
//   - params(ctx) fournit les paramètres liés (ctx = { ownerEmail, now }) ;
//   - when(q, ctx) décide si l'instruction s'applique (q(sql, params) renvoie les lignes) : c'est ce qui rend
//     les ALTER TABLE rejouables côté MySQL (pas de IF NOT EXISTS sur ADD COLUMN) ;
//   - check(q, ctx), au niveau de la migration, est lancé avant toute écriture et peut refuser de migrer.
// sqliteForeignKeysOff : la migration reconstruit des tables (SQLite ne sait pas retirer un UNIQUE) ; les clés
// étrangères sont suspendues pendant la migration, puis PRAGMA foreign_key_check vérifie le résultat.

import { hashSid } from './crypto.js';

const T = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

// Les sessions existantes gardent leur validité : le cookie n'change pas, seule la valeur stockée devient son empreinte.
const hashSessionIds = {
  run: async (q, ctx, exec) => {
    // Une empreinte (64 caractères hexadécimaux) n'est pas rehachée : la migration peut être rejouée côté MySQL
    for (const r of await q('SELECT id FROM sessions')) if (!/^[0-9a-f]{64}$/.test(r.id)) await exec('UPDATE sessions SET id = ? WHERE id = ?', [hashSid(r.id), r.id]);
  },
};


// ---------- Aides de la migration 2 ----------

function ownerParams(ctx) { return [ctx.ownerEmail, ctx.now]; }
function ownerParams0(ctx) { return [ctx.ownerEmail ?? null]; }

// Des données existent-elles (une instance déjà utilisée) ? Alors elles ont besoin d'un propriétaire.
async function hasLegacyData(q) {
  for (const t of ['projects', 'settings', 'jobs']) {
    if ((await q(`SELECT COUNT(*) n FROM ${t}`))[0].n > 0) return true;
  }
  return false;
}

async function checkOwner(q, ctx) {
  if (ctx.ownerEmail) return;
  if (await hasLegacyData(q)) {
    throw new Error('Migration comptes : des données existent, définis ADMIN_EMAILS (le premier email devient propriétaire de ces données).');
  }
}

const infoSchema = (what) => `SELECT 1 x FROM information_schema.${what} WHERE table_schema = DATABASE() AND table_name = ?`;
function colMissing(t, c) {
  return async (q) => !(await q(`${infoSchema('columns')} AND column_name = ?`, [t, c])).length;
}
function idxExists(t, i) {
  return async (q) => (await q(`${infoSchema('statistics')} AND index_name = ?`, [t, i])).length > 0;
}
function idxMissing(t, i) {
  return async (q) => !(await idxExists(t, i)(q));
}
function fkMissing(t, name) {
  return async (q) => !(await q(`${infoSchema('table_constraints')} AND constraint_name = ? AND constraint_type = 'FOREIGN KEY'`, [t, name])).length;
}
function tableExists(t) {
  return async (q) => (await q(infoSchema('tables'), [t])).length > 0;
}

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
  {
    // J2 : comptes et multi-tenant. Les données existantes sont rattachées à l'utilisateur « propriétaire »
    // (première adresse de ADMIN_EMAILS). Sessions et états OAuth, éphémères, sont recréés.
    name: 'comptes_multi_tenant',
    sqliteForeignKeysOff: true,
    check: checkOwner,
    sqlite: [
      `CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        name TEXT,
        provider TEXT,              -- google | apple (NULL = compte préparé par la migration, jamais connecté)
        provider_sub TEXT,          -- identifiant (sub) chez le fournisseur
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
        is_admin INTEGER NOT NULL DEFAULT 0,
        plan TEXT NOT NULL DEFAULT 'free',
        created_at INTEGER NOT NULL,
        last_login_at INTEGER,
        claude_link_json TEXT,      -- liaison Claude (J3)
        UNIQUE(provider, provider_sub)
      )`,
      { sql: "INSERT OR IGNORE INTO users(email, status, is_admin, plan, created_at) VALUES(?, 'active', 1, 'free', ?)", params: ownerParams, when: hasLegacyData },
      `CREATE TABLE projects_new (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        git_url TEXT NOT NULL,
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
        created_at INTEGER NOT NULL,
        UNIQUE(user_id, git_url)
      )`,
      { sql: `INSERT INTO projects_new(id, user_id, name, git_url, profile_json, profile_commit, profile_at, target_json, target_validated,
          smtp_enc, db_enc, imap_enc, inbox_json, daily_mail_cap, followup_enabled, followup_days, created_at)
        SELECT id, (SELECT id FROM users WHERE email = ?), name, git_url, profile_json, profile_commit, profile_at, target_json, target_validated,
          smtp_enc, db_enc, imap_enc, inbox_json, daily_mail_cap, followup_enabled, followup_days, created_at FROM projects`, params: ownerParams0 },
      'DROP TABLE projects',
      'ALTER TABLE projects_new RENAME TO projects',
      `CREATE TABLE jobs_new (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        type TEXT NOT NULL,         -- analyze | prospect | template | send | evolution…
        status TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | error | cancelled
        params_json TEXT, progress_json TEXT, result_json TEXT, error TEXT,
        cost_usd REAL, tokens_in INTEGER, tokens_out INTEGER,
        created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER,
        run_after INTEGER           -- ne pas démarrer avant (epoch s)
      )`,
      { sql: `INSERT INTO jobs_new(id, user_id, project_id, type, status, params_json, progress_json, result_json, error,
          cost_usd, tokens_in, tokens_out, created_at, started_at, finished_at, run_after)
        SELECT id, COALESCE((SELECT user_id FROM projects WHERE projects.id = jobs.project_id), (SELECT id FROM users WHERE email = ?)),
          project_id, type, status, params_json, progress_json, result_json, error,
          cost_usd, tokens_in, tokens_out, created_at, started_at, finished_at, run_after FROM jobs`, params: ownerParams0 },
      'DROP TABLE jobs',
      'ALTER TABLE jobs_new RENAME TO jobs',
      'CREATE INDEX jobs_status ON jobs(status, id)',
      'CREATE INDEX jobs_user ON jobs(user_id, status)',
      `CREATE TABLE user_settings (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (user_id, key)
      )`,
      { sql: 'INSERT OR IGNORE INTO user_settings(user_id, key, value) SELECT u.id, s.key, s.value FROM settings s JOIN users u ON u.email = ?', params: ownerParams0 },
      'DROP TABLE settings',
      'DROP TABLE sessions',
      `CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      )`,
      'CREATE INDEX sessions_user ON sessions(user_id)',
      'DROP TABLE oauth_states',
      `CREATE TABLE oauth_states (
        state TEXT PRIMARY KEY, provider TEXT NOT NULL, verifier TEXT NOT NULL, nonce TEXT NOT NULL,
        binding TEXT NOT NULL,      -- empreinte du cookie qui lie le flux au navigateur d'origine
        created_at INTEGER NOT NULL
      )`,
    ],
    mysql: [
      `CREATE TABLE IF NOT EXISTS users (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        provider VARCHAR(20),       -- google | apple (NULL = compte préparé par la migration, jamais connecté)
        provider_sub VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,  -- identifiant (sub) chez le fournisseur
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        is_admin TINYINT NOT NULL DEFAULT 0,
        plan VARCHAR(20) NOT NULL DEFAULT 'free',
        created_at BIGINT NOT NULL,
        last_login_at BIGINT,
        claude_link_json TEXT,      -- liaison Claude (J3)
        UNIQUE KEY users_email (email),
        UNIQUE KEY users_provider (provider, provider_sub),
        CONSTRAINT users_status CHECK (status IN ('active', 'suspended'))
      ) ${T}`,
      { sql: "INSERT IGNORE INTO users(email, status, is_admin, plan, created_at) VALUES(?, 'active', 1, 'free', ?)", params: ownerParams, when: hasLegacyData },
      // projects : user_id, puis unicité de git_url par utilisateur
      { sql: 'ALTER TABLE projects ADD COLUMN user_id BIGINT NULL', when: colMissing('projects', 'user_id') },
      { sql: 'UPDATE projects SET user_id = (SELECT id FROM users WHERE email = ?) WHERE user_id IS NULL', params: ownerParams0 },
      'ALTER TABLE projects MODIFY user_id BIGINT NOT NULL',
      { sql: 'ALTER TABLE projects ADD CONSTRAINT projects_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE', when: fkMissing('projects', 'projects_user') },
      { sql: 'ALTER TABLE projects DROP INDEX projects_git_url', when: idxExists('projects', 'projects_git_url') },
      { sql: 'ALTER TABLE projects ADD UNIQUE KEY projects_user_git_url (user_id, git_url)', when: idxMissing('projects', 'projects_user_git_url') },
      // jobs : user_id dénormalisé (un job sans projet doit rester attribuable)
      { sql: 'ALTER TABLE jobs ADD COLUMN user_id BIGINT NULL', when: colMissing('jobs', 'user_id') },
      'UPDATE jobs SET user_id = (SELECT user_id FROM projects WHERE projects.id = jobs.project_id) WHERE user_id IS NULL AND project_id IS NOT NULL',
      { sql: 'UPDATE jobs SET user_id = (SELECT id FROM users WHERE email = ?) WHERE user_id IS NULL', params: ownerParams0 },
      'ALTER TABLE jobs MODIFY user_id BIGINT NOT NULL',
      { sql: 'ALTER TABLE jobs ADD CONSTRAINT jobs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE', when: fkMissing('jobs', 'jobs_user') },
      { sql: 'ALTER TABLE jobs ADD KEY jobs_user_status (user_id, status)', when: idxMissing('jobs', 'jobs_user_status') },
      // réglages : globaux → par utilisateur
      `CREATE TABLE IF NOT EXISTS user_settings (
        user_id BIGINT NOT NULL,
        \`key\` VARCHAR(190) NOT NULL,
        value TEXT,
        PRIMARY KEY (user_id, \`key\`),
        CONSTRAINT user_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ${T}`,
      { sql: 'INSERT IGNORE INTO user_settings(user_id, `key`, value) SELECT u.id, s.`key`, s.value FROM settings s JOIN users u ON u.email = ?', params: ownerParams0, when: tableExists('settings') },
      'DROP TABLE IF EXISTS settings',
      'DROP TABLE IF EXISTS sessions',
      `CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
        KEY sessions_user (user_id),
        CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ${T}`,
      'DROP TABLE IF EXISTS oauth_states',
      `CREATE TABLE IF NOT EXISTS oauth_states (
        state VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
        provider VARCHAR(20) NOT NULL,
        verifier VARCHAR(255) NOT NULL, nonce VARCHAR(255) NOT NULL,
        binding VARCHAR(128) NOT NULL,     -- empreinte du cookie qui lie le flux au navigateur d'origine
        created_at BIGINT NOT NULL
      ) ${T}`,
    ],
  },
  {
    // J5 : journal d'usage. Les envois et les jobs IA du mois se comptent ici (et non dans mail_log / jobs) pour qu'un projet
    // supprimé n'efface pas la consommation du mois. Pas de compteur : on additionne les lignes, rien ne peut dériver.
    name: 'journal_usage',
    sqlite: [
      `CREATE TABLE usage_events (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,         -- mail | ai_job
        ref INTEGER,                -- ai_job : id du job (il peut disparaître avec son projet, l'événement reste)
        at INTEGER NOT NULL
      )`,
      'CREATE INDEX usage_events_user ON usage_events(user_id, kind, at)',
    ],
    mysql: [
      `CREATE TABLE IF NOT EXISTS usage_events (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        kind VARCHAR(20) NOT NULL,         -- mail | ai_job
        ref BIGINT NULL,                   -- ai_job : id du job (il peut disparaître avec son projet, l'événement reste)
        at BIGINT NOT NULL,
        KEY usage_events_user (user_id, kind, at),
        CONSTRAINT usage_events_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ${T}`,
    ],
  },
  {
    // J5 : journal d'audit des actions d'administration et des décisions automatiques (pause d'envoi, comptes inactifs).
    // Pas de clé étrangère : le journal survit à la suppression des comptes, qui n'y figurent que par un identifiant et une
    // adresse masquée (minimisation). Aucune route ne le modifie ni ne l'efface ; un nettoyage périodique retire l'ancien.
    name: 'journal_audit',
    sqlite: [
      `CREATE TABLE admin_audit (
        id INTEGER PRIMARY KEY,
        admin_id INTEGER,           -- NULL = décision du système (planificateur, détection d'abus)
        admin_label TEXT,
        action TEXT NOT NULL,
        target_id INTEGER,
        target_label TEXT,          -- adresse masquée
        detail TEXT,
        created_at INTEGER NOT NULL
      )`,
      'CREATE INDEX admin_audit_at ON admin_audit(created_at)',
    ],
    mysql: [
      `CREATE TABLE IF NOT EXISTS admin_audit (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        admin_id BIGINT NULL,
        admin_label VARCHAR(255),
        action VARCHAR(40) NOT NULL,
        target_id BIGINT NULL,
        target_label VARCHAR(255),
        detail VARCHAR(500),
        created_at BIGINT NOT NULL,
        KEY admin_audit_at (created_at)
      ) ${T}`,
    ],
  },
  {
    // Équipes (partage de projets entre comptes) et LinkedIn (compte relié à un projet, brouillons de posts).
    //  - teams : une équipe par propriétaire ; ses projets y sont partagés avec projects.team_id (pas de clé étrangère : la
    //    suppression d'une équipe remet team_id à NULL dans le code, les projets restent à leur propriétaire) ;
    //  - team_members : rôle admin | member (le propriétaire est implicite) ;
    //  - team_invites : invitation par email, le jeton n'est jamais stocké en clair (seule son empreinte) ;
    //  - linkedin_accounts : un compte LinkedIn par projet, jeton chiffré ; linkedin_posts : brouillons et posts publiés.
    name: 'equipes_linkedin',
    sqlite: [
      `CREATE TABLE teams (
        id INTEGER PRIMARY KEY,
        owner_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE team_members (
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,         -- admin | member
        created_at INTEGER NOT NULL,
        PRIMARY KEY (team_id, user_id)
      )`,
      'CREATE INDEX team_members_user ON team_members(user_id)',
      `CREATE TABLE team_invites (
        id INTEGER PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_by INTEGER,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
      'CREATE INDEX team_invites_team ON team_invites(team_id)',
      'ALTER TABLE projects ADD COLUMN team_id INTEGER',
      'CREATE INDEX projects_team ON projects(team_id)',
      `CREATE TABLE linkedin_accounts (
        project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        member_urn TEXT NOT NULL,
        name TEXT,
        token_enc TEXT NOT NULL,
        expires_at INTEGER,
        connected_by INTEGER,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE linkedin_posts (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        direction TEXT,
        body TEXT NOT NULL,
        status TEXT NOT NULL,       -- draft | published
        remote_id TEXT,
        created_at INTEGER NOT NULL,
        published_at INTEGER
      )`,
      'CREATE INDEX linkedin_posts_project ON linkedin_posts(project_id, id)',
    ],
    mysql: [
      `CREATE TABLE IF NOT EXISTS teams (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        owner_id BIGINT NOT NULL,
        name VARCHAR(80) NOT NULL,
        created_at BIGINT NOT NULL,
        UNIQUE KEY teams_owner (owner_id),
        CONSTRAINT teams_owner_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS team_members (
        team_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        role VARCHAR(10) NOT NULL,         -- admin | member
        created_at BIGINT NOT NULL,
        PRIMARY KEY (team_id, user_id),
        KEY team_members_user (user_id),
        CONSTRAINT team_members_team_fk FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
        CONSTRAINT team_members_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS team_invites (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        team_id BIGINT NOT NULL,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(10) NOT NULL,
        token_hash VARCHAR(64) NOT NULL,
        created_by BIGINT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        UNIQUE KEY team_invites_token (token_hash),
        KEY team_invites_team (team_id),
        CONSTRAINT team_invites_team_fk FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
      ) ${T}`,
      { sql: 'ALTER TABLE projects ADD COLUMN team_id BIGINT NULL', when: colMissing('projects', 'team_id') },
      { sql: 'CREATE INDEX projects_team ON projects(team_id)', when: idxMissing('projects', 'projects_team') },
      `CREATE TABLE IF NOT EXISTS linkedin_accounts (
        project_id BIGINT NOT NULL PRIMARY KEY,
        member_urn VARCHAR(100) NOT NULL,
        name VARCHAR(255),
        token_enc TEXT NOT NULL,
        expires_at BIGINT NULL,
        connected_by BIGINT NULL,
        created_at BIGINT NOT NULL,
        CONSTRAINT linkedin_accounts_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS linkedin_posts (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        project_id BIGINT NOT NULL,
        direction TEXT,
        body TEXT NOT NULL,
        status VARCHAR(12) NOT NULL,       -- draft | published
        remote_id VARCHAR(200) NULL,
        created_at BIGINT NOT NULL,
        published_at BIGINT NULL,
        KEY linkedin_posts_project (project_id, id),
        CONSTRAINT linkedin_posts_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ${T}`,
    ],
  },
  {
    // LinkedIn : publier sur une page. Le compte relié garde les droits accordés (scope) et la cible choisie (NULL = le profil) ;
    // chaque post publié garde le nom de l'endroit où il est parti.
    name: 'linkedin_pages',
    sqlite: [
      'ALTER TABLE linkedin_accounts ADD COLUMN scope TEXT',
      'ALTER TABLE linkedin_accounts ADD COLUMN target_urn TEXT',
      'ALTER TABLE linkedin_accounts ADD COLUMN target_name TEXT',
      'ALTER TABLE linkedin_posts ADD COLUMN author_name TEXT',
    ],
    mysql: [
      { sql: 'ALTER TABLE linkedin_accounts ADD COLUMN scope VARCHAR(600) NULL', when: colMissing('linkedin_accounts', 'scope') },
      { sql: 'ALTER TABLE linkedin_accounts ADD COLUMN target_urn VARCHAR(100) NULL', when: colMissing('linkedin_accounts', 'target_urn') },
      { sql: 'ALTER TABLE linkedin_accounts ADD COLUMN target_name VARCHAR(255) NULL', when: colMissing('linkedin_accounts', 'target_name') },
      { sql: 'ALTER TABLE linkedin_posts ADD COLUMN author_name VARCHAR(255) NULL', when: colMissing('linkedin_posts', 'author_name') },
    ],
  },
  {
    // Le SMTP « global » des Réglages disparaît : les mails d'AiTools (rapport, évolutions, invitations, avertissements) partent
    // du SMTP du serveur (SYSTEM_SMTP_*). Pour ne rien casser, chaque projet qui s'appuyait sur ce SMTP en garde une copie.
    name: 'global_smtp_to_projects',
    sqlite: [
      `UPDATE projects SET smtp_enc = (SELECT s.value FROM user_settings s WHERE s.user_id = projects.user_id AND s.key = 'smtp_enc')
        WHERE smtp_enc IS NULL AND EXISTS (SELECT 1 FROM user_settings s WHERE s.user_id = projects.user_id AND s.key = 'smtp_enc')`,
      "DELETE FROM user_settings WHERE key = 'smtp_enc'",
    ],
    mysql: [
      `UPDATE projects p JOIN user_settings s ON s.user_id = p.user_id AND s.\`key\` = 'smtp_enc' SET p.smtp_enc = s.value WHERE p.smtp_enc IS NULL`,
      "DELETE FROM user_settings WHERE `key` = 'smtp_enc'",
    ],
  },
  {
    // Liste d'opposition : les prospects déjà présents chez les autres comptes passent en « refus » (ils ne sont plus contactés, et
    // l'état affiché le dit sans révéler d'où vient l'opposition).
    name: 'opposition_propagation',
    sqlite: ["UPDATE prospects SET status = 'refused' WHERE status IN ('new', 'sent') AND email IN (SELECT email FROM blacklist)"],
    mysql: ["UPDATE prospects SET status = 'refused' WHERE status IN ('new', 'sent') AND email IN (SELECT email FROM blacklist)"],
  },
  {
    // Réponses des prospects lues dans la boîte : texte, intention (classement automatique), lu / non lu (popup d'arrivée).
    name: 'replies',
    sqlite: [
      `CREATE TABLE replies (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        prospect_id INTEGER REFERENCES prospects(id) ON DELETE CASCADE,
        uid INTEGER,                -- UID IMAP : une réponse n'est enregistrée qu'une fois
        from_email TEXT NOT NULL, subject TEXT, body TEXT,
        intent TEXT NOT NULL DEFAULT 'other',   -- interested | question | later | refused | other
        received_at INTEGER NOT NULL, seen_at INTEGER
      )`,
      'CREATE UNIQUE INDEX replies_uid ON replies(project_id, uid)',
      'CREATE INDEX replies_project ON replies(project_id, received_at)',
      'CREATE INDEX replies_prospect ON replies(prospect_id)',
    ],
    mysql: [
      `CREATE TABLE IF NOT EXISTS replies (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        project_id BIGINT NOT NULL,
        prospect_id BIGINT NULL,
        uid BIGINT NULL,
        from_email VARCHAR(255) NOT NULL, subject TEXT, body TEXT,
        intent VARCHAR(20) NOT NULL DEFAULT 'other',
        received_at BIGINT NOT NULL, seen_at BIGINT NULL,
        UNIQUE KEY replies_uid (project_id, uid),
        KEY replies_project (project_id, received_at),
        KEY replies_prospect (prospect_id),
        CONSTRAINT replies_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        CONSTRAINT replies_prospect_fk FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
      ) ${T}`,
    ],
  },
  {
    // Accusés de lecture (MDN, RFC 8098) : le destinataire choisit d'en envoyer un ; aucun pixel espion.
    name: 'read_receipts',
    sqlite: ['ALTER TABLE mail_log ADD COLUMN read_at INTEGER'],
    mysql: [{ sql: 'ALTER TABLE mail_log ADD COLUMN read_at BIGINT NULL', when: colMissing('mail_log', 'read_at') }],
  },
  {
    // Agenda : lien iCal secret par compte ; posts LinkedIn programmés (publiés par le planificateur à l'heure choisie).
    name: 'calendar',
    sqlite: [
      `CREATE TABLE ical_feeds (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        token_enc TEXT NOT NULL,     -- le lien d'un agenda doit pouvoir être réaffiché : chiffré, jamais en clair
        created_at INTEGER NOT NULL
      )`,
      'ALTER TABLE linkedin_posts ADD COLUMN scheduled_at INTEGER',
      'ALTER TABLE linkedin_posts ADD COLUMN schedule_error TEXT',
    ],
    mysql: [
      `CREATE TABLE IF NOT EXISTS ical_feeds (
        user_id BIGINT NOT NULL PRIMARY KEY,
        token_hash VARCHAR(64) NOT NULL,
        token_enc TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        UNIQUE KEY ical_feeds_hash (token_hash),
        CONSTRAINT ical_feeds_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ${T}`,
      { sql: 'ALTER TABLE linkedin_posts ADD COLUMN scheduled_at BIGINT NULL', when: colMissing('linkedin_posts', 'scheduled_at') },
      { sql: 'ALTER TABLE linkedin_posts ADD COLUMN schedule_error VARCHAR(500) NULL', when: colMissing('linkedin_posts', 'schedule_error') },
    ],
  },
  {
    // Jetons d'API (mode développeur) : seul le SHA-256 du jeton est gardé, jamais le jeton lui-même.
    name: 'api_tokens',
    sqlite: [
      `CREATE TABLE api_tokens (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        prefix TEXT NOT NULL,        -- début du jeton, pour le reconnaître dans la liste
        scopes TEXT NOT NULL,        -- read, write, jobs (séparés par des virgules)
        created_at INTEGER NOT NULL, last_used_at INTEGER
      )`,
      'CREATE INDEX api_tokens_user ON api_tokens(user_id)',
    ],
    mysql: [
      `CREATE TABLE IF NOT EXISTS api_tokens (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        name VARCHAR(100) NOT NULL,
        token_hash VARCHAR(64) NOT NULL,
        prefix VARCHAR(16) NOT NULL,
        scopes VARCHAR(60) NOT NULL,
        created_at BIGINT NOT NULL, last_used_at BIGINT NULL,
        UNIQUE KEY api_tokens_hash (token_hash),
        KEY api_tokens_user (user_id),
        CONSTRAINT api_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ${T}`,
    ],
  },
  {
    // Identifiants de session : la base ne garde plus que leur empreinte SHA-256. Personne n'est déconnecté (voir hashSessionIds).
    name: 'session_id_hashing',
    sqlite: [hashSessionIds],
    mysql: [hashSessionIds],
  },
  {
    // Place réservée : le runner MySQL suit les migrations par numéro (position dans la liste). `calendar_events` avait été insérée
    // plus haut par erreur, ce qui a décalé les numéros des suivantes ; ce vide garantit qu'elle reçoit un numéro jamais appliqué.
    name: 'reserved_1',
    sqlite: [],
    mysql: [],
  },
  {
    // Événements de l'agenda : ajoutés à la main, ou proposés à partir d'une réponse de prospect (date, appel, rendez-vous).
    name: 'calendar_events',
    sqlite: [
      `CREATE TABLE calendar_events (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        prospect_id INTEGER,
        reply_id INTEGER,
        title TEXT NOT NULL, notes TEXT,
        starts_at INTEGER NOT NULL, minutes INTEGER NOT NULL DEFAULT 30,
        created_at INTEGER NOT NULL
      )`,
      'CREATE INDEX calendar_events_user ON calendar_events(user_id, starts_at)',
      'CREATE INDEX calendar_events_reply ON calendar_events(reply_id)',
    ],
    mysql: [
      `CREATE TABLE IF NOT EXISTS calendar_events (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        project_id BIGINT NULL,
        prospect_id BIGINT NULL,
        reply_id BIGINT NULL,
        title VARCHAR(255) NOT NULL, notes TEXT,
        starts_at BIGINT NOT NULL, minutes INT NOT NULL DEFAULT 30,
        created_at BIGINT NOT NULL,
        KEY calendar_events_user (user_id, starts_at),
        KEY calendar_events_reply (reply_id),
        CONSTRAINT calendar_events_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT calendar_events_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ${T}`,
    ],
  },
  {
    // Page IA : conversations de l'utilisateur avec Claude et leurs messages. Supprimés avec le compte (cascade).
    name: 'chat',
    sqlite: [
      `CREATE TABLE chat_conversations (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL, model TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      )`,
      'CREATE INDEX chat_conversations_user ON chat_conversations(user_id, updated_at)',
      `CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL, content TEXT NOT NULL, model TEXT,
        cost_usd REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      )`,
      'CREATE INDEX chat_messages_conv ON chat_messages(conversation_id, id)',
    ],
    mysql: [
      `CREATE TABLE IF NOT EXISTS chat_conversations (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        title VARCHAR(200) NOT NULL, model VARCHAR(64) NOT NULL,
        created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
        KEY chat_conversations_user (user_id, updated_at),
        CONSTRAINT chat_conversations_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS chat_messages (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        conversation_id BIGINT NOT NULL,
        role VARCHAR(12) NOT NULL, content MEDIUMTEXT NOT NULL, model VARCHAR(64) NULL,
        cost_usd DOUBLE NOT NULL DEFAULT 0, created_at BIGINT NOT NULL,
        KEY chat_messages_conv (conversation_id, id),
        CONSTRAINT chat_messages_conv_fk FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
      ) ${T}`,
    ],
  },
  {
    // Page IA : pièces jointes (images, PDF, fichiers texte, vidéos) et projets joints. Les fichiers sont sur le disque (dossier de l'utilisateur,
    // supprimé avec son compte) ; `file` est le nom du fichier, jamais un chemin. Un projet supprimé laisse la ligne (project_id passe à NULL).
    name: 'chat_attachments',
    sqlite: [
      `CREATE TABLE chat_attachments (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id INTEGER REFERENCES chat_conversations(id) ON DELETE CASCADE,
        message_id INTEGER REFERENCES chat_messages(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, name TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL DEFAULT 0,
        file TEXT, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, meta TEXT,
        created_at INTEGER NOT NULL
      )`,
      'CREATE INDEX chat_attachments_user ON chat_attachments(user_id, created_at)',
      'CREATE INDEX chat_attachments_message ON chat_attachments(message_id)',
      'CREATE INDEX chat_attachments_conv ON chat_attachments(conversation_id)',
    ],
    mysql: [
      `CREATE TABLE IF NOT EXISTS chat_attachments (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        conversation_id BIGINT NULL,
        message_id BIGINT NULL,
        kind VARCHAR(12) NOT NULL, name VARCHAR(255) NOT NULL, mime VARCHAR(100) NULL, size BIGINT NOT NULL DEFAULT 0,
        file VARCHAR(100) NULL, project_id BIGINT NULL, meta TEXT NULL,
        created_at BIGINT NOT NULL,
        KEY chat_attachments_user (user_id, created_at),
        KEY chat_attachments_message (message_id),
        KEY chat_attachments_conv (conversation_id),
        CONSTRAINT chat_attachments_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT chat_attachments_conv_fk FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
        CONSTRAINT chat_attachments_msg_fk FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
        CONSTRAINT chat_attachments_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
      ) ${T}`,
    ],
  },
  {
    // Onglet Promotion : vidéos de design motion générées pour un projet. Le fichier MP4 est sur le disque (dossier de l'utilisateur, supprimé avec son
    // compte) ; `file` est un nom de fichier, jamais un chemin. Supprimer le projet supprime les lignes (les fichiers sont retirés par le code).
    name: 'promo_videos',
    sqlite: [
      `CREATE TABLE promo_videos (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        subject TEXT NOT NULL DEFAULT '', fps INTEGER NOT NULL, seconds INTEGER NOT NULL, format TEXT NOT NULL,
        width INTEGER NOT NULL, height INTEGER NOT NULL, size INTEGER NOT NULL DEFAULT 0, file TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      'CREATE INDEX promo_videos_project ON promo_videos(project_id, id)',
      'CREATE INDEX promo_videos_user ON promo_videos(user_id, id)',
    ],
    mysql: [
      `CREATE TABLE IF NOT EXISTS promo_videos (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        project_id BIGINT NOT NULL,
        subject VARCHAR(600) NOT NULL DEFAULT '', fps INT NOT NULL, seconds INT NOT NULL, format VARCHAR(12) NOT NULL,
        width INT NOT NULL, height INT NOT NULL, size BIGINT NOT NULL DEFAULT 0, file VARCHAR(100) NOT NULL,
        created_at BIGINT NOT NULL,
        KEY promo_videos_project (project_id, id),
        KEY promo_videos_user (user_id, id),
        CONSTRAINT promo_videos_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT promo_videos_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ${T}`,
    ],
  },
  {
    // Page IA, mode Support : une conversation est soit « claude » (assistant classique), soit « support » (aide sur l'application, Claude lit la documentation).
    // Les anciennes conversations restent « claude ».
    name: 'chat_mode',
    sqlite: ["ALTER TABLE chat_conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'claude'"],
    mysql: [
      { sql: "ALTER TABLE chat_conversations ADD COLUMN mode VARCHAR(12) NOT NULL DEFAULT 'claude'", when: colMissing('chat_conversations', 'mode') },
    ],
  },
  {
    // Mails de prospection : texte simple par défaut ; l'utilisateur peut choisir le HTML en validant le modèle (case « Envoyer en HTML »).
    name: 'template_html',
    sqlite: ['ALTER TABLE templates ADD COLUMN html INTEGER NOT NULL DEFAULT 0'],
    mysql: [
      { sql: 'ALTER TABLE templates ADD COLUMN html TINYINT NOT NULL DEFAULT 0', when: colMissing('templates', 'html') },
    ],
  },
  {
    // Comptabilité : une ligne par paiement, dépense, remboursement… avec son justificatif (fichier sur le disque, un dossier par ligne). Le nom du projet est
    // recopié : supprimer un projet ne supprime pas la comptabilité (on garde les pièces), la ligne reste classée sous son ancien nom.
    name: 'accounting',
    sqlite: [
      `CREATE TABLE accounting_entries (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        project_name TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL,
        entry_date TEXT NOT NULL,
        label TEXT NOT NULL,
        party TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        amount_cents INTEGER NOT NULL,
        vat_rate INTEGER NOT NULL DEFAULT 0,
        vat_cents INTEGER NOT NULL DEFAULT 0,
        method TEXT NOT NULL DEFAULT 'transfer',
        notes TEXT NOT NULL DEFAULT '',
        doc_name TEXT NOT NULL,
        doc_mime TEXT NOT NULL,
        doc_size INTEGER NOT NULL,
        doc_file TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      'CREATE INDEX accounting_user_date ON accounting_entries(user_id, entry_date)',
      'CREATE INDEX accounting_project ON accounting_entries(project_id)',
      `CREATE TABLE accounting_declarations (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        period TEXT NOT NULL,
        done_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, period)
      )`,
    ],
    mysql: [
      `CREATE TABLE IF NOT EXISTS accounting_entries (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        project_id BIGINT NULL,
        project_name VARCHAR(200) NOT NULL DEFAULT '',
        kind VARCHAR(20) NOT NULL,
        entry_date VARCHAR(10) NOT NULL,
        label VARCHAR(200) NOT NULL,
        party VARCHAR(200) NOT NULL DEFAULT '',
        category VARCHAR(30) NOT NULL DEFAULT '',
        amount_cents BIGINT NOT NULL,
        vat_rate INT NOT NULL DEFAULT 0,
        vat_cents BIGINT NOT NULL DEFAULT 0,
        method VARCHAR(20) NOT NULL DEFAULT 'transfer',
        notes VARCHAR(600) NOT NULL DEFAULT '',
        doc_name VARCHAR(200) NOT NULL,
        doc_mime VARCHAR(60) NOT NULL,
        doc_size BIGINT NOT NULL,
        doc_file VARCHAR(60) NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        KEY accounting_user_date (user_id, entry_date),
        KEY accounting_project (project_id),
        CONSTRAINT accounting_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT accounting_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS accounting_declarations (
        user_id BIGINT NOT NULL,
        period VARCHAR(10) NOT NULL,
        done_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, period),
        CONSTRAINT accounting_decl_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ${T}`,
    ],
  },
  {
    // Facturation : informations légales d'un projet et modèles de documents (3 exemples de devis, puis devis / acompte / facture finale / avoir).
    // `variant` : 1 à 3 pour les exemples de devis (kind « quote_option »), 0 pour les quatre documents définitifs.
    name: 'billing',
    sqlite: [
      `CREATE TABLE billing_projects (
        project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        legal_json TEXT NOT NULL,
        chosen INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE billing_docs (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        variant INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft',
        layout TEXT NOT NULL DEFAULT 'classique',
        content_json TEXT NOT NULL,
        refinement TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        validated_at INTEGER,
        UNIQUE (project_id, kind, variant)
      )`,
      'CREATE INDEX billing_docs_user ON billing_docs(user_id)',
    ],
    mysql: [
      `CREATE TABLE IF NOT EXISTS billing_projects (
        project_id BIGINT NOT NULL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        legal_json TEXT NOT NULL,
        chosen INT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        CONSTRAINT billing_projects_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        CONSTRAINT billing_projects_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ${T}`,
      `CREATE TABLE IF NOT EXISTS billing_docs (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        project_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        kind VARCHAR(20) NOT NULL,
        variant INT NOT NULL DEFAULT 0,
        status VARCHAR(12) NOT NULL DEFAULT 'draft',
        layout VARCHAR(12) NOT NULL DEFAULT 'classique',
        content_json MEDIUMTEXT NOT NULL,
        refinement VARCHAR(1000) NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        validated_at BIGINT NULL,
        UNIQUE KEY billing_docs_slot (project_id, kind, variant),
        KEY billing_docs_user (user_id),
        CONSTRAINT billing_docs_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        CONSTRAINT billing_docs_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ${T}`,
    ],
  },
  {
    name: 'billing_invoices',
    sqlite: [
      `CREATE TABLE billing_invoices (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        project_name TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL,
        number TEXT NOT NULL,
        issue_date TEXT NOT NULL,
        due_date TEXT NOT NULL DEFAULT '',
        client_json TEXT NOT NULL,
        amount_cents INTEGER NOT NULL DEFAULT 0,
        entry_id INTEGER,
        pdf_file TEXT NOT NULL,
        pdf_size INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (user_id, number)
      )`,
      'CREATE INDEX billing_invoices_project ON billing_invoices(project_id)',
      "ALTER TABLE accounting_entries ADD COLUMN pending INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE accounting_entries ADD COLUMN invoice_id INTEGER",
    ],
    mysql: [
      `CREATE TABLE IF NOT EXISTS billing_invoices (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        project_id BIGINT NULL,
        project_name VARCHAR(200) NOT NULL DEFAULT '',
        kind VARCHAR(20) NOT NULL,
        number VARCHAR(40) NOT NULL,
        issue_date VARCHAR(10) NOT NULL,
        due_date VARCHAR(10) NOT NULL DEFAULT '',
        client_json TEXT NOT NULL,
        amount_cents BIGINT NOT NULL DEFAULT 0,
        entry_id BIGINT NULL,
        pdf_file VARCHAR(60) NOT NULL,
        pdf_size BIGINT NOT NULL,
        created_at BIGINT NOT NULL,
        UNIQUE KEY billing_invoices_number (user_id, number),
        KEY billing_invoices_project (project_id),
        CONSTRAINT billing_invoices_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ${T}`,
      { sql: 'ALTER TABLE accounting_entries ADD COLUMN pending TINYINT NOT NULL DEFAULT 0', when: colMissing('accounting_entries', 'pending') },
      { sql: 'ALTER TABLE accounting_entries ADD COLUMN invoice_id BIGINT NULL', when: colMissing('accounting_entries', 'invoice_id') },
    ],
  },
  {
    name: 'billing_clients',
    sqlite: [
      `CREATE TABLE billing_clients (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        siret TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      'CREATE INDEX billing_clients_project ON billing_clients(project_id)',
    ],
    mysql: [
      `CREATE TABLE IF NOT EXISTS billing_clients (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT NOT NULL,
        project_id BIGINT NOT NULL,
        name VARCHAR(120) NOT NULL,
        address VARCHAR(200) NOT NULL DEFAULT '',
        siret VARCHAR(20) NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        KEY billing_clients_project (project_id),
        CONSTRAINT billing_clients_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT billing_clients_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ${T}`,
    ],
  },
];
