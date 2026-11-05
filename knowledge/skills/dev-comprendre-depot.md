---
nom: dev-comprendre-depot
titre: Comprendre un dépôt avant d'y toucher
niveau: base
resume: Se repérer vite dans un dépôt inconnu (stack, structure, conventions, fichiers utiles) en lisant peu et bien.
intentions: explain, review, debug, feature, refactor, tests, docs, deps, resume
quand: dépôt inconnu, question « comment ça marche / où est », début de toute tâche qui touche au code.
pas_pour: question qui ne dépend pas du code (concept général), ou fichier déjà entièrement fourni dans la conversation.
prerequis: le profil du dépôt (constats d'iaboss) s'il existe ; sinon la liste des fichiers à la racine.
outils: Glob pour la structure, Grep pour les symboles et les appels, Read pour les fichiers retenus.
reussite: tu peux citer les fichiers lus, nommer la stack et les conventions, et dire ce que tu n'as pas lu.
---
### Méthode
1. Pars du profil du dépôt fourni : stack, commandes, tests, intégration continue sont déjà établis ; ne les redécouvre pas, vérifie seulement ce dont dépend ta réponse.
2. Lis dans cet ordre, en t'arrêtant dès que tu peux répondre : instructions locales (CLAUDE.md, AGENTS.md, CONTRIBUTING), README, manifeste, point d'entrée, puis uniquement les fichiers que la question désigne.
3. Cherche avant de lire : Grep sur le nom exact du symbole, de la route, du message d'erreur ou du champ ; Glob sur le motif de nom. Lis ensuite les extraits autour, pas des fichiers entiers.
4. Cherche une implémentation voisine de ce qui est demandé : elle donne la convention (nommage, erreurs, tests) à reproduire.
5. Note les contrats : signatures publiques, formats d'échange, schémas, ce qui est appelé de l'extérieur.
### Règles de décision
Plusieurs candidats pour un même rôle : prends celui qui est appelé depuis le point d'entrée, pas celui qui a le meilleur nom. Fichier généré, vendorisé ou de verrouillage : ne le lis pas. Plus de 15 fichiers lus sans réponse : reformule ta recherche au lieu d'en lire d'autres.
### Contrôles qualité
Chaque affirmation sur le code renvoie à un fichier réellement lu (chemin, ligne si possible). Ce que tu déduis sans l'avoir lu est dit « supposé ».
### Résultat attendu
Un résumé court : stack, structure utile, conventions repérées, fichiers concernés, et ce qui reste inconnu.
### Clarifier quand
La question vise un comportement qui dépend d'un environnement, d'une configuration ou de données que le dépôt ne contient pas.
### Arrêt et escalade
Le code utile est absent du dépôt (service externe, sous-module non cloné) : dis-le et demande l'élément manquant plutôt que de l'imaginer.
