# Prospection : cible, recherche de prospects, accroche et score
Résumé : comment Claude cherche des prospects (cible, nombre, maintenant ou la nuit), ce que contient un prospect (email pro, source, accroche, score), les règles de collecte et les problèmes fréquents.

## Avant de chercher
- Le projet doit être **analysé** (fiche projet) et sa **Cible validée** (« Valider la cible »). Sans fiche, la recherche et les posts demandent d'abord d'analyser.
- Le plafond mensuel de **prospects** et de **jobs IA** de l'offre s'applique (voir « Offres, plafonds et limites »).

## Lancer une recherche (Prospecter → Recherche de prospects)
1. **Prospects à chercher** : le nombre voulu, de 1 à 50.
2. **Quand** : « Maintenant » ou « Cette nuit (1h-6h) ». « Cette nuit » met le job en file : il démarre au prochain créneau entre 1h et 6h (heure de Paris), quand le serveur est peu chargé et que le quota Claude est libre ; il peut être annulé jusqu'au départ.
3. Bouton **Lancer la recherche**. Une barre d'avancement, un message et la liste des derniers prospects trouvés suivent la progression en direct, rafraîchis toutes les quelques secondes (aussi dans « Activité ») : le message dit ce que Claude fait (par exemple « Recherche web : … » ou « Lecture du site … »), et chaque prospect ajouté apparaît aussitôt dans la liste sous la barre. Le pourcentage est une estimation tant que Claude cherche ; il suit le nombre de prospects trouvés quand il en trouve. À la fin : « Recherche terminée : N nouveau(x) prospect(s) sur M demandés ».

## Ce que Claude trouve
Pour chaque prospect : **entreprise**, **email professionnel publié sur le site de l'entreprise**, **site**, ville, secteur, **source** (la page où l'email est publié), une **accroche** personnalisée (une phrase qui prouve que le site a été lu) et un **score de pertinence de 1 à 10** pour CE produit (9-10 cœur de cible, 7-8 bon profil, 5-6 plausible, 3-4 éloigné, 1-2 hors cible).

## Règles de collecte (non modifiables)
- Uniquement des **emails professionnels** publiés par l'entreprise elle-même, avec leur source ; jamais de particuliers, jamais d'adresse devinée ou inventée.
- Les adresses déjà en **liste d'opposition**, les doublons et les adresses invalides sont écartés.
- La source de chaque contact est conservée et rappelée dans le pied des mails (transparence RGPD).
- Un prospect n'est contacté qu'une seule fois (plus une relance éventuelle).

## Régénérer une accroche
Dans la **fiche d'un prospect** : « Générer une accroche » ou « Régénérer l'accroche » demande à Claude de relire le site et de réécrire l'accroche (un job IA).

## Modèle utilisé
Le modèle de la recherche se choisit dans **Réglages → Budget et modèles IA** (« Modèle pour la prospection »). Les consignes se modifient dans **Réglages → Prompts IA** (« Recherche de prospects : accroche et pertinence »). Haiku suffit pour la plupart des projets.

## Problèmes fréquents
- **0 prospect trouvé** : la cible est trop étroite ou les requêtes trop vagues → corriger la section Cible (secteurs, zone, requêtes de recherche, une par ligne) et relancer.
- **Le job reste « En attente »** : plafond ou quota atteint, charge du serveur élevée, ou job programmé « Cette nuit ». Le message « En attente : … » donne la raison dans « Activité ».
- **« Plafond atteint »** : la limite mensuelle de l'offre est atteinte ; rien n'est perdu, voir « Offres, plafonds et limites ».
- **Une recherche est déjà en cours** : un seul job du même type à la fois par projet ; attendre sa fin ou l'annuler depuis « Activité ».
