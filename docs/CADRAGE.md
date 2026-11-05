Statut : validé (2026-10-22)

# Cadrage — iaboss public (SaaS multi-utilisateurs)

## 1. Contexte et objectif

iaboss est aujourd'hui un panel **mono-utilisateur** (login Google en whitelist, SQLite local, Raspberry Pi) qui pilote Claude Code en headless : prospection par mail, analyse de projets, évolutions, CRM, récap business.

**Objectif** : ouvrir le produit au public. N'importe qui crée un compte sur un site web, relie son accès Claude, et utilise ses propres projets/prospects, sans voir les données des autres. Le site reprend l'identité visuelle du dashboard. La base de données est une base MySQL/MariaDB créée dans CloudPanel.

## 2. Utilisateurs / cibles

- **Visiteur** : découvre le produit sur le site public, s'inscrit.
- **Utilisateur** : freelance / agence / TPE qui prospecte pour ses propres projets.
- **Admin (Tony)** : gère les comptes, voit l'usage, peut suspendre un compte.

## 3. Périmètre

### Inclus (MoSCoW)

**Must**
- Site public : accueil, fonctionnement, tarifs/conditions (à définir), connexion, inscription. Mêmes couleurs que le dashboard (tokens `--bg #f4f5f7`, `--card`, `--text`, `--accent #2f5bea`, etc., et thème sombre `--bg #111317`, `--accent #5b82ff`), mêmes polices et composants.
- Comptes : inscription (email + mot de passe haché argon2/scrypt, ou Google), vérification d'email, réinitialisation du mot de passe, sessions, suppression de compte.
- **Liaison Claude obligatoire** à l'inscription, avec deux modes au choix de l'utilisateur :
  1. **Clé API Anthropic** : saisie, test de validité par un appel minimal, stockage chiffré AES-256-GCM, jamais réaffichée.
  2. **Login CLI Claude** : l'utilisateur se connecte via `claude login` dans un répertoire de config **isolé par utilisateur** (flux d'autorisation guidé dans le navigateur, URL + code collé).
  Un compte non relié ne peut lancer aucun job IA (accès au profil et à la liaison uniquement).
- **Multi-tenant** : toutes les tables métier rattachées à un `user_id` ; chaque requête filtrée par utilisateur ; tests d'isolation.
- **Base MySQL CloudPanel** : migration de SQLite (`node:sqlite`) vers MySQL/MariaDB via `mysql2` (déjà en dépendance). Migrations versionnées. Identifiants en variables d'environnement.
- Isolation de l'exécution Claude par utilisateur : dossier de travail et config séparés, outils restreints (déjà le cas), pas d'accès au système de fichiers d'un autre utilisateur.
- Quotas/budgets, plafonds d'envoi et liste d'opposition **par utilisateur** (la liste d'opposition globale reste protégée côté RGPD).
- Pages légales : mentions légales, CGU, politique de confidentialité, bandeau cookies (cookies strictement nécessaires seulement, donc pas de bandeau bloquant si aucun traceur).
- Déploiement sur serveur CloudPanel : site Node avec reverse proxy Nginx, TLS, service managé, sauvegardes de la BDD.

**Should**
- Écran « Mon compte » : état de la liaison Claude (mode, dernier test, bouton délier/changer), export et suppression des données (RGPD).
- Anti-abus : limitation de débit sur login/inscription, CAPTCHA à décider (voir §8), liste d'emails jetables bloqués.
- Back-office admin : liste des comptes, suspension, usage IA par compte.
- File d'attente équitable entre utilisateurs (un seul job IA à la fois par utilisateur, plafond global serveur).

**Could**
- Paiement / abonnement (Stripe) et plans.
- Invitation sur liste d'attente avant ouverture complète.

**Won't (cette version)**
- Application mobile, API publique, organisations/équipes multi-membres.

### Hors périmètre
- Gestion du Raspberry Pi (le Pi n'exécute plus les jobs publics ; il reste utilisable pour l'instance perso).
- Conseil juridique définitif sur les CGU/RGPD : un modèle est préparé, validation par un juriste recommandée.
- Revente de crédits Claude.

## 4. Contraintes

- **Techno** : rester sur Node 22, zéro framework serveur, rendu serveur + JS vanilla (cohérent avec l'existant). Pas d'ajout de framework front.
- **Hébergement** : serveur CloudPanel (site Node + base MySQL/MariaDB CloudPanel). Ressources CPU/RAM du serveur à confirmer : les jobs Claude CLI sont lourds, d'où un plafond global de jobs simultanés.
- **Sécurité** : secrets chiffrés au repos, clé de chiffrement hors BDD, anti-CSRF, validation des entrées, en-têtes de sécurité, limitation de débit, journal d'audit minimal.
- **RGPD** : données de prospects = données personnelles traitées pour le compte de chaque utilisateur. Rôles à clarifier (l'utilisateur = responsable de traitement, iaboss = sous-traitant), DPA/CGU, durée de conservation, export/suppression, hébergement UE.
- **Accessibilité** : contrastes et navigation clavier conformes (viser RGAA/WCAG AA sur le site public).
- **Existant** : le code actuel (≈4 800 lignes) reste la base ; la migration doit garder les tests au vert (`npm run check`).

## 5. Livrables et critères d'acceptation

| Livrable | Critères vérifiables |
|---|---|
| Site public aux couleurs du dashboard | Mêmes tokens CSS clair/sombre ; pages accueil, connexion, inscription, légales accessibles sans compte ; score Lighthouse a11y ≥ 90 |
| Inscription + liaison Claude | Impossible de terminer l'onboarding sans liaison valide ; clé API invalide refusée ; clé jamais présente en clair en base ni dans les logs |
| Mode CLI par utilisateur | Config Claude stockée dans un dossier propre à l'utilisateur, permissions 700 ; un utilisateur ne peut pas lancer un job avec la config d'un autre (test automatisé) |
| Multi-tenant | Tests d'isolation : l'utilisateur A reçoit 404/403 sur toute ressource de B (projets, prospects, jobs, mails, notes, métriques) |
| BDD CloudPanel | App connectée à la base MySQL CloudPanel via variables d'environnement ; migrations rejouables ; script de migration SQLite → MySQL pour l'instance de Tony |
| Comptes | Vérification d'email, reset mot de passe, suppression de compte efface toutes les données liées |
| Légal | Mentions légales, CGU, confidentialité publiées ; aucun traceur tiers sans consentement |
| Déploiement | Site en HTTPS sur le domaine, redémarrage auto, sauvegarde BDD quotidienne testée en restauration |
| Qualité | `npm run check` vert (lint + tests) ; docs/JOURNAL.md à jour ; README mis à jour |

## 6. Risques et hypothèses

- **Risque majeur — CGU Anthropic** : les conditions d'Anthropic restreignent l'usage de l'abonnement Pro/Max d'un utilisateur via une application tierce. Le mode « login CLI » peut conduire à la **suspension du compte Claude de l'utilisateur** et exposer le service. *Décision de Tony : mode proposé quand même.* Mitigation : avertissement clair et consentement explicite avant liaison, option désactivable globalement (flag), mode clé API proposé en premier. À revérifier auprès d'Anthropic avant ouverture.
- **Sécurité du mode CLI** : exécuter des CLI avec des identifiants d'utilisateurs sur un même serveur. Mitigation : un dossier de config par utilisateur (700), outils restreints, idéalement un utilisateur système ou conteneur par compte (à trancher, impact charge).
- **Charge serveur** : jobs Claude concurrents. Mitigation : file globale avec plafond, `nice`, quotas.
- **Réputation d'envoi mail / spam** : un site public de prospection par mail peut être détourné. Mitigation : plafonds stricts par compte, désinscription obligatoire, signalement d'abus, suspension, validation manuelle des nouveaux comptes si besoin (à confirmer, §8).
- **Migration SQLite → MySQL** : différences de SQL (dates, `INSERT OR`, `AUTOINCREMENT`), synchrone → asynchrone (`node:sqlite` est synchrone, `mysql2` non) : touche une grande partie du code. Risque de régression, d'où les tests d'abord.
- **Hypothèses** : Tony fournit l'accès à CloudPanel (création de la base, du site Node, du domaine) ; un nom de domaine est disponible ; Tony reste seul exploitant.

## 7. Plan par jalons et estimation

| Jalon | Contenu | Jours |
|---|---|---|
| J1 Fondations | Branche, couche d'accès BDD asynchrone, schéma MySQL + migrations, script de migration des données de Tony | 3–4 |
| J2 Comptes | Inscription, connexion, vérification email, reset, sessions, `user_id` partout, tests d'isolation | 3–5 |
| J3 Liaison Claude | Mode clé API + mode CLI isolé, onboarding bloquant, écran de compte | 3–4 |
| J4 Site public | Accueil, pages, légales, thème identique au dashboard, accessibilité | 2–3 |
| J5 Anti-abus & admin | Rate limiting, plafonds par compte, back-office minimal, file équitable | 2–3 |
| J6 Déploiement & recette | CloudPanel, TLS, sauvegardes, recette, doc, journal | 2–3 |
| **Total** | | **15–22 jours** |

Hors paiement Stripe (Could, +3–5 j).

## 8. Décisions de Tony et points restants

### Décisions (réponses de Tony)
1. **Domaine** : `iaboss.fr` (avant : `ai.tony-averty.dev`).
2. **Inscription** : validation automatique, connexion **Google ou Apple** uniquement (pas de mot de passe), puis liaison Claude obligatoire. Le §3 « email + mot de passe, vérification, reset » est donc supprimé du périmètre.
3. **Modèle** : freemium (plan gratuit limité + plan payant → le paiement passe de Could à **Should**).
4. **Isolation du mode CLI** : la plus optimisée en ressources, avec garantie qu'un utilisateur n'accède jamais au Claude d'un autre. Retenu : un seul utilisateur système, un dossier de config par compte en 700, et chaque job lancé dans un bac à sable (bubblewrap ou `systemd-run` avec montages privés) qui ne voit que le dossier de son propriétaire. Mode clé API : clé passée par variable d'environnement au processus uniquement, jamais écrite sur disque.
5. **CAPTCHA** : Google reCAPTCHA (v3). À mentionner dans la politique de confidentialité et à charger après consentement (cookies / transfert vers Google).
6. **Ressources serveur** (mesurées) : 6 cœurs Xeon E5-2697 v3, 21 Go de RAM (≈ 18 Go disponibles), 271 Go de disque libre, Node 22.23. Plafond global retenu : **4 jobs Claude simultanés**, en gardant 2 cœurs pour MySQL, Nginx et les autres sites CloudPanel. `bubblewrap` n'est pas installé : à ajouter (`apt install bubblewrap`) et à tester (user namespaces non privilégiés).
7. **Raspberry Pi** : plus rien dessus. Tout tourne sur CloudPanel ; l'instance de Tony est migrée dans le SaaS (Tony = admin). Les contraintes thermiques (`thermal.js`, `nice`) sont remplacées par des limites serveur.

### Décisions complémentaires
8. **Plans** : gratuit (1 projet, 50 prospects, 100 mails/mois, 6 jobs IA/mois) puis Démarrage 10 €, Croissance 25 €, Business 50 €, Intensif 100 € TTC par mois, annuel = 2 mois offerts (voir `src/limits.js` et le README). Le paiement reste à construire (jalon Stripe).
9. **Apple** : compte Apple Developer disponible → Google **et** Apple dès la première version.
10. **Mode login CLI** : au clic sur « Connecter via Claude CLI », une fenêtre d'avertissement s'affiche (risque de suspension du compte Claude au regard des conditions d'Anthropic). L'utilisateur doit cocher une case d'acceptation des risques pour continuer ; l'acceptation est horodatée en base. Les CGU contiennent la clause correspondante. Flag global pour désactiver ce mode. *Note : la case et les CGU documentent le consentement mais ne garantissent pas juridiquement l'exonération totale ; relecture juridique recommandée.*

### Points restants
- **Prix du plan payant** (avant le jalon Stripe).
- **Pages légales** : infos EI fournies (SIRET connu) ; relecture juridique ou non.
- **Installation de bubblewrap** sur le serveur et test (voir point 6).
