# Journal de projet — AiTools

Branche de travail : `feat/saas-mysql` (version publique, voir `docs/CADRAGE.md`).

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
