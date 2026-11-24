# Checklist avant mise en ligne publique

Date : 24 novembre 2026. `[x]` fait et prouvé · `[ ]` à faire (par toi, sur le serveur ou chez un tiers) · `[!]` blocage ou validation humaine nécessaire.
**Une case `[ ]` ou `[!]` d'une section « Bloquant » = NO-GO.** Détails et preuves : `SECURITY_AUDIT.md`, `SECURITY_TESTS.md`.

## A. Déjà vérifié dans le dépôt (preuves)

### Application
- [x] SQL préparé partout, fragments dynamiques en liste blanche : `test/security.test.js`
- [x] Sorties échappées, CSP stricte sans script ni style en ligne : `test/security.test.js`, `scripts/recap-check.mjs`
- [x] CSRF : `SameSite=Lax` + contrôle `Origin` sur **toute** écriture authentifiée : `test/route-security.test.js`
- [x] **Aucune route non publique ne répond à un visiteur** ; liste blanche des routes publiques : `test/route-security.test.js`
- [x] Back-office : 404 pour un compte ordinaire, **A2F exigée** pour un administrateur : `test/admin.test.js`, `test/mfa.test.js`
- [x] Cloisonnement des données entre comptes : `test/isolation.test.js`
- [x] SSRF : adresses privées refusées, IP épinglée : `test/netguard.test.js`
- [x] Requêtes malformées sans arrêt du processus ni trace : `test/security.test.js`
- [x] Fichiers sensibles non servis (`/.env`, `/.git`, `/package.json`, `/src`, `/deploy`, traversées de chemin) : vérifié sur serveur local (rapport §12.2)

### Authentification
- [x] OIDC (state, nonce, PKCE, liaison navigateur, signature RS256, `email_verified`), aucun mot de passe stocké : `test/auth.test.js`
- [x] Sessions : identifiant aléatoire 256 bits, empreinte SHA-256 en base, cookie `HttpOnly; Secure; SameSite=Lax`, 30 jours
- [x] A2F (TOTP, codes de secours, plafond par compte, nouvel identifiant de session, appareils de confiance) : `test/mfa.test.js`

### Données
- [x] Secrets chiffrés AES-256-GCM, jamais réaffichés ; jetons d'API et sessions en empreinte
- [x] Export complet des données (RGPD) sans secret, chaque table classée : `test/dataexport.test.js`
- [x] Suppression de compte en cascade vérifiée : `test/schema.test.js`
- [x] Sauvegarde chiffrée + restauration réelle sur MariaDB en CI : job « backup »
- [x] Aucun secret dans les fichiers ni dans l'historique : `npm run security:history` (CI à chaque PR et chaque semaine)

### Dépendances
- [x] `npm audit` : 0 vulnérabilité ; 4 dépendances directes ; licences toutes autorisées : `npm run security`
- [x] SBOM CycloneDX produit par la CI ; Dependabot actif (à activer côté GitHub si l'interface le demande)

### Documentation
- [x] Politique de confidentialité alignée sur le code (données, durées, cookies, destinataires)
- [x] Support utilisateur à jour (`docs/support/`, testé par `test/support-docs.test.js`)

## B. Bloquant : à faire avant d'ouvrir au public

### Secrets et configuration
- [ ] **Mot de passe MySQL renouvelé** (il a fuité dans une conversation) et mis à jour dans `.env`
- [ ] `NODE_ENV=production`, `APP_URL` exact, `TRUST_PROXY` correct, `ALLOW_PRIVATE_HOSTS` absent, `SECRET_KEY` de production sauvegardée **à part**
- [ ] `.env` en `chmod 600`, propriétaire du service seul
- [ ] reCAPTCHA configuré ; clés Stripe **live** ; webhook Stripe pointant vers l'adresse de production
- [ ] **A2F activée sur le compte administrateur** (sinon l'Administration est inaccessible)

### Serveur et réseau
- [ ] Cloudflare : TLS « Full (strict) », HTTPS forcé, WAF géré, règle de rate limiting sur `/auth/*`, `/u/*`, `/login/2fa`
- [ ] Port de l'application **non joignable** depuis l'extérieur (`ss -ltnp`, test depuis une autre machine)
- [ ] MySQL : compte applicatif aux droits minimaux, écoute locale, mot de passe fort
- [ ] Bac à sable bwrap installé et **testé** (écriture hors dossier refusée) : `NODE_ENV=production`
- [ ] `curl -sI https://iaboss.fr/login` : en-têtes de sécurité présents, pas de `Server` ni `X-Powered-By` ; `https://iaboss.fr/.env` → 404

### Sauvegardes et reprise
- [ ] Clés `age` créées, clé privée **hors du serveur** ; sauvegarde planifiée et copiée hors du serveur
- [ ] `aitools-restore-check.sh` joué sur une sauvegarde **réelle** (`RESTAURATION VÉRIFIÉE`)
- [ ] Alerte si aucune sauvegarde depuis 36 heures

### Surveillance
- [ ] Alerte sur les redémarrages du service, les erreurs 5xx et les lignes `"type":"security"` du journal
- [ ] `pm2 save` fait ; redémarrage automatique au démarrage de la machine (`pm2 startup` ou systemd)
- [ ] Rotation des journaux (12 mois au plus)

### Juridique et conformité
- [!] **Validation juridique** des mentions légales, de la politique de confidentialité, des CGU / CGV
- [!] **Avenant de traitement (art. 28 RGPD)** rédigé par un juriste (lacune des CGU)
- [!] Applicabilité du droit de la consommation / droit de rétractation tranchée
- [!] Obligations de transparence de l'AI Act (contenus générés, voix synthétique) tranchées
- [ ] Registre des traitements tenu ; décision DPO / AIPD notée
- [ ] DPA et mécanismes de transfert vérifiés pour chaque fournisseur (`THIRD_PARTY_SERVICES.md`)

## C. Recommandé avant l'ouverture, ou risque accepté par écrit

- [ ] Test d'intrusion / scan dynamique (OWASP ZAP baseline) sur un environnement de test
- [ ] Un mail de test après déploiement (nodemailer 10)
- [ ] Scanner d'en-têtes externe (securityheaders.com) sur l'URL publique
- [ ] Test du QR code A2F avec une vraie application d'authentification ; connexion Google et Apple réelles avec A2F
- [ ] `/.well-known/security.txt` publié (adresse de signalement)
- [ ] Déclaration d'accessibilité, si l'obligation s'applique

## D. Après la mise en ligne

- [ ] Surveiller les journaux 48 heures ; vérifier la première sauvegarde automatique
- [ ] Rejouer ce document à chaque version majeure ; mettre à jour `SECURITY_CHANGELOG.md`
