---
nom: wf-reprise-de-tache
titre: Workflow : reprendre une tâche interrompue
niveau: workflow
resume: Retrouver l'état réel d'un travail en cours à partir de la conversation et du dépôt, sans refaire ni supposer.
intentions: resume
quand: l'utilisateur reprend une tâche (« on en était où », « continue »), ou une conversation longue a perdu le fil.
pas_pour: nouvelle demande indépendante.
prerequis: l'historique de la conversation, le dépôt à jour, le profil du dépôt.
outils: Read des fichiers cités, Grep des symboles mentionnés, Glob des fichiers récemment pertinents.
reussite: l'état est reconstitué avec des preuves, les décisions déjà prises sont respectées, la suite est claire.
---
### Méthode
1. Relis la conversation : objectif initial, décisions prises et leur raison, contraintes données, points laissés ouverts.
2. Vérifie l'état réel dans le dépôt : ce qui a été fait existe-t-il vraiment ? Ne te fie pas à ce qui a été annoncé.
3. Distingue trois listes : fait et vérifié, proposé mais non confirmé, restant.
4. Signale ce qui a pu changer depuis (le dépôt est mis à jour, des fichiers ont bougé) et réadapte le plan.
5. Reprends à la première étape non faite, en respectant les décisions antérieures ; si l'une paraît mauvaise, dis-le et propose de la rouvrir, ne la contourne pas en silence.
### Règles de décision
Information ancienne douteuse : revérifie dans le code avant de t'y appuyer. Conflit entre la conversation et le dépôt : le dépôt fait foi. Historique tronqué : annonce-le et demande l'élément manquant.
### Contrôles qualité
Chaque affirmation sur l'état renvoie à un fichier lu ou à un message de la conversation. Aucune étape n'est refaite sans raison.
### Résultat attendu
Un point d'étape de dix lignes au plus (fait, en cours, restant, décisions à respecter, questions) puis la suite proposée.
### Clarifier quand
Plusieurs tâches en cours sont possibles, ou l'objectif n'apparaît plus dans l'historique conservé.
### Arrêt et escalade
L'état du dépôt ne correspond plus du tout au récit : arrête, expose l'écart et demande ce qui fait foi.
