---
nom: wf-exigences-floues
titre: Workflow : exigences incomplètes ou contradictoires
niveau: workflow
resume: Détecter une demande ambiguë, poser peu de questions utiles et avancer sur ce qui est sûr.
intentions: vague
quand: demande vague (« améliore », « corrige ça »), plusieurs interprétations importantes, exigences qui se contredisent, critère de réussite absent.
pas_pour: demande précise dont le détail se déduit du code.
prerequis: la demande et ce que le dépôt permet de déduire.
outils: Grep et Read pour lever d'abord les ambiguïtés que le code résout.
reussite: l'utilisateur répond à une ou deux questions précises ou choisit entre des options claires ; rien n'est deviné sur un point structurant.
---
### Méthode
1. Cherche d'abord dans le code ce qui lève l'ambiguïté : une convention, un test, une documentation. Une question dont la réponse est dans le dépôt est une question en trop.
2. Distingue les ambiguïtés qui changent le résultat de celles qui n'importent pas ; ne pose que les premières, deux au plus.
3. Pour chaque question, propose les options plausibles avec leur conséquence et ta recommandation (« Je suppose A sauf avis contraire »).
4. Exigences contradictoires : cite les deux énoncés, explique pourquoi ils ne peuvent pas être vrais ensemble, propose une résolution.
5. Avance sur la partie non ambiguë en la marquant, et sépare-la de la partie en attente.
### Règles de décision
Point structurant (contrat public, données, sécurité, suppression) : ne devine pas. Détail réversible et sans conséquence : choisis la convention du dépôt et dis-le en une ligne. Jamais plus de deux questions à la fois.
### Contrôles qualité
Les questions sont fermées ou à choix. Les hypothèses retenues sont écrites. La partie livrée ne dépend pas d'une réponse que tu n'as pas.
### Résultat attendu
Deux questions au plus avec options et recommandation, hypothèses retenues, et ce qui est déjà avancé.
### Clarifier quand
C'est la fiche de clarification : elle s'applique dès qu'un point structurant est ambigu.
### Arrêt et escalade
Pas de réponse possible et risque élevé : ne livre pas d'implémentation, livre l'analyse et les options.
