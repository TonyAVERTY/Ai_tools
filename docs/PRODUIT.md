# iaboss : inventaire complet des fonctionnalités

Ce document liste **tout ce qu'iaboss fait aujourd'hui**, page par page, pour qu'une IA (ou une personne) puisse analyser le produit sans fouiller le code. Il décrit l'existant, pas un souhait. Les libellés entre « » sont ceux de l'écran. Pour le détail d'une fonction, `docs/support/*.md` (écrit pour l'utilisateur) fait foi ; les offres, plafonds, modèles et postes sont **générés** par le code (`docs/support/plans-et-limites.md`, `modeles-ia.md`, `postes-et-taches-ia.md`).

## 1. Le produit en bref

- **Quoi** : une application web qui aide des indépendants et de petites équipes à **trouver des clients par mail** avec **leur propre IA** (Claude, ChatGPT ou Gemini), puis à gérer la suite : réponses, CRM, agenda, facturation, comptabilité.
- **Pour qui** : des personnes proches du code (elles ont un dépôt Git), sans service commercial. Ton : franc, concret, on se tutoie.
- **Principe de fond** : l'IA tourne toujours **avec l'accès de la personne** (clé API, abonnement Claude, compte ChatGPT ou abonnement Google AI), jamais un compte partagé ; elle ne peut que **lire** (pas de commande, pas d'écriture de fichiers) ; chaque donnée est filtrée par compte ; la personne relit tout avant l'envoi.
- **Stack** : Node 22 sans framework, HTML rendu côté serveur, scripts navigateur en JS natif, SQLite (tests) ou MySQL/MariaDB (production), tâches IA en arrière-plan dans un bac à sable.
- **Offres** (`plans-et-limites.md`) : gratuit, Démarrage (10 €/mois), Croissance (25 €/mois), Business (50 €/mois), Intensif (100 €/mois) et pro (illimité, sur demande) ; annuel avec deux mois offerts ; plafonds mensuels de projets, prospects, mails, jobs IA, jobs simultanés et places d'équipe.

## 2. Les pages et leurs fonctions

### 2.1 Site public (sans connexion)
Accueil (la promesse, une lettre d'exemple), **Fonctionnement**, **Tarifs** (offres, qui paie quoi, risques d'un abonnement d'IA), **Docs** (API REST, serveur MCP), mentions légales, politique de confidentialité, CGU, **Connexion** (Google ou Apple, sans mot de passe, avec protection anti-robot), page d'erreur. Bandeau/cookies : seulement le nécessaire.

### 2.2 Entrée dans l'application
- **Relier mon IA** (obligatoire avant toute tâche IA) : trois cartes (Claude, ChatGPT, Gemini). Par IA : clé API (recommandée, vérifiée sans coût, chiffrée, jamais réaffichée), ou abonnement avec avertissement de risque et consentement enregistré : jeton/connexion guidée Claude, compte ChatGPT (connexion guidée par code d'appareil ou fichier collé), abonnement Google AI (connexion guidée avec lien puis code en 60 secondes, ou fichier collé ; désactivé par défaut côté serveur).
- **Bienvenue** (profil de la personne : métier, secteur, que l'IA utilise dans ses consignes) ; **visite guidée** du tableau de bord (une étape par onglet).

### 2.2 bis Aujourd'hui (page d'accueil de l'application)
Page `/` d'un compte connecté. Ce qui demande l'attention maintenant, lu dans les données réelles : liste **À traiter** (réponses de prospects non lues, actions prévues aujourd'hui ou en retard, tâches IA terminées ou en échec des 48 dernières heures ; filtres Tout / Réponses / Actions / IA ; « Marquer traité » avec annulation, mémorisé par compte dans `today_done`), quatre chiffres (réponses, mails de la semaine, à encaisser, encaissé du mois), agenda du jour, factures à encaisser et déclaration à faire, consommation de l'IA, huit dernières semaines (mails, réponses, rendez-vous ; graphique ou tableau), parcours des projets, usage du mois. Le bandeau « Mise en route » suit la liste de mise en route du premier projet pas prêt. Code : `src/today.js` (données), `src/todayviews.js` (rendu), `src/todayroutes.js`, `public/app-today.js`. Pas encore : devis sans réponse, rendez-vous pris hors d'iaboss.

### 2.3 Projets (`/projets`)
- Quatre chiffres : Projets, Prospects, Mails envoyés ce mois-ci, Tâches IA ce mois-ci, avec les plafonds de l'offre ; alerte quand un plafond est atteint.
- Filtre **Poste** ; **Nouveau projet** (nom + dépôt Git, hôtes autorisés réglables) ; carte **Consommation** de l'IA (tokens via iaboss ; quota 5 h et semaine pour Claude, les deux fenêtres lues chez OpenAI pour ChatGPT ; $ seulement avec une clé API).
- Un bloc par projet : nom, badge « config n/m », comptes de prospects (à contacter, réponses), dernier envoi, **Analyser/Réanalyser**. Fenêtres d'arrivée des réponses (en bas à droite). Menu **Activité** (jobs en cours, en file, programmés, annulation, console d'une tâche).

### 2.4 Dans un projet (sections)
1. **Mise en route** : liste des étapes restantes (analyser, valider la cible, chercher des prospects, SMTP, modèle de mail, premier envoi, puis facultatif : boîte IMAP, relance, évolutions, LinkedIn), étapes faites repliées.
2. **En-tête** : dépôt Git (lecture seule), fiche projet écrite par l'IA, site du produit.
3. **Cible** : description, zone, taille, décideur, secteurs, requêtes ; « Valider la cible » ; validée = grisée avec « Modifier ».
4. **Prospecter** :
   - *Recherche de prospects* : nombre, maintenant ou la nuit ; l'IA trouve des entreprises avec email pro public, source, accroche, score 1 à 10 ; règles de collecte (professionnels seulement, liste d'opposition, doublons).
   - *Modèle de mail* : objet, objet B (test A/B), corps avec variables `{{entreprise}} {{ville}} {{accroche}} {{expediteur}} {{site}}`, mail HTML ou texte, « Générer avec l'IA » (relu par l'IA avant d'être montré), « Aperçu » (vrai prospect ou exemple, avertissements, relecture du sens par l'IA, correction avant affichage, sélection d'une phrase : « Changer | Modifier »), « Enregistrer », « Valider le modèle » (validé = grisé).
   - *Envoi* : nombre, confirmation, garde-fous (plafonds, heures, montée en charge, relecture du sens de chaque mail par lots, liste d'opposition, pied de page de désinscription, accusé de lecture facultatif).
   - *Relance automatique* : une relance dans le même fil après N jours sans réponse ; son propre modèle (mêmes règles).
   - *Prospects* : liste et Kanban, filtres, fiche (prochaine action, notes, historique), ajout à la main, import et export CSV, statuts (à contacter, envoyé, répondu, client, refus, rejeté, invalide…), accroche régénérable.
5. **Évolution** : idées de fonctionnalités tirées du code, envoyées par mail.
6. **Audit du projet** : rapport qualité et sécurité du code, copiable.
7. **LinkedIn** : relier un compte, choisir profil ou page, faire écrire un post, relire, programmer, publier, historique.
8. **Promotion** : vidéo de design motion (sujet, images par seconde, durée, format), lecture, téléchargement, suppression, limites par offre.
9. **Récapitulatif** : chiffres business et courbes lus dans la base de données du client (tables choisies dans des listes, aucune requête à écrire).
10. **Configuration du projet** : SMTP d'envoi (test), boîte de réception IMAP (détection des réponses et rejets), base de données du récapitulatif.
11. **Postes et tâches IA** : 11 postes (Direction, Commerce, Marketing, Communication, Produit, Développement, Support client, Finance, Juridique et conformité, Ressources humaines, Opérations et qualité), 4 à 5 tâches chacun (par exemple Note de stratégie, Proposition commerciale, Plan de référencement, Communiqué de presse, Feuille de route, Documentation technique, Foire aux questions, Budget prévisionnel, Registre RGPD, Fiche de poste, Gestion d'incident), livrable à lire et copier, consignes modifiables.

### 2.5 Mails
- **Envoyés** : liste de tous les mails (date, destinataire, objet, projet, type, état : Envoyé, Lu (accusé), Répondu, Rejeté, Refus, Non envoyé), barre de chiffres filtrante, liste déroulante du texte envoyé ou de la raison d'un rejet ou d'un échec.
- **Réponses** : classées par intention (intéressé, question, plus tard, refus, autre), brouillon de réponse suggéré à copier, proposition « Ajouter à ton calendrier » quand un rendez-vous est évoqué, marquer comme lu, badge de non-lues sur l'onglet.

### 2.6 Calendrier
Mois, événements (heures de Paris), ajout à la main ou depuis une réponse, agenda externe (Google, Apple, Outlook) par lien iCal, vue « à venir ».

### 2.7 Comptabilité
Situation, ajout d'une ligne (paiement, dépense, remboursement…) avec **justificatif obligatoire**, chiffres par période et par projet, guide « Faire ma déclaration », exports (journal CSV, archive des justificatifs). Les factures émises arrivent toutes seules, à encaisser.

### 2.8 Facturation
Par projet : informations légales (préremplies) ; trois exemples de devis écrits par l'IA, choix, affinage avec l'IA, validation ; préparation de l'acompte, de la facture finale et de l'avoir dans le même style, validés un par un (validé = résumé grisé avec « Modifier ») ; **émission** d'un document rattaché à un client (numérotation, lignes, totaux et mentions légales calculés par le code, jamais par l'IA), PDF, passage en comptabilité.

### 2.9 Clients
Par projet (en déroulants) : clients et prospects, recherche, ajout et modification d'un client, passage d'un prospect en client, fiche client (documents générés, échanges), export CSV.

### 2.10 Équipe
Créer une équipe, inviter par email, rôles, partager des projets (l'IA d'un projet partagé utilise l'accès de son propriétaire), places selon l'offre.

### 2.11 Assistant et Support
- **Assistant** : discussion avec l'IA de la personne (conversations enregistrées, choix du modèle, pièces jointes, joindre un projet iaboss pour qu'elle le lise, limites de taille).
- **Support** : même fenêtre, mais l'IA répond d'après la documentation d'iaboss.

### 2.12 Réglages (avatar)
Notifications (canaux Discord, Slack, Telegram, e-mail ; quels événements ; rapport hebdomadaire), Dépôts Git (hôtes et jetons), Garde-fous (plafonds d'envoi, pause, accusé de lecture, pied de page), Budget et modèles IA (selon l'IA), Prompts IA (consignes par tâche et par gamme de modèle).

### 2.13 Mon compte (avatar)
Connexion (Google ou Apple), usage du mois et plafonds, carte « Mon IA » (IA, mode, état, limites, tester, changer, délier), agenda externe, **mode développeur** (jetons d'API `iaboss_…`, documentation), suppression du compte (confirmation par l'email), page **Administration** pour les administrateurs (comptes, plans, statuts, usage, pause d'envoi, journal).

### 2.14 Développeurs
**API REST** (groupes : Compte, Projets, Prospects, Réponses, Mails envoyés, Tâches) et **serveur MCP** (`iaboss-mcp.js` : liste des projets et prospects, fiche, réponses, mails envoyés, état d'un job, ajout de prospects, statut, notes, prochaine action, marquer lu, lancer une tâche, régénérer une accroche) pour piloter iaboss depuis des scripts ou depuis Claude.

## 3. Ce qui travaille en arrière-plan

- **File de tâches IA** équitable entre comptes (un seul exécutable par compte quand l'accès est un abonnement, plusieurs en parallèle selon l'offre), tâches de nuit (1 h à 6 h), reports automatiques quand le quota d'abonnement est serré, budgets en $ (clé API), annulation, console en direct, relance sur erreur.
- **Types de tâches** : analyser, prospecter, rédiger le modèle, rédiger la relance, accroche, évolutions, audit, post LinkedIn, vidéo de promotion, trois tâches de facturation (devis, affinage, documents), et les tâches des postes ; envoi et relance par lots.
- **Surveillance de la boîte** : lecture IMAP périodique, détection des réponses, des rejets (avec leur raison) et des accusés de lecture, mise à jour des statuts, liste d'opposition.
- **Notifications** : réponses, plafonds, quota, erreurs, rapport hebdomadaire.

## 4. Garde-fous et règles de fond (non négociables)

- Isolation par compte (un compte ne voit jamais les données d'un autre : « introuvable »).
- Secrets chiffrés, jamais réaffichés ni journalisés.
- Conformité des envois : professionnels seulement, source de l'adresse, lien de désinscription, liste d'opposition commune.
- L'IA de la personne ne peut que lire ; ses consignes internes ne sont pas modifiables par un dépôt ou un prospect.
- Consentement explicite et enregistré pour tout accès par abonnement (Claude, ChatGPT, Google).
- Pages légales qui décrivent ce que fait réellement l'application.

## 5. Contraintes de réalisation

CSP stricte (ni style ni script en ligne, aucune ressource externe), couleurs par jetons (`public/tokens.css`), icônes par sprite (`src/icons.js`), rédaction (tutoiement, succès en « Nom + participe passé », boutons à l'infinitif), animations seulement avec l'accord du propriétaire du produit, documentation Support et visite guidée à jour dans le même commit que toute nouveauté visible. Détail : `CLAUDE.md`, `docs/DESIGN.md`, `docs/UX.md`.

**La charte graphique actuelle** (`docs/DESIGN.md` : indigo du logo, bleu et cyan, plus des couleurs d'état, de surlignage et de code) est **en cours de refonte** : la nouvelle charte tient en trois couleurs, deux dominantes et une d'accent, plus des neutres dérivés (voir `docs/REDESIGN-PROMPTS.md`, prompts A et B).
