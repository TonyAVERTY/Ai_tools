# Activité, jobs, quota Claude, budget et rapport hebdomadaire
Résumé : comprendre le menu Activité, la file de jobs (en attente, programmé, annulation), la carte « Consommation Claude » (quota Claude, coût IA), les reports automatiques, les jobs de nuit et les alertes.

## Les jobs
Toute tâche lourde (analyse, recherche de prospects, envoi, relances, évolutions, audit, post LinkedIn, vidéo de promotion, accroche) est un **job** : il tourne en arrière-plan, même si on ferme la page.
- Un **seul job du même type à la fois par projet**, et un nombre de jobs IA **simultanés par compte qui dépend de l'offre** (le « multi jobs ») : **un seul à la fois avec l'offre gratuite**, plusieurs avec les offres payantes, et plus l'offre est chère plus il y en a (voir « Offres, plafonds et limites », colonne « Jobs IA simultanés »). Les jobs en trop attendent dans « Activité » avec le message « En attente : … » qui dit pourquoi. Les envois de mails (premiers mails et relances) ne se chevauchent jamais. Il n'y a aucune limite globale sur le serveur : le nombre de jobs simultanés d'un compte est celui de son offre (le tourniquet reste équitable entre les comptes quand plusieurs attendent). Seule une charge très élevée du serveur retient provisoirement les nouveaux jobs (message « charge du serveur élevée »).
- Un job IA exige une **liaison Claude valide**.
- Le plafond mensuel de **jobs IA** de l'offre s'applique (voir « Offres, plafonds et limites ») ; les envois de mails ont leur propre plafond.

## Le menu « Activité » (barre du haut)
Il apparaît dès qu'un job est en cours, en attente ou programmé : la liste détaille chaque job, son projet, son état (« Démarré il y a… », « En file d'attente », « Programmé » suivi du jour et de l'heure) suivi du **modèle réellement utilisé** (« · modèle Sonnet 5.5 »), son avancement en pourcentage avec sa barre, et un message (« Rendu de la vidéo : image 120/450 », « Recherche web : … », « Lecture du site … », « Lecture de src/app.js »…). Une tâche qui n'a pas encore démarré (en file d'attente, retenue par le quota Claude ou programmée) affiche **0 %** et une barre vide ; le message dit pourquoi elle attend (par exemple « En attente : quota de la session Claude (5 h) à 95 % »). Le même pourcentage s'affiche dans la zone de la tâche, dans le projet. Boutons **Voir** (ouvre le projet) et **Annuler**. Quand on lance une tâche, une petite animation conduit à ce menu.
**Pourcentage.** Toute génération de Claude, l'analyse d'un projet comprise, affiche un pourcentage et une barre (liste des jobs, page du projet, page « Facturation »). Quand Claude répond en un seul bloc (modèle de mail, relance, post LinkedIn, vidéo, devis…), le pourcentage est une **estimation** qui avance avec le temps sans jamais atteindre 100 % avant la fin ; il passe à 100 % quand le résultat est prêt. S'il reste longtemps au même chiffre, la tâche tourne toujours : seul un statut « Échec » ou « Annulé » indique qu'elle s'est arrêtée.
Quand un job est « En attente : … », la raison est écrite : budget IA atteint, quota Claude serré, charge élevée du serveur, ou plafond du plan.

## Jobs de nuit (« Cette nuit (1h-6h) »)
La recherche de prospects, l'évolution et l'audit proposent « Maintenant » ou « Cette nuit ». Le job démarre au prochain créneau entre 1h et 6h (heure de Paris), quand le serveur est peu chargé et que le quota Claude est libre. Il reste annulable jusqu'au départ.

## La carte « Consommation Claude » (page Projets)
- **Claude session 5 h** et **Claude semaine** (abonnement) : le taux d'utilisation du compte Claude. Un petit texte grisé sous chaque barre indique quand la limite se réinitialise (par exemple « Remise à zéro aujourd'hui à 18:42 » ou « Remise à zéro lundi à 09:00 », heure de Paris). Orange à 80 %, rouge à 100 %. Relevé en direct chez Anthropic quand c'est possible, sinon dernière mesure faite pendant un job.
- **IA via AiTools 24 h / 30 j** (**uniquement avec une clé API**) : ce que les jobs lancés par AiTools ont consommé, en $ équivalent API. Ce que la personne fait ailleurs avec Claude n'y est pas compté.
- **Avec un abonnement Claude, aucun montant en dollars n'est affiché** (ni dans la carte « Consommation Claude », ni dans la carte « Usage du mois », ni dans le récapitulatif d'un projet, ni dans le rapport hebdomadaire ou les notifications) : rien n'est facturé en plus de l'abonnement, le seul repère est le quota Claude (session 5 h, semaine).
- Avec une clé API : pas de quota d'abonnement, seulement le coût.

## Reports automatiques et budget
- **Quota Claude serré** (au-delà de 85 % de la session ou de la semaine) : les jobs non urgents (analyse, évolutions, audit, tâches des postes) restent en file et repartent seuls une fois le quota libéré. Prospection et envois continuent normalement.
- **Budget IA** (clé API seulement, Réglages → Budget IA) : plafonds glissants sur 24 h et sur 30 jours. Plafond atteint : les jobs IA restent en file et repartent seuls quand la fenêtre glisse ; les envois et relances continuent. Un job en cours n'est jamais coupé : le plafond peut être dépassé d'un job.
- **Charge du serveur élevée** : les nouveaux jobs attendent un instant.

## Notifications et rapport hebdomadaire
Les alertes (quota proche de la limite à 80 % puis 95 %, budget atteint, job terminé ou en erreur, réponse d'un prospect, relances envoyées, envois en pause) partent vers les canaux choisis dans Réglages → Notifications. Le rapport hebdomadaire arrive le lundi à 8h (heure de Paris).

## Erreurs de job
Un job qui échoue affiche son message (« Job en erreur » dans Activité et dans la section du projet). Les causes fréquentes : liaison Claude à revalider, quota ou budget atteint, SMTP ou adresse de réception manquants, dépôt Git inaccessible (token manquant dans Réglages → Dépôts Git), plafond de l'offre atteint.
