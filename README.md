# AiTools

Panel pour piloter Claude Code (headless) sur des projets : prospection client par email,
idées d'évolutions et récap business. L'instance perso tourne sur un Raspberry Pi 4 sans ventilateur ;
la version publique cible un serveur CloudPanel avec une base MySQL/MariaDB (voir `docs/CADRAGE.md`).

## Choix techniques

- **Node 22, zéro framework** : `node:http`. Dépendances : `nodemailer`, `imapflow`, `mysql2`, `pg`.
- **Base MySQL / MariaDB** (`mysql2`, pool, utf8mb4, InnoDB), accès entièrement asynchrone via `src/db.js`. SQLite (`node:sqlite`, en mémoire) ne sert plus que pour les tests locaux et comme source du script de migration.
- **Rendu serveur + JS vanilla**, pas de build.
- **Un seul job IA à la fois** (file en base). Le process Claude tourne en `nice 10`. Pause automatique si le CPU dépasse `THERMAL_MAX`.
- **Économie de tokens** :
  - outils Claude restreints à chaque job (lecture seule pour le code, WebSearch/WebFetch pour la prospection) ;
  - `--max-turns` borné ;
  - fiche projet générée une fois, puis seulement sur « Réanalyser » ;
  - Haiku par défaut partout (prospection, analyse de projet, mails, relances) ; Sonnet/Opus restent
    disponibles en Réglages (prospection, analyse) ou au lancement (niveau de raisonnement de
    l'Évolution), uniquement quand Haiku ne suffit pas — utile avec un abonnement Pro dont le quota
    est limité à la semaine.
- **Sécurité** :
  - connexion Google ou Apple (OIDC), inscription automatique, sans mot de passe ;
  - state + nonce (+ PKCE pour Google), id_token vérifié (signature RS256 via les JWKS du fournisseur, émetteur, audience, expiration) ;
  - données cloisonnées par compte (voir « Comptes et multi-utilisateur ») ;
  - anti-CSRF par contrôle d'`Origin` ;
  - secrets chiffrés en AES-256-GCM en base ;
  - token Forgejo jamais écrit sur disque.

## Suivi des réponses, relances et test A/B

- **Détection des réponses** : la boîte de réception du projet est lue en IMAP toutes les 15 minutes, et à la demande avec « Vérifier maintenant ».
  - Une réponse fait passer le prospect en « A répondu ». Elle est rattachée par le fil de discussion (Message-ID), puis par l'adresse, puis par le domaine pro s'il est unique.
  - Les absences, réponses automatiques et newsletters sont ignorées.
  - Les mails rejetés (bounces) passent le prospect en « Rejeté » et l'adresse en liste d'opposition.
  - Aucun token Claude n'est consommé : on ne lit que les en-têtes, et le début du corps pour les bounces.
- **Relance automatique** : une seule, après N jours (7 par défaut), dans le même fil (« Re: » + In-Reply-To). Elle part à quatre conditions :
  - le modèle de relance est validé ;
  - la boîte IMAP a été lue avec succès il y a moins de 2 h. Sinon, on relancerait des gens qui ont déjà répondu ;
  - on est en heures ouvrées, du lundi au vendredi de 9h à 18h (heure de Paris). L'heure est revérifiée entre chaque mail ;
  - les plafonds quotidiens ne sont pas atteints (premiers mails et relances confondus).
- **Test A/B de l'objet** : renseigne un « Objet B » et les envois alternent de façon équilibrée. Le taux de réponse de chaque objet s'affiche sous le bouton Envoyer.

> Test IMAP de bout en bout (optionnel) : `IMAP_TEST=hôte:port:utilisateur:motdepasse npm test`. Voir `test/inbox.live.test.js` pour les 4 mails attendus dans la boîte de test.

## Pilotage

- **Jobs de nuit** : Prospecter et Évolution proposent « Maintenant » ou « Cette nuit ». Le job démarre au prochain créneau entre 1h et 6h (heure de Paris, changements d'heure gérés), quand le Pi est au frais et que ton quota Claude est libre. Il est annulable jusqu'au départ.
- **Budget IA** : plafonds glissants sur 24 h et sur 30 jours, en équivalent $ API remonté par Claude Code. L'abonnement Pro ne facture rien en plus ; c'est un garde-fou pour ton quota.
  - Plafond atteint : les jobs IA **restent en file** et repartent seuls quand la fenêtre glisse. Les envois et relances, qui ne consomment pas d'IA, continuent.
  - Un job en cours n'est jamais coupé : le plafond peut donc être dépassé d'un job.
- **Quota du compte Claude** : la barre du haut affiche, dès qu'un job IA a tourné, le taux d'utilisation
  remonté par la CLI elle-même — session glissante de 5 h et semaine glissante de 7 jours, avec l'heure de
  réinitialisation au survol. Orange à partir de 80 %, rouge à 100 %. C'est la vraie limite du compte
  Pro, à distinguer du budget IA ci-dessus (un garde-fou interne en $ équivalent).
  - **Report automatique** : au-delà de 85 % (session ou semaine), Analyse et Évolutions — non urgents —
    restent en file et repartent seuls une fois le quota libéré. Prospection et envois (y compris les
    relances) continuent normalement : c'est le cœur du métier, jamais mis en pause.
  - **Alerte Discord** à 80 % puis 95 % (session ou semaine), une seule fois par fenêtre jusqu'au reset.
- **Notifications Discord** via webhook : URL chiffrée, validée, sans mention possible. Tu choisis les événements :
  - fin de job ou erreur ;
  - réponses de prospects ;
  - relances envoyées ;
  - pause thermique ;
  - budget atteint ;
  - quota Claude proche de la limite, ou job reporté ;
  - rapport hebdo.

  Un bouton permet d'envoyer une notification de test.
- **Rapport hebdo** : le lundi à 8h, par mail (SMTP global vers ton email de réception) et en résumé sur Discord. Pour chaque projet, sur 7 jours :
  - prospects trouvés ;
  - mails et relances envoyés ;
  - réponses et taux de réponse ;
  - clients ;
  - adresses invalides ;
  - objet gagnant du test A/B, dès 10 envois par objet ;
  - coût IA.

  Le bouton « Envoyer le rapport maintenant » permet de tester.

## CRM

- **Recherche et filtres** sur les prospects :
  - recherche par entreprise, email, ville ou secteur ;
  - filtres par statut, score minimum et « Actions à faire » ;
  - tri ;
  - pagination par 100.

  Tout est côté serveur, donc ça reste léger sur le Pi même avec des milliers de prospects.
- **Fiche prospect** : un clic sur l'entreprise ouvre la fiche, avec :
  - l'accroche et l'origine de l'email ;
  - l'historique : premier mail (avec la variante A/B), relance, réponse et échecs d'envoi ;
  - une **prochaine action** datée (rappel à 9h, heure de Paris), qui alimente le filtre « Actions à faire » ;
  - des **notes** libres.
- **Export CSV** : format Excel FR (`;` et BOM UTF-8). L'export reprend les filtres affichés.
  - Les cellules qui commencent par `= + - @` sont neutralisées pour qu'Excel ne les exécute pas comme des formules.
- **Import CSV** (2000 lignes max) :
  - colonnes reconnues en français ou en anglais (entreprise, email, site, ville, secteur, score, source, accroche) ;
  - encodage UTF-8 ou Windows-1252 détecté, donc les fichiers enregistrés par Excel passent tels quels ;
  - doublons et adresses en liste d'opposition ignorés ;
  - rapport ligne par ligne ;
  - l'origine de chaque contact est toujours renseignée (« Import CSV du JJ/MM/AAAA » par défaut), pour le RGPD.
- **Courbes** (onglet Récapitulatif, sur 30 ou 90 jours) :
  - utilisateurs, clients payants et revenu : une photo quotidienne est prise automatiquement, plus une à chaque ouverture du récap ;
  - mails envoyés et réponses par semaine, recalculés depuis l'historique.

  Les graphiques ont des infobulles au survol et une vue tableau (« Voir les données »).
  - Les données business démarrent le jour où tu configures l'accès BDD du projet : l'historique ne peut pas être reconstitué avant.

## Garde-fous d'envoi

- Tu choisis le nombre de mails à chaque envoi, avec une confirmation obligatoire.
- Plafonds sur 24 h : par projet (réglable, max 200) et global (réglable, max 300). Un batch fait 100 mails au plus.
- Délai aléatoire entre deux mails (20–60 s par défaut).
- Un prospect n'est contacté qu'une seule fois.
- Lien de désinscription dans chaque mail, avec en-têtes `List-Unsubscribe` en one-click.
- La liste d'opposition vaut pour tous les projets. Un statut « Refus » y ajoute aussi l'adresse.
- La source publique de l'email est stockée et rappelée dans le pied de mail (RGPD).

## Comptes et multi-utilisateur

- **Connexion** : Google ou Apple, sans mot de passe. Le compte est créé à la première connexion réussie (plan gratuit). Un même email ne se lie qu'à un seul fournisseur ; un compte suspendu ne peut plus se connecter et ses sessions tombent aussitôt.
- **Cloisonnement** : projets, prospects, notes, modèles, journaux d'envoi, jobs, métriques et **réglages** (SMTP, Discord, budget IA, plafonds, hôte Forgejo…) sont propres à chaque compte. Toute requête est filtrée par l'utilisateur courant ; la ressource d'un autre compte répond « introuvable » (404). Un même dépôt Git peut être un projet pour deux comptes (unicité par utilisateur).
- **Liste d'opposition** : volontairement commune à tous les comptes (une personne désinscrite ne doit plus être contactée par personne). Un compte n'y voit que le nombre de ses propres prospects concernés, jamais l'origine ni le motif d'un autre compte.
- **Jobs IA réservés aux admins, pour l'instant** : tant que la liaison Claude n'existe pas (jalon suivant), seuls les emails de `ADMIN_EMAILS` peuvent lancer analyse, recherche de prospects, modèles générés ou évolutions. Les autres reçoivent « Liaison Claude requise (bientôt disponible) », refusé côté serveur (routes, file, worker et handlers). Ils peuvent créer des projets, utiliser le CRM et l'import CSV, et envoyer des mails dans les plafonds existants.
- **Mon compte** (`/account`) : email, fournisseur, et suppression du compte (confirmation par saisie de l'email). Elle efface tout : projets, prospects, notes, modèles, journaux, jobs, réglages, sessions et clones Git. Seule la liste d'opposition est conservée.

### Connexion Google et Apple

- **Google** : voir « Google OAuth » plus bas. URI de redirection : `https://<domaine>/auth/google/callback`.
- **Apple** (facultatif) : dans developer.apple.com, crée un *Services ID* (c'est `APPLE_CLIENT_ID`), active « Sign in with Apple » avec ton domaine et l'URL de retour `https://<domaine>/auth/apple/callback`, puis une clé *Sign in with Apple* : son identifiant est `APPLE_KEY_ID`, le fichier `.p8` va dans `APPLE_PRIVATE_KEY` sur une seule ligne (retours à la ligne écrits `\n`). `APPLE_TEAM_ID` est l'identifiant d'équipe. Le secret client (JWT ES256) est généré à chaque connexion, rien n'est stocké. Apple répond par un POST cross-site : le flux est protégé par state, nonce et un cookie de liaison `SameSite=None` limité à `/auth`.

## Installation sur un serveur (CloudPanel ou autre, sans Raspberry)

Pré-requis : Node 22.13 ou plus, git, la CLI `claude` si les jobs IA doivent tourner sur ce serveur, et une base MySQL 8.0.16 ou plus / MariaDB 10.4 ou plus (contraintes `CHECK`).

1. **Base de données** : dans CloudPanel, Databases > Add Database. Note le nom, l'utilisateur et le mot de passe. Les tables sont créées par l'application au premier démarrage, rien à importer à la main.
2. **Code** :

   ```bash
   git clone -b develop https://git.tony-averty.dev/Tony/AiTools.git
   cd AiTools
   npm ci --omit=dev
   cp .env.example .env     # puis renseigne le fichier, voir ci-dessous
   chmod 600 .env
   ```

3. **Variables d'environnement** (`.env`, jamais commité) :

   | Variable | Rôle |
   |---|---|
   | `DB_HOST`, `DB_PORT` (3306 par défaut), `DB_USER`, `DB_PASSWORD`, `DB_NAME` | connexion MySQL / MariaDB |
   | `SECRET_KEY` | clé AES-256-GCM (64 caractères hexa) des secrets stockés en base |
   | `APP_URL`, `PORT`, `HOST` | URL publique et écoute locale (reverse proxy Nginx devant) |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | connexion Google (voir « Connexion Google et Apple ») |
   | `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID`, `APPLE_PRIVATE_KEY` | connexion Apple, facultative : les quatre ou aucune (sans elles, le bouton Apple est masqué) |
   | `ADMIN_EMAILS` | emails des administrateurs, séparés par des virgules. Le premier est aussi propriétaire des données migrées. Remplace `ALLOWED_EMAILS`, supprimée : n'importe qui peut créer un compte |
   | `DATA_DIR` | clones Git des projets analysés, rangés par utilisateur (`repos/<utilisateur>/<projet>`) |

4. **Démarrage** : `npm start`. Au lancement, les migrations en attente sont appliquées (table `schema_migrations`, verrou pour éviter deux migrations simultanées). Lance le service sous un gestionnaire de processus (systemd ou celui de CloudPanel) et mets un reverse proxy TLS devant `HOST:PORT`.
5. **Sauvegardes** : sauvegarde quotidienne de la base avec `mysqldump --single-transaction` (ou la sauvegarde CloudPanel) ; teste une restauration.

### Reprendre les données de l'ancienne instance SQLite

Arrête l'ancien service, puis, avec le `.env` pointant sur la nouvelle base :

```bash
npm run migrate:sqlite -- data/aitools.sqlite          # refuse si la base cible contient déjà des données
npm run migrate:sqlite -- data/aitools.sqlite --force   # vide les tables cibles avant la copie
```

Toutes les tables sont copiées dans une seule transaction, ids conservés, avec un rapport de lignes par table. En cas d'écart ou d'erreur, rien n'est écrit. L'ancienne base est mono-utilisateur : tout est rattaché au compte propriétaire (première adresse de `ADMIN_EMAILS`, créé s'il n'existe pas) et les anciens réglages deviennent les siens. Les sessions de l'ancienne base ne sont pas copiées : reconnecte-toi. Les clones Git sont à recloner : le dossier est maintenant `DATA_DIR/repos/<utilisateur>/<projet>`.

Une base MySQL/MariaDB déjà utilisée **avant les comptes** (migration 1) se met à niveau toute seule au démarrage : la migration « comptes_multi_tenant » rattache ses données au propriétaire (`ADMIN_EMAILS` doit alors être défini, sinon le démarrage s'arrête avec un message clair). Au premier login Google ou Apple avec cet email, tu retrouves tes données.

## Installation sur le Pi (instance perso, héritage)

> `install.sh` date de la version SQLite : il ne renseigne pas encore les variables `DB_*` ni ne sauvegarde MySQL. À reprendre avec le déploiement (jalon J6) ; en attendant, suis la section ci-dessus.

Pré-requis : **Raspberry Pi OS Lite 64 bits** fraîchement installé, accès SSH, et ton HDD branché.

```bash
sudo apt install -y git
git clone -b develop https://git.tony-averty.dev/Tony/AiTools.git
cd AiTools
sudo ./install.sh
```

Pour voir ce qui serait fait sans rien toucher : `./install.sh --dry-run`.

### Ce que fait `install.sh`

1. **Questions d'abord** :
   - quel disque pour les données (le disque système est exclu d'office) ;
   - partition existante, ou formatage ext4 ;
   - interface réseau, Wi-Fi et Bluetooth ;
   - nettoyage du système ;
   - config de l'app ;
   - token Cloudflare ;
   - connexion Claude.

   Puis un **récapitulatif à valider**. Rien n'est modifié avant.
2. **Installation sans interruption** :
   - mise à jour du système et du firmware ;
   - nettoyage : services inutiles coupés, swap SD remplacé par zram, journaux en RAM ;
   - montage du HDD par UUID dans `/etc/fstab` (`nofail`, `noatime`) ;
   - Node 22, Claude Code et cloudflared ;
   - déploiement dans `/opt/aitools` avec l'utilisateur système `aitools` et les dépendances de prod uniquement (sans les tests) ;
   - `.env` généré avec `SECRET_KEY` aléatoire, en droits 600 ;
   - services systemd + sauvegarde quotidienne de la base (04:30, 14 jours) ;
   - tunnel Cloudflare.
3. **Connexion Claude** via `claude setup-token`, puis un test réel, et démarrage avec vérification HTTP.

Garde-fous :
- formater un disque exige de **taper son nom** ;
- les partitions exFAT/NTFS sont refusées, car SQLite et les droits Linux ne les supportent pas ;
- `/etc/fstab` et `config.txt` sont sauvegardés (`*.aitools.bak`) avant modification ;
- les tokens ne passent jamais en ligne de commande ni dans le log.

**Mise à jour de l'app** : `git pull` dans ton clone, puis relance `sudo ./install.sh` et garde la config existante. Le script est relançable sans risque.

> Le service ne démarre pas si le HDD n'est pas monté (`RequiresMountsFor`). Ça évite d'écrire une base vide sur la carte SD par erreur.

### Google OAuth

Dans la console Google Cloud, crée un ID client OAuth de type « Application Web » (menu Identifiants).

- URI de redirection : `https://ai.tony-averty.dev/auth/google/callback`
- Écran de consentement : mode « Test » avec ton email en testeur, ça suffit.

### Cloudflare Tunnel

Dans Zero Trust, va dans Networks → Tunnels → Create a tunnel (Cloudflared).

- Public hostname : `ai.tony-averty.dev` → `http://localhost:3100`
- Copie le token, `install.sh` te le demandera.

### Forgejo

Le token se crée dans Paramètres → Applications. Donne-lui la portée `read:repository` seulement, puis colle-le dans **Réglages** du panel avec l'hôte `git.tony-averty.dev`.

## À faire côté mails (sinon spam garanti)

- SPF, DKIM et DMARC sur le domaine d'envoi.
- Idéalement un sous-domaine dédié à la prospection, pour protéger ton domaine principal.
- Commence petit, 10 à 20 mails par jour la première semaine.

## Récapitulatif (BDD des projets)

- Crée un utilisateur **lecture seule** dédié sur chaque base.
- N'expose pas MySQL/Postgres à tout Internet. Autorise uniquement l'IP de ta box, ou passe par un tunnel SSH.
- Seules les requêtes `SELECT` / `WITH` sont acceptées, exécutées dans une transaction read-only. Chacune doit renvoyer un seul nombre.

## Dev

```bash
npm install
npm run hooks     # active le hook pre-commit (refus sur main, secrets, lint + tests)
npm run check     # lint + tests
```

Les tests utilisent un faux binaire Claude (`test/fixtures/fake-claude.js`) : aucun token consommé.

Par défaut ils tournent sur SQLite en mémoire, sans rien à installer. Pour les rejouer contre un vrai MySQL/MariaDB :

```bash
TEST_DB_HOST=127.0.0.1 TEST_DB_USER=root TEST_DB_PASSWORD=... TEST_DB_NAME=aitools_test npm run test:mysql
```

Utilise une base **dédiée aux tests** : toutes ses tables sont supprimées à chaque test. `test:mysql` force l'exécution des fichiers un par un, car ils partagent la même base.

Les tests d'isolation (`test/isolation.test.js`), de connexion (`test/auth.test.js`, fournisseurs simulés), de suppression de compte, de blocage des jobs IA et de migration des données existantes tournent avec le reste de la suite.

Le SQL est écrit dans un sous-ensemble commun aux deux moteurs (`INSERT OR IGNORE`, `ON CONFLICT ... excluded.x`, colonnes réservées entre accents graves) et `src/db.js` le traduit pour MySQL. Le schéma est déclaré deux fois dans `src/migrations.js` (SQLite et MySQL) ; `test/schema.test.js` vérifie qu'ils décrivent les mêmes tables et colonnes. Pour changer le schéma, ajoute une entrée aux deux dialectes sans modifier les précédentes.

`test/install.test.sh` teste les fonctions d'`install.sh` qui écrivent des fichiers : `.env`, unit systemd, migration, sauvegarde. Il tourne en root et écrit dans `/opt/aitools` et `/etc/systemd`, donc **uniquement dans une VM ou un conteneur jetable**, jamais sur le Pi en service.
