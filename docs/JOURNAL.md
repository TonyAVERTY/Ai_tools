# Journal de projet — AiTools

Branches de travail : `feat/saas-mysql` (J1) puis `feat/saas-accounts` (J2, créée depuis la précédente) — version publique, voir `docs/CADRAGE.md`.

## 2026-10-22 — J2 « Comptes et multi-tenant »

### Fait
- **Comptes** (migration 2 `comptes_multi_tenant`, SQLite et MySQL ensemble) : table `users` (email unique insensible à la casse, nom, fournisseur + `sub`, statut `active|suspended`, `is_admin`, plan `free`, dates, `claude_link_json` réservé au J3). Inscription automatique à la première connexion réussie, sans validation manuelle ni mot de passe.
- **Connexion Google et Apple** (`src/auth.js`, zéro dépendance) : state + nonce, PKCE pour Google, `response_mode=form_post` pour Apple, secret client Apple en JWT ES256 signé avec `node:crypto`. L'id_token est vérifié pour les deux fournisseurs : signature RS256 via les JWKS (cache 1 h, relecture sur clé inconnue), puis émetteur, audience, expiration, nonce, `sub`, email vérifié. Le bouton Apple n'apparaît que si les quatre variables `APPLE_*` sont définies (trois sur quatre = erreur au démarrage). `ALLOWED_EMAILS` est supprimée ; `ADMIN_EMAILS` désigne les admins (relue au démarrage et à chaque connexion).
- **Sessions** liées à `users.id`. Un compte suspendu ne peut plus se connecter, et sa session existante est refusée puis supprimée.
- **Multi-tenant** : `user_id` sur `projects` (unicité du dépôt par utilisateur) et sur `jobs` ; `settings` global remplacé par `user_settings` (SMTP, Discord, budget, plafonds, Forgejo…, quota Claude). `getProject`, `listProjects`, `createProject`, `enqueue`, `cancelJob`, budget, usage, rapport hebdo, notifications, planificateur, boîtes IMAP, métriques, export/import CSV : tout est filtré par utilisateur. Dossier des clones : `DATA_DIR/repos/<utilisateur>/<projet>`.
- **Rattachement des données existantes** : la migration crée le propriétaire depuis le premier email de `ADMIN_EMAILS` et lui rattache projets, jobs (y compris sans projet) et réglages. Il retrouve ses données à sa première connexion, par correspondance d'email. `scripts/migrate-sqlite-to-mysql.js` reste valide : il rattache de même au propriétaire, convertit les réglages et ne copie pas les sessions.
- **Jobs IA réservés aux admins** (en attendant le J3), refusés à quatre niveaux : route (403 « Liaison Claude requise (bientôt disponible) »), `enqueue`, worker (le job d'un non-admin déjà en base passe en erreur sans s'exécuter) et wrapper `claude()` des handlers. À la création d'un projet par un non-admin, l'analyse n'est pas lancée.
- **Pages** : connexion (Google, Apple si configuré, thème clair/sombre avec les jetons de `app.css`), bannière « liaison Claude » pour les non-admins, « Mon compte » (email, fournisseur, suppression du compte avec saisie de l'email).
- **Suppression de compte** : cascade des clés étrangères (projets, prospects, notes, modèles, journaux, métriques, jobs, réglages, sessions), clones git effacés, job en cours interrompu, session détruite. Le schéma est testé : toute table métier descend d'un utilisateur par cascade.
- **Tests** : suite existante adaptée ; nouveaux fichiers `isolation` (A contre B sur chaque route, listes et exports compris), `auth` (fournisseurs simulés : jeton forgé, alg `none`, kid inconnu, iss/aud/exp/nonce/state/cookie de liaison, rejeu, expiration, Apple form_post, secret ES256), `account`, `ai-guard`, `accounts-migration`.

### Décisions
- **Un compte = un fournisseur.** Même email déjà lié à l'autre fournisseur : refus avec message, pas de fusion automatique (risque de prise de compte). Seul un compte « préparé » par la migration (sans fournisseur) est rattaché à la première identité vérifiée portant son email.
- **ADMIN_EMAILS fait foi** pour le rôle admin (au démarrage et à chaque login) ; vide, plus personne ne peut lancer de job IA (avertissement au démarrage). Les futures promotions depuis un back-office (J5) devront remplacer cette règle.
- **Cookie de liaison OAuth** (`oauth_b`, `SameSite=None; Secure; HttpOnly; Path=/auth`, 10 min) pour les deux fournisseurs : sans lui, un POST d'Apple (ou un lien de callback) forgé par un tiers connecterait la victime au compte de l'attaquant. Le callback Apple est public, sans contrôle d'`Origin` (c'est un POST d'Apple), protégé par state + nonce + cookie.
- **`jobs.user_id` dénormalisé** (en plus de `project_id`) : un job sans projet doit rester attribuable, et le budget / l'usage se calculent sans jointure. Les autres tables filles héritent via `project_id`.
- **Tous les réglages sont par utilisateur**, y compris l'état du quota Claude (`claude_rate_limit_json`) : en J3 chaque compte Claude a son propre quota.
- **Liste d'opposition globale** conservée à la suppression d'un compte. Elle ne sort plus dans le prompt de prospection (domaines exclus), n'est comptée que sur les prospects du compte, et le motif affiché sur une fiche prospect est générique, sauf la désinscription.
- **Désinscription** (lien public signé) : met à `refused` les prospects de cet email chez tous les comptes (la personne ne veut plus être contactée, par personne).
- **Sessions et états OAuth recréés** par la migration (éphémères) : tout le monde doit se reconnecter après la mise à jour.

### Non vérifié (à faire par Tony ou au prochain passage)
- **Aucun test contre un vrai MySQL/MariaDB** (toujours pas de serveur, Docker exclu). Nouveautés MySQL non exécutées : les `ALTER TABLE` conditionnels de la migration 2 (interrogent `information_schema`), `ADD CONSTRAINT ... FOREIGN KEY`, `DROP INDEX`, le `UPDATE ... (SELECT ...)` de rattachement, l'unique `(user_id, git_url(500))` (2 008 octets en utf8mb4, sous la limite de 3 072 d'InnoDB DYNAMIC), le `CHECK` sur `users.status` (appliqué à partir de MySQL 8.0.16 / MariaDB 10.2), `UPDATE users SET is_admin = CASE WHEN email IN (...)`. Commande dès qu'une base de test existe : `TEST_DB_HOST=... TEST_DB_USER=... TEST_DB_PASSWORD=... TEST_DB_NAME=aitools_test npm run test:mysql`. Si une migration 2 échoue à mi-chemin sur MySQL, elle est rejouable (les ALTER sont gardés), mais à vérifier réellement.
- **Aucun flux Google ni Apple réel** : tout est testé avec des fournisseurs simulés. À valider sur le domaine : redirections, JWKS réels, cookie `SameSite=None` dans Safari (le POST d'Apple), URL de retour déclarée côté Apple, secret client accepté par Apple (claims `iss`/`sub`/`aud`, durée).
- `test/install.test.sh` et `install.sh` (Pi) : seul le nom de la variable `ADMIN_EMAILS` a changé dans `install.sh` ; le test shell n'est pas exécutable sur ce poste (root, systemd).

### Risques connus, hors périmètre J2
- **Sorties réseau pilotées par l'utilisateur** : hôtes SMTP, IMAP et base du récap, hôte Forgejo (clone), qu'un compte non admin peut renseigner. Sans filtre, ils permettent de sonder le réseau interne du serveur (MySQL local, etc.). À traiter avec l'isolation du J3/J5 (interdire les adresses privées/loopback pour les non-admins, ou sortir ces appels dans le bac à sable).
- Plan gratuit (1 projet, 50 prospects, 100 mails/mois, 5 jobs IA/mois), anti-abus, rate limiting, CAPTCHA, back-office de suspension : J5. La suspension se fait pour l'instant en base (`UPDATE users SET status = 'suspended'`).
- Les clones git d'avant J2 (`repos/<projet>`) sont orphelins : ils se reclonent au prochain job et peuvent être supprimés.

### À faire ensuite
- J3 : liaison Claude (`users.claude_link_json`), levée du blocage des jobs IA pour les comptes liés (remplacer `canRunAi`), isolation par compte de l'exécution.
- Essai complet sur la base CloudPanel (`npm run test:mysql`, migration réelle), puis test des connexions Google et Apple sur le domaine.

## 2026-10-22 — J1 « Fondations » : couche de données MySQL/MariaDB

### Fait
- `src/db.js` : une seule API asynchrone, deux drivers.
  - MySQL/MariaDB (`mysql2/promise`, pool, utf8mb4) en production, configuré par `DB_HOST`, `DB_PORT` (3306), `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
  - `node:sqlite` en mémoire pour les tests locaux (`openDb(':memory:')`, ou `DB_DRIVER=sqlite` pour un essai local non persistant).
  - Shim `db.prepare(sql).get/all/run(...params)` (promesses ; `run` → `{ changes, lastInsertRowid }`) et `db.transaction(async (tx) => ...)`.
- `src/migrations.js` : migrations versionnées en deux jeux de DDL (SQLite et MySQL) maintenus ensemble. Table `schema_migrations`, verrou `GET_LOCK` côté MySQL, `CREATE TABLE IF NOT EXISTS`, InnoDB, utf8mb4, `VARCHAR` de longueur définie pour les clés et index, FK `ON DELETE CASCADE`.
- Tout `src/**` en async/await (routes, handlers de jobs, worker, planificateur, services). File de jobs inchangée : un job à la fois. `thermal.js` conservé (seul changement : `await` du callback `onWait`).
- `scripts/migrate-sqlite-to-mysql.js` (`npm run migrate:sqlite -- data/aitools.sqlite [--force]`) : copie toutes les tables, ids conservés, une transaction, rapport par table, refuse une cible non vide sauf `--force`.
- Tests adaptés au shim asynchrone ; nouveaux tests : parité des schémas, shim/transactions, migration des données, cycle de vie du worker. Si `TEST_DB_HOST` est défini, la même suite tourne contre un vrai MySQL/MariaDB (`npm run test:mysql`).
- `.env.example` et README (installation sur un serveur sans Raspberry, variables `DB_*`, migration des données, tests MySQL).

### Décisions
- **SQL canonique = forme SQLite/ANSI**, traduit à la volée pour MySQL (`translate()` dans `src/db.js`) : `INSERT OR IGNORE` → `INSERT IGNORE`, `ON CONFLICT(...) DO UPDATE SET x = excluded.x` → `ON DUPLICATE KEY UPDATE x = VALUES(x)`, `COLLATE NOCASE` retiré. Les colonnes réservées (`key`) sont entre accents graves, acceptés par les deux moteurs.
- **Requêtes réécrites plutôt que traduites** : `project_id IS ?` (deux requêtes selon NULL ou non), `ORDER BY ... COLLATE NOCASE` → `ORDER BY LOWER(...)`, `LIKE ... ESCAPE '\'` → `ESCAPE '!'` (le backslash n'a pas le même sens dans un littéral MySQL), `INSERT ... SELECT ... WHERE NOT EXISTS` sans `FROM` → test de la liste d'opposition puis `INSERT OR IGNORE`, alias `last` → `lj`.
- **Schéma initial consolidé** : les 8 migrations SQLite historiques deviennent la migration 1 (état final identique). La migration des données copie les colonnes de l'ancienne base et exige la version 8 (`user_version`) ou un `schema_migrations` à jour.
- **SQLite = une seule connexion** : pendant une transaction, les autres requêtes attendent sa fin (sinon elles s'exécuteraient dans la transaction). Dans le callback de `transaction`, utiliser `tx`, jamais `db`.
- **Callbacks synchrones du flux Claude** (`onText`, `onTurn`) : leurs écritures passent par une file ordonnée (`makeSink`) attendue en fin de phase ; une erreur d'écriture fait échouer le job.
- **Aucune promesse laissée en l'air** : le worker suit ses notifications (`idle()`, `stop()` les attend), le planificateur suit son passage en cours, `createApp` est asynchrone et `app.close()` attend job, tâches de fond puis base.
- **`npm test`** : le glob avec guillemets simples ne trouvait aucun fichier sous Windows (0 test lancé) ; remplacé par des guillemets doubles, valables partout.
- Ancien test « migration 2 » supprimé : l'ancien chemin de migration SQLite incrémentale n'existe plus, le script de migration des données le remplace.

### Non vérifié (à faire par Tony ou au prochain passage)
- **Aucun test contre un vrai MySQL/MariaDB** : pas de serveur disponible et Docker exclu sur ce poste. Le DDL MySQL, la traduction SQL, `GET_LOCK`, la transaction `mysql2` et le script de migration vers MySQL ne sont donc validés que par lecture et par les tests SQLite. Commande à lancer dès qu'une base de test existe : `TEST_DB_HOST=... TEST_DB_USER=... TEST_DB_PASSWORD=... TEST_DB_NAME=aitools_test npm run test:mysql`.
- Mode strict MySQL (`STRICT_TRANS_TABLES`) : une chaîne plus longue qu'un `VARCHAR` fait échouer l'écriture (SQLite ne vérifie rien). Les longueurs côté code (entreprise 200, ville/secteur 100, site/source 300) sont sous les limites, les noms de projet sont limités à 80, mais l'email n'est pas tronqué (limite 255, cohérente avec le format d'une adresse).
- Comparaisons d'emails : SQLite est sensible à la casse, MySQL (`utf8mb4_unicode_ci`) non. Le code met déjà les emails en minuscules ; à garder en tête pour J2 (comptes).
- `git_url` en `VARCHAR(500)` unique : 2000 octets en utf8mb4, OK avec InnoDB `DYNAMIC` (MySQL ≥ 5.7, MariaDB ≥ 10.2), pas avec l'ancien format `COMPACT`.

### À faire ensuite
- Essai complet sur la base CloudPanel (création de la base, `npm start`, `npm run test:mysql`, migration réelle de `data/aitools.sqlite`).
- `install.sh`, `deploy/aitools-backup.sh` et `test/install.test.sh` sont encore ceux de la version SQLite (sauvegarde `sqlite3 .backup`, pas de `DB_*` dans le `.env` généré) : à reprendre au jalon J6 (déploiement).
- Connexion TLS à la base distante (option `ssl` de `mysql2`) si la base n'est pas locale.
- J2 : comptes, `user_id` sur toutes les tables métier, tests d'isolation.

### Reprise
Une session précédente avait été interrompue avec `src/auth.js`, `src/config.js`, `src/db.js` et `src/projects.js` modifiés (environ 15 %). Ces fichiers étaient cohérents avec le plan et ont été conservés ; `db.js` a été réécrit pour porter les deux drivers, et un `ON DUPLICATE KEY` laissé en dur dans `projects.js` a été remis dans la forme commune (commit `fix(projects)`).
