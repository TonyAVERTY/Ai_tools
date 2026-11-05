# Premiers pas : de la connexion au premier envoi
Résumé : parcours complet pour démarrer (connexion, liaison de l'IA, premier projet, cible, prospects, SMTP, modèle, premier envoi) et explication de la liste de mise en route.

## 1. Se connecter
La connexion se fait avec **Google** (ou Apple quand il est proposé) depuis la page « Connexion » du site : pas de mot de passe à créer. Un compte est créé automatiquement à la première connexion. Une fois connecté, le bouton « Dashboard » du site mène à l'application. Quand on est déconnecté, la racine du site montre la page d'accueil publique.

## 2. Relier son IA (obligatoire)
Sans liaison valide, l'application affiche la page « Relier mon IA » et rien d'autre (seuls « Mon compte » et la déconnexion répondent). Tu y choisis ton IA sur trois cartes (Claude, ChatGPT ou Gemini), puis comment t'y connecter : clé API (recommandée), abonnement ou compte (Claude, ChatGPT), ou clé Google AI Studio (Gemini). Détails dans le fichier sur la liaison de l'IA. Un membre d'équipe qui travaille sur les projets d'un autre n'a pas besoin de sa propre liaison.

## 2 bis. Faisons connaissance (une seule fois)
À ta première arrivée sur le tableau de bord (après la liaison de l'IA), iaboss affiche une page « Faisons connaissance » avec des questions générales sur toi, valables pour tous tes projets : ta fonction, ton niveau technique, ton expérience de la prospection, le niveau de détail que tu préfères dans les réponses, tutoiement ou vouvoiement, ce que tu veux faire avec iaboss, et une précision libre sur ta façon de travailler. Elle ne demande rien sur un projet précis (secteur, taille de l'entreprise, cible) : ces informations se règlent projet par projet, dans la section Cible. Tout est facultatif.
Les questions s'affichent **une à la fois** (7 au total) :
1. Choisis une réponse puis clique **Continuer**. Sans choix, **Continuer** passe simplement la question. **Retour** revient à la question précédente en gardant ta réponse.
2. En haut, « Question 3 sur 7 » et un pourcentage avec sa barre indiquent combien de questions sont déjà passées (0 % à la première, 14 % à la deuxième, 86 % à la dernière).
3. Quand tu valides une réponse, un grand cercle vert avec une coche apparaît en plein milieu de la carte, l'arrière-plan devenant flou un instant : c'est la confirmation que ta réponse est bien prise en compte. Puis la question suivante arrive de la droite vers la gauche. Sous la barre, une rangée de 7 pastilles se remplit : verte avec une coche pour chaque question à laquelle tu as répondu, vide pour une question passée sans réponse. Si ton système demande moins d'animations, le passage se fait sans mouvement (la confirmation reste affichée brièvement).
4. À la dernière question, le bouton devient **Terminer** : il enregistre ton profil. À tout moment, **Passer le questionnaire** ferme tout sans rien enregistrer.
5. La page ne revient plus d'elle-même. Tu peux la rouvrir et la modifier à tout moment : avatar → Mon compte → **Modifier mon profil** (toutes les questions s'affichent alors sur une seule page, avec **Enregistrer mon profil** et **Annuler**).
Pourquoi : l'IA adapte son vocabulaire, ses exemples et son niveau de détail à ton métier. Les réponses restent dans ton compte.

À la fin du questionnaire, un écran « Merci, ton espace est prêt » apparaît en fondu, puis le tableau de bord prend la place sans coupure. Une **visite guidée** démarre alors toute seule (voir le fichier « Visite guidée du tableau de bord ») : la page s'assombrit et chaque élément important est éclairé et expliqué l'un après l'autre. **Passer la visite** l'arrête ; avatar → **Visite guidée** la relance à tout moment.

## 3. Créer le premier projet
1. Page **Projets** → bouton **Nouveau projet**.
2. **Nom** : le nom du produit. **Dépôt Git** : l'adresse du dépôt, par exemple `https://github.com/utilisateur/projet.git`. Le lien ne pourra plus être modifié ensuite.
3. Clique **Créer et analyser**. Le dépôt est cloné (en lecture seule) puis analysé une fois par l'IA (avec le modèle d'analyse choisi dans Réglages → Modèles IA, Haiku par défaut) : l'analyse produit la fiche projet et une cible proposée. Compte quelques minutes.
4. Dépôt privé ou autre serveur Git : ajoute d'abord un token dans **Réglages → Dépôts Git**.

## 4. Valider la cible
Quand l'analyse est finie, la section **Cible** s'ouvre avec le badge « à valider ». Relis la description, la zone, la taille, le décideur, les secteurs et les requêtes de recherche, corrige si besoin, puis clique **Valider la cible**. Le badge « à valider » disparaît et la coche verte apparaît sur la section. Une fois validée, la cible est **grisée et en lecture seule** : pour la changer, clique **Modifier**, corrige, puis **Mettre à jour** (ou **Annuler** pour remettre ce qui était validé).

## 5. Chercher des prospects
Dans **Prospecter → Recherche de prospects** : choisis « Prospects à chercher » (de 1 à 50), « Quand » (Maintenant ou Cette nuit, 1h-6h), puis **Lancer la recherche**.

## 6. Régler l'adresse d'envoi (SMTP)
Dans **Configuration du projet**, renseigne le SMTP de l'adresse qui enverra les mails (hôte, port, utilisateur, mot de passe, email et nom expéditeur) puis **Enregistrer SMTP**. Sans SMTP, rien ne peut partir.

## 7. Le modèle de mail
Dans **Prospecter → Modèle de mail** : clique **Générer avec l'IA** (ou écris-le), relis l'objet et le corps, **Enregistrer** puis **Valider le modèle**. Le mail part en texte simple ; coche **Envoyer en mail HTML** avant de valider si tu veux un mail mis en forme. Seul un modèle validé peut être envoyé.

## 8. Le premier envoi
Dans **Prospecter → Envoi** : indique « Mails à envoyer » puis **Envoyer** et confirme. Voir le fichier sur les mails pour les garde-fous.

## La liste de mise en route
Dès qu'un projet existe, sa section **Mise en route** (la première du projet) guide la configuration : analyser le projet, valider la cible, chercher des prospects, SMTP, modèle de mail, premier envoi, puis le facultatif (boîte IMAP, relance automatique, idées d'évolution, compte LinkedIn relié, premier post publié).
- Le projet porte un badge « config 4/11 » (par exemple) sur sa ligne : **clique dessus pour ouvrir la liste** (il t'amène à la section **Mise en route** du projet). Il est orange tant que le projet n'est pas prêt à prospecter, vert avec une coche « config ✓ » une fois tout fait. La section affiche « 4 étapes sur 11 », et son titre devient **Prêt à prospecter** quand le nécessaire est fait. Si la liste ne peut pas se charger, la section affiche un message et un bouton **Réessayer** (voir « Une section ou une liste n'a pas pu se charger : Réessayer » dans le dépannage).
- Chaque ligne ouvre la bonne section du projet et y fait défiler la page.
- Les étapes terminées reçoivent une coche (et sont barrées dans la liste) ; les étapes facultatives sont marquées « facultatif ».
- La liste se calcule à chaque affichage d'après l'état réel du projet : une étape défaite (par exemple un jeton LinkedIn expiré) redevient « à faire ».
- Il n'y a plus de panneau qui flotte au-dessus de la page : la liste est une section comme les autres, repliée par défaut. Quand tout est fait, la section disparaît toute seule et le badge devient « config ✓ ». Quand tu termines une étape alors que la liste est ouverte, sa coche apparaît d'un petit saut ; quand la dernière est faite, le badge « config ✓ » apparaît de la même façon.
- Un membre d'équipe ne voit pas les étapes SMTP et IMAP (il ne peut pas les régler).

## Projet unique ou plusieurs projets
Avec **un seul projet**, il est déjà ouvert quand on arrive sur la page. Avec **plusieurs projets**, ils sont tous fermés : clique sur le nom du projet pour l'ouvrir.
