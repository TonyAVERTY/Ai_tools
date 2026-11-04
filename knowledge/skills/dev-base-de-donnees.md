---
nom: dev-base-de-donnees
titre: Modifier un schéma de base de données et ses migrations
niveau: specialise
resume: Changer un schéma ou une requête sans perte de données, avec migration rejouable et code compatible pendant la transition.
intentions: db, feature, refactor, perf, debug
signaux: db
quand: nouvelle table ou colonne, changement de type, index, migration, requête lente ou fausse, modèle d'ORM.
pas_pour: simple lecture d'un enregistrement via une API existante sans changement de schéma.
prerequis: l'outil de migration du dépôt, les migrations existantes (ordre, nommage), le SGBD visé, la taille probable des données.
outils: Glob des migrations et du schéma, Grep des usages de la table ou de la colonne, Read de la dernière migration pour en copier la forme.
reussite: la migration s'applique sur une base existante sans perte, peut être rejouée ou annulée, et le code fonctionne avant, pendant et après.
---
### Méthode
1. Lis les migrations existantes : outil, convention de nommage, ordre, style (SQL brut ou ORM), gestion de la version appliquée. Suis-les à la lettre.
2. Cherche tous les usages de la table ou de la colonne (Grep) : requêtes, modèles, exports, tests, jeux de données, documentation.
3. Ajoute en fin de chaîne, jamais au milieu d'une migration déjà appliquée ; ne modifie jamais une migration déjà livrée.
4. Rends la migration sûre : valeur par défaut pour une colonne obligatoire sur table remplie, étapes séparées pour les changements destructeurs (ajouter, copier, basculer, supprimer plus tard), index créés sans verrouiller quand le SGBD le permet.
5. Vérifie la compatibilité : l'ancien code tourne-t-il sur le nouveau schéma pendant le déploiement ? Le nouveau code sur l'ancien ?
6. Pour une requête : lis les conditions, jointures et index disponibles ; cherche N+1, absence d'index, fonctions sur colonne indexée, pagination par décalage sur gros volumes.
### Règles de décision
Suppression de colonne ou de table, changement de type avec perte, renommage : traite comme irréversible, exige une sauvegarde et une confirmation explicite de l'utilisateur. Plusieurs SGBD pris en charge : écris pour le plus restrictif et précise ce qui diffère. Donnée existante invalide pour la nouvelle contrainte : prévois la correction avant la contrainte.
### Contrôles qualité
La migration est rejouable ou gardée par une condition, le retour arrière est décrit, les tests de migration existants sont étendus, et les SGBD non testables sont nommés.
### Résultat attendu
Migration proposée, modifications du code, plan de déploiement ordonné, retour arrière, commandes de vérification du dépôt, risques.
### Clarifier quand
Le volume de données ou les contraintes de disponibilité sont inconnus et changent la méthode de migration.
### Arrêt et escalade
Opération destructrice sur des données de production : ne la présente jamais comme anodine ; demande confirmation et rappelle la sauvegarde.
