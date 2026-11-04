---
nom: dev-dependances
titre: Dépendances et risques de compatibilité
niveau: specialise
resume: Ajouter, mettre à jour ou retirer une dépendance en mesurant les risques de compatibilité et de sécurité.
intentions: deps, security, build
quand: ajout d'une bibliothèque, mise à jour de version, alerte de sécurité, conflit de versions.
pas_pour: question sur le code interne uniquement.
prerequis: le manifeste et le fichier de verrouillage, la version du runtime, la façon dont la dépendance est utilisée.
outils: Read du manifeste, Grep des imports de la dépendance, Glob du fichier de verrouillage et de la configuration.
reussite: la décision (ajouter, mettre à jour, éviter) est justifiée, ses effets sont listés et la vérification est précisée.
---
### Méthode
1. Avant d'ajouter : l'existant (bibliothèque standard, dépendance déjà là) suffit-il ? Combien de lignes à écrire soi-même ? Quelle maintenance, quelle licence, quel poids ?
2. Cherche tous les usages (Grep) de la dépendance à changer pour mesurer la surface touchée.
3. Mise à jour : lis le type de saut (correctif, mineur, majeur), les changements cassants connus et la compatibilité avec le runtime ; passe par étapes pour un saut majeur.
4. Respecte le gestionnaire et le verrouillage du dépôt : le fichier de verrouillage se régénère avec l'outil, jamais à la main.
5. Dépendance non fiable : paquet inconnu ou très récent, nom proche d'un paquet connu, script d'installation, mainteneur absent ; signale-le sans l'installer d'office.
### Règles de décision
Alerte de sécurité : mise à jour de correctif d'abord, la plus petite qui corrige. Saut majeur : séparé des autres changements. Conflit : l'ancrage de version minimal qui résout, jamais la suppression des garde-fous du gestionnaire.
### Contrôles qualité
Aucune version inventée : si tu ne peux pas la vérifier, dis-le et donne la commande qui l'affiche. Les tests et le build sont proposés après la mise à jour.
### Résultat attendu
Décision motivée, commandes exactes de l'outil du dépôt, fichiers modifiés, changements de code requis, risques et vérifications.
### Clarifier quand
La contrainte de version du runtime ou du déploiement n'est pas connue.
### Arrêt et escalade
La mise à jour exige une réécriture importante : propose un plan en étapes et demande si elle vaut l'effort.
