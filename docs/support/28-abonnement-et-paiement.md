# Abonnement et paiement : choisir, changer ou résilier son offre
Résumé : passer à une offre payante (Démarrage, Croissance, Business, Intensif) par carte sur une page sécurisée de Stripe, voir et gérer son abonnement dans Mon compte, changer d'offre, résilier, ce qui se passe en cas de paiement refusé.

## Les offres
Le plan **Gratuit** est sans carte bancaire et sans limite de durée. Les offres payantes relèvent les plafonds (projets, prospects, mails, jobs IA, jobs en parallèle, places d'équipe). Les prix et les plafonds exacts sont dans « Plans et limites » et sur la page **Tarifs** ; ils sont TTC (l'éditeur est en franchise de TVA, article 293 B du CGI : le prix affiché est le prix payé). **À l'année**, tu paies 10 mois et tu en profites 12.

Ton accès à l'IA (Claude, ChatGPT ou Gemini) n'est **pas** compris : il est facturé par ton fournisseur, directement à toi.

## Choisir une offre
1. Va sur **Tarifs** (ou sur l'accueil du site) et choisis **Au mois** ou **À l'année**.
2. Clique **Choisir cette offre** sous l'offre voulue. Si tu n'es pas connecté, iaboss te demande d'abord de te connecter ; reviens ensuite sur Tarifs.
3. Tu arrives sur la page de paiement de **Stripe** : iaboss ne voit jamais ton numéro de carte. Paye.
4. Tu reviens sur **Mon compte** : « Paiement reçu : ton offre est activée dans quelques secondes ». Si le plan affiché (badge « plan … » dans « Usage de la semaine ») n'a pas changé, recharge la page.

Un administrateur du service et un compte au plan « pro » n'ont pas besoin d'offre : le bouton les renvoie vers Mon compte avec ce message.

Si les paiements ne sont pas ouverts sur le service, les offres affichent **Bientôt** et **Me prévenir à l'ouverture**.

## Voir et gérer son abonnement
**Mon compte → Usage de la semaine** affiche le bloc **Ton offre** :
- **Ton offre : Démarrage · 10 € TTC par mois** et **Prochain paiement le …** ;
- **Gérer mon abonnement** : ouvre le portail de Stripe pour changer de carte, télécharger les factures ou résilier ;
- **Changer d'offre** : mène à Tarifs ;
- en **mode test**, la mention « Mode test : aucun paiement réel » (réservée à une configuration d'essai).

## Changer d'offre
Sur Tarifs, clique **Choisir cette offre** sur une autre offre (ou une autre période). Ton abonnement est **modifié** et non doublé : la différence est calculée **au prorata** sur ta prochaine facture. Message : « Offre … activée : la différence est calculée au prorata sur ta prochaine facture ». Si tu as déjà exactement cette offre : « Tu as déjà cette offre ».

## Résilier
**Gérer mon abonnement** → résilier. Ton offre reste active **jusqu'à la fin de la période déjà payée** (Mon compte affiche « Se termine le … : tu repasseras ensuite au plan gratuit, tes données sont gardées »), puis ton compte repasse au plan Gratuit. La période commencée n'est pas remboursée, sauf obligation légale.

Même sans IA reliée, **Gérer mon abonnement** reste accessible : on peut toujours résilier.

## Paiement refusé
Si un paiement échoue, Mon compte affiche « Ton dernier paiement a échoué. Mets ta carte à jour avant le … pour garder ton offre ». Tu gardes les droits de ton offre **7 jours** : mets ta carte à jour dans **Gérer mon abonnement**. Sans régularisation, ton compte repasse au plan Gratuit. Pendant ce délai, changer d'offre est refusé (« Ton dernier paiement a échoué : mets ta carte à jour… »).

## Retour au plan Gratuit : que devient mon travail ?
**Rien n'est supprimé** : tes projets, prospects, mails et brouillons sont gardés. Seuls les plafonds du plan Gratuit s'appliquent aux **nouvelles** actions (par exemple, créer un nouveau projet ou lancer un job IA au-delà du plafond est refusé avec un message clair et un lien vers les tarifs). Mon compte affiche alors « Ton abonnement est terminé : tu es revenu au plan gratuit » avec **Voir les offres** et **Mes factures** (portail Stripe).

## Supprimer mon compte avec un abonnement
Quand tu supprimes ton compte (Mon compte → Zone de danger), ton abonnement est **résilié chez Stripe avant l'effacement**, pour que tu ne sois plus facturé. Si Stripe ne répond pas, **rien n'est supprimé** et un message te l'indique : réessaie, ou résilie d'abord dans « Gérer mon abonnement ».

## Problèmes fréquents
- **Je viens de payer et mon plan n'a pas changé** : l'activation arrive par un message de Stripe, en général en quelques secondes. Recharge Mon compte. Si rien ne change au bout de quelques minutes, écris-nous avec l'email de ton compte : le paiement est visible chez Stripe.
- **« Les paiements ne sont pas ouverts sur ce service »** : l'administrateur n'a pas encore branché Stripe.
- **« Stripe ne répond pas » / « Stripe a refusé la demande »** : réessaie dans un instant ; rien n'a été facturé tant que tu n'as pas payé sur la page de Stripe.
- **Je veux une facture** : Mon compte → Gérer mon abonnement → factures (portail Stripe).
- **Je n'ai pas de carte française** : les cartes courantes (Visa, Mastercard, American Express) sont acceptées par Stripe ; les moyens de paiement proposés s'affichent sur sa page.
