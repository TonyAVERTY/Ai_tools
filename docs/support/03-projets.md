# Les projets : créer, ouvrir, sections, supprimer
Résumé : tout sur la page Projets : création, sections d'un projet (En-tête, Cible, Prospecter, Évolution, Audit, LinkedIn, Promotion, Récapitulatif, Configuration), réanalyse, suppression et partage.

## La page Projets
Elle liste les projets du compte (et ceux partagés par une équipe, avec le badge « équipe de … »). Tout en haut, quatre indicateurs : **Projets**, **Prospects**, **Mails envoyés** (ce mois-ci) et **Tâches IA** (ce mois-ci), chacun avec son plafond (« sur 50 ») selon l'offre. Un indicateur prend la couleur d'avertissement à 80 % du plafond et celle d'erreur une fois atteint (« plafond atteint », avec un lien vers **Voir les tarifs**). Les chiffres sont les mêmes que dans « Mon compte → Usage du mois » : le plafond mensuel repart de zéro le 1er (heure de Paris). Chaque projet affiche sur sa ligne repliée ses vrais chiffres : nombre de **prospects**, ceux **à contacter** (pas encore contactés), les **réponses** reçues et la date du **dernier envoi** (rien n'est affiché s'il n'y en a pas). À droite, la carte **Consommation Claude** n'apparaît que lorsqu'une mesure existe : **Claude session 5 h** et **Claude semaine** (le quota de ton abonnement, relevé en direct chez Anthropic, avec une barre qui passe à l'orange à 80 % et au rouge une fois atteint) et, **avec une clé API seulement**, **IA via AiTools 24 h** / **IA via AiTools 30 j** (ce que les tâches lancées par AiTools ont consommé, en $ équivalent API). Avec un abonnement Claude, aucun montant en dollars n'est affiché (rien n'est facturé en plus). ; avec une clé API, il n'y a pas de quota d'abonnement : seules les lignes « IA via AiTools » s'affichent. Ce sont les mêmes chiffres que la ligne d'état du haut de l'écran (voir « Activité, jobs, quota Claude, budget et rapport hebdomadaire »). La liste **Poste**, à côté de **Nouveau projet**, filtre les sections de tous les projets par poste. Bouton **Nouveau projet** (en haut) pour en créer un. Un projet affiche son état : « 0 prospect(s) », la pastille « config 4/11 »…

## Créer un projet
Bouton **Nouveau projet** → champs **Nom** et **Dépôt Git** → **Créer et analyser** (ou **Annuler**). GitHub est accepté ; les autres serveurs Git doivent d'abord être ajoutés dans **Réglages → Dépôts Git** (avec un token pour un dépôt privé). Le lien du dépôt ne peut plus être modifié après la création : pour changer de dépôt, créer un nouveau projet. Si le plafond de projets de l'offre est atteint, la création est refusée avec un message.

## Ouvrir un projet
Clique sur son nom. Avec **un seul projet**, il est ouvert par défaut ; avec **plusieurs projets**, ils sont tous fermés à chaque arrivée sur la page (même si on en avait ouvert un avant). Quand l'application recharge la page toute seule (fin d'une analyse, cible validée), le projet en cours reste ouvert. Le bouton **Voir** du menu « Activité » ouvre le projet concerné.

## Les sections d'un projet (dans l'ordre)
En haut de la page, la liste **Poste** (**Tous les postes**, **Commerce**, **Communication**…) filtre les sections de tous les projets par poste (voir « Postes et filtre par poste : les tâches IA d'une entreprise »).
- **En-tête** : « Dépôt Git et fiche projet ». Le champ **Site du produit** (avec le bouton **Enregistrer le site**) reçoit l'adresse du site de ton produit, par exemple `https://monproduit.fr` : elle est ajoutée dans les mails de prospection à la place de `{{site}}` ; laisse le champ vide pour ne pas en mettre (propriétaire et administrateurs du projet). Le dépôt (lecture seule) et la **Fiche projet** (résumé, date et commit de l'analyse ; elle n'apparaît qu'une fois l'analyse terminée, puisqu'à la création Claude est déjà en train d'analyser le dépôt). Le bouton est sur la **ligne du projet**, à droite (sur téléphone, une icône seule) : il s'appelle **Analyser** tant que le projet n'a pas de fiche, puis **Réanalyser** une fois la fiche écrite. Il lance (ou refait) l'analyse ; **la première analyse ne demande pas de confirmation** (la relance, si) et l'avancement s'affiche en pourcentage avec une barre à trois endroits : sur la ligne du projet (« Analyse 42 % »), dans la section **En-tête** du projet, et dans le menu **Activité** de la barre du haut, qui s'ouvre tout seul au lancement, y compris à la création d'un projet ; consomme un job IA et du quota Claude).
- **Cible** (badge « à valider » ou « validée ») : description, zone, taille, décideur, secteurs (1 par ligne), requêtes de recherche (1 par ligne) ; bouton **Valider la cible**.
- **Prospecter** : regroupe quatre sous-sections : **Recherche de prospects**, **Modèle de mail**, **Envoi**, **Relance automatique**, puis **Prospects** (liste, Kanban, fiches, import/export CSV). Voir les fichiers sur la prospection, les mails et le CRM.
- **Évolution** : idées de fonctionnalités tirées du code, envoyées par mail. Voir le fichier sur Évolution et Audit.
- **Audit du projet** : rapport qualité et sécurité du code (réservé aux propriétaires et administrateurs du projet).
- **LinkedIn** : relier un compte, faire écrire des posts, relire, programmer, publier.
- **Promotion** : générer une vidéo de design motion.
- **Récapitulatif** : chiffres business et courbes (réservé aux propriétaires et administrateurs).
- **Postes et tâches IA** : les postes d'une entreprise (Commerce, Communication, Finance…) et les tâches que Claude y fait. Voir « Postes et filtre par poste : les tâches IA d'une entreprise ».
- **Configuration du projet** : SMTP, boîte de réception (IMAP) et base de données du récapitulatif, plus le bouton **Supprimer le projet** (réservé aux propriétaires et administrateurs).

## Supprimer un projet
Dans **Configuration du projet**, bouton **Supprimer le projet** : seul le propriétaire peut le faire. Cela efface le projet, ses prospects, ses modèles, ses vidéos de promotion et le clone du code. L'opération est irréversible. Les adresses en liste d'opposition y restent.

## Droits dans un projet partagé
- **Membre** : travaille sur les projets partagés (modèles, contacts, recherches, envois, notes), génère des posts LinkedIn et des vidéos de promotion.
- **Administrateur** : en plus, règle le projet (SMTP, boîte de réception, base du récapitulatif, LinkedIn), lance l'audit, supprime des vidéos.
- **Propriétaire** : gère l'équipe, partage et supprime les projets.
Les jobs d'un projet partagé tournent avec l'accès Claude du propriétaire.
