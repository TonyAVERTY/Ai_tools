# Activité, jobs, quota de l'IA, budget et rapport hebdomadaire
Résumé : comprendre le menu Activité, la file de jobs (en attente, programmé, annulation), la carte « Consommation Claude » (quota Claude, coût IA), les reports automatiques, les jobs de nuit et les alertes.

## Les jobs
Toute tâche lourde (analyse, recherche de prospects, envoi, relances, évolutions, audit, post LinkedIn, vidéo de promotion, accroche) est un **job** : il tourne en arrière-plan, même si on ferme la page.
- Un **seul job du même type à la fois par projet**, et un nombre de jobs IA **simultanés par compte qui dépend de l'offre** (le « multi jobs ») : **un seul à la fois avec l'offre gratuite**, plusieurs avec les offres payantes, et plus l'offre est chère plus il y en a (voir « Offres, plafonds et limites », colonne « Jobs IA simultanés »). Les jobs en trop attendent dans « Activité » avec le message « En attente : … » qui dit pourquoi. Les envois de mails (premiers mails et relances) ne se chevauchent jamais. Il n'y a aucune limite globale sur le serveur : le nombre de jobs simultanés d'un compte est celui de son offre (le tourniquet reste équitable entre les comptes quand plusieurs attendent). Seule une charge très élevée du serveur retient provisoirement les nouveaux jobs (message « charge du serveur élevée »).
- Un job IA exige une **liaison valide de ton IA**.
- Le plafond mensuel de **jobs IA** de l'offre s'applique (voir « Offres, plafonds et limites ») ; les envois de mails ont leur propre plafond.

## Le menu « Activité » (barre du haut)
Il est **toujours visible** dans la barre du haut. Le point à gauche de « Activité » devient Safran quand une tâche tourne, et reste éteint au repos (la liste dit alors « Aucune tâche en cours. »). Dès qu'un job est en cours, en attente ou programmé, la liste détaille chaque job, son projet, son état (« Démarré il y a… », « En file d'attente », « Programmé » suivi du jour et de l'heure) et, à côté du nom du job, une pastille avec le **modèle réellement utilisé** (« Sonnet 5.5 »), son avancement en pourcentage avec sa barre, et un message (« Rendu de la vidéo : image 120/450 », « Recherche web : … », « Lecture du site … », « Lecture de src/app.js »…). Une tâche qui n'a pas encore démarré (en file d'attente, retenue par le quota Claude ou programmée) affiche **0 %** et une barre vide ; le message dit pourquoi elle attend (par exemple « En attente : quota de la session Claude (5 h) à 95 % »). Le même pourcentage s'affiche dans la zone de la tâche, dans le projet. Boutons **Voir** (ouvre le projet) et **Annuler**. Quand on lance une tâche, une petite animation conduit à ce menu.
**Pourcentage.** Toute génération de l'IA, l'analyse d'un projet comprise, affiche un pourcentage et une barre (liste des jobs, page du projet, page « Facturation »). Quand l'IA répond en un seul bloc (modèle de mail, relance, post LinkedIn, vidéo, devis…), le pourcentage est une **estimation** qui avance avec le temps sans jamais atteindre 100 % avant la fin ; il passe à 100 % quand le résultat est prêt. S'il reste longtemps au même chiffre, la tâche tourne toujours : seul un statut « Échec » ou « Annulé » indique qu'elle s'est arrêtée.
Quand un job est « En attente : … », la raison est écrite : budget IA atteint, quota Claude serré, charge élevée du serveur, ou plafond du plan.

## Jobs de nuit (« Cette nuit (1h-6h) »)
La recherche de prospects, l'évolution et l'audit proposent « Maintenant » ou « Cette nuit ». Le job démarre au prochain créneau entre 1h et 6h (heure de Paris), quand le serveur est peu chargé et que le quota de l'IA est libre. Il reste annulable jusqu'au départ.

## La carte « Consommation Claude » (page Projets)
- **Claude session 5 h** et **Claude semaine** (abonnement) : le taux d'utilisation du compte Claude. Un petit texte grisé sous chaque barre indique quand la limite se réinitialise (par exemple « Remise à zéro aujourd'hui à 18:42 » ou « Remise à zéro lundi à 09:00 », heure de Paris). Orange à 80 %, rouge à 100 %. Relevé en direct chez Anthropic quand c'est possible, sinon dernière mesure faite pendant un job.
- **IA via iaboss 24 h / 30 j** (**uniquement avec une clé API**) : ce que les jobs lancés par iaboss ont consommé, en $ équivalent API. Ce que la personne fait ailleurs avec Claude n'y est pas compté.
- **Avec un abonnement Claude, aucun montant en dollars n'est affiché** (ni dans la carte « Consommation Claude », ni dans la carte « Usage du mois », ni dans le récapitulatif d'un projet, ni dans le rapport hebdomadaire ou les notifications) : rien n'est facturé en plus de l'abonnement, le seul repère est le quota Claude (session 5 h, semaine).
- Avec une clé API : pas de quota d'abonnement, seulement le coût.

## La carte « Consommation ChatGPT » (compte ChatGPT) ou « Consommation Gemini »
- **ChatGPT session 5 h** et **ChatGPT semaine** (compte ChatGPT) : le taux d'utilisation de ton abonnement ChatGPT, avec « Remise à zéro … » (heure de Paris). Le relevé est lu en direct chez OpenAI avec ton accès ChatGPT (il compte aussi ce que tu fais hors iaboss) ; il se rafraîchit au plus toutes les 2 minutes. Cette lecture passe par une adresse interne d'OpenAI, non documentée : si elle ne répond pas, la carte garde la dernière mesure et le dit, et si aucune mesure n'existe elle écrit « indisponible » avec la raison dans l'infobulle.
- **ChatGPT via iaboss 24 h / 30 j** (ou le nom de ton IA) : les tokens (entrée + sortie) des jobs lancés par iaboss. Ce que tu fais ailleurs n'y est pas compté, et ce n'est pas la limite de ton abonnement.
- Aucun montant en dollars n'est affiché avec un abonnement. Gemini n'a pas de relevé de limites : seuls les tokens via iaboss s'affichent.

## Reports automatiques et budget
- **Quota Claude serré** (au-delà de 85 % de la session ou de la semaine) : les jobs non urgents (analyse, évolutions, audit, tâches des postes) restent en file et repartent seuls une fois le quota libéré. Prospection et envois continuent normalement.
- **Budget IA** (clé API seulement, Réglages → Budget IA) : plafonds glissants sur 24 h et sur 30 jours. Plafond atteint : les jobs IA restent en file et repartent seuls quand la fenêtre glisse ; les envois et relances ne partent pas non plus, car chaque mail est relu par l'IA avant l'envoi (message « Budget IA atteint … Aucun mail n'est parti ») : relance-les quand la fenêtre a glissé. Un job en cours n'est jamais coupé : le plafond peut être dépassé d'un job.
- **Charge du serveur élevée** : les nouveaux jobs attendent un instant.

## Notifications et rapport hebdomadaire
Les alertes (quota proche de la limite à 80 % puis 95 %, budget atteint, job terminé ou en erreur, réponse d'un prospect, relances envoyées, envois en pause) partent vers les canaux choisis dans Réglages → Notifications. Le rapport hebdomadaire arrive le lundi à 8h (heure de Paris).

## Erreurs de job
Un job qui échoue affiche son message (« Job en erreur » dans Activité et dans la section du projet). Les causes fréquentes : liaison de l'IA à revalider, quota ou budget atteint, SMTP ou adresse de réception manquants, dépôt Git inaccessible (token manquant dans Réglages → Dépôts Git), plafond de l'offre atteint.
## Console d'une tâche

Dans Activité et le récapitulatif d'une tâche, **Voir** ouvre la page de suivi. Elle affiche les étapes horodatées, le modèle, les outils utilisés, les sorties de l'IA et les erreurs. Les sorties de texte arrivent progressivement pendant la génération, sans attendre la fin de la réponse. Les nouvelles lignes arrivent automatiquement ; décocher **Suivre les nouvelles lignes** permet de relire tranquillement. Le journal reste consultable depuis le récapitulatif après la fin de la tâche.

Seul le propriétaire du job peut ouvrir cette console. Les anciennes tâches n'ont pas de journal rétroactif. Pour limiter le stockage, les sorties très longues et le début des journaux volumineux sont abrégés avec une mention explicite. Le journal montre les actions et les sorties disponibles, pas le raisonnement interne de l'IA.


La page présente un fil de cartes horodatées et un résumé de la tâche (progression, modèle et temps écoulé). Les sorties longues se déplient à la demande. Lorsque l'IA signale une phase de réflexion, une carte indique cette activité ; le raisonnement interne n'est pas enregistré ni affiché. Le suivi reçoit les fragments de texte, puis actualise l'écran environ toutes les 800 ms.
### Réessayer et consommation

Une tâche en échec propose **Réessayer** dans son récapitulatif et sa page de suivi. Une nouvelle tâche reprend les paramètres d'origine ; l'ancienne conserve son erreur et son journal. Les autorisations, les plafonds et la liaison de l'IA sont revérifiés. Les échecs des dernières 24 heures restent dans Activité jusqu'à une nouvelle tâche du même type sur le même projet.

La consommation s'affiche sous la forme **12 345 tokens**, en cumulant les tokens d'entrée et de sortie retournés par l'IA pour les appels de la tâche. Le compteur se met à jour pendant les appels lorsque l'IA fournit ses mesures, puis à leur fin, et reste visible en cas d'échec. **Claude** les envoie au fil de l'eau. **ChatGPT et Gemini** ne les donnent qu'à la fin de la tâche : tant qu'elle tourne et que rien n'est encore compté, la ligne dit « Tokens comptés à la fin de la tâche » au lieu de « 0 tokens », puis le total apparaît quand la tâche se termine. Aucun pourcentage de limite n'est affiché.
### Suivi pendant la génération

Le menu Activité se rafraîchit automatiquement toutes les secondes lorsqu'il est ouvert, toutes les deux secondes lorsqu'une tâche tourne et que le menu est fermé. Ce relevé léger ne dépend pas du service de quota Claude. Le retour sur un onglet déclenche aussi une mise à jour.

Les tokens fournis par le flux de l'IA sont enregistrés pendant l'appel (entrées, cache et sorties), sans attendre sa fin. Les mesures provisoires restent comptées si la tâche est annulée ; le résultat final n'est pas ajouté une seconde fois. Lorsque l'IA ne fournit pas encore de nouveaux compteurs, la dernière mesure réelle reste affichée : aucun nombre n'est estimé à partir du texte. Le bouton **Annuler** reste disponible pendant le suivi.

### Temps restant

Le temps restant est calculé par étape et affiché en minutes et secondes, dès le démarrage. Pour la vidéo, la prévision tient compte de la durée, du nombre d'images par seconde, du format, de la voix et du modèle. Elle comprend la conception, les phrases audio, le rendu, l'assemblage et les deux revues finales.

Les durées se calibrent sur les dernières tâches réussies du même compte et du même type. Pendant le rendu, le débit des images réellement produites précise le temps restant. Le pourcentage animé pendant un appel à l'IA n'est plus utilisé comme une vitesse. Sans historique, la mention « estimation initiale » est affichée ; si une étape prend plus de temps, la prévision est réajustée plutôt que de promettre une fin immédiate.
