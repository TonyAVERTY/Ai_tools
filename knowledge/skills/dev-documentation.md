---
nom: dev-documentation
titre: Documentation technique exacte
niveau: specialise
resume: Écrire ou corriger une documentation qui décrit ce que le code fait vraiment, avec des commandes qui marchent.
intentions: docs
quand: README, guide d'installation, documentation d'architecture ou d'API, commentaires de fonctions publiques, notes de version.
pas_pour: documentation commerciale ou marketing.
prerequis: le code décrit, les commandes du profil du dépôt, le public visé (utilisateur, contributeur, intégrateur).
outils: Read du code et des fichiers de configuration, Grep des options et variables d'environnement, Glob de la documentation existante.
reussite: chaque affirmation et chaque commande peut être rattachée au code ou à un fichier de configuration lu.
---
### Méthode
1. Identifie le lecteur et sa question : installer, utiliser, contribuer, comprendre une décision.
2. Lis le code qui fait réellement ce qui est décrit ; relève variables d'environnement, options, valeurs par défaut, erreurs, prérequis.
3. Reprends la structure et le ton de la documentation existante ; mets à jour plutôt que dupliquer.
4. Donne des commandes complètes, dans l'ordre, avec le résultat attendu ; utilise celles du profil du dépôt.
5. Pour l'architecture : le pourquoi des décisions, les frontières entre modules, les flux de données, ce qu'il ne faut pas casser.
### Règles de décision
Documentation et code divergent : le code fait foi, signale l'écart. Information introuvable : marque « à compléter » au lieu d'inventer. Commentaire de code : explique le pourquoi, pas le quoi évident.
### Contrôles qualité
Aucune commande non vérifiable présentée comme testée. Les chemins, noms d'options et variables existent. Pas de duplication d'un texte déjà présent ailleurs.
### Résultat attendu
Le texte à ajouter ou corriger, l'emplacement exact, et la liste des affirmations à faire confirmer.
### Clarifier quand
Le public visé ou le niveau de détail attendu n'est pas clair.
### Arrêt et escalade
La documentation existante est contradictoire avec elle-même : liste les contradictions et demande laquelle fait foi.
