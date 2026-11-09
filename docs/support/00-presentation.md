# Présentation d'iaboss et plan de l'interface
Résumé : ce qu'est iaboss, le vocabulaire (projet, fiche, cible, prospect, job, liaison de l'IA, plafond), et la carte de tous les boutons de la barre du haut.

## Ce qu'est iaboss
iaboss aide à **trouver des clients par mail**, avec **sa propre IA** (Claude, ChatGPT ou Gemini, au choix) : la personne relie son accès (clé API, ou abonnement Claude ou compte ChatGPT), ajoute un **projet** (le dépôt Git de son produit), et iaboss :
1. lit le code et rédige une **fiche projet** et une **cible** (à qui vendre) ;
2. cherche des **prospects** (entreprises correspondant à la cible) avec une adresse de contact professionnelle publiée ;
3. rédige un **modèle de mail** et envoie les mails à la demande, avec relance automatique, suivi des réponses et CRM ;
4. propose aussi : des idées d'**évolutions**, un **audit** du code, des posts **LinkedIn**, des **vidéos de promotion**, un **calendrier**, un **assistant IA** et un **Support**.

Tout ce que fait l'IA passe par le accès de la personne à son IA, jamais par un compte partagé : c'est elle qui paie Anthropic directement. Les données d'un compte ne sont jamais visibles par un autre compte.

## Vocabulaire
- **Projet** : un produit à promouvoir, relié à un dépôt Git (lecture seule). Il a sa fiche, sa cible, ses prospects, ses modèles de mail, son adresse d'envoi (SMTP).
- **Fiche projet** : résumé du produit écrit par l'IA après lecture du code (bouton « Analyser » la première fois, puis « Réanalyser » pour la refaire).
- **Cible** : le public à démarcher (description, zone, taille, décideur, secteurs, requêtes de recherche). Elle doit être validée avec « Valider la cible ».
- **Prospect** : une entreprise trouvée, avec son email professionnel, sa source publique, une accroche personnalisée et un score de pertinence de 1 à 10.
- **Job** : une tâche lancée en arrière-plan (analyse, recherche, envoi, évolution, audit, post LinkedIn, vidéo…). Ses jobs en cours se voient dans « Activité ».
- **Mon IA** : l'accès à l'IA reliée au compte, Claude, ChatGPT ou Gemini (voir le fichier sur la liaison de l'IA).
- **Plafond** : limite mensuelle de l'offre (projets, prospects, mails, jobs IA, places d'équipe) ; voir « Offres, plafonds et limites ».
- **Liste d'opposition** : adresses qui ne doivent plus être contactées (désinscription, refus, adresse invalide), commune à tous les comptes.

## La barre du haut (de gauche à droite)
- **iaboss** (logo) : retour à la page des projets.
- **Aujourd'hui** : la page d'accueil de l'application, ce qui demande ton attention maintenant (voir le fichier « La page Aujourd'hui »).
- **Projets** : la liste de tes projets (adresse `/projets`). 
- **Mails** : tous les mails envoyés et les réponses reçues.
- **Agenda** : le mois, les événements et l'agenda externe (la page s'appelle « Calendrier »).
- **Compta** : tes paiements, dépenses et remboursements avec leurs justificatifs, tes chiffres, le guide « Faire ma déclaration » et les exports (voir « Comptabilité : lignes, justificatifs, déclaration et exports »).
- **Rechercher** (ou **⌘K** sur Mac, **Ctrl+K** sous Windows et Linux) : ouvre la recherche (voir « Rechercher partout »).
- **Activité** (toujours visible, avec un point Safran quand une tâche tourne) : la liste des jobs en cours, en attente ou programmés, avec leur avancement ; au repos, elle dit « Aucune tâche en cours. ».
- **Site internet** : ouvre le site public d'iaboss (page d'accueil du site). Sur téléphone, seule l'icône (un globe) s'affiche.
- **Assistant** : un menu qui s'ouvre au survol (ou au clic sur téléphone) avec deux choix : le nom de ton IA, **Claude**, **ChatGPT** ou **Gemini** (l'assistant classique, pour discuter, rédiger, réfléchir) et **Support** (pose une question sur iaboss).
- **Sur téléphone**, les cinq onglets (Aujourd'hui, Projets, Mails, Agenda, Compta) passent dans une barre fixe en bas de l'écran, l'icône au-dessus du mot ; le nombre de réponses non lues s'affiche sur « Mails ».
- **Avatar** (la première lettre de l'email) : un menu au survol avec **Facturation**, **Clients**, **Équipe**, **Mon compte**, **Réglages**, **Visite guidée** et **Déconnexion**. Ces trois pages ne sont plus dans la barre du haut :
  - **Facturation** : pour chaque projet, tes informations légales puis un devis, un acompte, une facture finale et un avoir écrits avec l'IA, validés un par un, puis émis en PDF (les factures émises arrivent toutes seules dans la Comptabilité, à encaisser) (voir « Facturation : modèles de devis, d'acompte, de facture finale et d'avoir »).
  - **Clients** : pour chaque projet, tes clients et tes prospects (recherche, ajout, modification), la fiche client avec ses documents générés et ses échanges, le passage d'un prospect en client et l'export CSV (voir « Clients : liste par projet, fiches, documents et échanges »).
  - **Équipe** : partager des projets avec des collègues.

- Le **quota Claude** (session de 5 h et semaine) et, avec une clé API seulement, la consommation « IA via iaboss » en $ sur 24 h et 30 jours se lisent dans la carte « Consommation Claude » de la page Projets (le nom suit ton IA : « Consommation Gemini »…) (avec un abonnement Claude, aucun montant en dollars n'est affiché).
- Pour un administrateur du service, la page « Administration » est accessible depuis « Mon compte ».
- **Transitions de page** : en passant d'un onglet de la barre du haut à un autre (Aujourd'hui, Projets, Mails, Agenda, Compta), le contenu arrive en fondu par la droite quand tu vas vers la droite, et par la gauche quand tu vas vers la gauche ; pour les autres pages (Réglages, Mon compte, IA…) il monte en fondu. Recliquer sur la page déjà ouverte ou enregistrer un formulaire n'anime rien. Si ton système demande moins d'animations (« Réduire les animations »), il n'y a aucune transition.

## Où trouver quoi
| Je veux… | Où aller |
|---|---|
| Relier, changer ou déconnecter son IA | Avatar → **Mon compte** → « Mon IA » |
| Créer un projet | **Projets** → « Nouveau projet » |
| Configurer l'adresse d'envoi (SMTP) | Dans le projet → « Configuration du projet » |
| Chercher des prospects | Dans le projet → onglet « Prospection » → « Recherche de prospects » |
| Envoyer des mails | Dans le projet → onglet « Envoi » → « Envoi » |
| Voir les réponses | **Mails** → « Réponses » |
| Régler les notifications, plafonds, modèles, prompts | Avatar → **Réglages** |
| Partager un projet | **Équipe** |
| Créer une vidéo de promotion | Dans le projet → « Promotion » |
| Poser une question sur l'application | **Assistant** → **Support** |
