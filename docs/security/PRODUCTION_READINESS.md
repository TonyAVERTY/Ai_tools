# Préparation à la production : décision

Date : 24 novembre 2026. Ce document ne constitue ni une certification de sécurité ni une validation juridique. Il dit où en est l'application, preuves à l'appui, et ce qui reste à faire avant de l'ouvrir au public.

## Décision

# **NO-GO**

**La mise en production publique n'est pas autorisée aujourd'hui.** Le code applicatif est dans un état technique solide, mais plusieurs conditions obligatoires ne peuvent pas être remplies depuis le dépôt : elles dépendent de ton serveur, de services externes et d'une validation juridique. Quand les éléments du lot 1 de `SECURITY_ACTION_PLAN.md` seront faits et prouvés, le statut pourra passer à **GO CONDITIONNEL**, puis à **GO TECHNIQUE** si les preuves sont au rendez-vous. Aucune de ces étapes ne vaut garantie de sécurité absolue.

## Les conditions obligatoires, une par une

| Condition (mission §23) | État | Preuve ou blocage |
|---|---|---|
| Aucun risque **critique** ouvert | ✅ | Aucun P0 identifié : `SECURITY_AUDIT.md` §12 |
| Aucun risque **élevé** ouvert | ❌ | Trois P1 ouverts : configuration réelle du serveur non vérifiée, sauvegardes non installées ni restaurées pour de vrai, validation juridique non faite |
| Risques résiduels documentés | ✅ | `SECURITY_AUDIT.md` §12.3 et `SECURITY_ACTION_PLAN.md` |
| Aucun secret exposé et identifié ne reste actif | ❌ | **Le mot de passe de la base MySQL a fuité dans une conversation** : à renouveler (`SECURITY_ACTION_PLAN.md` n° 1) |
| Permissions vérifiées | ✅ | 246 routes essayées sans compte, avec un compte ordinaire, sans l'origine : `test/route-security.test.js` |
| Cloisonnement des données testé | ✅ | `test/isolation.test.js`, `test/dataexport.test.js` |
| Tests essentiels passent | ✅ (voir `SECURITY_TESTS.md` §1) | Lint, tests, contrôles d'interface, workflow « Sécurité » |
| Sauvegardes et restaurations vérifiées | ❌ partiel | Scripts testés, restauration réelle prouvée en CI sur MariaDB ; **installation et restauration sur ton serveur non faites** |
| Obligations réglementaires identifiées | ✅ | `LEGAL_COMPLIANCE.md`, `RGPD_COMPLIANCE.md` |
| Documents légaux complétés **et validés** | ❌ | Textes présents et alignés sur le code ; **aucune validation juridique** ; avenant de traitement (art. 28) manquant |
| Traitements de données personnelles documentés | ✅ | `DATA_MAPPING.md` (registre à tenir par l'éditeur) |
| Dépendances auditées | ✅ | `npm audit` 0 vulnérabilité, licences autorisées, SBOM : `LICENSE_AUDIT.md` |
| Surveillance opérationnelle | ❌ | Journal de sécurité en place ; alertes, rotation des journaux et supervision à configurer (`MAINTENANCE_PLAN.md`) |
| Procédure de gestion des incidents | ✅ | `INCIDENT_RESPONSE.md` |
| Vérifications sur l'environnement **réel** de production | ❌ | Aucune : Nginx, Cloudflare, MySQL, bwrap, `.env`, port, en-têtes publics : `PRODUCTION_CHECKLIST.md` §B |
| Contrôles nécessitant une intervention humaine validés | ❌ | Voir ci-dessous |

## Constats sur le serveur réel (24 novembre 2026, sorties de commandes fournies par le propriétaire)

| Contrôle | Résultat | Verdict |
|---|---|---|
| Adresse du visiteur vue par l'application (`TRUST_PROXY`) | Le journal de sécurité note une adresse de particulier (tronquée), pas celle du proxy | ✅ correct |
| `https://iaboss.fr/.env` | 404 | ✅ |
| En-têtes `Content-Security-Policy`, `Strict-Transport-Security` (une fois), `Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options` ; pas de `X-Powered-By` | Présents | ✅ |
| `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` | **Envoyés deux fois** (l'application et Nginx), avec deux valeurs différentes pour `X-Frame-Options` (`DENY` et `SAMEORIGIN`) | 🟡 à corriger : retirer ces `add_header` du vhost Nginx |
| Port de l'application (3100) | Écoute sur **toutes les interfaces** (`*:3100`) | ❌ **P1** : doit écouter sur `127.0.0.1` seulement |
| MySQL (3306) et protocole X (33060) | Écoutent sur **toutes les interfaces** (`0.0.0.0:3306`, `*:33060`) | ❌ **P1** : `bind-address` à `127.0.0.1`, ou pare-feu |
| Autres ports ouverts sur toutes les interfaces : 21 (FTP), 25, 80, 443, 2006, 3000, 6081, 8080, 8443 (CloudPanel) | À confirmer contre le pare-feu | 🟡 vérifier l'accessibilité depuis l'extérieur ; restreindre 8443, désactiver FTP s'il ne sert pas |
| Base de production | **MySQL 8** (protocole X présent) : les migrations de l'audit s'y sont appliquées et l'application démarre | ✅ preuve pratique que les migrations passent sur MySQL 8 (non testé en CI) |

## Décisions du propriétaire

- **Sauvegardes (24 novembre 2026) : le propriétaire a décidé de ne pas les installer pour l'instant.** Risque accepté par le propriétaire : en cas de panne de disque, d'erreur de manipulation ou d'attaque, **toutes les données sont perdues sans retour possible**. La condition « sauvegardes et restaurations vérifiées » du §23 de la mission n'est donc **pas remplie** : le statut reste **NO-GO** tant qu'elle ne l'est pas ou que ce risque n'est pas explicitement revalidé. Les scripts restent livrés et testés (`BACKUP_RESTORE.md`) si le propriétaire change d'avis.

- **SSH par mot de passe conservé (24 novembre 2026)** : la configuration réelle autorise `PermitRootLogin yes` et `PasswordAuthentication yes` sur le port 2006, ouvert à tout Internet dans le pare-feu. Le propriétaire a choisi de **garder la connexion par mot de passe**. Risque accepté : une prise de contrôle de `root` donne accès à tout le serveur (base, fichiers, `.env`). Mesures de compensation convenues : mot de passe `root` long et aléatoire, fail2ban sur le port 2006, `MaxAuthTries 3` et `LoginGraceTime 30` ; recommandé, non fait : limiter le port 2006 aux seules adresses du propriétaire. À revalider à chaque revue (`MAINTENANCE_PLAN.md`).

## Résumé exécutif (en clair)

Ton application a été durcie à plusieurs niveaux : accès, sessions, double authentification, chiffrement des secrets, cloisonnement entre comptes, protection contre les attaques web courantes. Des contrôles automatiques vérifient maintenant à chaque modification qu'aucun secret n'est publié, qu'aucune dépendance dangereuse n'est ajoutée, qu'aucune porte d'entrée n'est laissée ouverte par erreur, et que les sauvegardes peuvent vraiment être restaurées. Les droits des utilisateurs (accéder à leurs données, les emporter, les effacer) fonctionnent depuis l'application.

Ce qui t'empêche d'ouvrir **aujourd'hui** n'est pas du code : (1) un mot de passe de ta base a fuité et doit être changé ; (2) je n'ai aucun moyen de vérifier ton serveur, ton pare-feu, Cloudflare ni ta base ; (3) tes sauvegardes ne sont pas encore installées ni testées sur le vrai serveur ; (4) tes textes légaux n'ont pas été relus par un juriste et il manque une clause obligatoire entre toi et tes clients ; (5) l'alerte et la surveillance ne sont pas branchées.

## Corrigé dans cet audit

Voir `SECURITY_CHANGELOG.md` : A2F obligatoire pour l'administration, plafond de codes par compte, session renouvelée après la double authentification, export complet des données (RGPD), sauvegarde chiffrée avec restauration testée, journal de sécurité, contrôles automatiques en CI, politique de confidentialité corrigée, test de couverture des routes.

## Ce que tu dois fournir ou faire

**Informations manquantes** : décisions sur le droit de rétractation, la médiation, la désignation d'un délégué à la protection des données, l'AIPD et la déclaration d'accessibilité ; origine et droits des visuels et des icônes ; contrats des fournisseurs (`LEGAL_COMPLIANCE.md` §4, `THIRD_PARTY_SERVICES.md`).

**Actions manuelles** (dans l'ordre) : renouveler le mot de passe MySQL ; vérifier `.env` ; vérifier Cloudflare, MySQL et le port ; activer l'A2F sur ton compte administrateur ; installer les sauvegardes et jouer une restauration ; configurer alertes et rotation des journaux ; tester le QR code et une connexion réelle ; envoyer un mail de test.

**Validations externes** : relecture juridique (mentions, confidentialité, CGU/CGV, avenant art. 28, droit de la consommation, AI Act, facturation électronique) ; test d'intrusion ou scan dynamique sur un environnement de test.

## Recommandations de maintenance

`MAINTENANCE_PLAN.md` : automatique (CI, Dependabot, contrôles du lundi) ; chaque semaine, relire le journal de sécurité et les pull requests Dependabot ; chaque mois, vérifier les sauvegardes hors du serveur ; chaque trimestre, **rejouer une restauration**.

## Comment sortir du NO-GO

1. Terminer le lot 1 de `SECURITY_ACTION_PLAN.md` en cochant chaque ligne avec sa preuve (date, commande, capture).
2. Obtenir la validation juridique et l'avenant de traitement.
3. Rejouer `PRODUCTION_CHECKLIST.md` en entier sur la préproduction, puis sur la production.
4. Relancer un audit de contrôle (`npm run security`, `npm test`, `npm run ui:check`) et mettre à jour ce document : statut **GO CONDITIONNEL** quand seules des validations externes restent, **GO TECHNIQUE** quand toutes les preuves techniques sont réunies.
