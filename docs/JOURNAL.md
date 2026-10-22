# Journal de projet — AiTools

Branches de travail : `feat/saas-mysql` (J1), `feat/saas-accounts` (J2, depuis la précédente) `feat/saas-claude-link` (J3, depuis J2) puis `feat/saas-site` (J4, depuis J3) et `feat/saas-guardrails` (J5, depuis J4) — version publique, voir `docs/CADRAGE.md`.

## 2026-10-22 — J5 « Anti-abus, quotas et administration »

### Fait
- **Limitation de débit** (`src/ratelimit.js`, seuils dans `src/limits.js`) : fenêtre glissante en mémoire, par IP et par compte, sans dépendance. Connexion (démarrage, retours Google et Apple), `/link/*`, export et import CSV, envois (lot, rapport, notification de test), création de projet, suppression de compte, tests IMAP et récap, back-office. `429` + `Retry-After` ; une requête refusée n'est pas comptée. `TRUST_PROXY` (défaut : désactivé) : `X-Forwarded-For` lu de droite à gauche, seulement depuis un proxy de confiance (loopback, ou liste/CIDR), les valeurs de gauche forgées par le client sont ignorées.
- **reCAPTCHA v3** (`src/captcha.js`, `public/captcha.js`) : le démarrage de la connexion devient un POST avec jeton, vérifié côté serveur (score ≥ `RECAPTCHA_MIN_SCORE`, action, site). Le script de Google n'est chargé qu'après le clic sur « Charger la vérification anti-robot » ; la CSP ouvre les domaines reCAPTCHA sur `/login` seulement. Sans clés : désactivé. Politique de confidentialité mise à jour (destinataires, cookies, adresse IP en mémoire) seulement quand reCAPTCHA est configuré.
- **Plafonds du plan gratuit** (`src/services/plans.js`) : 1 projet, 50 prospects, 100 mails, 5 jobs IA par mois (mois calendaire Paris). Migration 3 `usage_events` (journal d'usage qui survit à la suppression d'un projet). Refus `403 plan_limit` avec lien `/tarifs`, sans perte (import CSV refusé en entier, lot de mails tronqué, recherche de prospects arrêtée au plafond, projet créé même si l'analyse est refusée). Barres d'usage dans Mon compte et sur le tableau de bord. Page Tarifs corrigée.
- **Offres payantes** (`src/limits.js`, `PLAN_LIMITS` / `PLAN_PRICES`) : plan gratuit passé à 6 jobs IA par mois (analyse + deux modèles + trois recherches), puis Démarrage 10 €, Croissance 25 €, Business 50 €, Intensif 100 € TTC par mois ; annuel = 10 mois payés pour 12. Prix TTC = prix payé (franchise de TVA, art. 293 B). Page Tarifs générée depuis la configuration (bascule mois/année en CSS pur), CGU et tests aussi. Affichées « Bientôt » : aucun paiement n'est branché. L'ancien plan `pro` (illimité, attribué à la main) est conservé pour ne retirer l'accès à personne. Le plafond des mails d'une offre ne dépasse jamais 300 × 30 (plafond d'envoi par 24 h) ; un test le vérifie.
- **SMTP par projet et équipes** : le SMTP d'un projet est facultatif (hôte vide = Réglages du propriétaire). Équipes : tables `teams`, `team_members`, `team_invites`, colonne `projects.team_id` (migration `equipes_linkedin`). Choix d'architecture : un membre **agit comme le propriétaire** sur les projets partagés (jobs au nom du propriétaire : son accès Claude, son plan, ses plafonds ; usage compté chez lui), donc le reste du code (jobs, handlers, planificateur) n'a pas changé : seuls `getProject` et les routes projet résolvent l'accès (`accessOn`). Invitations : jeton stocké sous forme d'empreinte, lié à l'adresse, usage unique. Un membre sans liaison Claude n'est plus renvoyé vers `/link`. `test/teams.test.js` vérifie l'isolation (projets privés, autres équipes, étrangers), les rôles, les places, le retrait immédiat et la suppression de compte.
- **LinkedIn** (`src/linkedin.js`, `src/linkedinroutes.js`) : compte relié à un projet par OAuth (jeton chiffré), brouillons de posts en base (`linkedin_posts`), job IA `linkedin_post` (direction facultative, régénération qui reçoit les brouillons précédents), publication par `ugcPosts` après confirmation, avec verrou `publishing` contre le double clic. Droits : membre = génère et modifie, administrateur = connecte, publie, déconnecte. Non testé contre l'API réelle (limite connue, voir README).
- **File de jobs** : `MAX_AI_JOBS` (4) en parallèle, un seul par utilisateur, tourniquet, réservation atomique (`UPDATE … WHERE status = 'queued'` + contrôle des lignes affectées et d'un job `running` du même utilisateur), arrêt qui attend tous les jobs. Pause thermique remplacée par une pause selon `charge / cœurs` (`LOAD_MAX`, hystérésis de 0,1). `nice 10` conservé. Testée avec le CLI simulé (`FAKE_DELAY_MS`, `FAKE_LOG` dans la fixture).
- **SSRF** (`src/netguard.js`, `src/ip.js`) : SMTP, IMAP, base du récap, Forgejo. Résolution puis refus des adresses privées ; connexion à l'adresse vérifiée (SMTP/IMAP/BDD : `host` = IP + `servername`), git épinglé (`http.curloptResolve`, sans redirection). Ports par type. `ALLOW_PRIVATE_HOSTS` : dev, et admins seulement en production. Contrôle aussi à l'enregistrement (réponse 400 immédiate ; hôte non résolu accepté, revérifié à l'usage).
- **Back-office `/admin`** (`src/admin.js`, `adminroutes.js`, `adminviews.js`) : 404 pour les non-admins et les visiteurs, liste paginée avec recherche, suspendre / réactiver / plan gratuit-pro / supprimer (saisie de l'email) / rétablir les envois. Migration 4 `admin_audit` (sans clé étrangère, adresses masquées, conservé 12 mois, lecture seule).
- **Comptes inactifs** (`src/services/inactive.js`) : planificateur, `INACTIVE_ACCOUNT_MONTHS` (24, 0 = désactivé), avertissement 30 jours avant via `SYSTEM_SMTP_*`, suppression 30 jours après l'avertissement si pas de reconnexion. Page confidentialité corrigée (en place, durée configurée).
- **Abus d'envoi** (`src/services/abuse.js`) : > 10 % de rejets sur ≥ 50 prospects contactés (30 jours) → pause d'envoi, message clair, audit, journal serveur, Discord des admins (forcé) et du compte. Rétablissement par l'admin.
- **Tests** : `ratelimit`, `captcha`, `plans`, `queue`, `netguard`, `admin`, `abuse`, `inactive`.

### Décisions
- **Journal d'usage plutôt que `mail_log`/`jobs`** pour les plafonds mensuels : supprimer un projet efface ses jobs et ses logs de mail (cascade) et remettrait sinon le mois à zéro. Un job IA annulé ou refusé sans jamais démarrer n'est pas compté ; un job dont le projet a disparu l'est (prudence).
- **Pas de suppression automatique sans avertissement reçu** : sans SMTP du serveur, les comptes inactifs sont journalisés et à traiter à la main (le brief disait « sinon journalisé » ; supprimer sans prévenir semblait pire).
- **Le plan `pro` est illimité** tant qu'il n'est pas défini (`PLAN_LIMITS.pro` dans `src/limits.js`).
- **Un admin ne touche pas aux autres admins** (suspension, plan, suppression) : leur rôle vient de `ADMIN_EMAILS`.
- **Sans consentement reCAPTCHA, pas de connexion** (aucun contournement demandé) : la politique le dit. Le consentement n'est pas mémorisé.
- **Git épinglé sans suivre de redirection** (`http.followRedirects=false`) : un dépôt hébergé derrière une redirection ne se clone plus.
- Événement Discord `thermal` renommé `load` (les anciens réglages sont convertis à la lecture).

### Non vérifié (à faire par Tony ou au prochain passage)
- **MySQL/MariaDB réel** : toujours aucune base de test. Nouveau à valider avec `npm run test:mysql` : migrations 3 et 4, et surtout `UPDATE jobs … AND (SELECT COUNT(*) FROM (SELECT id FROM jobs WHERE … LIMIT 1) busy) = 0` (table dérivée avec `LIMIT` pour éviter l'erreur 1093 ; à confirmer sur MySQL 8 et MariaDB), `COUNT(DISTINCT CASE …)`, `LIKE … ESCAPE '!'`.
- **reCAPTCHA réel** : clés, score, rendu du badge masqué, et surtout la **CSP** (`style-src 'self'` sans `unsafe-inline` : si reCAPTCHA injecte des styles en ligne, la console affichera des violations ; à vérifier dans un navigateur sur le domaine, ajuster seulement la CSP de `/login`). Durée du cookie `_GRECAPTCHA` non vérifiée (la page dit « durée fixée par Google »).
- **Connexions réelles bloquées par le filtre** : SMTP/IMAP/MySQL réels avec `servername`, `tls.servername` pour STARTTLS (nodemailer), `http.curloptResolve` (git ≥ 2.37), non exécutables ici. Vérifier un envoi réel, une lecture IMAP et un clone sur le serveur.
- **Charge** : `os.loadavg()` vaut toujours 0 sous Windows ; la pause de charge n'est testée qu'avec une charge injectée. Valeurs `MAX_AI_JOBS`/`LOAD_MAX` à régler sur le vrai serveur (bwrap, 4 jobs réels, mémoire non mesurés).
- **TRUST_PROXY** derrière le Nginx de CloudPanel : à tester avec l'en-tête réellement posé.
- **Mail d'avertissement d'inactivité** : jamais envoyé pour de vrai (transport simulé).

### Risques
- Compteurs de débit en mémoire : un redémarrage les remet à zéro ; plusieurs instances ne les partagent pas.
- Quotas : `withUserLock` est un verrou de processus ; deux instances pourraient dépasser un plafond d'une unité.
- Ports autorisés : un fournisseur de base managée sur un port inhabituel est refusé (liste dans `ALLOWED_PORTS`).
- Une pause d'envoi se déclenche aussi sur des rejets dont l'utilisateur n'est pas responsable (liste achetée, panne chez un destinataire) : l'admin rétablit.
- Aucune relecture juridique du paragraphe reCAPTCHA (consentement obligatoire pour se connecter : un consentement « libre » peut être contesté).

### À faire
- Fixer le plan `pro` (limites, prix) avec le jalon paiement.
- Poser les clés reCAPTCHA, `SYSTEM_SMTP_*`, `TRUST_PROXY=true` (ou la liste) dans le `.env` du serveur ; `MAX_AI_JOBS` selon la charge réelle.
- J6 : `install.sh` (Pi) propose encore `THERMAL_MAX` ; il n'est plus lu.

## 2026-10-22 — J4 « Site public »

### Fait
- **Site servi par la même application** (`src/site/`), rendu serveur, zéro JavaScript sur les pages publiques, zéro dépendance. Un visiteur sans session voit le site à la racine ; connecté, `/` mène au tableau de bord (et à l'onboarding de liaison si besoin) comme avant. `/login` renvoie vers `/` si on est déjà connecté.
- **Pages** : accueil (avec une maquette du tableau de bord construite avec les vrais composants, données d'exemple signalées), fonctionnement (7 étapes, limites annoncées), tarifs (Gratuit : 1 projet, 50 prospects, 100 mails, 5 jobs IA par mois ; payant « Bientôt », sans prix ; accès Claude à la charge de l'utilisateur, clé API ou abonnement avec le risque expliqué ; responsabilité des envois), connexion (la page existante, intégrée au site), mentions légales, confidentialité, CGU, 404.
- **Identité** : `public/site.css` chargé après `app.css`, uniquement les jetons du tableau de bord (`--bg`, `--card`, `--text`, `--muted`, `--line`, `--accent`, thème sombre inclus), composants `.btn`, `.card`, `.badge`, `.bar`. Signature visuelle : un carré à coin rabattu (logo, numéros d'étapes, repères) et une règle graduée comme séparateur. Les effets du tableau de bord (fond dégradé, verre dépoli, dégradé violet des boutons) sont neutralisés sous `body.site`. Typographie système, une seule animation d'entrée, désactivée par `prefers-reduced-motion`.
- **SEO** : title, description, canonical, Open Graph par page, une h1, `lang="fr"`, liens d'évitement, `robots.txt` (pages d'application en `Disallow`), `sitemap.xml` (6 pages), JSON-LD `SoftwareApplication` sur l'accueil, favicon SVG (clair/sombre), `noindex` (balise et en-tête `X-Robots-Tag`) sur tout ce qui n'est pas une page publique, y compris connexion et 404.
- **Sécurité** : CSP stricte (`default-src 'self'`, pas d'inline, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action` limité à l'application, Google et Apple), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, HSTS **seulement si `APP_URL` est en https**. Statiques avec ETag (304) et `Cache-Control` (1 h, 1 jour pour le favicon). HEAD répond comme GET.
- **Tests** : `test/site.test.js`. Deux tests existants adaptés : la racine anonyme n'est plus une redirection (elle sert le site), et le contrôle de redirection vers la connexion passe par `/account`.

### Décisions
- **« Tu »** partout, y compris dans les pages légales, comme dans le tableau de bord. À valider avec le juriste (usage plus courant : « vous »).
- **Ce qui est dit sur le site vient du code** : limites d'envoi (100 mails par lot, plafonds 200/300 par 24 h, délai 20–60 s), lecture IMAP toutes les 15 minutes, une seule relance en heures ouvrées, etc. Si le code change, les pages Fonctionnement et Tarifs sont à relire.
- **Plafonds du plan gratuit annoncés mais non appliqués** : la page Tarifs le dit en clair (application technique au J5).
- **Pas de bandeau cookies** : seuls `sid` (30 jours) et `oauth_b` (10 minutes, `/auth`) sont posés, tous deux strictement nécessaires ; pas d'analytics, pas de police externe. Dit dans la page confidentialité. Le `sessionStorage` du tableau de bord (projet ouvert) y est mentionné.
- **Acceptation des CGU par la connexion** (phrase sous les boutons, pas de case à cocher) : à valider ; une case serait plus solide juridiquement mais casse le flux « un clic ».
- **« Apple » n'apparaît que si Apple est configuré** (accueil, connexion, confidentialité, CGU), sinon le site mentionnerait un bouton absent.
- **Pas d'image Open Graph** : aucune illustration réelle pour l'instant (`twitter:card=summary`).
- **reCAPTCHA (J5)** : le paragraphe de confidentialité prêt à l'emploi est en commentaire dans `src/site/legal.js` (au-dessus de `privacyPage`), avec la liste des autres endroits à mettre à jour (CSP, cookies, transferts, consentement).
- **`/login` n'est pas en `Disallow` mais en `noindex`**, pour que le robot puisse lire le noindex.

### Marqueurs à compléter
Visibles en jaune sur les pages légales tant que l'information manque. Un test compare cette liste aux pages et au code : ajouter ou retirer un marqueur impose de mettre cette liste à jour.

- `[À COMPLÉTER : adresse du siège]` : mentions légales et confidentialité (adresse de l'EI).
- `[À COMPLÉTER : hébergeur]` : mentions légales et confidentialité (nom, adresse, contact de l'hébergeur du serveur).
- `[À COMPLÉTER : téléphone]` : mentions légales. La loi sur la confiance dans l'économie numérique demande un moyen de contact rapide pour l'éditeur ; à confirmer avec un juriste (un numéro, ou autre solution), sinon retirer la ligne.
- `[À VALIDER : durées de conservation]` : confidentialité. Propositions : compte inactif supprimé après 24 mois (implémenté au J5, avec avertissement 30 jours avant), journal d'administration 12 mois, sessions 30 jours, sauvegardes environ 14 jours, journaux d'accès du serveur 12 mois (à vérifier avec la configuration réelle de Nginx/CloudPanel), prospects : recommandation de 3 ans après le dernier contact.
- `[À VALIDER : transferts hors UE]` : confidentialité (Google, Apple, Anthropic aux États-Unis ; mécanismes cités de façon générale).
- `[À VALIDER : cadre de sous-traitance]` : confidentialité et CGU. Les CGU et la politique tiennent lieu de cadre de l'article 28 RGPD ; un accord de sous-traitance dédié est peut-être préférable.
- `[À VALIDER : limitation de responsabilité]` : CGU.

### À faire relire par un juriste
- Clause d'abonnement (risque de suspension du compte Claude, exclusion de responsabilité « dans la mesure permise par la loi ») et sa case d'acceptation (décision 10 du cadrage).
- Rôles RGPD (utilisateur responsable de traitement, AiTools sous-traitant), contenu de l'article 28 réellement couvert.
- Affirmation de la page Tarifs sur la prospection B2B sans accord préalable (règle CNIL résumée, formulation prudente « en règle générale »).
- Mentions du siège et du téléphone, médiation de la consommation (service réservé aux professionnels, donc non traitée), juridiction compétente.
- Liens sortants, saisis de mémoire et à vérifier à la main : `anthropic.com/legal/consumer-terms`, `anthropic.com/legal/privacy`, `policies.google.com/privacy`, `apple.com/legal/privacy/fr-fr/`, `cnil.fr/fr/plaintes`.

### Non vérifié
- **Rendu réel** : vu dans le navigateur intégré (accueil sur ordinateur et mobile 375 px, fonctionnement en sombre sur tablette, confidentialité), mais la fenêtre du volet est petite et les captures sont partielles. Pas de Lighthouse, pas de Safari ni Firefox, pas de lecteur d'écran, pas de vrai téléphone.
- **Contrastes** : calculés par un test à partir des jetons (AA 4,5:1) ; pas de mesure sur la page rendue.
- **Sur le serveur** : en-têtes derrière le reverse proxy (Nginx/CloudPanel peut en ajouter ou en dupliquer, notamment HSTS), cache d'un éventuel CDN (`Vary: Cookie` est posé sur `/`).
- **Connexion Apple** : le POST cross-site reste testé avec un fournisseur simulé uniquement (déjà le cas au J2).

### À faire
- Renseigner les marqueurs, relire les pages légales, vérifier les liens sortants, et retirer chaque marqueur de cette liste et de `MARKERS` (`src/site/legal.js`) une fois traité.
- Une image Open Graph et de vraies captures du produit quand il y aura des données réelles (aucun témoignage ni chiffre n'a été inventé : il n'y en a pas).
- ~~J5 : plafonds, reCAPTCHA, comptes inactifs~~ : faits (voir J5).
- Les pages d'erreur HTML autres que 404 (403, 500) utilisent encore l'ancien gabarit.

## 2026-10-22 — J3 « Liaison Claude »

### Fait
- **Liaison par utilisateur** (`src/claudelink.js`, stockée dans `users.claude_link_json`, secret chiffré AES-256-GCM avec `crypto.js`) : trois modes. Clé API Anthropic (vérifiée par `GET /v1/models`, sans coût ; 401/403 refusent, une erreur réseau ou un 5xx donne un message distinct ; `fetch` injectable). Jeton d'abonnement (`claude setup-token` sur la machine de l'utilisateur, collé dans un formulaire). « Claude du serveur » (admins de `ADMIN_EMAILS`, configuration CLI de la machine, comme avant). La clé n'est jamais réaffichée (4 derniers caractères seulement), ni journalisée ; les erreurs du CLI sont masquées (`***`) avant d'atteindre la base, les journaux ou les réponses.
- **Consentement du mode abonnement** : fenêtre `<dialog>` d'avertissement avec case obligatoire ; le serveur refuse (400) sans la case, avant toute validation, et ne stocke rien. L'acceptation est horodatée avec la version du texte (`CONSENT_VERSION`) dans la liaison et dans `user_settings.claude_cli_consent_json` (conservée après « Délier », effacée avec le compte). `CLAUDE_CLI_MODE_ENABLED=false` masque le mode et le refuse côté serveur (liaison, test, exécution).
- **Onboarding bloquant** : garde centrale dans `server.js` (défaut = refus) : sans liaison valide, redirection vers `/link` (HTML) ou 403 `link_required` (JSON) sur toute route, sauf `/link*`, Mon compte, suppression du compte et déconnexion. La garde « admin seulement » du J2 est remplacée par `aiRefusal` / `assertCanRunAi`, appelés dans les routes, `enqueue`, le worker (`jobRefusal`) et le wrapper `makeClaude()`.
- **Le secret vient toujours du `user_id` du job** (`resolveCredentials`) ; les projets sont relus avec ce même `user_id` (404 sinon). Le répertoire de travail doit être sous `repos/<user_id>` (`allowedRoot`).
- **Exécution isolée** (`src/services/sandbox.js`, `claude.js`) : ligne bubblewrap construite par une fonction pure (racine reconstruite en lecture seule : `/usr`, `/etc`, bibliothèques ; `/tmp` et `HOME` en tmpfs ; clone de l'utilisateur monté en lecture seule ; `--unshare-pid/ipc/uts`, `--die-with-parent`, `--new-session`, `--cap-drop ALL` ; réseau conservé). Le secret est dans l'environnement du processus, pas dans argv (visible dans `ps`). Environnement enfant en liste blanche (`PATH`, `LANG`, `HOME` jetable, le secret). Production : job refusé si `bwrap` manque, même avec `SANDBOX=off` ; développement : `SANDBOX=off` désactive avec avertissement au démarrage. Les clones git passent par `git.js` durci (https seulement, `GIT_ALLOW_PROTOCOL`, pas de hooks, pas de sous-modules, symlinks désactivés, 2 min, 300 Mo, environnement assaini). `syncRepo` revalide l'URL lue en base.
- **Par utilisateur** : quota remonté par le CLI, alertes, budget, pauses, notifications étaient déjà dans `user_settings` depuis le J2 ; le wrapper n'enregistre plus de quota en mode clé API, `/api/system` n'en renvoie pas, et la barre l'efface. Le quota est remis à zéro quand la liaison change.
- **Mon compte** : mode, état, date de liaison, dernier test, 4 derniers caractères (clé), consentement ; Tester (marque la liaison invalide sur refus d'authentification, la laisse intacte sur panne réseau ou CLI), Changer de mode (`/link?change=1`), Délier (efface le secret, annule les jobs IA en file ou en cours, interrompt le job IA en cours).
- Tests : `claude-link.test.js` et `claude-run.test.js` (remplacent `ai-guard.test.js`). Fixtures : `fake-claude.js` gagne ENVDUMP, LEAK et le jeton révoqué ; `helpers/claude-bin.js` fabrique un faux `claude` qui fixe des variables (l'environnement enfant étant assaini, un test ne peut plus piloter la fixture par `process.env`).

### Décisions
- **Racine du bac à sable reconstruite plutôt que `--ro-bind / /`** : une racine entière en lecture seule laisserait voir `/home`, la base, le `.env` et la configuration Claude du serveur. On monte `/usr`, `/etc` et les bibliothèques, plus le dossier du binaire Claude et `SANDBOX_RO_BINDS`. Le clone est monté en lecture seule (les outils autorisés ne font que lire).
- **Statut HTTP 502 « exposé »** (`HttpError.expose`) pour les échecs de validation (réseau, CLI) : sans cela le serveur masquait le message en « Erreur interne ».
- **Mode serveur** : n'importe aucune variable d'environnement d'identification de la machine ; il s'appuie sur la configuration CLI du serveur montée dans le bac à sable (`~/.claude`, `~/.claude.json`, en écriture pour le rafraîchissement des jetons). Une `ANTHROPIC_API_KEY` posée dans l'environnement du serveur n'est plus transmise.
- **Tests des clones** : `syncRepo` refuse désormais `file://`; le test de flux complet injecte `app.syncRepo` (clone local).

### Ce qui reste à valider en conditions réelles (non vérifié ici)
- **Aucun CLI `claude` installé sur ce poste** : `claude --help`, `claude setup-token --help` et `claude auth --help` n'ont donc pas pu être lus. Les consignes affichées (« lance `claude setup-token`, connecte-toi, copie le jeton ») et le nom de la variable `CLAUDE_CODE_OAUTH_TOKEN` reposent sur la documentation connue, pas sur la version installée sur le serveur. À vérifier sur le serveur : `claude setup-token --help`, forme exacte du jeton (la validation de format est volontairement large : 20 à 800 caractères sans espace, et refuse un préfixe `sk-ant-api` qui est une clé API), et que le jeton fonctionne avec `-p` sans `HOME` préexistant.
- **Validation du jeton** : aucune commande du CLI ne vérifie un jeton sans appel au modèle ; on lance un appel minimal (Haiku, 1 tour, aucun outil), qui consomme quelques tokens de l'abonnement. La distinction « jeton refusé » (400) / « impossible de juger » (502) repose sur une correspondance de texte dans la réponse du CLI : à confirmer avec de vraies réponses d'erreur.
- **bwrap réel** : non exécutable sous Windows. Seule la ligne de commande est testée. À essayer sur le serveur : un job complet avec chaque mode ; que `claude` et `node` sont bien visibles dans le bac à sable (sinon `SANDBOX_RO_BINDS`) ; la résolution DNS (`/etc/resolv.conf` pointant vers `/run/systemd/resolve`) ; le mode serveur (écriture dans `~/.claude`). Vérifier aussi que `deploy/aitools.service` (`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectKernelTunables`) laisse bwrap monter `/proc` ; si ce n'est pas le cas, assouplir ces options ou ajouter `--proc` conditionnel. Contrôle d'isolation à faire à la main : depuis un job, `ls /home /var /srv` doit être vide ou absent.
- **MySQL réel** : toujours aucun essai (pas de changement de schéma au J3, la colonne `claude_link_json` existait). `npm run test:mysql` reste à lancer.
- **Dépôts malveillants** : un `.claude/settings.json` ou un `CLAUDE.md` dans un dépôt cloné est lu par le CLI. Le bac à sable (lecture seule, sans la config du serveur) limite l'impact, mais le réseau reste ouvert : un hook ou un serveur MCP déclaré par le dépôt peut tenter de sortir des données de CE seul utilisateur. À étudier (désactiver les réglages de projet côté CLI si une option existe).
- Le surcoût de CPU/RAM du bac à sable par job n'est pas mesuré ; la concurrence de plusieurs jobs reste hors périmètre (J5).

### Risques connus, hors périmètre J3
- Rate limiting des routes `/link/*` (un utilisateur peut tester des clés à volonté, avec un appel réseau par essai), reCAPTCHA, back-office, plafond global de jobs : J5.
- Hôtes SMTP/IMAP/BDD/Forgejo saisis par l'utilisateur (SSRF) : non traités, non aggravés (le bac à sable conserve le réseau, comme demandé).
- Le texte d'avertissement du mode abonnement est une proposition de rédaction ; relecture juridique recommandée avec les CGU (décision 10).

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
