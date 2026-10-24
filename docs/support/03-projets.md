# Les projets : créer, ouvrir, sections, supprimer
Résumé : tout sur la page Projets : création, sections d'un projet (En-tête, Cible, Prospecter, Évolution, Audit, LinkedIn, Promotion, Récapitulatif, Configuration), réanalyse, suppression et partage.

## La page Projets
Elle liste les projets du compte (et ceux partagés par une équipe, avec le badge « équipe de … »). À droite, la carte **Usage du mois** (Projets, Prospects, Mails ce mois-ci, Jobs IA ce mois-ci) avec le nom de l'offre. Bouton **Nouveau projet** (en haut) pour en créer un. Un projet affiche son état : « 0 prospect(s) », la pastille « config 4/11 »…

## Créer un projet
Bouton **Nouveau projet** → champs **Nom** et **Dépôt Git** → **Créer et analyser** (ou **Annuler**). GitHub est accepté ; les autres serveurs Git doivent d'abord être ajoutés dans **Réglages → Dépôts Git** (avec un token pour un dépôt privé). Le lien du dépôt ne peut plus être modifié après la création : pour changer de dépôt, créer un nouveau projet. Si le plafond de projets de l'offre est atteint, la création est refusée avec un message.

## Ouvrir un projet
Clique sur son nom. Avec un seul projet, il est ouvert par défaut ; avec plusieurs, ils sont fermés. Le dernier projet consulté se rouvre après un rechargement de la page.

## Les sections d'un projet (dans l'ordre)
- **En-tête** : « Dépôt Git et fiche projet ». Le dépôt (lecture seule) et la **Fiche projet** avec le bouton **Réanalyser** (refait l'analyse ; consomme un job IA et du quota Claude).
- **Cible** (badge « à valider » ou « validée ») : description, zone, taille, décideur, secteurs (1 par ligne), requêtes de recherche (1 par ligne) ; bouton **Valider la cible**.
- **Prospecter** : regroupe quatre sous-sections : **Recherche de prospects**, **Modèle de mail**, **Envoi**, **Relance automatique**, puis **Prospects** (liste, Kanban, fiches, import/export CSV). Voir les fichiers sur la prospection, les mails et le CRM.
- **Évolution** : idées de fonctionnalités tirées du code, envoyées par mail. Voir le fichier sur Évolution et Audit.
- **Audit du projet** : rapport qualité et sécurité du code (réservé aux propriétaires et administrateurs du projet).
- **LinkedIn** : relier un compte, faire écrire des posts, relire, programmer, publier.
- **Promotion** : générer une vidéo de design motion.
- **Récapitulatif** : chiffres business et courbes (réservé aux propriétaires et administrateurs).
- **Configuration du projet** : SMTP, boîte de réception (IMAP) et base de données du récapitulatif, plus le bouton **Supprimer le projet** (réservé aux propriétaires et administrateurs).

## Supprimer un projet
Dans **Configuration du projet**, bouton **Supprimer le projet** : seul le propriétaire peut le faire. Cela efface le projet, ses prospects, ses modèles, ses vidéos de promotion et le clone du code. L'opération est irréversible. Les adresses en liste d'opposition y restent.

## Droits dans un projet partagé
- **Membre** : travaille sur les projets partagés (modèles, contacts, recherches, envois, notes), génère des posts LinkedIn et des vidéos de promotion.
- **Administrateur** : en plus, règle le projet (SMTP, boîte de réception, base du récapitulatif, LinkedIn), lance l'audit, supprime des vidéos.
- **Propriétaire** : gère l'équipe, partage et supprime les projets.
Les jobs d'un projet partagé tournent avec l'accès Claude du propriétaire.
