# Postes et filtre par poste : les tâches IA d'une entreprise
Résumé : comment filtrer les projets par poste (Commerce, Communication, Finance…), lancer les tâches IA d'un poste depuis « Postes et tâches IA », lire et copier le livrable, droits et limites. La liste complète des postes et tâches est dans postes-et-taches-ia.md.

## À quoi ça sert
Une entreprise est faite de postes : Direction, Commerce, Marketing, Communication, Produit, Développement, Support client, Finance, Juridique et conformité, Ressources humaines, Opérations et qualité. Dans un projet, chaque poste a ses tâches faites par Claude. Les fonctions qui existaient déjà (Prospecter, LinkedIn, Promotion, Évolution, Audit du projet, Récapitulatif, Cible) sont rattachées à leur poste ; les autres sont dans la section **Postes et tâches IA**.

## Filtrer par poste
1. Sur la page **Projets**, en haut à droite, à côté de **Nouveau projet**, la liste **Poste** propose : **Tous les postes**, **Direction**, **Commerce**, **Marketing**, **Communication**, **Produit**, **Développement**, **Support client**, **Finance**, **Juridique et conformité**, **Ressources humaines**, **Opérations et qualité**.
2. Choisis un poste : **tous tes projets** n'affichent plus que les sections de ce poste (par exemple Commerce : Cible et Prospecter), et la section **Postes et tâches IA** s'ouvre sur ce poste seulement.
3. **Tous les postes** réaffiche tout.
- Les sections **En-tête** et **Configuration du projet** restent toujours visibles.
- Le filtre choisi est mémorisé dans ton navigateur ; il ne change rien aux données ni pour les autres membres de l'équipe. La liste n'apparaît que lorsque tu as au moins un projet.
- Un poste sans section dédiée (Support client, Finance, Juridique et conformité, Ressources humaines, Opérations et qualité) n'affiche que **Postes et tâches IA**.

## Lancer une tâche
1. Ouvre la section **Postes et tâches IA** (ou filtre sur un poste), puis le poste voulu.
2. Chaque tâche a un nom, une description et un champ **Précisions** (facultatif, jusqu'à 1000 caractères) : le client visé, le ton, une contrainte, un sujet précis.
3. Clique **Lancer la tâche**. Elle apparaît dans le menu **Activité** de la barre du haut avec sa progression ; comme les autres tâches IA, elle peut attendre si le quota ou le budget est atteint.
4. Quand elle est terminée, **Voir le résultat** ouvre le livrable dans une fenêtre ; **Copier le livrable (Markdown)** le copie, **Fermer** referme la fenêtre.
- Relancer une tâche remplace son dernier résultat. Une même tâche ne peut pas tourner deux fois en même temps sur un projet (message « Cette tâche est déjà prévue ou en cours »).
- Rien n'est envoyé ni publié : le livrable est un texte à relire, adapter et utiliser toi-même.

## Prérequis, droits et limites
- Le projet doit avoir été **analysé** (la fiche projet sert de contexte) : sinon « Analyse le projet d'abord ».
- Ton accès Claude doit être relié (voir « Relier, tester et déconnecter son accès Claude »). Le modèle utilisé est celui des **tâches de rédaction** (Réglages → Budget et modèles IA).
- Les tâches marquées **lit le dépôt** (Développement, et le registre RGPD du Juridique) lisent le code en lecture seule : elles sont réservées au propriétaire et aux administrateurs de l'équipe ; les autres membres voient « Réservé aux administrateurs du projet ».
- Les tâches marquées **cherche sur le web** (analyse des concurrents, SEO, choix d'outils) lisent des pages publiques et citent leurs sources.
- Chaque lancement compte comme une tâche IA dans le plafond de ton offre (voir « Offres, plafonds et limites »). Au plus 40 lancements par heure.
- **Fiabilité** : Claude n'invente ni prix, ni chiffre, ni client : ce que la fiche ne donne pas est écrit « À compléter » ou « Hypothèse à vérifier ». Les livrables juridiques (conditions de vente, contrat, mentions, registre RGPD), financiers et de ressources humaines sont des **brouillons à faire relire** par un professionnel avant usage.

## Modifier les consignes
Les consignes communes à toutes ces tâches se modifient dans **Réglages → Prompts IA**, rubrique « Tâches des postes (Commerce, Communication, Finance…) » (un texte par gamme de modèle). Le poste, la mission et les rubriques de chaque tâche sont imposés par l'application.

## Ce qui n'existe pas encore
Les tâches des postes ne sont pas lançables par l'API ni par le serveur MCP, ne se programment pas « Cette nuit » et gardent seulement le dernier résultat de chaque tâche.
