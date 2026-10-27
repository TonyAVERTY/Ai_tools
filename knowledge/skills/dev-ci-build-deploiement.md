---
nom: dev-ci-build-deploiement
titre: Build, intégration continue et déploiement
niveau: specialise
resume: Diagnostiquer un échec de build ou de pipeline et modifier la configuration d'intégration ou de déploiement sans risque.
intentions: build, debug
signaux: ci, docker
quand: pipeline en échec, build cassé, Dockerfile, configuration de déploiement, variables d'environnement, version d'outil.
pas_pour: bug applicatif sans lien avec le build.
prerequis: la configuration du pipeline, les commandes de build et de test du profil du dépôt, la sortie de l'erreur.
outils: Read des fichiers de pipeline et de conteneur, Grep des variables et scripts appelés, Glob des scripts.
reussite: la première cause d'échec est identifiée et corrigée, et le pipeline reste aussi strict qu'avant.
---
### Méthode
1. Lis la première erreur du journal, pas la dernière : les suivantes en découlent souvent.
2. Compare local et pipeline : versions d'outils et de runtime, variables d'environnement, dépendances installées depuis le verrouillage ou non, système d'exploitation, droits, réseau, ordre des étapes.
3. Remonte au changement récent : dépendance, version d'image, fichier de configuration, commande modifiée.
4. Corrige à la source (version épinglée, commande, variable déclarée), pas en désactivant l'étape.
5. Pour un Dockerfile : couches ordonnées pour le cache, image de base épinglée, utilisateur non root, aucun secret copié dans l'image, fichier d'exclusion à jour.
### Règles de décision
Ne désactive, ne saute et ne mets jamais en « autorisé à échouer » un test, un lint ou une étape de sécurité pour faire passer un pipeline. Un secret manquant se déclare dans le coffre du service, jamais dans le dépôt. Un changement de déploiement en production est irréversible tant qu'il n'est pas expliqué : décris le retour arrière.
### Contrôles qualité
Le pipeline modifié exécute au moins les mêmes contrôles qu'avant. Aucune valeur secrète n'apparaît. La commande équivalente en local est donnée quand elle existe.
### Résultat attendu
Cause (étape, ligne du journal, fichier), correctif en diff, commande locale pour reproduire, effets sur les autres jobs, retour arrière.
### Clarifier quand
Le journal d'échec manque ou le service d'exécution est inconnu.
### Arrêt et escalade
L'échec dépend d'une ressource que tu ne vois pas (secret, runner, quota, service externe) : dis exactement laquelle vérifier.
