# Présentation d'AiTools et plan de l'interface
Résumé : ce qu'est AiTools, le vocabulaire (projet, fiche, cible, prospect, job, liaison Claude, plafond), et la carte de tous les boutons de la barre du haut.

## Ce qu'est AiTools
AiTools aide à **trouver des clients par mail**, avec **son propre Claude** : la personne relie son accès Claude (clé API Anthropic ou abonnement Claude), ajoute un **projet** (le dépôt Git de son produit), et AiTools :
1. lit le code et rédige une **fiche projet** et une **cible** (à qui vendre) ;
2. cherche des **prospects** (entreprises correspondant à la cible) avec une adresse de contact professionnelle publiée ;
3. rédige un **modèle de mail** et envoie les mails à la demande, avec relance automatique, suivi des réponses et CRM ;
4. propose aussi : des idées d'**évolutions**, un **audit** du code, des posts **LinkedIn**, des **vidéos de promotion**, un **calendrier**, un **assistant IA** et un **Support**.

Tout ce que fait l'IA passe par le compte Claude de la personne, jamais par un compte partagé : c'est elle qui paie Anthropic directement. Les données d'un compte ne sont jamais visibles par un autre compte.

## Vocabulaire
- **Projet** : un produit à promouvoir, relié à un dépôt Git (lecture seule). Il a sa fiche, sa cible, ses prospects, ses modèles de mail, son adresse d'envoi (SMTP).
- **Fiche projet** : résumé du produit écrit par Claude après lecture du code (bouton « Réanalyser » pour la refaire).
- **Cible** : le public à démarcher (description, zone, taille, décideur, secteurs, requêtes de recherche). Elle doit être validée avec « Valider la cible ».
- **Prospect** : une entreprise trouvée, avec son email professionnel, sa source publique, une accroche personnalisée et un score de pertinence de 1 à 10.
- **Job** : une tâche lancée en arrière-plan (analyse, recherche, envoi, évolution, audit, post LinkedIn, vidéo…). Ses jobs en cours se voient dans « Activité ».
- **Liaison Claude** : l'accès à Claude relié au compte (voir le fichier sur la liaison Claude).
- **Plafond** : limite mensuelle de l'offre (projets, prospects, mails, jobs IA, places d'équipe) ; voir « Offres, plafonds et limites ».
- **Liste d'opposition** : adresses qui ne doivent plus être contactées (désinscription, refus, adresse invalide), commune à tous les comptes.

## La barre du haut (de gauche à droite)
- **AiTools** (logo) : retour à la page des projets.
- **Projets** : la page d'accueil de l'application (liste des projets). 
- **Mails** : tous les mails envoyés et les réponses reçues.
- **Calendrier** : le mois, les événements et l'agenda externe.
- **Équipe** : partager des projets avec des collègues.
- **Activité** (apparaît quand une tâche tourne) : la liste des jobs en cours, en attente ou programmés, avec leur avancement.
- **Site internet** : ouvre le site public d'AiTools (page d'accueil du site). Sur téléphone, seule l'icône (un globe) s'affiche.
- **IA** : un menu qui s'ouvre au survol (ou au clic sur téléphone) avec deux choix : **Claude** (l'assistant classique, pour discuter, rédiger, réfléchir) et **Support** (pose une question sur AiTools).
- **Avatar** (la première lettre de l'email) : un menu au survol avec **Mon compte**, **Réglages** et **Déconnexion**.
- Sous la barre : une ligne d'état avec le **quota Claude** (session de 5 h et semaine) et la consommation « IA via AiTools » sur 24 h et 30 jours.
- Pour un administrateur du service, la page « Administration » est accessible depuis « Mon compte ».

## Où trouver quoi
| Je veux… | Où aller |
|---|---|
| Relier ou déconnecter Claude | Avatar → **Mon compte** → « Liaison Claude » |
| Créer un projet | **Projets** → « Nouveau projet » |
| Configurer l'adresse d'envoi (SMTP) | Dans le projet → « Configuration du projet » |
| Chercher des prospects | Dans le projet → « Prospecter » → « Recherche de prospects » |
| Envoyer des mails | Dans le projet → « Prospecter » → « Envoi » |
| Voir les réponses | **Mails** → « Réponses » |
| Régler les notifications, plafonds, modèles, prompts | Avatar → **Réglages** |
| Partager un projet | **Équipe** |
| Créer une vidéo de promotion | Dans le projet → « Promotion » |
| Poser une question sur l'application | **IA** → **Support** |
