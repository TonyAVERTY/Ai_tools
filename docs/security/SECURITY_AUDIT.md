# Audit de sécurité d'iaboss

Date : 23 octobre 2026. Audit statique du code du dépôt + tests dynamiques **locaux** (serveur de test, base jetable, données fictives).
Aucun test contre la production ni contre un service externe. Aucun secret n'est reproduit dans ce document.
Les corrections sont **dans l'arbre de travail, non commitées, non déployées**.

## 1. Périmètre

Couvert : tout `src/`, `public/*.js`, `deploy/`, `install.sh`, `package.json` / `package-lock.json`, l'historique Git (fichiers sensibles), les tests existants.
**Non couvert** (accès nécessaire, voir §7) : la configuration réelle de Nginx / CloudPanel / Cloudflare Tunnel en production, le compte MySQL réel et ses droits, le fichier `.env` de production, les sauvegardes réelles, le runtime du bac à sable (bubblewrap) sur le serveur, les flux LinkedIn / Apple / Google contre les vrais services.

## 2. Architecture identifiée

| Élément | Constat (vérifié dans le code) |
|---|---|
| Stack | Node 22, sans framework (`http` natif), rendu serveur + JS vanilla, SQLite (dev/tests) ou MySQL (prod). Dépendances : `imapflow`, `mysql2`, `nodemailer`, `pg`. |
| Authentification | OAuth/OIDC Google et Apple uniquement (pas de mot de passe stocké). `state` + `nonce` + PKCE (Google) + cookie de liaison au navigateur, signature RS256 de l'`id_token` vérifiée via JWKS, `iss`/`aud`/`exp`/`nonce` contrôlés. |
| Sessions | Identifiant aléatoire 256 bits en base, cookie `HttpOnly; Secure; SameSite=Lax`, 30 jours, suppression à la déconnexion / suspension. |
| CSRF | `SameSite=Lax` + contrôle strict de l'en-tête `Origin` sur toute requête non-GET authentifiée ; aucune écriture en GET. |
| Autorisation | Contrôle serveur par ressource (`getProject`, `ownedProspect`, `accessOn`), 404 pour une ressource d'autrui, rôles d'équipe, back-office réservé aux admins (404 pour les autres). Tests d'isolation existants (`test/isolation.test.js`). |
| SQL | Requêtes préparées partout ; les fragments dynamiques (`ORDER BY`, colonnes) viennent de listes blanches. |
| SSRF | `netguard.js` : ports autorisés, résolution DNS, refus de toute adresse privée/réservée (IPv4, IPv6, NAT64, 6to4…), **épinglage de l'IP vérifiée** pour SMTP / IMAP / base / git (anti DNS-rebinding). |
| Exécution de commandes | `spawn` sans shell pour git et Claude ; git durci (https seul, pas de hooks, pas de sous-modules, pas de redirections) ; Claude exécuté dans un bac à sable obligatoire en production, environnement enfant en liste blanche. |
| Secrets | Chiffrés en base (AES-256-GCM), jamais réaffichés ; jetons de désinscription HMAC ; `.env` ignoré par Git. |
| En-têtes | CSP stricte (`script-src 'self'`, pas de style/script en ligne, `frame-ancestors 'none'`, `object-src 'none'`), HSTS, nosniff, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP. |
| Abus | Limiteur en mémoire par IP / par compte, plafonds de plan, plafonds d'envoi, détection de rejets, reCAPTCHA v3 sur la connexion, IP client lue dans `X-Forwarded-For` **seulement** depuis un proxy déclaré (`TRUST_PROXY`). |
| Déploiement | Service systemd durci (`NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`, `MemoryMax`), écoute locale derrière Cloudflare Tunnel. |

## 3. Vulnérabilités détectées

| # | Gravité | Problème | Emplacement | État |
|---|---|---|---|---|
| V1 | **ÉLEVÉE** (disponibilité) | Une seule requête non authentifiée `GET //` (ou `///`) fait lever `new URL()` hors du `try` : la promesse rejetée n'est pas gérée et **Node arrête le processus**. Reproduit avant correction. systemd redémarre le service, mais l'attaque est triviale et répétable (coupure à chaque requête). | `src/server.js` | **Corrigé et testé** |
| V2 | **ÉLEVÉE** (chaîne d'approvisionnement) | `nodemailer` 6.10.1 : 1 paquet « high » regroupant une quinzaine d'avis (GHSA), dont contournements de validation du domaine destinataire (IDN, commentaires RFC 5322), injection d'en-têtes CRLF, injection de commandes SMTP, DoS par parseur d'adresses, fuite de `servername` TLS entre transports. Pertinent ici : les adresses des prospects viennent du web ou d'un CSV. | `package.json` | **Corrigé** (10.2.1, `npm audit` : 0 vulnérabilité) |
| V3 | MOYENNE | Réponses authentifiées (pages, API : prospects, réglages, CSV) sans `Cache-Control: no-store` : cache navigateur / proxy possible, données visibles après déconnexion sur poste partagé. | `src/server.js` | **Corrigé et testé** |
| V4 | FAIBLE | `%` mal encodé dans l'URL, dans un cookie ou JSON invalide → réponse 500 + trace dans les journaux au lieu de 400 (bruit, amplification de journaux, fausse alerte). | `src/http.js` | **Corrigé et testé** |
| V5 | FAIBLE | Page publique de désinscription sans limitation de débit. | `src/routes.js`, `src/limits.js` | **Corrigé et testé** (60 / 10 min / IP) |
| V6 | FAIBLE | Page d'erreur : échappement partiel (`<` seulement). | `src/server.js` | **Corrigé** (`esc`) |
| V7 | INFO | `Cross-Origin-Resource-Policy` absent. | `src/site/seo.js` | **Corrigé** (`same-origin`) |
| V8 | FAIBLE | Filet de sécurité : un défaut imprévu dans un gestionnaire pouvait, de la même façon que V1, arrêter le processus. | `src/server.js` | **Corrigé** (garde global, réponse 500 générique) |
| V9 | FAIBLE | Identifiants de session stockés en clair en base : une fuite de la base ou d'une sauvegarde permettait de rejouer des sessions actives. | `src/auth.js`, `src/crypto.js`, migration `session_id_hashing` | **Corrigé et testé** : la base ne garde que le SHA-256 du cookie ; la migration convertit les sessions existantes, personne n'est déconnecté |

## 4. Problèmes identifiés, non corrigés

| Gravité | Sujet | Pourquoi pas corrigé / action |
|---|---|---|
| FAIBLE | Pas de limite globale de requêtes pour un compte connecté (seules les routes coûteuses sont limitées) et limiteur en mémoire (non partagé, remis à zéro au redémarrage). | Volontaire (une seule instance). Une règle Cloudflare (rate limiting / WAF) devant le tunnel est la vraie protection contre un abus distribué : action infrastructure. |
| FAIBLE | Liste d'opposition globale : tout utilisateur peut, en important un CSV contenant une adresse puis en la marquant « refusé », l'ajouter à la liste commune (empoisonnement possible). | Comportement **voulu** (demande produit). Risque limité à l'effet « ne plus contacter ». À surveiller via le journal d'administration. |
| FAIBLE | Cookie de session sans préfixe `__Host-`. | Gain marginal ; changer le nom déconnecterait les utilisateurs. |
| INFO | HSTS sans `includeSubDomains` ni `preload`. | Volontaire : n'activer que si tous les sous-domaines de `iaboss.fr` sont en HTTPS. |

## 5. Tests exécutés

- `npm run lint` : OK (124 fichiers).
- `npm test` : 384 tests, **383 réussis, 0 en échec, 1 ignoré d'office**. Les 6 échecs qui existaient avant l'audit étaient des tests périmés ou dépendants du réseau (DNS réel injoignable ici ; plafonds en $ désormais réservés aux clés API ; fin de quota fictive dans le passé ; SMTP commun retiré) : ils sont corrigés, aucun code applicatif n'a été modifié pour cela.
- `npm audit` : 0 vulnérabilité (avant : 1 paquet « high », nodemailer).
- Nouveau fichier `test/security.test.js` (9 tests) : `GET //` ne fait plus tomber le processus ; `%zz` et cookie mal encodé ; JSON invalide → 400 sans trace ; `no-store` / CORP / CSP / nosniff ; aucune écriture en GET ; limitation de la désinscription ; injection SQL (recherche et tri) traitée comme du texte ; hachage des sessions (la base ne contient que l'empreinte, l'empreinte seule n'ouvre aucune session, la déconnexion la supprime) et migration des sessions existantes sans double hachage. **Vérifié : 5 de ces tests échouent sans les correctifs** (les 2 autres sont des garde-fous sur un comportement déjà correct).
- Contrôle manuel TLS d'une connexion SMTP épinglée avec nodemailer 10 : le nom d'hôte est bien envoyé en SNI et un certificat non fiable est refusé (la vérification TLS n'est pas affaiblie).
- Recherche de secrets dans les fichiers suivis par Git (motifs de clés connues) : aucun. Le seul motif trouvé est une fausse clé de test. Aucun `.env`, clé, dump ou base dans l'historique.

## 6. Risques résiduels

Un abus distribué (DDoS) n'est pas arrêté par le limiteur local. Le bac à sable de Claude (exécution d'un CLI sur du contenu de dépôts tiers) reste la surface la plus sensible : il n'a pas pu être testé ici. La mise à jour majeure de nodemailer (6 → 10) est validée par les tests et un contrôle TLS, mais **pas contre un vrai serveur SMTP** : envoyer un mail de test après déploiement.

## 7. Actions manuelles / contrôles impossibles depuis cet environnement

1. Après déploiement : envoyer un mail de test (SMTP projet et `SYSTEM_SMTP_*`) pour valider nodemailer 10.
2. Vérifier en production : `NODE_ENV=production`, `TRUST_PROXY=true` (sinon tous les visiteurs partagent une IP), `ALLOW_PRIVATE_HOSTS` absent ou `false`, reCAPTCHA configuré, `SECRET_KEY` de 64 hexadécimaux **propre à la production** et sauvegardée à part.
3. MySQL : l'utilisateur applicatif ne doit avoir que `SELECT/INSERT/UPDATE/DELETE` (+ DDL le temps des migrations) sur sa base, écouter en local, mot de passe fort. Non vérifiable ici.
4. Cloudflare : TLS « Full (strict) », « Always HTTPS », règle de rate limiting sur `/auth/*` et `/u/*`, WAF géré activé. Vérifier que le port 3100 n'est joignable que depuis la machine.
5. Sauvegardes : le script `deploy/aitools-backup.sh` n'a pas été exécuté ; vérifier qu'elles sont chiffrées et hors du dépôt, et tester une restauration.
6. Vérifier avec un scanner d'en-têtes externe (securityheaders.com) sur l'URL publique : à lancer avec ton accord, non fait ici.
7. Avant déploiement sur MySQL : la migration `session_id_hashing` a été testée sur SQLite uniquement (pas de MySQL ici). Sauvegarder la base, déployer, puis vérifier qu'une session ouverte avant le déploiement reste valide.

## 8. Recommandations production

- Déployer V1/V2 en priorité (disponibilité + dépendance).
- Brancher une alerte sur les redémarrages systemd du service et sur les lignes `[http]` / 5xx.
- Activer Dependabot ou un `npm audit` hebdomadaire.
- Garder `.env` en `chmod 600`, propriétaire du service uniquement.

## 9. Points relevant d'une validation juridique (non techniques)

Conservation des données, durées, mentions RGPD, base légale de la prospection B2B, liste d'opposition globale : traités côté produit (pages légales, suppression de compte, purge d'inactivité) mais **la conformité RGPD n'est pas certifiée par cet audit** et demande une validation juridique.

## 10. Addendum : nouvelles surfaces (23 octobre 2026)

Ajoutées après l'audit initial ; relues et testées localement, **non auditées par un tiers**.

| Surface | Mesures | Risque résiduel |
|---|---|---|
| API v1 (mode développeur) | Jeton `Bearer` seul (jamais de cookie, aucun CORS), SHA-256 en base, affiché une fois, 5 par compte, droits `read` / `write` / `jobs`, mode désactivable (coupe tout), limites par IP puis par compte, même contrôle d'accès que le panel, `404` pour les ressources d'autrui, envoi de mails refusé sans `confirm: true` | Un jeton `jobs` volé permet d'envoyer des mails depuis le compte : donner `jobs` seulement si nécessaire, révoquer au moindre doute |
| Serveur MCP | Aucun droit propre, mode lecture seule, jeton masqué dans les erreurs, contenus de tiers signalés comme données | Injection de prompt par le texte d'une réponse de prospect : Claude doit rester sous le contrôle de l'utilisateur pour les actions d'écriture |
| Canaux Slack / Telegram / e-mail | Hôtes fixes validés par motif (pas de SSRF), secrets chiffrés et jamais réaffichés, e-mail depuis le SMTP du serveur avec plafond horaire, titre nettoyé (pas d'injection d'en-tête) | Un webhook Slack ou un jeton Telegram fuité permet d'écrire dans ce canal |
| Lien iCal | Jeton de 256 bits, chiffré en base, régénérable, `404` identique pour tout lien inconnu, limite par IP, compte suspendu = lien coupé, contenu limité aux actions et posts du compte | Le lien est un secret porteur : quiconque l'a lit l'agenda (à régénérer s'il fuit) |
| Prompts modifiables | Seules les consignes se modifient ; contexte, format de réponse et règles légales de collecte restent dans le code ; 4 000 caractères au plus ; propres à chaque compte | Un prompt mal écrit dégrade la qualité des résultats de ce compte, pas la sécurité |
| Réponses lues dans la boîte | Texte borné (3 000 caractères), échappé à l'affichage, classement local (aucun appel externe), refus écrit = opposition | Le classement par mots-clés peut se tromper : l'utilisateur relit |
| Posts LinkedIn programmés | Confirmation obligatoire, réservé aux administrateurs du projet, verrou anti double publication, un échec remet en brouillon (jamais de nouvelle tentative en boucle) et prévient | Publication jusqu'à ~15 minutes après l'heure (cadence du planificateur) |

## 11. Addendum : audit du 16 novembre 2026

Relecture du pipeline IA (lanceurs de CLI, worker, handlers, page IA), des routes ajoutées depuis octobre et du front. Tests locaux seulement (SQLite, faux CLI, Chromium) : rien contre la production, MySQL, bwrap ni un vrai fournisseur d'IA.

| # | Gravité | Problème | Emplacement | État |
|---|---|---|---|---|
| V10 | FAIBLE | Injection HTML : les valeurs « Utilisateurs » et « Clients payants » du Récapitulatif viennent de la base du projet (requête SQL configurée) et étaient insérées sans échappement. La CSP bloque tout script ; restait l'injection de balises (lien, formulaire vers une origine autorisée) visible du propriétaire et des administrateurs du projet. | `public/app-recap.js` | **Corrigé**, vérifié dans Chromium (`scripts/recap-check.mjs`, échoue sans le correctif) |
| V11 | FAIBLE (disponibilité, coût) | Un job annulé juste avant le lancement du CLI tournait jusqu'au bout (le signal déjà annulé n'était pas lu) ; un CLI qui ignorait SIGTERM n'était jamais tué. | `src/services/providers/childio.js` | **Corrigé et testé** (`test/childio.test.js`) |
| V12 | FAIBLE (disponibilité) | Planificateur : l'erreur d'un seul projet (donnée illisible) arrêtait tout le passage pour tous les comptes (relances, posts LinkedIn programmés, rapports, entretien). | `src/services/scheduler.js` | **Corrigé et testé** (`test/followup.test.js`) |

Contrôlés sans défaut trouvé : accès par identifiant (aucune lecture ni écriture sur une ressource d'un autre compte), redirections (cibles fixes), exports CSV (formules neutralisées), jetons d'API, signature Stripe, scènes HTML écrites par l'IA (CSP, résolution DNS coupée, requêtes bloquées), téléversements (type lu à la signature), `npm audit` (0 vulnérabilité).

Non vérifié cette fois encore : bac à sable bwrap en conditions réelles, MySQL 8, configuration Nginx / Cloudflare, vrais flux OAuth, vrais CLI d'IA. Les risques résiduels des sections 4 et 6 restent valables.

## 12. Addendum : audit du 24 novembre 2026 (mise en production publique)

Audit complet de l'état de `main` (commit `2df9df8`) puis des corrections de cette PR. Méthode : relecture du code, tests dynamiques **locaux** (serveur de test, bases jetables, données fictives), recherche de secrets dans les 1 247 commits de toutes les branches, `npm audit`, audit des licences, vérification des en-têtes sur un serveur local. **Rien contre la production, aucun service externe.**

Niveaux : **P0** critique (mise en production interdite) · **P1** à corriger avant la production · **P2** à corriger ou à accepter par écrit · **P3** amélioration.

### 12.1 Problèmes trouvés et corrigés

| # | Niveau | Problème | Où | Correction | Preuve |
|---|---|---|---|---|---|
| V13 | **P1** | Aucune sauvegarde de la base **MySQL** de production : le seul script (`aitools-backup.sh`) ne sait faire que SQLite, et rien ne sauvegarde les fichiers des comptes (justificatifs, pièces jointes, vidéos). Aucune restauration jamais testée. | `deploy/` | `aitools-backup-mysql.sh` (chiffré avec une clé publique `age`, refuse de tourner sans chiffrement, mot de passe hors ligne de commande, rotation), `aitools-restore-check.sh` (base temporaire, jamais la production) | `test/backup-scripts.test.js` ; job CI « backup » : sauvegarde puis restauration réelles sur MariaDB 10.11 |
| V14 | **P1** | Un compte **administrateur** (liste des comptes, suspension, suppression de compte) n'avait que Google ou Apple comme protection, sans second facteur. | `src/server.js` | L'A2F est exigée pour toute route d'administration (`ADMIN_REQUIRE_MFA`, actif par défaut) | `test/mfa.test.js` (« le back-office exige l'A2F ») |
| V15 | P2 | A2F : le nombre de codes essayés n'était limité que par adresse IP et par session « en attente » : une session volée pouvait deviner un code de 6 chiffres depuis plusieurs adresses. | `src/mfaroutes.js` | Plafond par **compte** : 10 codes / 15 minutes, connexion, désactivation et codes de secours confondus | `test/mfa.test.js` |
| V16 | P2 | A2F : la session « en attente » devenait la session connectée avec **le même identifiant** (fixation de session). | `src/mfaroutes.js` | Nouvel identifiant émis, l'ancien supprimé | `test/mfa.test.js` |
| V17 | P2 | RGPD art. 15 et 20 : pas d'export complet des données en libre-service (CSV des prospects et de la compta seulement, « écris-nous » pour le reste). | `src/services/dataexport.js` | « Mes données » : fichier JSON de toutes les tables du compte, sans aucun secret, 3 par heure ; toute nouvelle table doit être classée (exportée ou exclue avec raison) | `test/dataexport.test.js` |
| V18 | P2 | Politique de confidentialité inexacte : « aucune statistique de visite » (faux depuis les compteurs d'audience), données de l'A2F et journal de sécurité non mentionnés. | `src/site/legal.js` | Textes et durées corrigés | `test/site.test.js` |
| V19 | P2 | Aucun contrôle automatique des secrets, des licences, des vulnérabilités ni inventaire des composants ; pas de mise à jour automatique des dépendances. | `.github/` | Workflow « Sécurité » (secrets fichiers + historique, licences, `npm audit`, SBOM CycloneDX), hebdomadaire et à chaque PR ; Dependabot | `test/security-tools.test.js` |
| V20 | P3 | Aucun journal de sécurité exploitable (échecs de code, A2F, exports). | `src/securitylog.js` | Lignes JSON sur la sortie standard, sans secret ni e-mail, IP tronquée | `test/mfa.test.js` |
| V21 | P3 | Aucune garantie qu'une nouvelle route non protégée soit détectée. | `test/route-security.test.js` | Chaque route est essayée sans compte, avec un compte ordinaire (404 sur le back-office), sans l'origine (CSRF) ; une route publique nouvelle fait échouer le test | `test/route-security.test.js` |

### 12.2 Contrôlés sans défaut trouvé (preuve dans les tests ou la lecture du code)

Secrets : aucun dans les fichiers suivis ni dans l'historique (les 33 occurrences de motifs trouvées sont des valeurs factices de tests, revues une à une). En-têtes : CSP stricte, HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, `Cache-Control: no-store`, ni `Server` ni `X-Powered-By`. Fichiers sensibles : `/.env`, `/.git/*`, `/package.json`, `/src/*`, `/deploy/*`, `/data/`, traversées de chemin (`..%2f`, `%2e%2e`) répondent tous 404. Webhook Stripe : signature HMAC comparée à temps constant, tolérance de date, idempotence par identifiant d'événement, état relu chez Stripe. Connexion : `email_verified` exigé. Dépendances : `npm audit` 0 vulnérabilité, 49 paquets de production, toutes licences autorisées. Les 228 routes : voir V21.

### 12.3 Risques ouverts (non corrigés) et décision

| Niveau | Sujet | Pourquoi | Action |
|---|---|---|---|
| **P1** | Configuration réelle de la production non vérifiée : MySQL (droits du compte, écoute), Nginx / CloudPanel / Cloudflare (TLS, WAF, rate limiting), `.env`, port de l'application | Inaccessible depuis cet environnement | À faire par le propriétaire, voir `PRODUCTION_CHECKLIST.md` |
| **P1** | Sauvegardes à installer et restauration à rejouer **sur le vrai serveur** | Les scripts sont livrés et testés en CI, pas installés | `BACKUP_RESTORE.md` |
| **P1** | Validation juridique : CGU, mentions, confidentialité, applicabilité du droit de la consommation aux petits professionnels, AI Act, facturation électronique | Je ne peux pas valider une obligation juridique | `LEGAL_COMPLIANCE.md` |
| P2 | Test d'intrusion / DAST (ZAP, Burp) sur un environnement de test | Aucun scanner disponible ici | Non exécuté |
| P2 | Bac à sable bwrap des exécutions de Claude, MySQL 8, vrais flux OAuth Google/Apple avec A2F, vrais CLI d'IA | Non testables ici | Tests manuels avant ouverture |
| P2 | Limiteur de débit en mémoire (une instance) | Un abus distribué se traite chez Cloudflare | Règle de rate limiting |
| P3 | HSTS sans `includeSubDomains` / `preload` ; actions GitHub épinglées par version et non par empreinte ; session de 30 jours sans expiration d'inactivité ; course bénigne entre deux événements Stripe identiques simultanés (l'application d'un abonnement est idempotente) | Voir `SECURITY_ACTION_PLAN.md` | Accepté ou planifié |
