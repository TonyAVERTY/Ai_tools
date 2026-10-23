# Checklist de sécurité AiTools

`[x]` vérifié avec preuve (test ou lecture du code) · `[ ]` à effectuer · `[!]` problème ou validation nécessaire.
Détails et preuves : `SECURITY_AUDIT.md`.

## Application
- [x] Pas de SQL concaténé avec des données utilisateur (fragments dynamiques en liste blanche) — lecture du code + test d'injection
- [x] Sorties HTML échappées côté serveur et côté navigateur (`esc`, Markdown échappé avant mise en forme) — lecture du code
- [x] CSP stricte sans script ni style en ligne — `src/site/seo.js`
- [x] CSRF : `SameSite=Lax` + contrôle `Origin` sur toute écriture ; aucune écriture en GET — test
- [x] Contrôle d'accès serveur par ressource, 404 pour les ressources d'autrui — tests d'isolation existants
- [x] SSRF : adresses privées refusées, IP épinglée (SMTP, IMAP, BDD, git) — `netguard.js` + tests existants
- [x] Pas d'injection de commandes (spawn sans shell, git durci, bac à sable) — lecture du code
- [x] Requêtes mal formées (`//`, `%zz`, cookie, JSON) ne font plus tomber ni ne polluent le serveur — `test/security.test.js`
- [x] Pages et API privées en `no-store` — test
- [x] Désinscription : jeton HMAC + limitation de débit — test
- [x] Identifiants de session hachés en base (SHA-256), sessions existantes conservées — test
- [ ] Vérifier la migration `session_id_hashing` sur MySQL (testée sur SQLite seulement)
- [x] Suite de tests complète verte (383 réussis, 0 échec, 1 test ignoré d'office), plus de test dépendant du réseau DNS dans `test/http.test.js`

## Authentification et sessions
- [x] OIDC : state, nonce, PKCE, liaison navigateur, signature RS256, iss/aud/exp — lecture + tests existants
- [x] Aucun mot de passe stocké
- [x] Cookie `HttpOnly; Secure; SameSite=Lax`, session supprimée à la déconnexion et à la suspension
- [x] Messages d'erreur de connexion sans fuite technique
- [ ] Préfixe `__Host-` du cookie (gain marginal)

## Dépendances et secrets
- [x] `npm audit` : 0 vulnérabilité (nodemailer 10.2.1)
- [x] Aucun secret ni fichier sensible dans les fichiers suivis ni dans l'historique Git
- [x] `.env`, clés, dumps ignorés par `.gitignore`
- [x] Secrets en base chiffrés (AES-256-GCM), jamais réaffichés
- [ ] Envoi d'un mail de test avec nodemailer 10 après déploiement
- [ ] Planifier un `npm audit` régulier

## Infrastructure (à vérifier sur le serveur)
- [ ] `NODE_ENV=production`, `TRUST_PROXY=true`, `ALLOW_PRIVATE_HOSTS` désactivé, reCAPTCHA configuré
- [ ] Port 3100 non joignable depuis l'extérieur
- [ ] MySQL : compte applicatif au moindre privilège, écoute locale
- [ ] Cloudflare : TLS strict, HTTPS forcé, rate limiting `/auth/*` et `/u/*`, WAF
- [ ] Sauvegardes chiffrées et restauration testée
- [ ] HSTS étendu (`includeSubDomains`) seulement si tous les sous-domaines sont en HTTPS
- [ ] Alerte sur les redémarrages du service et les erreurs 5xx

## Données personnelles
- [!] Conformité RGPD : validation juridique nécessaire (non certifiée par l'audit technique)
