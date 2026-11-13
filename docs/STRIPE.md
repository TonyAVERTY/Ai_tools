# Configurer Stripe pour iaboss (entreprise individuelle, un seul compte)

Ce guide suit ce que le code attend (`src/services/stripe.js`, `src/subscriptions.js`, `src/subscriptionroutes.js`). Les noms de menus de Stripe changent de temps en temps : si un libellé ne correspond plus, cherche-le dans la barre de recherche du tableau de bord.

## Ce que le code fait tout seul (rien à créer à la main)

- **Produits et prix** : créés à la demande au premier achat (`iaboss Démarrage`, etc., en euros, mensuel et annuel), avec une clé de recherche `iaboss_<offre>_<période>_<centimes>`. Si tu changes un tarif dans `src/limits.js`, un nouveau prix est créé ; les abonnés en cours gardent l'ancien.
- **Page de paiement** : Stripe Checkout (hébergée par Stripe, iaboss ne voit jamais la carte). **Gestion de l'abonnement** : portail client de Stripe.
- **Changement d'offre** : géré par iaboss (au prorata), pas par le portail.

## Compte partagé avec d'autres produits

Le point d'arrivée (webhook) reçoit **tous** les événements du compte. iaboss ne tient compte que des abonnements marqués `metadata.app = iaboss` (posé à la création) ou déjà enregistrés chez lui ; les paiements et abonnements de tes autres produits sont ignorés et ne peuvent jamais changer le plan d'un utilisateur (test : `test/subscriptions.test.js`, « compte Stripe partagé »). Deux règles à garder de ton côté :

- ne crée **pas** d'autres produits dont le nom commence par « iaboss » ;
- garde **un point d'arrivée par application** (un pour iaboss, un par autre produit), chacun avec son propre secret `whsec_…`.

## 1. Le compte (une fois)

1. **Paramètres → Détails de l'entreprise** : type **entreprise individuelle** (micro-entrepreneur ou EI), nom, **SIRET**, adresse, activité (édition de logiciels / SaaS), site `https://iaboss.fr`.
2. **Compte bancaire** : l'IBAN professionnel sur lequel Stripe verse (virements). Un micro-entrepreneur doit avoir un compte dédié à l'activité dès que son chiffre d'affaires dépasse 10 000 € deux années de suite : autant l'utiliser dès le départ.
3. **Paramètres → Détails publics** : nom affiché sur le relevé bancaire du client (`IABOSS`), e-mail et site de support, mentions légales et CGV (`https://iaboss.fr/cgu`).
4. **Paiements → Moyens de paiement** : active **cartes**. Le reste est facultatif (Link, Apple Pay et Google Pay se règlent là aussi). Garde l'authentification 3D Secure et Radar activés (par défaut).

## 2. Factures et TVA

L'éditeur est en **franchise de TVA** (art. 293 B du CGI) : le prix TTC est le prix payé et ne comporte pas de TVA.

1. **Paramètres → Facturation → Modèle de facture** : dans le **pied de page**, écris `TVA non applicable, art. 293 B du CGI` ; renseigne ton nom, ton SIRET et ton adresse.
2. **Paramètres → Facturation → Abonnements et e-mails** : active l'envoi des reçus et des factures aux clients.
3. **N'active pas Stripe Tax** tant que tu es en franchise.
4. Point à vérifier avec ton comptable : les seuils de la franchise en base pour des services numériques vendus à des particuliers d'autres pays de l'UE (guichet OSS). Je ne peux pas te le garantir.

## 3. Clé secrète

**Développeurs → Clés API** : commence en **mode test** (`sk_test_…`).

- Soit la clé secrète standard.
- Soit (recommandé) une **clé restreinte** (`rk_test_…` puis `rk_live_…`) avec droits **en écriture** sur : Customers, Checkout Sessions, Subscriptions, Prices, Products, Billing portal ; lecture sur le reste.

## 4. Point d'arrivée (webhook)

**Développeurs → Webhooks → Ajouter un point d'arrivée**, sur **Votre compte** (pas « Connect ») :

- URL : `https://iaboss.fr/stripe/webhook`
- Événements : `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
- Copie le **secret de signature** (`whsec_…`).

Le mode test et le mode production ont **chacun leur point d'arrivée et leur secret**.

## 5. Portail client

**Paramètres → Facturation → Portail client** : enregistre une configuration avec

- **Résiliation** des abonnements : activée, **à la fin de la période** ;
- **Mise à jour du moyen de paiement** et **historique des factures** : activés ;
- **Changement de formule / de quantité** : **désactivé** (c'est iaboss qui gère le changement d'offre, sinon les deux se contredisent).

## 6. Variables du serveur

```bash
STRIPE_SECRET_KEY=sk_test_...      # ou rk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Les deux vont ensemble (le serveur refuse de démarrer avec une seule). Redémarre le serveur. Tant que ces valeurs sont vides, la page Tarifs affiche « Bientôt » et les offres s'attribuent à la main dans l'administration.

## 7. Essai en mode test

1. Sur Tarifs, « Choisir cette offre » → carte de test `4242 4242 4242 4242`, une date future, un CVC quelconque.
2. De retour sur Mon compte : « Paiement reçu » puis le plan change. Si ce n'est pas le cas, regarde **Développeurs → Webhooks → ton point d'arrivée → Tentatives** (erreur 400 : mauvais secret ; 404 : paiements non activés côté serveur).
3. Teste aussi : carte refusée `4000 0000 0000 0341` (le plan est gardé 7 jours), changement d'offre, résiliation depuis « Gérer mon abonnement ».

## 8. Passage en production

1. Bascule le tableau de bord en mode production et termine la vérification d'identité demandée par Stripe (pièce d'identité, IBAN).
2. Recrée la **clé** (`sk_live_…` / `rk_live_…`), le **point d'arrivée** (mêmes URL et événements) et le **portail client** : ils sont distincts du mode test.
3. Remplace les deux variables du serveur, redémarre, puis fais **un vrai achat de l'offre la moins chère**, vérifie le plan et rembourse-le depuis Stripe.

## Ce que ni le code ni ce guide ne règlent

- Les frais de Stripe sont prélevés sur chaque paiement : tes recettes déclarées sont le montant payé par le client, pas le virement net reçu.
- Le versement des fonds vers ta banque suit le calendrier de ton compte (paramètres de versement).
- La déclaration de ton chiffre d'affaires reste à faire auprès de l'URSSAF/des impôts, comme pour toute activité.
