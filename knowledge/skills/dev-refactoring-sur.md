---
nom: dev-refactoring-sur
titre: Refactorer sans changer le comportement
niveau: base
resume: Réorganiser le code par petites étapes vérifiables en gardant le contrat fonctionnel intact.
intentions: refactor
quand: simplifier, découper, renommer, déplacer ou dédupliquer du code sans modifier ce qu'il fait.
pas_pour: ajout de fonctionnalité ou correction de bug (à faire séparément), réécriture complète non demandée.
prerequis: les tests qui couvrent la zone (ou la décision d'en ajouter d'abord), la liste des appelants et des contrats publics.
outils: Grep de tous les usages (y compris chaînes, configuration, documentation), Read des tests, Glob des fichiers liés.
reussite: le comportement observable est identique, chaque étape est vérifiable seule, le code est plus simple à lire qu'avant.
---
### Méthode
1. Fixe le contrat : ce qui est observable de l'extérieur (signatures, formats, erreurs, ordre des effets). Il ne change pas.
2. Vérifie le filet : les tests existants couvrent-ils la zone ? Sinon ajoute d'abord des tests de caractérisation qui décrivent le comportement actuel, même imparfait.
3. Cherche tous les usages (Grep), y compris dans les chaînes, les fichiers de configuration, les templates et la documentation.
4. Procède par étapes minuscules : renommer, extraire, déplacer, puis simplifier ; chaque étape laisse tests et build corrects.
5. Ne mélange jamais refactoring et changement de comportement dans une même étape ; si tu découvres un bug, note-le à part.
### Règles de décision
Renommage d'un symbole public ou exporté : conserve un alias le temps de migrer les appelants si l'on ne maîtrise pas tous les usages. Duplication : factorise à partir de trois occurrences ou quand elles doivent évoluer ensemble. Code qui paraît mort : prouve qu'il n'est appelé nulle part (y compris par réflexion ou configuration) avant de proposer de le supprimer.
### Contrôles qualité
Le diff ne contient que du déplacement ou de la simplification. Les tests de la zone sont inchangés (sinon c'est un changement de comportement, à signaler). Les imports, exports et références sont à jour.
### Résultat attendu
Les étapes ordonnées, chacune avec ses fichiers et sa vérification (commande du profil du dépôt), le contrat préservé et les risques résiduels.
### Clarifier quand
Le périmètre du refactoring est flou, ou le « comportement actuel » est lui-même contesté.
### Arrêt et escalade
Aucun test possible et risque élevé (finance, droits, données) : propose d'abord le filet de tests, ne propose pas la réorganisation à l'aveugle.
