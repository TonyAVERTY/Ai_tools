# Évolution, Audit du projet et Récapitulatif
Résumé : les trois sections d'analyse d'un projet : idées d'évolutions envoyées par mail, audit qualité et sécurité du code, chiffres et courbes du récapitulatif.

## Évolution (idées de fonctionnalités)
l'IA lit le code et propose des fonctionnalités réalistes, classées de la plus rentable à la moins rentable, avec le bénéfice pour l'utilisateur et des pistes techniques. Le résultat est **envoyé par mail** et aussi affiché dans la section.
Champs : **Nombre d'évolutions** (1 à 20), **Raisonnement** (**Rapide** = Haiku, économe ; **Normal** = Sonnet, plus cher ; **Approfondi** = Opus, coûteux), **Quand** (Maintenant ou Cette nuit, 1h-6h). Bouton **Chercher et envoyer par mail**.
- Le mail part de l'adresse d'AiTools (SMTP du serveur) vers l'**Email de réception** réglé dans **Réglages → Notifications**. Sans cette adresse, le job échoue avec « Adresse de réception non configurée (Réglages) » ; si le serveur n'a pas de SMTP, avec « le serveur ne peut pas envoyer de mail ».
- Après la fin : mention « Envoyé à … » et bouton **Copier le Markdown**.
- Le niveau « Approfondi » consomme beaucoup de quota de l'IA : une confirmation est demandée.

## Audit du projet
Rapport **qualité et sécurité** du code, en lecture seule : l'IA signale les défauts de code, de sécurité, de tests et de dépendances, chaque constat avec le fichier et la ligne concernés, sa gravité (critique, élevée, moyenne, faible) et un correctif précis. Réservé aux propriétaires et administrateurs du projet.
Champs : **Raisonnement** (Rapide, Normal, Approfondi), **Quand**. Bouton **Lancer l'audit**. À la fin, le rapport s'affiche dans la section avec « Audit terminé » et le bouton **Copier le rapport (Markdown)**.
Rien n'est modifié dans le dépôt. Les consignes se modifient dans **Réglages → Prompts IA**.

## Récapitulatif (propriétaires et administrateurs)
Chiffres du produit et de la prospection, avec courbes.
- **Utilisateurs**, **Clients payants**, **Revenu total** : lus dans la base de données du projet, d'après les tables que tu as choisies (voir « Configuration du projet → Base de données (récapitulatif) » : **Se connecter et analyser**, puis tes listes de tables, sans aucune requête à écrire). Mis en cache 10 minutes ; bouton **Rafraîchir**.
- **Prospection** : **Trouvés**, **Contactés**, **Réponses**, **Convertis**.
- **Coût IA du projet** (équivalent API), uniquement avec une clé API : avec un abonnement Claude, rien n'est facturé en plus et aucun montant n'est affiché.
- **Courbes** sur 30 ou 90 jours : utilisateurs, clients payants et revenu (une photo quotidienne est prise automatiquement, plus une à chaque ouverture), mails envoyés et réponses par semaine. Les graphiques ont des infobulles au survol et une vue tableau (« Voir les données »).
- Les données business commencent le jour où la base est configurée.
