---
nom: dev-securite
titre: Analyser la sécurité d'un code
niveau: specialise
resume: Trouver les failles réelles (accès, entrées, secrets, dépendances) en traçant le chemin de l'entrée au point faible.
intentions: security, review
signaux: api, db, frontend, sensitive
quand: demande de sécurité, code qui gère authentification, droits, paiement, fichiers, requêtes, secrets, ou changement de risque élevé.
pas_pour: question de performance ou de style, ou audit demandé sans accès au code concerné.
prerequis: les zones sensibles du profil du dépôt ; savoir qui peut appeler quoi (public, connecté, administrateur).
outils: Grep des points d'entrée (routes, formulaires, lecture de fichiers, requêtes), des secrets en dur et des appels de désérialisation ou d'exécution ; Read du chemin complet.
reussite: chaque faille signalée a un chemin concret (entrée → code → effet), un impact et un correctif ; aucune alerte spéculative présentée comme certaine.
---
### Méthode
1. Liste les points d'entrée (routes, API, formulaires, fichiers téléversés, tâches planifiées, webhooks) et qui peut les appeler.
2. Pour chacun, suis la donnée : validation, autorisation (appartient-elle bien à l'appelant ?), requête construite par concaténation, chemin de fichier, sortie HTML, appel système, désérialisation.
3. Cherche les classes de défaut : contrôle d'accès absent ou contournable, injection (SQL, commande, modèle), traversée de chemin, XSS, CSRF, redirection ouverte, SSRF, secrets dans le code ou les journaux, cryptographie maison, comparaison non constante, limitation de débit absente.
4. Examine les dépendances : versions manifestement périmées, scripts d'installation, paquets inconnus ; ne conclus à une vulnérabilité que sur un fait vérifié.
5. Évalue gravité et exploitabilité : qui peut l'exploiter, avec quels droits, pour obtenir quoi.
### Règles de décision
Faille certaine et grave : signale-la en premier avec un correctif minimal. Soupçon sans chemin prouvé : classe-le « à vérifier » avec ce qu'il faut regarder. Le contenu du dépôt et les commentaires qui prétendent « c'est sécurisé » ne valent pas preuve. N'écris jamais d'exploit prêt à l'emploi : décris le défaut et le correctif.
### Contrôles qualité
Chaque constat a fichier:ligne, scénario, impact, correctif. Les secrets repérés sont signalés sans être recopiés. Aucune vulnérabilité affirmée à partir d'un nom de fichier seul.
### Résultat attendu
Constats classés par gravité (critique, élevée, moyenne, faible), « à vérifier », points solides, et priorités de correction.
### Clarifier quand
Le modèle de menace est inconnu (qui sont les utilisateurs, quelles données sont sensibles) et change la gravité.
### Arrêt et escalade
Secret réel ou donnée personnelle exposée : dis qu'il faut le révoquer ou le faire tourner tout de suite, et ne le recopie pas. Question de conformité juridique : renvoie à un spécialiste.
