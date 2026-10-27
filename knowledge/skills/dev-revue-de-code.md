---
nom: dev-revue-de-code
titre: Revoir un changement avant livraison
niveau: base
resume: Relire un changement comme un relecteur exigeant : correction, régressions, sécurité, cohérence, et ce qui manque pour le livrer.
intentions: review, commit
quand: revue d'un diff, d'un fichier ou d'une branche ; vérification avant de livrer ; préparation d'un commit ou d'une description de changement.
pas_pour: audit complet d'un dépôt (voir l'audit du projet), ou code qu'on ne peut pas lire.
prerequis: le changement lui-même (diff ou fichiers), l'intention du changement, les tests de la zone.
outils: Read du code modifié et de ses appelants, Grep des usages des symboles changés, Glob des tests.
reussite: chaque remarque est vérifiée, classée par gravité, localisée, et assortie d'un correctif ; aucun faux positif présenté comme certain.
---
### Méthode
1. Lis d'abord l'intention (description, nom de branche, message) puis le diff ; demande-toi si le changement fait ce qu'il annonce et seulement cela.
2. Pour chaque symbole modifié, cherche ses appelants (Grep) : un contrat changé sans mise à jour des appelants est le défaut le plus fréquent.
3. Passe en revue : entrées non validées, cas limites (vide, nul, grand, concurrent), erreurs avalées, ressources non libérées, droits et isolation des données, secrets, migrations irréversibles, dépendances ajoutées.
4. Vérifie la couverture : un test échouerait-il si le changement était retiré ? Les messages d'erreur, la documentation et la configuration suivent-ils ?
5. Vérifie ce que tu affirmes : trace le chemin de code qui mène au défaut avant de le signaler.
### Règles de décision
Gravité : bloquant (perte de données, faille, régression certaine), important (bug probable, contrat cassé), mineur (lisibilité, nommage). Reste sur le changement relu, pas sur le style personnel ; respecte les conventions du dépôt. Défaut préexistant : signale-le à part, il ne bloque pas ce changement.
### Contrôles qualité
Aucun défaut sans fichier:ligne et sans scénario concret. Les points solides sont cités aussi, brièvement. Le nombre de remarques est proportionné : mieux vaut 4 réelles que 15 spéculatives.
### Résultat attendu
Verdict (prêt / à corriger), remarques classées avec fichier:ligne, impact et correctif, tests manquants, et pour un commit : un message au format utilisé par le dépôt, décrivant le pourquoi.
### Clarifier quand
L'intention du changement n'est pas claire : tu ne peux pas juger la correction d'un code dont tu ignores le but.
### Arrêt et escalade
Le diff est trop grand pour être relu sérieusement : demande de le découper, ou limite la revue aux fichiers à risque en le disant.
