# Résultats des tests et preuves de validation

Date : 24 novembre 2026. **Un test non exécuté est écrit « non exécuté ». Rien n'est falsifié.** Les chiffres de la dernière exécution complète sont en §1 ; ce qui n'a pas pu être testé est en §4.

## 1. Dernière exécution complète (poste de travail, SQLite, Chromium local)

| Contrôle | Résultat | Commande |
|---|---|---|
| Syntaxe de tous les fichiers (lint) | `[À COMPLÉTER : résultat final de la dernière exécution]` | `npm run lint` |
| Suite de tests (parallèles + sérialisés) | `[À COMPLÉTER : résultat final]` | `npm test` |
| Vérifications d'interface dans Chromium (contrastes clair et sombre, débordements, parcours) | `[À COMPLÉTER : résultat final]` | `npm run ui:check` |
| Secrets (fichiers suivis et historique complet) | Aucun détecté ; faux positifs connus documentés dans `scripts/secret-scan-baseline.json` | `npm run security:history` |
| Licences des dépendances de production | 49 paquets, toutes autorisées | `npm run security:licenses` |
| Vulnérabilités connues (production) | 0 | `npm run security:audit` |

La CI rejoue tout à chaque PR : jobs « check » (SQLite), « mysql » (MariaDB 10.11), « ui » (Chromium), et le workflow « Sécurité » (secrets, licences, audit, SBOM, sauvegarde réelle).

## 2. Tests de sécurité par domaine

| Domaine | Fichiers | Ce qui est démontré |
|---|---|---|
| Authentification | `test/auth.test.js` | OIDC : `state`, `nonce`, PKCE, liaison au navigateur, signature RS256, `email_verified` |
| A2F | `test/mfa.test.js` | Vecteur RFC 6238 ; un code ne sert qu'une fois ; session « en attente » sans accès ; codes de secours à usage unique ; 5 erreurs ferment la session ; **10 codes / 15 min par compte** ; **nouvel identifiant de session** ; appareils de confiance (empreinte, isolation par compte) ; **A2F exigée pour l'administration** ; journal de sécurité sans secret ni e-mail |
| Contrôle d'accès et cloisonnement | `test/isolation.test.js`, `test/route-security.test.js`, `test/admin.test.js` | Chaque route essayée sans compte et avec un compte ordinaire ; 404 sur le back-office ; liste blanche des routes publiques ; **toute écriture sans l'origine de l'application est refusée** ; aucune ressource d'un autre compte accessible |
| CSRF, XSS, injections | `test/security.test.js`, `scripts/recap-check.mjs` | Écriture jamais en GET ; injection SQL traitée comme du texte ; échappement ; CSP ; requêtes malformées |
| SSRF | `test/netguard.test.js` | Adresses privées refusées, IP épinglée |
| Jetons d'API et MCP | `test/api.test.js` | Bearer seul, empreinte, droits, isolation, limites, jeton affiché une fois |
| Paiement | `test/subscriptions.test.js` | Signature de webhook, rejeu, idempotence, mauvais secret refusé |
| Abus | `test/abuse.test.js`, `test/budget.test.js`, `test/plans.test.js` | Plafonds, pauses d'envoi, liste d'opposition, budgets |
| Disponibilité | `test/security.test.js`, `test/childio.test.js`, `test/followup.test.js` | Pas d'arrêt du processus, annulation des CLI d'IA, planificateur isolé par projet |
| Données personnelles | `test/dataexport.test.js`, `test/schema.test.js` | Export complet sans secret ni donnée d'autrui (y compris les secrets rangés en lignes de réglages) ; chaque table classée ; suppression en cascade |
| Cookies et audience | `test/theme.test.js`, `test/audience.test.js` | Cookie de préférence seulement sur choix ; mesure sans cookie ni identifiant ; « Ne pas me suivre » |
| Sauvegarde | `test/backup-scripts.test.js` + job CI « backup » | Refus sans chiffrement ; fichiers chiffrés sans clair ; mot de passe absent de la ligne de commande ; rotation ; restauration dans une base temporaire (jamais la production) ; **restauration réelle sur MariaDB en CI** |
| Outils de contrôle | `test/security-tools.test.js` | Détection de secrets (jamais la valeur affichée), fichiers sensibles, licences ; le dépôt et son historique sont propres |
| Documentation | `test/support-docs.test.js`, `test/wording.test.js`, `test/site.test.js` | Support aligné sur l'interface ; politique de confidentialité et cookies cohérentes |

## 3. Preuves d'efficacité (« le test échoue sans le correctif »)

- V1 à V9 : 5 des 9 tests de `test/security.test.js` échouent sans les correctifs (vérifié lors de l'audit d'octobre).
- V10 : `scripts/recap-check.mjs` échoue sans le correctif (novembre).
- V14 à V16, V20 : **vérifié le 24 novembre** en rejouant `test/mfa.test.js` sur l'état précédent du code (copie temporaire, supprimée ensuite) : 5 tests échouent (plafond par compte, nouvel identifiant de session, passage de la session « en attente » avec cookie neuf, A2F exigée pour l'administration, journal de sécurité), les 6 autres passent. Les tests détectent donc bien l'absence des correctifs.
- V13 : `deploy/aitools-backup.sh` ne gérait que SQLite ; le job CI « backup » prouve que la nouvelle procédure restaure bien une vraie base MariaDB.

## 4. Non exécuté ou non vérifiable depuis cet environnement

| Contrôle | Pourquoi | À faire |
|---|---|---|
| **DAST** (OWASP ZAP, Burp) sur un environnement de test | Aucun scanner disponible ici | Lancer une baseline ZAP sur un environnement de test autorisé |
| Test d'intrusion manuel | Hors périmètre d'un audit local | Prestataire ou revue externe avant l'ouverture publique |
| Bac à sable bwrap en conditions réelles | Nécessite le serveur | Tests manuels (voir `PRODUCTION_CHECKLIST.md`) |
| MySQL 8 | La CI utilise MariaDB 10.11 | Tester si la production est sur MySQL 8 |
| Vrais flux Google et Apple (avec A2F), vrais CLI d'IA, vrai SMTP, vrai Stripe | Services externes interdits à tester ici | Recette sur la préproduction |
| QR code de l'A2F avec une vraie application d'authentification | L'encodeur est vérifié par relecture complète de la matrice et l'exemple de la norme, pas par un lecteur réel | Scanner avec un téléphone |
| Configuration réelle de Nginx, Cloudflare, MySQL, du pare-feu | Inaccessibles | Voir `PRODUCTION_CHECKLIST.md` |
| Restauration de **tes** sauvegardes réelles | Pas de sauvegarde réelle ici | `BACKUP_RESTORE.md` §5 |
| Scanner d'en-têtes externe (securityheaders.com) | Aucun test contre un système externe sans accord | À lancer par toi |

## 5. Journal des tests de restauration réelle (à remplir)

| Date | Sauvegarde utilisée | Machine | Résultat | Par qui |
|---|---|---|---|---|
| `[À COMPLÉTER]` | | | | |
