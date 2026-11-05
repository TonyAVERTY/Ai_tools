# iaboss

Panel pour piloter Claude Code (headless) sur des projets : prospection client par email,
idées d'évolutions et récap business. L'instance perso tourne sur un Raspberry Pi 4 sans ventilateur ;
la version publique cible un serveur CloudPanel avec une base MySQL/MariaDB (voir `docs/CADRAGE.md`).

## Choix techniques

- **Node 22, zéro framework** : `node:http`. Dépendances : `nodemailer`, `imapflow`, `mysql2`, `pg`.
- **Base MySQL / MariaDB** (`mysql2`, pool, utf8mb4, InnoDB), accès entièrement asynchrone via `src/db.js`. SQLite (`node:sqlite`, en mémoire) ne sert plus que pour les tests locaux et comme source du script de migration.
- **Rendu serveur + JS vanilla**, pas de build.
- **File de jobs équitable** (en base) : jobs en parallèle **par compte autant que son offre le permet**, **sans limite globale sur le serveur** (`parallelJobs` dans `src/limits.js` : 1 en gratuit, plus en payant), tourniquet entre utilisateurs. Le process Claude tourne en `nice 10`. Les nouveaux jobs attendent si la charge du serveur dépasse `LOAD_MAX` (voir « Anti-abus, plafonds et administration »).
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

## Site public

Le site (`iaboss.fr`) est servi par la même application, dans `src/site/`, en rendu serveur sans JavaScript ni dépendance.

- **Pages** : `/` (accueil pour un visiteur, tableau de bord pour un compte connecté), `/fonctionnement`, `/tarifs`, `/login`, `/mentions-legales`, `/confidentialite`, `/cgu`, et une 404 propre. Toutes répondent sans session.
- **Identité** : `public/site.css` s'ajoute à `public/app.css` et n'utilise que ses jetons (`--bg`, `--card`, `--text`, `--muted`, `--line`, `--accent`, thème sombre compris). Pas de seconde palette : pour changer une couleur, on modifie `app.css`.
- **Textes** : `src/site/pages.js` (accueil, fonctionnement, tarifs, connexion, 404) et `src/site/legal.js` (pages légales). Les limites annoncées viennent du code ; si elles changent, relire ces textes.
- **Marqueurs** : les informations légales manquantes (adresse du siège, hébergeur, téléphone) et les points à valider s'affichent en `[À COMPLÉTER : …]` / `[À VALIDER : …]`. La liste vit dans `docs/JOURNAL.md` (« Marqueurs à compléter ») et dans `MARKERS` de `legal.js` ; un test vérifie qu'elles concordent. Pour en finir avec un marqueur, remplace-le dans `legal.js` puis retire-le des deux listes.
- **SEO** : title, description, canonical et Open Graph par page, `/robots.txt`, `/sitemap.xml`. Tout ce qui n'est pas une page publique répond `noindex` (balise et `X-Robots-Tag`).
- **En-têtes** : CSP stricte (aucun style ni script en ligne, aucune ressource externe), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`. HSTS seulement si `APP_URL` commence par `https://`. Les fichiers statiques ont un ETag (réponse 304).
- **Ajouter une page** : une fonction dans `pages.js` qui appelle `siteLayout`, une route dans `src/site/routes.js`, et son chemin dans `INDEXABLE_PATHS` (`src/site/seo.js`) si elle doit être référencée.
- **Essayer en local** : `APP_URL=http://localhost:3199 PORT=3199 SECRET_KEY=<64 hexa> GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=y DB_DRIVER=sqlite SANDBOX=off node src/server.js` (base SQLite en mémoire, perdue à l'arrêt).

## Liste de mise en route

Sur le tableau de bord, dès qu'un projet existe, une liste en bas à gauche guide la configuration : analyser le projet, valider la cible, chercher des prospects, SMTP, modèle de mail, premier envoi, puis le facultatif (boîte IMAP, relance automatique, idées d'évolution, compte LinkedIn relié, premier post publié).

- **Calculée à chaque lecture** à partir de l'état réel du projet (`src/checklist.js`, route `GET /api/projects/:id/checklist`, aussi incluse dans `/status`). Rien n'est stocké : elle ne peut pas se désynchroniser, et une étape défaite (jeton LinkedIn expiré, par exemple) redevient à faire.
- **Chaque ligne ouvre la bonne section** du projet et y fait défiler la page. Les sections terminées reçoivent une coche, et le projet une pastille « config 5/11 ».
- **Selon les droits et la configuration** : un membre d'équipe ne voit pas le SMTP ni l'IMAP (il ne peut pas les régler), et les étapes LinkedIn disparaissent si `LINKEDIN_CLIENT_ID` n'est pas défini.
- **Côté navigateur** (localStorage) : la liste peut être réduite, ou masquée pour un projet (la pastille la rappelle). Réduite par défaut sous 1700 px de large, pour ne pas recouvrir le contenu. Elle disparaît toute seule quand tout est fait.

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

- **Jobs de nuit** : Prospecter et Évolution proposent « Maintenant » ou « Cette nuit ». Le job démarre au prochain créneau entre 1h et 6h (heure de Paris, changements d'heure gérés), quand le serveur est peu chargé et que ton quota Claude est libre. Il est annulable jusqu'au départ.
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
- **Rapport hebdo** : le lundi à 8h, par mail (SMTP du serveur, vers ton email de réception) et en résumé sur Discord. Pour chaque projet, sur 7 jours :
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
- **Cloisonnement** : projets, prospects, notes, modèles, journaux d'envoi, jobs, métriques et **réglages** (SMTP, Discord, budget IA, plafonds, serveur Git perso…) sont propres à chaque compte. Toute requête est filtrée par l'utilisateur courant ; la ressource d'un autre compte répond « introuvable » (404). Un même dépôt Git peut être un projet pour deux comptes (unicité par utilisateur).
- **Liste d'opposition** : volontairement commune à tous les comptes (une personne désinscrite ne doit plus être contactée par personne). Un compte n'y voit que le nombre de ses propres prospects concernés, jamais l'origine ni le motif d'un autre compte.
- **Liaison Claude obligatoire** : après la connexion, un compte sans liaison valide est renvoyé vers `/link` et ne peut rien utiliser d'autre que cette page, Mon compte, la déconnexion et la suppression du compte (garde côté serveur sur toutes les routes, dans la file, le worker et le wrapper d'exécution). Voir « Liaison Claude et exécution isolée ».
- **Mon compte** (`/account`) : email, fournisseur, état de la liaison Claude (mode, dates, valide ou non, 4 derniers caractères de la clé API) avec Tester, Changer de mode et Délier, et suppression du compte (confirmation par saisie de l'email). Elle efface tout : projets, prospects, notes, modèles, journaux, jobs, réglages, sessions et clones Git. Seule la liste d'opposition est conservée.

### Liaison Claude et exécution isolée

Chaque utilisateur relie SON accès ; ses jobs IA tournent avec cet accès uniquement.

- **Clé API Anthropic** (recommandé) : vérifiée par `GET /v1/models` (aucun token consommé), chiffrée AES-256-GCM dans `users.claude_link_json`, jamais réaffichée. Passée par `ANTHROPIC_API_KEY` au seul processus enfant, jamais écrite sur disque. Pas de barre de quota d'abonnement dans ce mode.
- **Connexion avec Claude (abonnement)** : une fenêtre d'avertissement (risque pour le compte Claude au regard des conditions d'Anthropic) impose de cocher « J'ai compris et j'accepte ce risque » ; l'acceptation est horodatée avec la version du texte. L'utilisateur génère un jeton sur sa machine avec `claude setup-token` et le colle ; il est vérifié par un appel minimal du CLI (quelques tokens décomptés de l'abonnement), chiffré, et passé par `CLAUDE_CODE_OAUTH_TOKEN` au seul processus enfant. `CLAUDE_CLI_MODE_ENABLED=false` masque ce mode et le refuse côté serveur.
- **Se connecter avec Claude (connexion guidée)** : après la case du risque, le serveur lance `claude setup-token` (`src/claudelogin.js`, via `script` pour disposer d'un pseudo-terminal, `HOME` jetable, environnement assaini), récupère le lien de connexion et l'affiche à l'utilisateur. Il se connecte sur claude.com, recopie le petit code affiché, et le serveur le transmet au CLI puis capte le jeton (rangé chiffré, comme un jeton collé). Une seule connexion en cours par utilisateur, 5 minutes au plus, 5 en même temps sur le serveur. Prérequis : le binaire `claude` (`CLAUDE_BIN`) et la commande `script` (util-linux). La saisie manuelle du jeton reste proposée en secours.
- **Gemini (clé API Google AI Studio)** : `src/services/providers/gemini.js` lance `gemini -p … --output-format stream-json` (binaire `GEMINI_BIN`) dans le même bac à sable, avec `GEMINI_API_KEY` passé au seul processus enfant. Clé vérifiée par la liste des modèles (aucun token consommé), chiffrée comme les autres. Pas de connexion par compte Google : Gemini CLI ne sert plus ces comptes depuis le 18 juin 2026 et n'accepte, en headless, que la clé API ou Vertex AI. Les outils sont limités par un fichier de réglages « système » écrit pour chaque lancement et monté en lecture seule ; le CLI ne donne pas de coût en $ : il est estimé d'après `src/services/pricing.js` (grille à revérifier à chaque nouveau modèle).
- **ChatGPT (clé API OpenAI ou compte ChatGPT)** : `src/services/providers/openai.js` lance `codex exec --json` (binaire `CODEX_BIN`) dans le même bac à sable. **Clé API** : `CODEX_API_KEY` passé au seul processus enfant, clé vérifiée par la liste des modèles (aucun token consommé). **Compte ChatGPT** (comme l'abonnement Claude : même case de risque, même interrupteur `CLAUDE_CLI_MODE_ENABLED`) : le fichier `auth.json` de Codex est gardé chiffré en base ; pour chaque exécution il est écrit dans un dossier temporaire (`CODEX_HOME`, monté en lecture-écriture dans le bac à sable, seul montage en écriture), puis relu, car Codex renouvelle lui-même ses jetons (jeton de rafraîchissement à usage unique) : le fichier à jour remplace celui de la base, sauf si la liaison a été refaite entre-temps. Les exécutions d'un même compte passent donc **l'une après l'autre** (`src/services/userlock.js`), les comptes différents en parallèle. Connexion : fichier collé (`POST /link/chatgpt/auth`) ou connexion guidée par code d'appareil (`src/chatgptlogin.js`, `codex login --device-auth`, à activer dans les paramètres de sécurité du compte ChatGPT). Codex lit le dépôt avec une commande shell (pas d'outil « Read ») : une tâche qui lit le dépôt garde le shell, en lecture seule, sans réseau d'après la doc, sans variable `KEY`/`SECRET`/`TOKEN`, sans `AGENTS.md` du dépôt, et avec une connexion de compte un profil de permissions **refuse au shell la lecture du dossier des jetons** ; toute autre tâche a le shell coupé (`features.shell_tool=false`). Pas de limite de tours dans Codex : l'application compte les actions et l'arrête au-delà de `maxTurns`. Coût estimé d'après `src/services/pricing.js` (une connexion de compte n'est pas facturée à l'usage).
- **Pas de mode « Claude du serveur »** : le CLI connecté sur la machine n'est jamais utilisé à la place d'un utilisateur (il consommerait le quota de son propriétaire). Une ancienne liaison de ce type compte comme « pas de liaison » : le compte doit relier sa clé API ou son abonnement.
- **Bac à sable** : chaque job passe par bubblewrap (racine reconstruite en lecture seule, `/tmp` et `HOME` vides, seul le clone du projet de l'utilisateur monté en lecture seule, PID/IPC/UTS isolés, réseau conservé) avec un environnement en liste blanche (`PATH`, `LANG`, `HOME` jetable, le secret de l'utilisateur). En production le job est refusé si `bwrap` manque ; `SANDBOX=off` ne vaut qu'en développement. Installation : `apt install bubblewrap`. Si Node ou le CLI sont installés hors de `/usr`, liste leurs dossiers dans `SANDBOX_RO_BINDS`.
- **Clones git** d'URL fournies par les utilisateurs : https uniquement (`GIT_ALLOW_PROTOCOL=https`), pas de hooks ni de sous-modules, 2 minutes et 300 Mo au plus.
- **Quota, budget IA, pauses et notifications** sont propres à chaque compte.

### Connexion Google et Apple

- **Google** : voir « Google OAuth » plus bas. URI de redirection : `https://<domaine>/auth/google/callback`.
- **Apple** (facultatif) : dans developer.apple.com, crée un *Services ID* (c'est `APPLE_CLIENT_ID`), active « Sign in with Apple » avec ton domaine et l'URL de retour `https://<domaine>/auth/apple/callback`, puis une clé *Sign in with Apple* : son identifiant est `APPLE_KEY_ID`, le fichier `.p8` va dans `APPLE_PRIVATE_KEY` sur une seule ligne (retours à la ligne écrits `\n`). `APPLE_TEAM_ID` est l'identifiant d'équipe. Le secret client (JWT ES256) est généré à chaque connexion, rien n'est stocké. Apple répond par un POST cross-site : le flux est protégé par state, nonce et un cookie de liaison `SameSite=None` limité à `/auth`.

## Anti-abus, plafonds et administration

Les seuils, fenêtres et plafonds vivent dans **un seul module : `src/limits.js`**. Les pages Tarifs lisent les mêmes chiffres.

### Limitation de débit

En mémoire (fenêtre glissante, sans dépendance), par adresse IP et par compte. Au-delà du seuil : `429` avec `Retry-After`. Règles : démarrage et retours de connexion, routes `/link/*`, export et import CSV, envois (lot, rapport, notification de test), création de projet, suppression de compte, tests de connexion (IMAP, base du récap), back-office. Les compteurs sont perdus à un redémarrage et non partagés entre instances (une seule instance en production).

**`TRUST_PROXY`** (désactivé par défaut) : derrière Nginx de CloudPanel, toutes les requêtes arrivent de `127.0.0.1` ; sans réglage, tous les visiteurs partagent donc le même compteur.
- `TRUST_PROXY=true` : `X-Forwarded-For` est lu **seulement** si la connexion vient d'un proxy local (127.0.0.0/8, `::1`).
- `TRUST_PROXY=127.0.0.1,10.0.0.0/8` : liste d'adresses ou de plages CIDR de proxys de confiance.
- L'en-tête est lu de droite à gauche et on garde la première adresse qui n'est pas un proxy de confiance : les valeurs inventées par le client à gauche sont ignorées. Nginx doit AJOUTER l'adresse (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`). Sans `TRUST_PROXY`, un en-tête forgé n'a aucun effet. Derrière Cloudflare Tunnel seul, l'adresse réelle est dans `CF-Connecting-IP`, qui n'est pas lue : garde Nginx devant.

### reCAPTCHA v3 (connexion)

`RECAPTCHA_SITE_KEY` + `RECAPTCHA_SECRET` (les deux ou aucune), `RECAPTCHA_MIN_SCORE` (0,5 par défaut). Le démarrage de la connexion Google et Apple devient un POST qui porte un jeton, vérifié côté serveur (score, action `login`, site). **Rien n'est chargé depuis Google avant le clic sur « Charger la vérification anti-robot »** de la page de connexion ; la CSP n'ouvre les domaines reCAPTCHA que sur `/login`. Sans clés, reCAPTCHA est désactivé (développement, avertissement au démarrage) ; avec les clés, aucun réglage ne permet de le contourner. Le choix n'est pas mémorisé. La politique de confidentialité décrit reCAPTCHA seulement quand il est configuré.

### Plafonds des plans

Offres (définies dans `src/limits.js`, une seule source : serveur, page Tarifs, CGU et tests en dépendent). Plafonds ; projets et prospects = totaux du compte, mails et jobs IA = par mois calendaire (heure de Paris) :

| Offre | Prix TTC / mois | TTC / an (2 mois offerts) | Projets | Prospects | Mails / mois | Jobs IA / mois | Places d'équipe |
|---|---|---|---|---|---|---|---|
| Gratuit | 0 € | | 1 | 50 | 100 | 6 | 1 |
| Démarrage (`starter`) | 10 € | 100 € | 2 | 300 | 500 | 20 | 2 |
| Croissance (`growth`) | 25 € | 250 € | 5 | 1 000 | 1 500 | 60 | 3 |
| Business (`business`) | 50 € | 500 € | 10 | 3 000 | 4 000 | 150 | 10 |
| Intensif (`intensive`) | 100 € | 1 000 € | 25 | 10 000 | 8 000 | 400 | 25 |

Prix TTC : l'éditeur est en franchise de TVA (art. 293 B du CGI). Les offres payantes sont affichées « Bientôt » : **le paiement n'existe pas encore** (jalon Stripe). Un administrateur peut attribuer un plan à la main dans le back-office. Contraintes tenues par un test : `mails` ≤ 300 × 30 (plafond d'envoi de 300 mails par 24 h) et assez de jobs IA pour trouver tous les prospects (une recherche = 50 au plus). Un administrateur (`ADMIN_EMAILS`) n'a pas de limite ; l'ancien plan `pro` reste illimité (attribué à la main, non vendu). Projets et prospects se comptent dans leurs tables ; mails et jobs IA dans `usage_events`, qui survit à la suppression d'un projet. Rien ne se stocke en compteur : l'usage est toujours une somme. Un dépassement refuse l'action (`403`, code `plan_limit`, lien `/tarifs`) sans rien supprimer : un import CSV trop gros est refusé en entier, un lot de mails est tronqué à ce qui reste, une recherche de prospects n'enregistre pas au-delà du plafond. L'usage du mois s'affiche (barres) dans Mon compte et sur le tableau de bord.

### SMTP par projet et équipes

- **SMTP par projet** : chaque projet peut avoir son propre SMTP (une boîte d'envoi par projet). **Pas de SMTP commun** : un projet envoie depuis SON adresse ou pas du tout (hôte vide = on efface celui du projet). Les mails d'iaboss (rapport, évolutions, invitations, avertissement d'inactivité) partent du SMTP du serveur (`SYSTEM_SMTP_*`). L'ancien SMTP « global » des Réglages a été supprimé : une migration en copie le contenu dans chaque projet qui n'avait pas le sien (`getProject` renvoie `smtpSource` : `project` ou `null`). L'IMAP réutilise les identifiants du SMTP effectif.
- **Équipes** (`src/teams.js`, `src/teamroutes.js`, page `/team`) : un propriétaire (offre avec `seats` ≥ 2) invite des membres par email (lien à usage unique, valable 7 jours, **lié à l'adresse invitée**, seule son empreinte est stockée) et partage des projets (`projects.team_id`). Sur un projet partagé **un membre agit comme le propriétaire** : ses données, son SMTP, son plan, ses plafonds et son accès Claude (le membre n'a pas besoin du sien). Rôles : `member` (travaille sur les projets), `admin` (règle en plus SMTP, IMAP, base du récap), propriétaire (gère l'équipe, partage, supprime). Un seul point d'accès (`getProject` / `accessOn`) : un projet hors équipe est introuvable (404), le retrait d'un membre coupe l'accès à la requête suivante. Un mail d'invitation part si `SYSTEM_SMTP_*` est configuré, sinon le lien est affiché au propriétaire.

### LinkedIn

- **Un compte LinkedIn par projet** (section « LinkedIn » de la carte projet). Le bouton « Connecter LinkedIn » envoie vers l'OAuth officiel (`openid profile w_member_social`, `state` à usage unique lié au compte, au projet et au navigateur) ; le jeton (60 jours) est chiffré dans `linkedin_accounts`, jamais renvoyé. Connecter, déconnecter et publier demandent d'être administrateur du projet.
- **Direction facultative** : une zone de texte indique de quoi parlera le post. Vide, Claude choisit l'angle. « Générer » puis « Régénérer » lancent un job IA `linkedin_post` (compté dans les jobs IA) ; « Régénérer » donne à Claude les brouillons précédents pour changer d'angle, pas seulement de mots. Le prompt interdit d'inventer chiffres, clients ou résultats.
- **Rien n'est publié sans clic** : le brouillon est modifiable, la publication (`POST /v2/ugcPosts`, visibilité publique) demande une confirmation, et le texte envoyé est celui affiché. Un post publié ne se modifie ni ne repart. Un échec de LinkedIn conserve le brouillon.
- **Publier sur une page** (profil par défaut, page si l'application LinkedIn a les droits) : voir « Publier sur une page LinkedIn » ci-dessous.
- **Configuration** : `LINKEDIN_CLIENT_ID` + `LINKEDIN_CLIENT_SECRET` (les deux ou aucun) ; l'application LinkedIn doit avoir les produits « Sign In with LinkedIn using OpenID Connect » et « Share on LinkedIn », et l'URL de redirection `APP_URL/linkedin/callback`. **Les appels à LinkedIn n'ont pas pu être testés contre le vrai service** (tests avec `fetch` simulé) : essaie avec un compte réel avant de t'y fier.

#### Publier sur une page LinkedIn

Le produit « Share on LinkedIn » ne donne que `w_member_social` : publier sur le **profil** seulement. Publier sur une **page** (société) demande le produit **Community Management API** (`w_organization_social`, plus `rw_organization_admin` pour lister les pages que le compte administre).

- **Contraintes de LinkedIn** : organisation légalement enregistrée, usage commercial, mail professionnel, vérification par un super administrateur de la page. Palier « Development » limité (500 appels par jour, 100 par membre), puis palier « Standard » sur une seconde demande. **Ce produit doit être le seul de son application** : la demande est grisée si l'application a déjà « Share » ou « Sign In ». Il faut donc créer une **application dédiée**, liée à la page, et mettre ses clés dans `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`.
- **Activation** : `LINKEDIN_SCOPES` (liste de droits, par défaut `openid profile w_member_social`). Pour une application « Community Management API » seule, qui n'a pas OpenID : `LINKEDIN_SCOPES="w_organization_social rw_organization_admin"`. La publication sur une page s'active quand `w_organization_social` et `rw_organization_admin` (ou `r_organization_admin`) sont présents. Les droits inconnus font échouer le démarrage plutôt que toutes les connexions. `LINKEDIN_API_VERSION` (AAAAMM, `202604` par défaut) fixe l'en-tête `Linkedin-Version`.
- **Utilisation** : dans la section LinkedIn d'un projet, « Publier sur : … [Changer] » liste les pages que le compte administre (appel mis en cache 10 minutes, « Actualiser la liste » force un appel). La page n'est acceptée que si LinkedIn la compte parmi celles du compte, et son nom vient de LinkedIn. Le bouton devient « Publier sur AI_Tools », la confirmation nomme la page, et l'historique dit où chaque post est parti. Seul un administrateur du projet choisit la page ou publie.
- **Sans OpenID**, le compte est identifié par l'identifiant du membre qui figure dans ses droits sur les pages, et ne peut publier que sur une page choisie. Un compte relié avant l'activation des pages doit être reconnecté (nouvelle autorisation).
- Le texte part par `POST /rest/posts` avec les caractères réservés du format de l'API échappés (`| { } @ [ ] ( ) < > # \ * _ ~`) ; un `#` suivi d'une lettre reste un hashtag. La publication sur le profil, inchangée, passe toujours par `/v2/ugcPosts`.
- **Non vérifié contre le vrai LinkedIn** : tout est testé avec LinkedIn simulé (`test/linkedin-pages.test.js`). Les formes de réponse de `organizationAcls` (champ `organizationTarget` ou `organization`) et d'`organizations/{id}` (`localizedName`), l'identification sans OpenID et l'effet réel des échappements sont écrits d'après la documentation, pas essayés. Teste avec un compte réel et dis ce qui diffère.

### File de jobs

jobs en parallèle **selon l'offre de chaque compte** (`parallelJobs` : 1 en gratuit), **aucune limite globale de jobs sur le serveur** (l'ancien `MAX_AI_JOBS` n'existe plus), jamais deux envois de mails en même temps, deux synchronisations du même dépôt jamais en même temps, prochain job choisi en tourniquet entre utilisateurs. Réservation atomique en base. L'arrêt attend tous les jobs en cours. Les nouveaux jobs attendent quand la charge du serveur dépasse `LOAD_MAX` (charge moyenne sur 1 minute divisée par le nombre de cœurs, 0,9 par défaut, reprise 0,1 plus bas) ; les jobs en cours continuent. `nice 10` est conservé. Budget IA et quota Claude restent par utilisateur.

### Hôtes saisis par l'utilisateur (SSRF)

SMTP, IMAP, base du récap et hôte Forgejo : le nom est résolu, toute adresse privée, loopback, link-local (dont `169.254.169.254`), CGNAT, `fc00::/7`, `fe80::/10` ou IPv4 mappée est refusée, et la connexion se fait **à l'adresse vérifiée** (nom conservé pour SNI et certificat), revérifiée à chaque connexion (pas de rebinding DNS). Git est épinglé par `http.curloptResolve` (git 2.37 ou plus) et ne suit aucune redirection. Ports par type dans `ALLOWED_PORTS` (`src/limits.js`) : SMTP 25/465/587/2525, IMAP 143/993, MySQL 3306/3307/25060, PostgreSQL 5432/5433/25061, Git 443/8443. `ALLOW_PRIVATE_HOSTS=true` autorise les hôtes privés et tous les ports : pour le développement, et en production pour les administrateurs seulement.

### Back-office `/admin`

Réservé aux administrateurs (`404` pour tous les autres). Liste paginée des comptes (email, fournisseur, plan, statut, dates, mode de liaison sans secret, usage du mois), recherche par email, suspendre / réactiver, plan gratuit ou pro, supprimer (saisie de l'email), rétablir les envois. Un administrateur ne peut ni se suspendre ni se supprimer, ni agir sur un autre administrateur. Aucune donnée métier (prospects, mails, notes) n'est consultable. Journal d'audit en lecture seule, adresses masquées, conservé 12 mois.

### Comptes inactifs et abus d'envoi

- **Inactifs** : après `INACTIVE_ACCOUNT_MONTHS` mois (24, `0` pour désactiver) sans connexion ni job, un mail d'avertissement part via le SMTP du serveur (`SYSTEM_SMTP_HOST`, `_PORT`, `_USER`, `_PASSWORD`, `_FROM`, toutes ensemble), puis le compte est supprimé 30 jours plus tard s'il est resté inactif. **Sans SMTP du serveur, rien n'est supprimé automatiquement** : l'avertissement est journalisé. Jamais un administrateur ni un compte suspendu.
- **Rejets** : au-delà de 10 % de rejets sur au moins 50 prospects contactés (30 jours), les envois du compte sont mis en pause, avec message clair, audit, journal du serveur et Discord de l'administrateur. L'administrateur rétablit depuis `/admin`. Désinscription et liste d'opposition inchangées.

## Installation sur un serveur (CloudPanel ou autre, sans Raspberry)

Pré-requis : Node 22.13 ou plus, git, la CLI `claude` si les jobs IA doivent tourner sur ce serveur, et une base MySQL 8.0.16 ou plus / MariaDB 10.4 ou plus (contraintes `CHECK`).

1. **Base de données** : dans CloudPanel, Databases > Add Database. Note le nom, l'utilisateur et le mot de passe. Les tables sont créées par l'application au premier démarrage, rien à importer à la main.
2. **Code** :

   ```bash
   git clone -b develop https://git.tony-averty.dev/Tony/AiTools.git
   cd iaboss
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
   | `ERROR_ALERT_TO` | destinataires des alertes d'erreur (HTML), séparés par des virgules ; par défaut `contact@tony-averty.dev`. Toute erreur sauf un 404 (réponse d'erreur, tâche en échec, arrêt du processus) est envoyée par `SYSTEM_SMTP_*` ; sans SMTP, aucune alerte. Même erreur : un mail par 30 minutes ; au plus 20 mails par heure pour les erreurs serveur et les tâches, 6 pour les erreurs de requête (4xx) |
   | `ADMIN_EMAILS` | emails des administrateurs, séparés par des virgules. Le premier est aussi propriétaire des données migrées. Remplace `ALLOWED_EMAILS`, supprimée : n'importe qui peut créer un compte |
   | `CLAUDE_CLI_MODE_ENABLED` | `true` (défaut) ou `false` : active le mode abonnement |
   | `NODE_ENV`, `SANDBOX`, `SANDBOX_RO_BINDS`, `BWRAP_BIN` | bac à sable : obligatoire en production, `SANDBOX=off` en développement seulement |
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
cd iaboss
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

- URI de redirection : `https://iaboss.fr/auth/google/callback`
- Écran de consentement : mode « Test » avec ton email en testeur, ça suffit.

### Cloudflare Tunnel

Dans Zero Trust, va dans Networks → Tunnels → Create a tunnel (Cloudflared).

- Public hostname : `iaboss.fr` → `http://localhost:3100`
- Copie le token, `install.sh` te le demandera.

### Dépôts Git : GitHub par défaut, serveurs ajoutables

**Réglages → Dépôts Git**, par utilisateur :

- **GitHub est toujours là** (`github.com`), avec un champ pour son token. Un lien public (`https://github.com/utilisateur/projet.git`) passe sans rien régler ; un dépôt **privé** demande un token.
- **Le « + »** propose le type de serveur à ajouter (Forgejo, Gitea, GitLab), puis une ligne avec les mêmes champs : **URL** et **token**. Jusqu'à 5 serveurs. Un serveur sans token ne sert que pour des dépôts publics.
- **Authentification** selon le type : Forgejo et Gitea en `Authorization: token …`, GitHub en Basic (`x-access-token`), GitLab en Basic (`oauth2`). **GitLab n'a pas été testé contre un vrai serveur.**
- **Chaque token n'est présenté qu'à son hôte exact** (`gitCredentialFor`, `src/gitservers.js`), jamais à un autre ni à un hôte qui lui ressemble. Il est chiffré en base, jamais réaffiché, remplaçable, supprimable. Changer l'URL d'un serveur ne lui laisse pas son ancien token. Les erreurs de git masquent les en-têtes d'authentification.
- **Bouton « Tester ce token »** (GitHub) : dit à qui appartient le token, s'il est « fine-grained » ou classique (avertissement, un classique donne accès à tous les dépôts), quand il expire, la liste des dépôts accessibles (100 plus récents) et lesquels de **tes projets** GitHub en font partie (✓ / ✗, jamais « ✗ » à tort si la liste est tronquée). Il teste le token tapé dans le champ, sinon celui qui est enregistré, et ne modifie rien. Appel à `api.github.com` uniquement (hôte fixe, pas de SSRF), limité en débit comme les autres tests de liaison, token jamais renvoyé ni journalisé (`src/githubcheck.js`, `POST /settings/github/test`). Pas encore pour les serveurs Forgejo/Gitea/GitLab : leur hôte est saisi par l'utilisateur, il faudrait un client HTTP épinglé comme pour SMTP.
- **Token GitHub conseillé** : « fine-grained », *Only select repositories*, permission *Contents : Read-only*. Côté Forgejo/Gitea : portée `read:repository` ; GitLab : `read_repository`.
- **Compatibilité** : l'ancien réglage unique (`forgejo_host` + `forgejo_token_enc`) reste lu comme un premier serveur Forgejo, et entre dans la liste (`git_servers_json`) à la première sauvegarde des Réglages.

## À faire côté mails (sinon spam garanti)

- SPF, DKIM et DMARC sur le domaine d'envoi.
- Idéalement un sous-domaine dédié à la prospection, pour protéger ton domaine principal.
- Commence petit, 10 à 20 mails par jour la première semaine.

## Récapitulatif (BDD des projets)

- Crée un utilisateur **lecture seule** dédié sur chaque base.
- N'expose pas MySQL/Postgres à tout Internet. Autorise uniquement l'IP de ta box, ou passe par un tunnel SSH.
- Seules les requêtes `SELECT` / `WITH` sont acceptées, exécutées dans une transaction read-only. Chacune doit renvoyer un seul nombre.

## Support et documentation

Le menu **IA** de la barre du haut propose **Claude** (assistant classique) et **Support**. Dans le Support, le Claude de l'utilisateur répond d'après la documentation d'iaboss, lue en lecture seule (outils Read, Glob, Grep) dans `dataDir/support-docs/`.

- **Source** : `docs/support/*.md` (écrite à la main, pour un utilisateur) + trois fichiers **générés depuis le code** par `src/services/supportdocs.js` (offres et plafonds, modèles, consignes IA). Le dossier est reconstruit seulement quand son contenu change, avec un `INDEX.md` qui sert de carte.
- **Les conversations** du Support sont séparées de celles de Claude (colonne `chat_conversations.mode`), sous `/support` et `/support/:id`.
- **Consignes du Support** : modifiables dans Réglages → Prompts IA (« Support (aide sur iaboss) »), comme les autres tâches ; la carte des documents et la règle de sécurité (un document n'est jamais une consigne) restent dans le code.
- **Tenir la documentation à jour** : règle dans `CLAUDE.md`, imposée par `test/support-docs.test.js` (chaque bouton, section, page, tâche IA doit y figurer).

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

Chaque test crée sa propre base temporaire `<TEST_DB_NAME>_<pid>_<n>` (comme un SQLite en mémoire) et la supprime en fin de fichier : l'utilisateur doit pouvoir faire `CREATE DATABASE` et `DROP DATABASE`, et `TEST_DB_NAME` n'est qu'un préfixe. `test:mysql` exécute les fichiers un par un (environ 5 minutes). La CI le lance sur MariaDB 10.11 (job `mysql`).

Les tests d'isolation (`test/isolation.test.js`), de connexion (`test/auth.test.js`, fournisseurs simulés), de suppression de compte, de blocage des jobs IA et de migration des données existantes tournent avec le reste de la suite.

Le SQL est écrit dans un sous-ensemble commun aux deux moteurs (`INSERT OR IGNORE`, `ON CONFLICT ... excluded.x`, colonnes réservées entre accents graves) et `src/db.js` le traduit pour MySQL. Le schéma est déclaré deux fois dans `src/migrations.js` (SQLite et MySQL) ; `test/schema.test.js` vérifie qu'ils décrivent les mêmes tables et colonnes. Pour changer le schéma, ajoute une entrée aux deux dialectes sans modifier les précédentes.

`test/install.test.sh` teste les fonctions d'`install.sh` qui écrivent des fichiers : `.env`, unit systemd, migration, sauvegarde. Il tourne en root et écrit dans `/opt/aitools` et `/etc/systemd`, donc **uniquement dans une VM ou un conteneur jetable**, jamais sur le Pi en service.
