# Activité, jobs, quota Claude, budget et rapport hebdomadaire
Résumé : comprendre le menu Activité, la file de jobs (en attente, programmé, annulation), la ligne d'état (quota Claude, coût IA), les reports automatiques, les jobs de nuit et les alertes.

## Les jobs
Toute tâche lourde (analyse, recherche de prospects, envoi, relances, évolutions, audit, post LinkedIn, vidéo de promotion, accroche) est un **job** : il tourne en arrière-plan, même si on ferme la page.
- Un **seul job du même type à la fois par projet**, et **un seul job IA à la fois par compte** ; un plafond global limite le nombre de jobs simultanés sur tout le serveur, avec un tourniquet équitable entre les comptes.
- Un job IA exige une **liaison Claude valide**.
- Le plafond mensuel de **jobs IA** de l'offre s'applique (voir « Offres, plafonds et limites ») ; les envois de mails ont leur propre plafond.

## Le menu « Activité » (barre du haut)
Il apparaît dès qu'un job est en cours, en attente ou programmé : la liste détaille chaque job, son projet, son état (« Démarré il y a… », « En file d'attente », « Programmé » suivi du jour et de l'heure), son avancement en pourcentage et un message (« Rendu de la vidéo : image 120/450 »…). Boutons **Voir** (ouvre le projet) et **Annuler**. Quand on lance une tâche, une petite animation conduit à ce menu.
Quand un job est « En attente : … », la raison est écrite : budget IA atteint, quota Claude serré, charge élevée du serveur, ou plafond du plan.

## Jobs de nuit (« Cette nuit (1h-6h) »)
La recherche de prospects, l'évolution et l'audit proposent « Maintenant » ou « Cette nuit ». Le job démarre au prochain créneau entre 1h et 6h (heure de Paris), quand le serveur est peu chargé et que le quota Claude est libre. Il reste annulable jusqu'au départ.

## La ligne d'état (sous la barre du haut)
- **Claude session 5h** et **Claude semaine** (abonnement) : le taux d'utilisation du compte Claude, avec l'heure de remise à zéro au survol. Orange à 80 %, rouge à 100 %. Relevé en direct chez Anthropic quand c'est possible, sinon dernière mesure faite pendant un job.
- **IA via AiTools 24 h / 30 j** : ce que les jobs lancés par AiTools ont consommé, en $ équivalent API. Ce que la personne fait ailleurs avec Claude n'y est pas compté (le quota Claude à côté, lui, compte tout).
- Avec une clé API : pas de quota d'abonnement, seulement le coût.

## Reports automatiques et budget
- **Quota Claude serré** (au-delà de 85 % de la session ou de la semaine) : les jobs non urgents (analyse, évolutions, audit, tâches des postes) restent en file et repartent seuls une fois le quota libéré. Prospection et envois continuent normalement.
- **Budget IA** (clé API seulement, Réglages → Budget IA) : plafonds glissants sur 24 h et sur 30 jours. Plafond atteint : les jobs IA restent en file et repartent seuls quand la fenêtre glisse ; les envois et relances continuent. Un job en cours n'est jamais coupé : le plafond peut être dépassé d'un job.
- **Charge du serveur élevée** : les nouveaux jobs attendent un instant.

## Notifications et rapport hebdomadaire
Les alertes (quota proche de la limite à 80 % puis 95 %, budget atteint, job terminé ou en erreur, réponse d'un prospect, relances envoyées, envois en pause) partent vers les canaux choisis dans Réglages → Notifications. Le rapport hebdomadaire arrive le lundi à 8h (heure de Paris).

## Erreurs de job
Un job qui échoue affiche son message (« Job en erreur » dans Activité et dans la section du projet). Les causes fréquentes : liaison Claude à revalider, quota ou budget atteint, SMTP ou adresse de réception manquants, dépôt Git inaccessible (token manquant dans Réglages → Dépôts Git), plafond de l'offre atteint.
