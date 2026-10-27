---
nom: dev-debogage-cause-racine
titre: Déboguer jusqu'à la cause racine
niveau: base
resume: Passer du symptôme à la cause avec des hypothèses testables, pas des correctifs au hasard ; vaut aussi pour les échecs de tests, de build, de lint et de CI.
intentions: debug, build
quand: erreur, plantage, résultat faux, test ou build qui échoue, comportement différent entre environnements.
pas_pour: demande de nouvelle fonctionnalité, ou question sans symptôme.
prerequis: le symptôme exact (message, trace, entrée, résultat attendu et obtenu) et l'environnement ; sinon les demander.
outils: Grep sur le message d'erreur et les symboles de la trace, Read des fichiers de la pile d'appels, lecture des tests voisins.
reussite: la cause est expliquée par un chemin de code précis, le correctif la supprime, et un test ou une procédure la reproduit.
---
### Méthode
1. Reformule le symptôme : attendu, obtenu, depuis quand, dans quel environnement. Une trace d'erreur se lit de la dernière ligne vers le haut jusqu'au premier fichier du projet.
2. Localise : Grep du message exact, puis Read de la fonction qui le produit et de ses appelants.
3. Pose 2 ou 3 hypothèses classées par probabilité, chacune avec l'observation qui la confirmerait ou l'éliminerait (valeur lue, branche prise, version, configuration).
4. Élimine par l'observation : lis le code réel du chemin, pas ce que le nom de la fonction laisse croire. Cherche ce qui a changé récemment (fichiers voisins, dépendances, configuration) quand le symptôme est nouveau.
5. Écris la cause en une phrase qui nomme un fichier et une ligne. Si tu ne peux pas, tu n'as pas la cause.
6. Propose le correctif le plus petit qui supprime la cause, puis le test qui échouait avant et réussit après.
### Règles de décision
Échec de test : ce qui est faux, le test ou le code ? Relis l'intention du test avant de toucher à l'un ou à l'autre ; ne modifie jamais un test pour le faire passer sans l'expliquer. Échec intermittent : cherche l'état partagé, l'horloge, l'ordre, la concurrence ; ne conclus pas « instable ». Build ou CI qui échoue : lis la première erreur, pas la dernière, et compare avec la version locale (outils, variables, versions).
### Contrôles qualité
Le correctif traite la cause et pas seulement le symptôme. Les cas voisins (autre appelant, autre entrée, valeur vide) sont examinés. Tu dis ce que tu n'as pas pu reproduire, car tu n'exécutes rien.
### Résultat attendu
Cause (fichier:ligne), chemin qui y mène, correctif proposé en diff, test de non-régression, commande exacte pour le lancer, certitude (établie, probable, supposée).
### Clarifier quand
Le symptôme n'est pas décrit ou ne se déduit pas du code, ou il dépend de données ou d'un environnement que tu ne vois pas.
### Arrêt et escalade
Après deux hypothèses éliminées sans nouvelle piste, arrête les essais : liste ce qui est établi, ce qui reste ouvert et la donnée à obtenir (journal, version, entrée) pour avancer.
