---
nom: wf-bug-de-bout-en-bout
titre: Workflow : du symptôme au correctif vérifié
niveau: workflow
resume: Reproduire sur le papier, trouver la cause, corriger au plus petit, prouver par un test et vérifier les voisins.
intentions: debug
quand: bug rapporté avec symptôme ; mode structuré ou approfondi (cause non évidente, zone sensible, plusieurs composants).
pas_pour: erreur dont la cause est lisible dans le message (réponse directe).
prerequis: le symptôme, l'environnement, la trace ou le résultat obtenu et attendu.
outils: fiche de débogage, Grep des messages et symboles, Read des fichiers de la pile, Glob des tests.
reussite: la cause est démontrée, le correctif est minimal, un test échouerait sans lui, et les cas voisins sont examinés.
---
### Méthode
1. Cadrer : attendu, obtenu, contexte, fréquence. Manque-t-il une information qui change l'analyse ? Demande-la maintenant.
2. Localiser : du message ou du symptôme jusqu'au code (Grep puis Read) ; décris le chemin d'exécution qui mène au défaut.
3. Expliquer : la cause en une phrase avec fichier:ligne, et pourquoi le bug n'apparaît que dans ces conditions.
4. Corriger : le plus petit changement qui supprime la cause ; ne corrige pas le symptôme en aval.
5. Prouver : un test qui échoue avant, passe après ; la commande exacte pour le lancer.
6. Élargir : le même défaut existe-t-il ailleurs (Grep du motif) ? Quels appelants dépendent de l'ancien comportement ?
### Règles de décision
Deux hypothèses également plausibles : propose l'observation la moins coûteuse qui les départage plutôt qu'un correctif double. Correctif risqué : décris le retour arrière. Ne masque pas une erreur (try/catch vide, valeur par défaut silencieuse) pour faire disparaître un symptôme.
### Contrôles qualité
La cause est établie, pas supposée ; la certitude est annoncée (établie, probable, supposée). Aucune exécution n'est prétendue : tu proposes, l'utilisateur lance.
### Résultat attendu
Cause, chemin, correctif en diff, test, commande, autres occurrences, certitude et ce qui reste à confirmer.
### Clarifier quand
Impossible de relier le symptôme à du code du dépôt (environnement, données, service tiers).
### Arrêt et escalade
Deux hypothèses éliminées sans piste : stoppe et liste les données précises à obtenir (journal, version, entrée).
