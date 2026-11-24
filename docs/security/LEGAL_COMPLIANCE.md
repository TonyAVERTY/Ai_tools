# Obligations légales : applicabilité et informations manquantes

Date : 24 novembre 2026. **Ce document n'est pas un avis juridique.** Je ne peux pas valider une obligation : pour chaque ligne, la colonne « Statut » dit ce qui est préparé techniquement et ce qui demande une validation humaine. **Aucun texte n'a pu être vérifié en ligne pendant cet audit** (pas d'accès à des sources officielles depuis l'environnement de travail) : vérifie chaque référence sur legifrance.gouv.fr, cnil.fr, eur-lex.europa.eu, et fais valider par un juriste avant la mise en ligne.

## 1. Faits retenus (tirés du code et des pages publiques)

- Éditeur : **Tony AVERTY, entrepreneur individuel (micro-entreprise)**, SIRET 100 142 819 00018, code APE 62.01Z, siège à Liffré, TVA non applicable (art. 293 B du CGI). Pages : `/mentions-legales`, `/confidentialite`, `/cgu`.
- Hébergeur indiqué : ElypseCloud, Mérignac.
- Service **réservé aux professionnels majeurs**, « pas destiné aux consommateurs » (CGU). Plan gratuit et plans payants (abonnement mensuel ou annuel, renouvellement automatique, paiement par Stripe).
- Fonctionnalités : prospection par e-mail (pour le compte de l'utilisateur), génération de contenus et de **vidéos avec voix synthétique** par IA, facturation et comptabilité pour l'utilisateur, API et serveur MCP.

## 2. Applicabilité des réglementations

| Texte | Applicable ? | Pourquoi | Statut |
|---|---|---|---|
| **RGPD** et **loi Informatique et Libertés** | **Oui** | Données personnelles de l'utilisateur et de tiers (adresses professionnelles de prospects) | `RGPD_COMPLIANCE.md` ; validation juridique à faire |
| **LCEN** (identification de l'éditeur et de l'hébergeur) | **Oui** | Service en ligne édité à titre professionnel | ✅ Mentions légales avec éditeur, SIRET, hébergeur, directeur de publication, contact. À relire (adresse de l'hébergeur à confirmer) |
| **ePrivacy / règles françaises sur les traceurs** | **Oui** | Cookies posés | ✅ Analyse dans `RGPD_COMPLIANCE.md` §6 : aucun bandeau nécessaire, à valider |
| **Droit de la consommation** (information précontractuelle, rétractation, médiation, reconduction tacite) | **Probablement non, à vérifier** | Les CGU excluent les consommateurs. **Mais** le code de la consommation étend certaines protections à des professionnels qui contractent hors de leur activité principale (petites entreprises) : l'étendue exacte est à confirmer par un juriste | 🟡 **Bloquant tant que non validé** : ni droit de rétractation, ni médiateur de la consommation, ni formulaire de rétractation n'existent aujourd'hui. Si l'application s'adresse aussi à des particuliers ou à des petits professionnels hors activité principale, ces éléments deviennent obligatoires |
| **Conditions générales de vente** | **Oui (plans payants)** | Les CGU contiennent un article « plans » (prix TTC, renouvellement, résiliation, paiement refusé, remboursement) | 🟡 À faire valider comme CGV ; mention d'un droit de rétractation à trancher (voir ci-dessus) |
| **Facturation** (mentions des factures, TVA, **facturation électronique**) | **Oui pour l'éditeur et pour les utilisateurs de la fonction Facturation** | L'application émet des factures pour l'utilisateur ; l'éditeur facture ses abonnés | 🟡 Vérifier le calendrier de la réforme de la facturation électronique et les mentions obligatoires (dates à confirmer sur impots.gouv.fr) |
| **Digital Services Act (DSA)** | **Probablement oui, obligations réduites** | iaboss stocke des contenus fournis par ses utilisateurs (service d'hébergement) mais ne les diffuse pas au public (pas une plateforme en ligne). Les micro-entreprises sont exemptées de plusieurs obligations | 🟡 Vérifier : point de contact (existe : e-mail), mécanisme de signalement (existe : adresse de signalement des mentions légales), conditions d'utilisation (existent) |
| **AI Act** (règlement européen sur l'IA) | **Oui, obligations de transparence à examiner** | iaboss intègre des modèles d'IA d'autres fournisseurs (via l'accès de l'utilisateur) : l'éditeur agit comme **déployeur** et peut être **fournisseur** d'un système qui génère du texte, des images et de la **voix synthétique**. Pas de cas d'usage à haut risque identifié (prospection, contenus marketing, comptabilité d'aide) | 🟡 **Validation humaine nécessaire** : obligations de transparence (informer qu'un contenu est généré par IA, marquage des contenus synthétiques audio/vidéo), formation à l'IA du personnel (art. 4). Le calendrier d'entrée en application de chaque obligation est à vérifier : il a été question de reports |
| **Cyber Resilience Act (CRA)** | **Probablement non** pour le SaaS ; **à vérifier** pour `iaboss-mcp.js` | Un service purement en ligne n'est en principe pas un « produit comportant des éléments numériques » ; le fichier du serveur MCP téléchargé et exécuté chez l'utilisateur pourrait en être un | 🟡 À trancher avec un juriste avant d'étendre la distribution du fichier |
| **NIS2** | **Probablement non** | Concerne des entités « essentielles » ou « importantes » dans des secteurs listés et au-dessus de seuils de taille ; une micro-entreprise éditrice d'un logiciel en ligne n'en relève pas en principe | 🟡 Conclusion à confirmer ; sans risque tant que la taille et le secteur ne changent pas |
| **Accessibilité (RGAA, directive européenne)** | **Probablement non obligatoire** | Les obligations de déclaration RGAA visent les services publics et de grandes entreprises ; l'acte européen sur l'accessibilité exempte les micro-entreprises de services | 🟡 À confirmer. Bonne pratique appliquée : contrastes AA vérifiés dans les deux thèmes, navigation clavier, libellés (`scripts/contrast-audit.mjs`, `scripts/responsive-audit.mjs`). Une **déclaration d'accessibilité** n'existe pas : à produire si l'obligation s'applique |
| **PCI DSS** | **Oui, au niveau le plus léger** | Le paiement se fait sur la page hébergée de Stripe : aucune donnée de carte ne transite par iaboss | ✅ Le questionnaire d'auto-évaluation SAQ A (via Stripe) est à remplir par l'éditeur ; **à vérifier** auprès de Stripe |

## 3. Documents : préparés techniquement ou à valider

| Document | État dans l'application | Validé juridiquement ? |
|---|---|---|
| Mentions légales | Page `/mentions-legales` complète | **Non validé** |
| Politique de confidentialité | `/confidentialite`, tenue à jour avec le code (test `test/site.test.js`) | **Non validé** |
| Politique relative aux cookies | Section « Cookies et traceurs » de la politique de confidentialité | **Non validé** |
| CGU | `/cgu` | **Non validé** |
| CGV | Article « Plan gratuit et plans payants » des CGU | **Non validé** ; décider s'il faut un document séparé |
| Politique de remboursement | Phrase dans les CGU (« la période commencée n'est pas remboursée, sauf obligation légale ») | **Non validé** |
| Conditions de résiliation | Article des CGU + « Gérer mon abonnement » (portail Stripe) | **Non validé** |
| Droit de rétractation | Absent | **À trancher** (voir droit de la consommation) |
| Médiation de la consommation | Absent | **À trancher** : obligatoire seulement si des consommateurs sont concernés |
| Déclaration d'accessibilité | Absente | À trancher |
| Contrat de sous-traitance (art. 28) avec les utilisateurs | Contenu partiel dans les CGU | **À compléter** (voir `RGPD_COMPLIANCE.md`) |

## 4. Informations manquantes à fournir (rien n'est inventé)

- `[À COMPLÉTER : nom et adresse du médiateur de la consommation]` — seulement si des consommateurs ou assimilés sont visés.
- `[À COMPLÉTER : numéro de TVA intracommunautaire]` — seulement si l'éditeur en a un (aujourd'hui : franchise en base).
- `[À COMPLÉTER : décision sur le droit de rétractation]`.
- `[À COMPLÉTER : date et auteur de la validation juridique de chaque page]`.
- `[À COMPLÉTER : décision de désigner ou non un délégué à la protection des données]`.
- `[À COMPLÉTER : décision sur l'AIPD]`.
- `[À COMPLÉTER : déclaration d'accessibilité, si l'obligation s'applique]`.
- `[À COMPLÉTER : contrat ou DPA de chaque fournisseur (hébergeur, Stripe, fournisseurs d'IA)]`.

## 5. Éléments bloquants pour la mise en production

Une obligation applicable non satisfaite est **bloquante**. Aujourd'hui :
1. **Validation juridique des trois pages et des CGV** : non faite → bloquant.
2. **Applicabilité du droit de la consommation / rétractation** : non tranchée → bloquant pour les plans payants.
3. **Obligations de transparence de l'AI Act** pour les contenus générés (texte, image, voix) : non tranchées → à trancher avant la communication publique.
