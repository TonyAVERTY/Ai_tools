---
nom: dev-implementer-fonctionnalite
titre: Implémenter une fonctionnalité dans un code existant
niveau: base
resume: Ajouter un comportement en réutilisant les abstractions du dépôt et sans casser l'existant.
intentions: feature
quand: ajout ou évolution d'un comportement dans un dépôt qui existe déjà.
pas_pour: correction de bug (voir débogage) ou réorganisation sans changement de comportement (voir refactoring).
prerequis: la demande et ses critères de réussite, une implémentation voisine à imiter, les contrats à préserver.
outils: Grep pour la fonctionnalité voisine et les points d'extension, Read pour les contrats, Glob pour les tests et la documentation à mettre à jour.
reussite: le comportement demandé existe, les comportements voisins sont inchangés, et le changement ressemble au reste du dépôt.
---
### Méthode
1. Trouve la fonctionnalité la plus proche déjà présente et suis son chemin complet : entrée, validation, logique, stockage, sortie, erreurs, tests, documentation.
2. Réutilise les bibliothèques, helpers, formats d'erreur et conventions de nommage déjà là ; n'introduis ni nouvelle abstraction ni nouvelle dépendance sans besoin démontré.
3. Fais le changement minimal et cohérent : un point d'entrée, la logique, les données si nécessaire, les tests, la documentation visible par l'utilisateur.
4. Préserve les contrats : champs existants, codes de retour, formats, comportement par défaut. Un ajout est facultatif et rétrocompatible par défaut.
5. Gère explicitement les cas limites et les erreurs de la même façon que le reste du code.
### Règles de décision
Deux emplacements possibles : celui où vit déjà le code voisin. Besoin d'un nouveau paramètre de configuration : valeur par défaut qui conserve l'ancien comportement. Changement de schéma : consulte la fiche sur les bases de données. Risque de casser un appelant : cherche-les tous avant de proposer.
### Contrôles qualité
Aucun fichier sans rapport avec la demande n'est touché. Chaque nouveau chemin est couvert par un test. Pas de code mort, de TODO sans objet, ni de valeur codée en dur qui devrait être configurable.
### Résultat attendu
Les changements fichier par fichier (diff ou blocs de code), les tests ajoutés, les commandes de vérification du profil du dépôt, les risques et ce qui n'a pas été vérifié.
### Clarifier quand
Le comportement attendu a plusieurs lectures raisonnables, ou il contredit un comportement existant.
### Arrêt et escalade
La fonctionnalité exige de changer un contrat public ou une architecture : présente l'impact et demande validation avant de détailler.
