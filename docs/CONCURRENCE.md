# Analyse concurrentielle des prix (relevé du 13 novembre 2026)

Prix publics relevés par recherche web ; les sites de comparaison se contredisent parfois (lignes marquées « ~ »). **À revérifier sur les pages officielles avant toute communication** : aucun de ces chiffres n'a été relevé directement chez l'éditeur. Dollars et euros ne sont pas convertis ici.

## Ce que coûte la concurrence

| Outil | Entrée | Milieu | Haut | Particularités |
|---|---|---|---|---|
| Waalaxy | ~19 €/mois (≈ 9,50 € en annuel) | | | LinkedIn, par licence ; pas de mails à ce prix |
| Brevo | à partir de 7 € | | | emailing généraliste, pas de prospection |
| Smartlead | 39 $ (Base, ~6 000 envois/mois) | 94 $ (Pro, ~90 000) | 174 $ / 379 $ | contacts vérifiés et warmup en options à 59 $ chacune |
| Instantly | 47 $ (Growth, 5 000 mails ; ~37,6 $ en annuel) | 97 $ (Hypergrowth, ~100 000) | 358 $ | volume élevé, peu de fonctions métier |
| Lemlist | ~79 $ (Email Pro, 3 adresses ; ~63 $ en annuel) | ~109 $ par siège (multicanal) | | tarif **par siège** |
| Apollo | gratuit | ~49 $ par utilisateur (Basic) | jusqu'à 119–149 $ par utilisateur | base de contacts incluse, par utilisateur |

Sources : [Smartlead](https://smartlead.ai/pricing), [Instantly](https://instantly.ai/pricing), [Lemlist (comparatif)](https://marketbetter.ai/blog/lemlist-pricing-breakdown-2026/), [Waalaxy](https://hackceleration.com/labs/waalaxy-pricing), [comparatif général](https://aiagentrank.io/blog/lemlist-vs-instantly-vs-smartlead-2026).

## Les offres iaboss après révision

Prix TTC (franchise de TVA). Annuel = 10 mois payés pour 12. Les plafonds de mails sont donnés par semaine puis en équivalent mensuel (× 4,3).

| Offre | Mensuel | Annuel (par mois) | Mails/mois env. | Comparable le moins cher | Écart |
|---|---|---|---|---|---|
| Gratuit | 0 € | | ~215 | Apollo gratuit, Brevo gratuit | à égalité |
| Démarrage | **9 €** (avant 10) | 90 € (7,50 €) | ~1 075 | Waalaxy ~19 € (9,50 € annuel) | −53 % mensuel, −21 % annuel |
| Croissance | **19 €** (avant 25) | 190 € (15,83 €) | ~3 000 | Smartlead Base 39 $, Instantly 47 $ | −51 % ou plus |
| Business | **29 €** (avant 50) | 290 € (24,17 €) | ~6 000 | Smartlead Base 39 $ (6 000 envois), Lemlist 79 $ | −26 % |
| Intensif | **75 €** (avant 100) | 750 € (62,50 €) | ~9 000 | Smartlead Pro 94 $, Instantly Hypergrowth 97 $ | −20 % ou plus |

Pour les offres à plusieurs places (Business 10, Intensif 25), la concurrence facture par siège (Lemlist, Apollo) : l'écart est bien plus grand. Les offres iaboss comparées ne comprennent pas de base de contacts achetée ni d'infrastructure d'envoi : les mails partent de la boîte de l'utilisateur, et l'IA est facturée par son fournisseur (c'est ce qui rend le prix possible).

## Fonctionnalités gratuites ou payantes

Définies dans `FEATURES` (`src/limits.js`) : une seule source pour le serveur, la page Tarifs et la documentation du Support.

| Fonctionnalité | À partir de |
|---|---|
| Prospection, mails, relances, réponses, agenda, comptabilité (saisie, chiffres, guide de déclaration), page IA, équipe selon les places | Gratuit |
| Posts LinkedIn, Instagram et newsletter | Démarrage |
| Devis et factures (génération et relecture par l'IA) | Démarrage |
| Postes (tâches IA métier) | Croissance |
| Export de la comptabilité (archive et journal CSV) | Croissance |
| Mode développeur : API et MCP | Croissance |
| Vidéos de promotion | Business |

Règle : seul le **lancement** d'un nouveau travail est refusé hors offre ; ce qui existe déjà reste lisible, rien n'est supprimé.

## Limites de cette analyse

- Chiffres issus de sites de comparaison, parfois partisans ou datés ; certains n'ont pas pu être recoupés (Brevo par palier, Apollo).
- Aucune étude de coût réel : ces prix baissent le revenu par abonné de 10 à 42 % ; à réévaluer avec les données de conversion une fois Stripe ouvert.
- Les abonnés existants gardent leur ancien prix chez Stripe (voir `docs/STRIPE.md`).
