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
