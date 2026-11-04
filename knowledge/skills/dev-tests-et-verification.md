---
nom: dev-tests-et-verification
titre: Tester et vérifier honnêtement
niveau: base
resume: Choisir les tests qui prouvent un changement et distinguer clairement ce qui a été exécuté de ce qui ne l'a pas été.
intentions: tests, feature, refactor, debug, review
quand: écrire ou améliorer des tests, décider comment valider un changement, préparer la vérification d'une livraison.
pas_pour: tâche purement rédactionnelle sans code.
prerequis: les commandes de test, lint, types et build du profil du dépôt, et les tests déjà présents dans la zone.
outils: Glob et Read pour les tests existants et leurs aides, Grep pour les conventions de nommage et de données de test.
reussite: chaque comportement modifié a un test qui échouerait sans le changement, et les vérifications annoncées sont exactement celles qui sont proposées ou exécutées.
---
### Méthode
1. Repère les tests voisins du code touché : framework, emplacement, nommage, données de test, aides communes. Reproduis ce style.
2. Pour chaque comportement changé : un test du cas nominal, un test du cas limite le plus probable (vide, borne, erreur, droits), et un test qui aurait échoué avant le changement.
3. Teste le comportement observable (entrée, sortie, effet), pas l'implémentation interne ; pas de test qui répète le code testé.
4. Choisis les contrôles les plus pertinents parmi : test ciblé, régression de la zone, types, lint et formatage, build, migration, contrôle de sécurité. Donne la commande exacte tirée du profil du dépôt.
5. Dans ta réponse, sépare : « exécuté » (jamais le cas ici, tu ne lances rien), « à lancer » (commande exacte, résultat attendu) et « non vérifiable » (avec la raison).
### Règles de décision
Pas de test existant dans la zone : propose un test minimal et indique la commande, sans imposer un nouveau framework. Test lent ou dépendant du réseau : isole-le et dis-le. Couverture : vise les chemins qui comptent, pas un pourcentage.
### Contrôles qualité
Aucune phrase du type « les tests passent » sans résultat obtenu. Un test ne dépend ni de l'ordre, ni de l'heure, ni du hasard non maîtrisé.
### Résultat attendu
Tests proposés (fichier, cas), commande de vérification, résultat attendu de chacune, liste de ce qui n'a pas été vérifié et pourquoi.
### Clarifier quand
Le comportement attendu n'est pas défini : écrire un test reviendrait à figer une hypothèse.
### Arrêt et escalade
Le code est intestable en l'état (dépendances en dur, état global) : décris le plus petit changement qui le rend testable plutôt que d'écrire un test factice.
