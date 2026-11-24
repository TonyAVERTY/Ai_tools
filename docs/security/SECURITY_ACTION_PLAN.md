# Plan d'action de sécurisation

Date : 24 novembre 2026. Ordre = priorité, en tenant compte des dépendances. **Qui** : « Claude » = fait dans le dépôt et vérifié ; « Tony » = action sur le serveur, un service externe ou une décision qui ne peut pas être prise depuis le dépôt.

## Lot 1 : à faire avant toute ouverture au public (P1)

| # | Action | Qui | État | Dépend de |
|---|---|---|---|---|
| 1 | Renouveler le mot de passe de la base MySQL (il a fuité dans une conversation) puis le mettre à jour dans `.env` ; redémarrer | Tony | **À faire** | — |
| 2 | Vérifier `NODE_ENV=production`, `TRUST_PROXY=true` (ou les adresses du proxy), `ALLOW_PRIVATE_HOSTS` absent, `SECRET_KEY` propre à la production, reCAPTCHA configuré, `.env` en `chmod 600` | Tony | **À faire** | — |
| 3 | MySQL : compte applicatif limité à sa base, droits `SELECT/INSERT/UPDATE/DELETE` (+ DDL le temps des migrations), écoute locale | Tony | **À faire** | 1 |
| 4 | Cloudflare : TLS « Full (strict) », HTTPS forcé, règle de rate limiting sur `/auth/*`, `/u/*`, `/login/2fa`, WAF géré ; port de l'application non joignable de l'extérieur | Tony | **À faire** | — |
| 5 | Activer l'A2F sur le compte administrateur (obligatoire pour `/admin`) et ranger ses codes de secours | Tony | **À faire** au prochain déploiement | déploiement |
| 6 | **Décision du propriétaire le 24 novembre : non installées, risque accepté (perte totale possible).** Installer les sauvegardes : clé `age` (clé privée **hors du serveur**), `SECRET_KEY` rangée à part, tâche planifiée, **restauration jouée une fois pour de vrai** | Tony | **À faire** | `BACKUP_RESTORE.md` |
| 7 | Relecture juridique : mentions légales, CGU, confidentialité, applicabilité du droit de la consommation aux petits professionnels, AI Act, facturation électronique | Tony (avocat / juriste) | **À faire** | `LEGAL_COMPLIANCE.md` |
| 8 | Envoyer un mail de test (SMTP projet et `SYSTEM_SMTP_*`) après déploiement | Tony | **À faire** | déploiement |
| 9a | **Constaté sur le serveur** : l'application écoute sur toutes les interfaces (`*:3100`) : vérifier `HOST` (`.env`, environnement de `pm2`, variable `HOST` du shell) et la ramener à `127.0.0.1` | Tony | **À faire (P1)** | — |
| 9b | **Constaté sur le serveur** : MySQL écoute sur `0.0.0.0:3306` et `*:33060` : `bind-address` et `mysqlx-bind-address` à `127.0.0.1`, ou pare-feu | Tony | **À faire (P1)** | — |
| 9c | **Constaté** : `X-Frame-Options` (deux valeurs), `X-Content-Type-Options` et `Referrer-Policy` envoyés deux fois : retirer les `add_header` du vhost Nginx | Tony | À faire | — |
| 9e | **Constaté** : SSH (port 2006) avec mot de passe et `root` autorisés, ouvert à tout Internet. **Mot de passe conservé par choix du propriétaire (risque accepté)** : mot de passe `root` aléatoire long, fail2ban (port 2006), `MaxAuthTries 3`, `LoginGraceTime 30` ; recommandé : limiter 2006 à ses adresses | Tony | **À faire (compensations)** | — |
| 9d | Vérifier depuis l'extérieur les ports 21, 25, 2006, 3000, 6081, 8080, 8443 ; restreindre 8443 (CloudPanel) à ton adresse, désactiver FTP si inutile | Tony | À faire | — |
| 9 | Tester le QR code de l'A2F avec une vraie application d'authentification, et une connexion Google réelle avec A2F | Tony | **À faire** | déploiement |

## Lot 2 : avant l'ouverture, ou risque accepté par écrit (P2)

| # | Action | Qui | État |
|---|---|---|---|
| 10 | Test d'intrusion ou scan dynamique (OWASP ZAP baseline) sur un environnement de test | Tony / prestataire | Non fait |
| 11 | Tester le bac à sable bwrap sur le vrai serveur (écriture hors dossier refusée, réseau coupé comme prévu) | Tony | Non fait |
| 12 | Brancher une alerte sur les redémarrages du service, les erreurs 5xx et les lignes `"type":"security"` du journal | Tony | Non fait (`MAINTENANCE_PLAN.md`) |
| 13 | Rotation des journaux (12 mois au plus, comme annoncé dans la politique de confidentialité) | Tony | Non fait |
| 14 | Conclure ou vérifier les contrats de sous-traitance (Stripe, hébergeur, fournisseurs d'IA) | Tony | À vérifier (`THIRD_PARTY_SERVICES.md`) |
| 15 | Décider de l'AIPD et du registre des traitements (voir `RGPD_COMPLIANCE.md`) | Tony | À décider |

## Lot 3 : améliorations (P3)

| # | Action | Qui | État |
|---|---|---|---|
| 16 | HSTS avec `includeSubDomains` / `preload` (seulement si tous les sous-domaines de `iaboss.fr` sont en HTTPS) | Tony | Volontairement non activé |
| 17 | Épingler les actions GitHub par empreinte de commit | Claude (dès que Dependabot propose les empreintes) | Non fait |
| 18 | Expiration de session après inactivité (aujourd'hui 30 jours fixes) | Claude | Non fait, à discuter (confort contre sécurité) |
| 19 | Préfixe `__Host-` du cookie de session | Claude | Non fait (déconnecterait tous les utilisateurs) |
| 20 | Limiteur de débit partagé (Redis) si plusieurs instances un jour | Claude | Sans objet tant qu'il n'y a qu'une instance |

## Règle de suivi

Chaque ligne passe à **Fait** avec sa preuve (test, capture, commande et date). Une ligne du lot 1 ouverte = **NO-GO** (voir `PRODUCTION_READINESS.md`).
