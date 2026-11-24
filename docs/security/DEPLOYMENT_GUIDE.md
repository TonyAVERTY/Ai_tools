# Déploiement et retour arrière

Date : 24 novembre 2026. **Règle : un déploiement en production n'est jamais automatique.** Les PR sont fusionnées sur `main` par la CI verte ; la mise en production est une action **volontaire et manuelle** de l'exploitant, jamais un effet de la fusion.

## 1. Configuration de production obligatoire (`.env`)

Le fichier `.env` n'est **jamais** dans le dépôt (`.gitignore`), jamais dans les sauvegardes, `chmod 600`, propriétaire = utilisateur du service. Modèle : `.env.example` (sans valeur confidentielle).

| Variable | Valeur attendue en production | Pourquoi |
|---|---|---|
| `NODE_ENV` | `production` | Bac à sable (bwrap) obligatoire pour les jobs IA ; pas de comportements de développement |
| `APP_URL` | `https://iaboss.fr` (l'adresse publique exacte) | Contrôle de l'en-tête `Origin` (CSRF), liens, cookies |
| `HOST`, `PORT` | `127.0.0.1`, port local | L'application n'écoute pas sur Internet |
| `TRUST_PROXY` | `true` (proxy local) ou les adresses du proxy | Sans lui, tous les visiteurs partagent une adresse pour les limites ; avec une valeur trop large, une adresse peut être usurpée |
| `SECRET_KEY` | 64 hexadécimaux **propres à la production**, sauvegardés à part | Chiffre les secrets de la base |
| `DB_HOST/PORT/USER/PASSWORD/NAME` | Compte applicatif limité à sa base, mot de passe fort, hôte local | Moindre privilège |
| `ADMIN_EMAILS` | Adresses des administrateurs | Les seuls comptes admin |
| `ADMIN_REQUIRE_MFA` | absent ou `true` | L'administration exige l'A2F |
| `GOOGLE_CLIENT_ID/SECRET` (et `APPLE_*`) | Valeurs de production | Connexion |
| `RECAPTCHA_SITE_KEY/SECRET` | Renseignés | Protège la connexion des robots |
| `ALLOW_PRIVATE_HOSTS` | **absent** ou `false` | Sinon l'application peut joindre le réseau interne (SSRF) |
| `SANDBOX` | **absent** (ignoré en production) | — |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Clés **live** de l'environnement de production | Paiements |
| `SYSTEM_SMTP_*`, `ERROR_ALERT_TO` | Renseignés | Alertes d'erreur et notifications |
| `INACTIVE_ACCOUNT_MONTHS` | `24` (défaut) ou la valeur annoncée dans la politique de confidentialité | Cohérence avec le texte public |

Vérification rapide après démarrage : le service répond en HTTPS ; `curl -sI https://iaboss.fr/login` montre `content-security-policy`, `strict-transport-security`, `x-content-type-options`, `x-frame-options` et aucun en-tête `Server` / `X-Powered-By` ; `curl -s -o /dev/null -w '%{http_code}' https://iaboss.fr/.env` répond **404**.

## 2. Procédure de mise à jour

Avant : `PRODUCTION_CHECKLIST.md` à jour, CI verte sur `main`, **sauvegarde récente** (§3).

```bash
cd ~/htdocs/iaboss.fr
git fetch origin && git log --oneline -1 origin/main        # noter le commit visé
git checkout -B main origin/main
npm ci --omit=dev
pm2 restart iaboss        # ou : sudo systemctl restart aitools
pm2 logs iaboss --lines 50   # les migrations s'appliquent au démarrage : chercher une erreur
```

Après : ouvrir la page de connexion, se connecter, ouvrir un projet, envoyer un mail de test (si SMTP modifié), vérifier `pm2 logs` sans erreur pendant 10 minutes. Si le processus a disparu de `pm2` (redémarrage de la machine sans `pm2 save`), le relancer avec `pm2 start deploy/ecosystem.config.cjs` (copié à la racine) puis `pm2 save`.

## 3. Avant chaque déploiement qui contient une **migration**

Les migrations (`src/migrations.js`) **ne se défont pas** : on les ajoute toujours à la fin, elles ne contiennent pas de « retour ». Donc :

1. Faire une **sauvegarde de la base juste avant** (`BACKUP_RESTORE.md` §3).
2. Lire la liste des nouvelles migrations (`git diff <ancien>..<nouveau> -- src/migrations.js`) : colonne ou table ajoutée = sans risque pour l'ancien code ; suppression ou conversion de données = risque (aucune aujourd'hui).
3. MySQL 8 n'est pas testé (la CI rejoue sur MariaDB 10.11) : prévenir si la production est sur MySQL 8.

## 4. Retour arrière

### 4.1 Le code seul est en cause (aucune migration dans la mise à jour)

```bash
git checkout -B main <commit précédent connu pour fonctionner>
npm ci --omit=dev
pm2 restart iaboss
```

### 4.2 La mise à jour contient des migrations

Le **code ancien fonctionne en général avec le nouveau schéma** (les migrations ajoutent des colonnes et des tables sans retirer l'existant) : essayer d'abord 4.1. Si la base elle-même est abîmée : arrêter l'application, restaurer la sauvegarde d'avant déploiement (`BACKUP_RESTORE.md` §4.2), revenir au code précédent, redémarrer. **Les données saisies entre le déploiement et le retour arrière sont perdues** : le dire aux utilisateurs.

### 4.3 Un secret ou une configuration est en cause

Remettre l'ancien `.env` (copié avant la modification), redémarrer.

## 5. Ce qu'un déploiement ne fait jamais

Il ne modifie ni la base à la main, ni les secrets, ni les règles Cloudflare, ni les droits MySQL. Toute modification de ces éléments est une opération distincte, notée dans `SECURITY_CHANGELOG.md`.

## 6. Environnements

Développement (`:memory:` SQLite, `SANDBOX=off` toléré), test (CI : SQLite et MariaDB jetables, données fictives), production (MySQL/MariaDB). Ne jamais copier la base de production vers le développement sans l'anonymiser.
