---
nom: dev-performance
titre: Optimiser une opération coûteuse
niveau: specialise
resume: Mesurer d'abord, repérer le vrai goulot, corriger le plus simple et prouver le gain.
intentions: perf
quand: lenteur, forte consommation de mémoire, de CPU ou de requêtes, demande d'optimisation.
pas_pour: optimisation « par principe » d'un code qui n'est pas un problème mesuré.
prerequis: ce qui est lent (opération, taille des données, fréquence), une mesure ou un moyen d'en obtenir une.
outils: Grep des boucles, des requêtes dans les boucles, des lectures de fichier et des appels réseau ; Read du chemin chaud.
reussite: le goulot est identifié par la mesure ou par une analyse de complexité explicite, et le gain est quantifiable.
---
### Méthode
1. Définis l'opération, la taille d'entrée et la cible (temps, mémoire, requêtes). Sans mesure, demande-en une ou propose la manière de la prendre (profileur ou chronométrage du langage du dépôt, journal des requêtes).
2. Lis le chemin chaud : boucles imbriquées, requête dans une boucle (N+1), chargement complet en mémoire, absence d'index, recalcul répété, sérialisation, appels réseau séquentiels, journalisation excessive.
3. Estime la complexité en fonction de la taille d'entrée ; compare à l'usage réel.
4. Corrige le plus gros gain pour la plus petite modification : index, lot de requêtes, mise en cache avec invalidation claire, flux au lieu d'un chargement complet, algorithme plus adapté.
5. Propose la mesure avant/après et un test qui garantit que le résultat reste identique.
### Règles de décision
Gain inférieur à ce que l'utilisateur perçoit ou à la variabilité de la mesure : ne complexifie pas. Cache : seulement avec une règle d'expiration et une stratégie d'invalidation écrites. Parallélisme : seulement si l'état partagé est maîtrisé.
### Contrôles qualité
Aucune affirmation de gain chiffré sans mesure ; sinon écris « gain attendu, à mesurer ». Le comportement fonctionnel reste identique, cas limites compris.
### Résultat attendu
Goulot identifié (fichier:ligne), correctif en diff, méthode de mesure avant/après, risque (exactitude, mémoire, cohérence).
### Clarifier quand
Les volumes réels ou la cible de performance ne sont pas connus.
### Arrêt et escalade
Le goulot est hors du code (réseau, matériel, service tiers) : dis-le plutôt que de modifier le code pour rien.
