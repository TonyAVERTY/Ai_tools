# Modèle de menaces d'iaboss

Date : 24 novembre 2026. Document interne : il n'est servi par aucune route de l'application (test : `test/route-security.test.js`, les fichiers de `docs/` ne sont pas dans la table des fichiers statiques).

## 1. Ce qu'il faut protéger (actifs)

| Actif | Pourquoi c'est sensible | Où il vit |
|---|---|---|
| Accès à l'IA de l'utilisateur (clé API, jeton d'abonnement Claude, fichier de connexion ChatGPT/Google) | Permet de dépenser l'argent de la personne et de lire ses conversations | Base, chiffré AES-256-GCM avec `SECRET_KEY` |
| `SECRET_KEY` (64 hexadécimaux) | Sa perte rend tous les secrets chiffrés illisibles ; sa fuite les rend lisibles à qui a la base | `.env` du serveur, **jamais** dans les sauvegardes |
| Identifiants SMTP / IMAP, accès base du projet, jetons Forgejo / LinkedIn / Instagram, webhooks | Envoyer des mails au nom de l'utilisateur, lire sa boîte | Base, chiffrés |
| Sessions, jetons d'API, lien iCal | Prise de contrôle d'un compte | Base, empreinte SHA-256 seulement |
| Données de prospects (adresses professionnelles de tiers) et réponses reçues | Données personnelles de tiers, dont iaboss est sous-traitant | Base |
| Comptabilité, factures, justificatifs, conversations IA, pièces jointes | Données financières et confidentielles | Base + fichiers du serveur |
| Back-office (suspendre, supprimer un compte) | Compromettre tous les comptes | Routes `/admin/*` |
| Réputation d'envoi (SMTP des utilisateurs) | Un compte compromis ou abusif fait classer les adresses en spam | Pauses d'envoi, liste d'opposition |

## 2. Qui peut attaquer (acteurs)

1. **Visiteur anonyme** : toute la surface publique (site, connexion, désinscription, webhook, agenda iCal).
2. **Utilisateur authentifié malveillant** : veut lire ou modifier les données d'un autre compte, contourner ses plafonds, faire sortir le serveur vers l'intérieur (SSRF), envoyer du spam.
3. **Détenteur d'une session ou d'un jeton volé** (poste partagé, vol de jeton d'API, fuite de lien iCal).
4. **Tiers qui contrôle du contenu lu par l'IA** : page web d'un prospect, dépôt Git d'un projet, texte d'une réponse reçue, pièce jointe (injection de prompt).
5. **Attaquant qui obtient la base ou une sauvegarde** : veut lire les données, rejouer des sessions.
6. **Compte administrateur compromis**.
7. **Chaîne d'approvisionnement** : dépendance npm, action GitHub, image de conteneur.
8. **Erreur de l'exploitant** : secret commité, sauvegarde non chiffrée, mauvaise configuration du serveur.

## 3. Frontières de confiance et flux

```
Navigateur ──HTTPS──> Cloudflare (TLS, WAF*) ──tunnel──> Node (127.0.0.1:3100) ──> MySQL/MariaDB (local)
   │                                                        │  ├─> disque : clones Git, pièces jointes, vidéos, justificatifs
   │                                                        │  ├─> CLI IA (bac à sable bwrap) ──> Anthropic / OpenAI / Google (accès DE L'UTILISATEUR)
   │                                                        │  ├─> SMTP / IMAP de l'utilisateur (adresses vérifiées, IP épinglée)
   │                                                        │  ├─> Stripe (paiement ; webhook signé en retour)
   │                                                        │  ├─> Discord / Slack / Telegram (notifications, hôtes fixes)
   │                                                        │  └─> Google / Apple (connexion OIDC), reCAPTCHA
Client API / MCP ──Bearer──> /api/v1/*   (jamais de cookie, aucun CORS)
* à vérifier sur le serveur réel
```

Frontières : (A) Internet → application ; (B) application → services externes (sortant, filtré par `netguard.js`) ; (C) application → CLI d'IA, qui lit du contenu non fiable ; (D) application → base et disque ; (E) administrateur → données de tous les comptes.

## 4. Menaces et parades (STRIDE condensé)

| # | Menace | Acteur | Parade en place | Preuve | Résiduel |
|---|---|---|---|---|---|
| T1 | Usurpation de connexion (OAuth rejoué, `state` volé, jeton falsifié) | 1 | `state` + `nonce` + PKCE + liaison navigateur, signature RS256, `iss/aud/exp`, `email_verified` | `test/auth.test.js` | Flux réels Google/Apple non testés ici |
| T2 | Prise de compte avec un compte Google/Apple volé | 3 | **A2F** (code TOTP, codes de secours à usage unique, session « en attente », plafond par compte, nouvel identifiant de session) | `test/mfa.test.js` | A2F facultative pour un utilisateur ordinaire, **obligatoire pour l'administrateur** |
| T3 | Lecture/écriture des données d'un autre compte (IDOR/BOLA) | 2 | Filtre par `user_id` à chaque requête, 404 pour une ressource d'autrui, rôles d'équipe | `test/isolation.test.js` | — |
| T4 | Route oubliée sans contrôle d'accès | 1, 2 | Test automatique des 246 routes ; liste blanche des routes publiques | `test/route-security.test.js` | — |
| T5 | CSRF | 3 | `SameSite=Lax`, contrôle strict de `Origin` sur toute écriture, aucune écriture en GET | `test/route-security.test.js` | — |
| T6 | XSS, injection HTML | 2, 4 | CSP sans script ni style en ligne, échappement serveur et navigateur, Markdown échappé avant mise en forme | `test/security.test.js`, `scripts/recap-check.mjs` | — |
| T7 | Injection SQL | 2 | Requêtes préparées, listes blanches pour tri et colonnes | `test/security.test.js` | — |
| T8 | SSRF (SMTP, IMAP, base, git, webhooks) | 2 | `netguard.js` : ports, DNS résolu, adresses privées refusées, IP épinglée ; hôtes fixes pour Slack/Telegram/Discord | `test/netguard.test.js` | — |
| T9b | Une IA (ou un contenu qui la manipule) écrit du code malveillant, un secret ou une porte dérobée dans le dépôt de l'utilisateur | 4 | Écriture limitée à une copie jetable sans `.git` (réglage décoché par défaut) ; chemins sensibles interdits (`.git`, `.github/workflows`, `.env`, clés) ; analyse de secrets ; volume borné ; pas de push forcé ; nouvelle branche recommandée ; le code reste à relire par un humain avant fusion |
| T9 | Injection de prompt par un site, un dépôt, une réponse, une pièce jointe | 4 | Contenu signalé comme **donnée**, outils de l'IA limités (pas de `Bash` ni d'`Edit`), bac à sable bwrap obligatoire en production, environnement enfant en liste blanche, web et dépôt jamais donnés ensemble, MCP en lecture seule possible | tests des lanceurs, `test/childio.test.js` | Bac à sable **non testé** sur le vrai serveur |
| T10 | Exécution de commandes | 2, 4 | `spawn` sans shell, git durci (https seul, pas de hooks) | lecture du code, tests | — |
| T11 | Dépense IA abusive | 2 | Budgets en $, plafonds de plan, plafonds de jobs, détection | `test/budget.test.js`, `test/plans.test.js` | Un budget est un garde-fou pour une clé API, pas une garantie pour un abonnement |
| T12 | Spam et abus d'envoi | 2 | Plafonds d'envoi, liste d'opposition commune, pause automatique à trop de rejets, désinscription en un clic | `test/abuse.test.js` | Poisonnement volontaire de la liste d'opposition (voulu, surveillé) |
| T13 | Vol de jeton d'API | 3 | Jeton affiché une fois, SHA-256 en base, 5 par compte, droits `read/write/jobs`, mode désactivable | `test/api.test.js` | Un jeton `jobs` volé peut envoyer des mails |
| T14 | Fuite de la base ou d'une sauvegarde | 5 | Secrets chiffrés, sessions et jetons en empreintes, sauvegardes chiffrées (clé publique) | `test/backup-scripts.test.js` | `SECRET_KEY` conservée à part par l'exploitant |
| T15 | Administrateur compromis | 6 | Liste `ADMIN_EMAILS` côté serveur, **A2F exigée**, journal d'administration, un admin ne touche pas un autre admin | `test/admin.test.js`, `test/mfa.test.js` | Un seul propriétaire = un point de défaillance |
| T16 | Paiement falsifié, abonnement activé à tort | 1, 2 | Webhook signé, tolérance de date, idempotence, état relu chez Stripe, prix côté serveur | `test/subscriptions.test.js` | — |
| T17 | Déni de service (une requête malformée, un job qui ne s'arrête pas, un abus distribué) | 1, 2 | Garde global contre l'arrêt du processus, annulation et SIGKILL des CLI, limites par IP et par compte | `test/security.test.js`, `test/childio.test.js` | **Abus distribué** : à traiter chez Cloudflare |
| T18 | Dépendance ou action malveillante / vulnérable | 7 | 4 dépendances directes, `npm audit` en CI chaque semaine, Dependabot, licences contrôlées, SBOM | workflow « Sécurité » | Actions épinglées par version, pas par empreinte |
| T19 | Secret commité | 8 | `.gitignore`, détection en CI (fichiers + historique) | `test/security-tools.test.js` | Un secret déjà exposé se **révoque**, la suppression ne suffit pas |
| T20 | Perte de données | 8 | Sauvegarde MySQL + fichiers chiffrée, test de restauration en CI | job « backup » | Installation sur le serveur et test de restauration **réelle** à faire |
| T21 | Fuite de données personnelles dans les journaux | 8 | Journal de sécurité sans secret ni e-mail, IP tronquée ; erreurs 500 génériques | `test/mfa.test.js`, `test/security.test.js` | Journaux du serveur web (Nginx) hors dépôt : à configurer |

## 5. Hypothèses de sécurité

- L'application tourne **seule** (une instance), derrière un proxy de confiance déclaré (`TRUST_PROXY`) ; le port n'est joignable que depuis la machine.
- MySQL écoute en local, avec un compte applicatif aux droits limités.
- L'exploitant garde `SECRET_KEY` et la clé privée de sauvegarde **hors du serveur**.
- Chaque utilisateur est responsable de son propre fournisseur d'IA et de la base légale de sa prospection (il est responsable de traitement pour ses prospects).
