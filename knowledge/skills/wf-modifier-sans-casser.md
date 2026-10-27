---
nom: wf-modifier-sans-casser
titre: Workflow : modifier un projet existant sans casser l'existant
niveau: workflow
resume: Enchaîner comprendre, planifier, changer, vérifier et relire pour une fonctionnalité ou un refactoring de taille moyenne ou plus.
intentions: feature, refactor, migrate
quand: changement multi-fichiers, contrat public touché, risque modéré à élevé ; mode structuré ou approfondi.
pas_pour: petite modification locale (réponse directe) ou question d'explication.
prerequis: la demande, le profil du dépôt, l'accès en lecture au code.
outils: les fiches de base (comprendre, planifier, implémenter ou refactorer, tests, revue), Read, Grep, Glob.
reussite: la livraison proposée est complète, cohérente avec le dépôt, vérifiable, et ses risques sont écrits.
---
### Méthode
1. Comprendre : lis les instructions locales, une implémentation voisine et les contrats touchés (fiche « Comprendre un dépôt »). Arrête-toi dès que tu peux planifier.
2. Planifier : critères de réussite, fichiers, ordre, vérification de chaque étape (fiche « Planifier un changement »). Si le plan montre une décision qui change un contrat, pose la question maintenant.
3. Changer : applique les étapes dans l'ordre, minimalement, avec les conventions du dépôt.
4. Vérifier : tests à ajouter, commandes du profil du dépôt, résultat attendu de chacune (fiche « Tester et vérifier »).
5. Relire : relis ton propre changement comme un relecteur (fiche « Revoir un changement ») : appelants oubliés, cas limites, documentation, fichiers sans rapport.
### Règles de décision
Chaque étape en trop doit se justifier par un risque réel. Si une étape révèle que l'hypothèse de départ est fausse, reviens à l'étape précédente et dis-le. Ne fusionne jamais le correctif d'un bug découvert en chemin avec la demande : signale-le à part.
### Contrôles qualité
La demande initiale est satisfaite point par point. Aucun fichier hors sujet. Ce qui est vérifié, à vérifier et non vérifiable est séparé. Les risques résiduels sont écrits.
### Résultat attendu
Un plan court, les changements par fichier, les tests, les commandes de vérification, les risques, puis une revue finale de trois lignes.
### Clarifier quand
Un critère de réussite manque ou deux lectures de la demande divergent (voir « Exigences incomplètes ou contradictoires »).
### Arrêt et escalade
Le périmètre explose ou une décision d'architecture est requise : arrête, présente les options et la recommandation, et demande de trancher.
