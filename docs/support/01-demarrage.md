# Premiers pas : de la connexion au premier envoi
Résumé : parcours complet pour démarrer (connexion, liaison Claude, premier projet, cible, prospects, SMTP, modèle, premier envoi) et explication de la liste de mise en route.

## 1. Se connecter
La connexion se fait avec **Google** (ou Apple quand il est proposé) depuis la page « Connexion » du site : pas de mot de passe à créer. Un compte est créé automatiquement à la première connexion. Une fois connecté, le bouton « Dashboard » du site mène à l'application. Quand on est déconnecté, la racine du site montre la page d'accueil publique.

## 2. Relier son Claude (obligatoire)
Sans liaison Claude valide, l'application affiche la page « Relier Claude » et rien d'autre (seuls « Mon compte » et la déconnexion répondent). Trois façons de relier : clé API Anthropic (recommandée), « Se connecter avec Claude » (abonnement), ou jeton collé à la main. Détails dans le fichier sur la liaison Claude. Un membre d'équipe qui travaille sur les projets d'un autre n'a pas besoin de sa propre liaison.

## 3. Créer le premier projet
1. Page **Projets** → bouton **Nouveau projet**.
2. **Nom** : le nom du produit. **Dépôt Git** : l'adresse du dépôt, par exemple `https://github.com/utilisateur/projet.git`. Le lien ne pourra plus être modifié ensuite.
3. Clique **Créer et analyser**. Le dépôt est cloné (en lecture seule) puis analysé une fois par Claude (modèle Sonnet) : l'analyse produit la fiche projet et une cible proposée. Compte quelques minutes.
4. Dépôt privé ou autre serveur Git : ajoute d'abord un token dans **Réglages → Dépôts Git**.

## 4. Valider la cible
Quand l'analyse est finie, la section **Cible** s'ouvre avec le badge « à valider ». Relis la description, la zone, la taille, le décideur, les secteurs et les requêtes de recherche, corrige si besoin, puis clique **Valider la cible**. Le badge devient « validée ».

## 5. Chercher des prospects
Dans **Prospecter → Recherche de prospects** : choisis « Prospects à chercher » (de 1 à 50), « Quand » (Maintenant ou Cette nuit, 1h-6h), puis **Lancer la recherche**.

## 6. Régler l'adresse d'envoi (SMTP)
Dans **Configuration du projet**, renseigne le SMTP de l'adresse qui enverra les mails (hôte, port, utilisateur, mot de passe, email et nom expéditeur) puis **Enregistrer SMTP**. Sans SMTP, rien ne peut partir.

## 7. Le modèle de mail
Dans **Prospecter → Modèle de mail** : clique **Générer avec l'IA** (ou écris-le), relis l'objet et le corps, **Enregistrer** puis **Valider le modèle**. Seul un modèle validé peut être envoyé.

## 8. Le premier envoi
Dans **Prospecter → Envoi** : indique « Mails à envoyer » puis **Envoyer** et confirme. Voir le fichier sur les mails pour les garde-fous.

## La liste de mise en route
Dès qu'un projet existe, une liste en bas à gauche de l'écran guide la configuration : analyser le projet, valider la cible, chercher des prospects, SMTP, modèle de mail, premier envoi, puis le facultatif (boîte IMAP, relance automatique, idées d'évolution, compte LinkedIn relié, premier post publié).
- Chaque ligne ouvre la bonne section du projet et y fait défiler la page.
- Les étapes terminées reçoivent une coche ; le projet porte une pastille « config 4/11 » (par exemple) qui rappelle la liste.
- La liste se calcule à chaque affichage d'après l'état réel du projet : une étape défaite (par exemple un jeton LinkedIn expiré) redevient « à faire ».
- Elle peut être réduite, ou retirée pour un projet : la petite croix **×** qui apparaît quand tu passes la souris sur la liste (toujours visible sur téléphone), ou le bouton **Masquer pour ce projet**. Retirer la liste **masque aussi la pastille « config X/11 »** du projet. Pour la récupérer, ouvre le projet : dans **En-tête**, le lien **Afficher la mise en route** la remet avec sa pastille. Le choix est mémorisé dans ton navigateur, projet par projet. Elle est réduite par défaut sur un écran étroit, et disparaît toute seule quand tout est fait.
- Un membre d'équipe ne voit pas les étapes SMTP et IMAP (il ne peut pas les régler).

## Projet unique ou plusieurs projets
Avec **un seul projet**, il est déjà ouvert quand on arrive sur la page. Avec **plusieurs projets**, ils sont tous fermés : clique sur le nom du projet pour l'ouvrir.
