# Historique des corrections de sécurité

Une ligne par correction, la plus récente en haut. Le détail technique est dans `SECURITY_AUDIT.md` ; les preuves dans `SECURITY_TESTS.md`.

## 24 novembre 2026 (PR « audit complet »)

- **N1** Implémentation d'une idée acceptée : écriture dans le dépôt de l'utilisateur. Exception unique et bornée à « pas d'Edit ni de Write pour l'IA » (voir `.claude/rules/donnees-personnelles.md`) : réglage de compte « Implémenter automatiquement les idées acceptées » décoché par défaut (activé : lancement dès l'acceptation, toujours sur une nouvelle branche ; désactivé : question à l'acceptation, jamais d'écriture sans réponse « oui » ou choix « oui » retenu par la personne ; un choix retenu ne vaut jamais pour la branche principale), Claude seulement, copie jetable sans `.git`, `Bash` toujours interdit, vérification de tout ce qui est écrit (chemins, secrets, volume, liens symboliques), commit et push faits par le code de l'application, jamais de push forcé, token Git de l'utilisateur seulement, propriétaire ou administrateur du projet, limite de débit, un seul job à la fois par projet.

- **V13** Sauvegarde MySQL chiffrée et test de restauration (`deploy/aitools-backup-mysql.sh`, `deploy/aitools-restore-check.sh`), jouée pour de vrai en CI sur MariaDB.
- **V14** A2F obligatoire pour accéder à `/admin` (variable `ADMIN_REQUIRE_MFA`, actif par défaut).
- **V15** Plafond de 10 codes A2F par compte et par 15 minutes.
- **V16** Nouvel identifiant de session après la saisie du code A2F.
- **V17** Export complet des données du compte (« Mes données »), avec garde-fou : toute nouvelle table doit être classée.
- **V18** Politique de confidentialité corrigée (compteurs d'audience, données et journal de l'A2F).
- **V19** Workflow « Sécurité » (secrets, licences, vulnérabilités, SBOM) et Dependabot.
- **V20** Journal de sécurité JSON (`src/securitylog.js`).
- **V25** Limites de longueur sur tous les champs de saisie (54 champs encadrés), garde unique côté serveur (`readBody`), champs de code A2F stricts (6 caractères, secours 11).
- **V24** Mesure d'audience : plafond de 200 sites d'origine distincts par jour (nouvel audit des corrections).
- **V23** Export des données : les secrets chiffrés stockés en lignes de `user_settings` et dans des blocs JSON ne sortent plus (nouvel audit des corrections).
- **V22** Cookie `li_oauth_b` (liaison LinkedIn) ajouté au tableau des cookies de la politique de confidentialité ; un test vérifie désormais que tout cookie posé par le code y figure.
- **V21** Test de couverture des routes (`test/route-security.test.js`).

## 20 novembre 2026

- A2F par application d'authentification (TOTP, RFC 6238), codes de secours, appareils de confiance (cookie `mfa_td`, empreinte en base).
- Cookies : thème (`theme`), mesure d'audience sans cookie ni identifiant (compteurs par jour et par page, « Ne pas me suivre » respecté, purge à 13 mois).
- Statistiques globales réservées aux administrateurs (aucune donnée de compte).
- Jeton d'API : affiché une seule fois dans une fenêtre, masqué partout ailleurs (`iaboss_*************`), préfixe stocké réduit à `iaboss_`.
- Avertissement dans la console du navigateur contre le copier-coller piégé (self-XSS).

## 16 novembre 2026

- V10 injection HTML dans le Récapitulatif, V11 annulation des CLI d'IA, V12 planificateur qui s'arrêtait pour tous à cause d'un seul projet (voir `SECURITY_AUDIT.md` §11).

## 23 octobre 2026

- V1 arrêt du processus par `GET //`, V2 `nodemailer` 6 vers 10, V3 `Cache-Control: no-store`, V4 requêtes mal encodées, V5 limite sur la désinscription, V6 page d'erreur, V7 `Cross-Origin-Resource-Policy`, V8 garde global, V9 identifiants de session hachés en base.
