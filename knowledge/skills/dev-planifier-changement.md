---
nom: dev-planifier-changement
titre: Planifier un changement proportionné
niveau: base
resume: Transformer une demande en plan court : fichiers touchés, ordre, critères de réussite, risques, sans plan inutile pour un petit changement.
intentions: feature, refactor, migrate, build
quand: changement qui touche plusieurs fichiers, un contrat public, des données ou un comportement existant.
pas_pour: correction d'une ligne ou d'une faute de frappe, question d'explication.
prerequis: avoir compris le code concerné (dev-comprendre-depot) et la demande exacte.
outils: Grep pour trouver tous les appelants et usages, Read pour les contrats.
reussite: un tiers peut exécuter le plan sans te reposer de question, et sait à quoi l'on voit que c'est réussi.
---
### Méthode
1. Écris la demande en une phrase et ses critères de réussite observables (ce qui doit marcher, ce qui ne doit pas changer).
2. Liste les fichiers à modifier et pourquoi, en cherchant tous les usages (Grep) des symboles touchés : appelants, tests, documentation, configuration, migrations.
3. Ordonne par dépendance : ce qui doit exister avant ce qui l'utilise ; isole l'étape qui est la plus risquée et fais-la en premier ou derrière un garde-fou.
4. Découpe en étapes qui laissent le dépôt cohérent (tests verts) à chacune.
5. Pour chaque étape, dis comment la vérifier (commande du profil du dépôt, test à ajouter, contrôle manuel).
### Règles de décision
Moins de 3 fichiers et aucun contrat public : pas de plan, passe directement aux changements. Plusieurs approches viables : présente la plus simple qui respecte les conventions du dépôt, et mentionne l'alternative en une ligne si elle change un contrat. Nouvelle dépendance : seulement si l'existant ne suffit pas, et dis pourquoi.
### Contrôles qualité
Aucune étape ne modifie un fichier sans rapport avec la demande. Le plan cite les tests existants qui couvrent la zone et ceux à ajouter.
### Résultat attendu
Critères de réussite, liste ordonnée d'étapes avec fichiers et vérification, risques, et ce qui est volontairement hors périmètre.
### Clarifier quand
Deux lectures de la demande mènent à des changements très différents, ou un critère de réussite manque et ne peut pas se déduire du code.
### Arrêt et escalade
Le plan dépasse l'ampleur raisonnable d'une session (réécriture, changement d'architecture) : propose un découpage en livraisons et demande laquelle commencer.
