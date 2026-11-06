# Prompts pour retravailler l'UI/UX d'iaboss avec Claude Code

Comment t'en servir :

1. **Une session par prompt**, dans cet ordre : le prompt 0 (contexte) puis le prompt 1 (audit) dans la même session ; ensuite **un prompt de page par session** (2 à 13), toujours précédé du prompt 0.
2. Claude Code **ne code rien avant d'avoir montré son plan** : tu valides, puis il fait une PR par page vers `develop`.
3. Chaque prompt dit ce que la page fait, ce que la personne veut y faire, ce qui est déjà connu comme gênant, et ce qu'il ne faut pas casser. Le reste (mise en page, composants, détails) est laissé à Claude Code, qui lit `docs/DESIGN.md`, `docs/UX.md` et le code.

---

## Prompt 0 : le contexte (à coller au début de chaque session)

```
Tu travailles sur iaboss, une application web (Node 22 sans framework, HTML rendu côté serveur dans src/*views.js, scripts navigateur dans public/app*.js, CSS dans public/app.css et public/tokens.css, base SQLite en test et MySQL/MariaDB en production).

Le produit : iaboss aide des indépendants et de petites équipes à trouver des clients par mail, avec LEUR propre IA (Claude, ChatGPT ou Gemini, au choix, reliée par clé API ou abonnement). La personne ajoute un projet (le dépôt Git de son produit) ; l'IA lit le code, écrit une fiche projet et une cible, cherche des prospects (entreprise + email pro public + accroche personnalisée), rédige un modèle de mail, et la personne relit puis envoie depuis sa propre boîte, avec relance automatique, suivi des réponses (IMAP) et CRM. Autour : évolutions, audit du code, posts LinkedIn, vidéos de promotion, calendrier, comptabilité, facturation (devis, acompte, facture, avoir en PDF), clients, équipes, un assistant IA et un Support.

Le public : des gens proches du code, pas commerciaux, qui veulent savoir en dix secondes où ils en sont et quoi faire ensuite. Ton de la marque : franc, concret, on se tutoie, on dit ce que l'outil ne sait pas faire.

Ce que je veux : retravailler l'UI/UX pour qu'elle soit PLUS LÉGÈRE (moins d'informations affichées en même temps, aucune répétition, une seule action principale par écran) et plus claire. Principe : tout ce qui est validé devient un résumé grisé en lecture seule avec un bouton « Modifier » (déjà fait pour les modèles de mail, la cible du projet et les documents de facturation) ; ce qui est fait se replie, ce qui reste à faire se montre.

Lis d'abord, dans cet ordre : CLAUDE.md (règles du dépôt, à suivre à la lettre), docs/DESIGN.md (direction artistique), docs/UX.md (retours d'action, rédaction, animations), docs/support/*.md (ce que l'application fait, écrit pour l'utilisateur), public/tokens.css.

Règles non négociables (détail dans CLAUDE.md) :
- CSP stricte : aucun style="…" ni <script> en ligne, aucune ressource externe. Les couleurs viennent des jetons de public/tokens.css, jamais en dur dans app.css ou site.css.
- Rédaction : on tutoie ; un succès se dit « Nom + participe passé » sans point ni « ! » ; une erreur dit ce qui n'a pas marché puis la suite après « : » ; boutons à l'infinitif. test/wording.test.js échoue sinon.
- AUCUNE animation n'est ajoutée, changée ni retirée sans mon accord, présentée une par une (l'élément, le comportement actuel, la proposition, la valeur, le coût). Une animation en boucle n'anime que transform et opacity. Un gain de performance s'annonce mesuré avant et après.
- Chaque nouveau bouton, section ou changement de comportement visible met à jour docs/support/ dans le même commit (les libellés exacts entre « » sont comparés par test/support-docs.test.js). Un nouvel onglet de la barre du haut ajoute son étape dans TOUR_STEPS (src/tour.js).
- Toute donnée métier est filtrée par user_id ; les secrets ne sont jamais réaffichés ni journalisés.
- Git : jamais sur main ; branche de travail, Conventional Commits, petits commits logiques. Avant chaque commit : npm run lint, npm test, et pour l'interface npm run ui:check (Chromium). Dis clairement ce que tu n'as PAS pu tester ; ne dis jamais « c'est bon » sans l'avoir vérifié.

Tu travailles en équipe avec moi : si une décision de produit est mienne (supprimer une fonctionnalité, changer un sens), tu me poses une question précise au lieu de choisir.
```

---

## Prompt 1 : l'audit (sans code)

```
Fais l'audit de l'UI/UX de toute l'application, SANS rien modifier.

1. Génère des captures de chaque page à 1280 px et à 390 px avec scripts/responsive-audit.mjs (mode « shots »), en ouvrant les sections d'un projet comme le ferait une vraie personne (pas tout déplié d'un coup). Regarde-les vraiment.
2. Pour chaque page, liste : ce qui est affiché en trop, ce qui est répété (un même titre, un même message à deux endroits), ce qui est caché alors qu'il est vital, ce qui demande trop de clics, et ce qui casse sur téléphone.
3. Propose 5 principes d'interface pour iaboss (par exemple : une action principale par écran ; ce qui est fait se replie ; un état = un seul endroit ; pas de texte d'aide permanent ; le détail à la demande) et applique-les en une phrase à chaque page.
4. Propose un ordre de travail par page, du plus rentable au moins rentable, avec pour chacune la taille estimée du changement.
5. Rends-moi tout cela dans un document (docs/AUDIT-UX.md) et STOP : j'ai validé le plan avant que tu touches au code.
```

---

## Prompt 2 : la page Projets (accueil de l'application)

```
Retravaille la page Projets (src/views.js, dashboardPage ; public/app.js).

Ce que la page fait : une rangée de quatre chiffres (Projets, Prospects, Mails envoyés ce mois-ci, Tâches IA ce mois-ci, avec les plafonds du plan) ; un filtre « Poste » (Commerce, Communication, Finance…) ; « Nouveau projet » ; la carte « Consommation » de l'IA (tokens via iaboss ; avec Claude, session 5 h et semaine ; avec ChatGPT, les deux fenêtres lues chez OpenAI) ; puis un bloc par projet (déroulant) avec, sur sa ligne : le nom, le badge « config n/m » (ouvre la mise en route), le nombre de prospects, « à contacter », « réponses », la date du dernier envoi, et « Analyser » ou « Réanalyser ».
Dans un projet : Mise en route (liste des étapes restantes), En-tête (dépôt Git en lecture seule, site du produit), Cible, Prospecter (voir le prompt 3), Évolution, Audit, LinkedIn, Promotion, Récapitulatif, Configuration du projet (SMTP, boîte IMAP, base de données), Postes et tâches IA.
Des fenêtres de réponses de prospects s'affichent en bas à droite (« X vous a apporté une réponse »). Un menu « Activité » (en haut à droite) liste les tâches en cours.

Ce que la personne veut y faire en dix secondes : savoir si son projet est prêt à prospecter, ce qui reste à faire, lancer la prochaine action, voir si on lui a répondu.

Ce qui gêne déjà (constaté) : un projet ouvert fait des milliers de pixels de haut ; des titres sont répétés (« Modèle de mail » en en-tête de section puis juste dessous ; « Relance automatique » puis « Modèle de relance ») ; la section Envoi répète ce que dit déjà la mise en route (« Bloqué : modèle à valider, SMTP à configurer ») ; les fenêtres de réponses masquent le contenu ; un « Voir » et un compteur de tokens ajoutent du bruit sous chaque tâche terminée.

À ne pas casser : les liens ancrés depuis la mise en route (« Valider la cible » ouvre la bonne section), l'ouverture automatique du projet attendu, les rafraîchissements automatiques d'un projet (ils ne doivent jamais écraser ce que la personne est en train de saisir), les fenêtres de confirmation, les tests scripts/projets-sections-check.mjs, todo-check.mjs, feedback-check.mjs.

Propose d'abord le plan (ce qui s'affiche par défaut, ce qui se replie, ce qui disparaît), puis fais-le en petites PR.
```

---

## Prompt 3 : Prospecter (dans un projet)

```
Retravaille la section « Prospecter » d'un projet : Recherche de prospects, Modèle de mail, Envoi, Relance automatique, Prospects.

Ce que ça fait :
- Recherche de prospects : nombre à chercher, « Maintenant » ou « Cette nuit », bouton « Lancer la recherche » ; une tâche IA trouve des entreprises avec un email professionnel public, une source, une accroche et un score de 1 à 10.
- Modèle de mail : objet, objet B facultatif (test A/B), corps avec variables ({{entreprise}}, {{ville}}, {{accroche}}, {{expediteur}}, {{site}}), case « Envoyer en mail HTML », « Générer avec l'IA », « Aperçu », « Enregistrer », « Valider le modèle ». L'IA relit le texte avant de te le montrer ; un modèle validé est grisé et en lecture seule jusqu'à « Modifier ». Aperçu : ce que le prospect reçoit, avec un prospect réel au choix ou un exemple, des avertissements, la relecture du sens par l'IA, et une barre « Changer | Modifier » sur une phrase sélectionnée.
- Envoi : nombre de mails, bouton « Envoyer » (confirmation), garde-fous (plafonds, heures, relecture par l'IA, liste d'opposition, avertissement de montée en charge).
- Relance automatique : case, délai en jours, modèle de relance (mêmes règles que le premier mail), même fil.
- Prospects : liste, Kanban, fiche (prochaine action, notes, historique), recherche, import et export CSV, statuts (à contacter, envoyé, répondu, client, refus, rejeté…).

Ce que la personne veut y faire : écrire (ou faire écrire) UN bon mail, le vérifier, l'envoyer à quelques prospects, suivre les réponses. Elle ne veut pas lire des paragraphes d'aide.

Ce qui gêne : trop de champs et de textes d'aide visibles en même temps ; l'état « validé / brouillon » pas assez lisible d'un coup d'œil ; deux modèles (premier mail, relance) presque identiques mais présentés différemment ; la liste de prospects et le Kanban très denses sur téléphone.

À ne pas casser : le verrouillage des modèles validés, l'aperçu et ses contrôles (public/app-prospects.js), la relecture du sens avant envoi, les rafraîchissements automatiques, test/prospects-check.mjs et tpl-lock-check.mjs.

Plan d'abord, puis petites PR.
```

---

## Prompt 4 : les autres sections d'un projet

```
Retravaille les sections d'un projet autres que « Prospecter » : Mise en route, En-tête, Cible, Évolution, Audit du projet, LinkedIn, Promotion, Récapitulatif, Configuration du projet, Postes et tâches IA.

Ce que chacune fait :
- Mise en route : liste des étapes (analyser, valider la cible, chercher des prospects, SMTP, modèle de mail, premier envoi, puis le facultatif : boîte IMAP, relance, évolutions, LinkedIn).
- En-tête : dépôt Git (lecture seule), site du produit.
- Cible : description, zone, taille, décideur, secteurs, requêtes ; « Valider la cible » ; une cible validée est grisée avec « Modifier ».
- Évolution : l'IA propose des idées de fonctionnalités tirées du code, envoyées par mail.
- Audit du projet : rapport qualité et sécurité du code.
- LinkedIn : relier un compte, faire écrire un post, relire, programmer, publier, historique.
- Promotion : vidéo de design motion (sujet, images par seconde, durée, format), lecture, téléchargement.
- Récapitulatif : chiffres business et courbes à partir de la base de données du client (tables choisies dans des listes, sans écrire de requête).
- Configuration du projet : SMTP d'envoi, boîte de réception IMAP, base de données du récapitulatif.
- Postes et tâches IA : tâches par poste (Commerce, Communication, Finance…), livrable à lire et copier.

Ce que la personne veut : configurer UNE fois (SMTP, IMAP), puis ne plus y penser ; lancer une tâche et lire son résultat sans bruit.
Ce qui gêne : toutes ces sections sont des accordéons de même poids ; les formulaires de configuration sont longs ; les tâches terminées répètent « terminé », « Voir » et les tokens.
À ne pas casser : les secrets ne sont jamais réaffichés (seulement les 4 derniers caractères), les erreurs de connexion SMTP/IMAP restent explicites, scripts/bdd-check.mjs, linkedin-check.mjs, promo-check.mjs, recap-check.mjs.

Plan d'abord, puis petites PR.
```

---

## Prompt 5 : la page Mails

```
Retravaille la page Mails (src/mailviews.js, src/mailroutes.js, public/app-replies.js).

Ce qu'elle fait : deux vues. « Envoyés » : une liste de tous les mails (date, destinataire, objet avec projet et type, état : Envoyé, Lu (accusé), Répondu, Rejeté, Refus, Non envoyé) avec une barre de chiffres qui filtre ; un clic sur l'objet déplie le texte envoyé, ou la raison d'un rejet ou d'un échec. « Réponses » : les réponses des prospects classées par intention (intéressé, plus tard, refus…), avec un brouillon de réponse suggéré à copier et, si un rendez-vous est évoqué, une proposition « Ajouter à ton calendrier ».
Un badge sur l'onglet « Mails » compte les réponses non lues ; une fenêtre en bas à droite les annonce.

Ce que la personne veut : voir d'un coup d'œil qui a répondu et quoi faire, retrouver un mail précis, comprendre pourquoi un mail n'est pas parti.
Ce qui gêne : liste dense sur téléphone ; les mails anciens affichent « Contenu non conservé » ; la raison d'un rejet n'existe que si la boîte IMAP est reliée.
À ne pas casser : l'isolation entre comptes (un mail d'un autre compte est « introuvable »), la liste déroulante accessible au clavier, scripts/mails-check.mjs et replies-check.mjs.
```

---

## Prompt 6 : Calendrier

```
Retravaille la page Calendrier. Elle montre le mois, les événements (heures de Paris), permet d'ajouter un rendez-vous à la main ou depuis une réponse de prospect, et de brancher un agenda externe (Google, Apple, Outlook) par un lien iCal. Sur téléphone, la grille devient une liste de jours. La personne veut voir ce qui arrive cette semaine et ajouter un rendez-vous en deux gestes. Garde l'isolation par compte et les heures de Paris.
```

---

## Prompt 7 : Comptabilité

```
Retravaille la page Comptabilité. Elle montre ta situation, l'ajout d'une ligne (paiement, dépense, remboursement…) avec un justificatif OBLIGATOIRE, les chiffres par période et par projet, le guide « Faire ma déclaration » et les exports. Les factures émises depuis la Facturation arrivent toutes seules, à encaisser. La personne veut saisir une ligne vite, voir ce qu'elle doit déclarer, et exporter sans réfléchir. Garde le justificatif obligatoire, les exports et les tests (scripts/compta-check.mjs). Réduis la densité des tableaux sur téléphone.
```

---

## Prompt 8 : Facturation

```
Retravaille la page Facturation. Le parcours, par projet : 1) informations légales (champs obligatoires, préremplis quand c'est possible) ; 2) trois exemples de devis écrits par l'IA, on en choisit un, on l'affine avec l'IA, on le valide ; 3) l'IA prépare l'acompte, la facture finale et l'avoir dans le même style, chacun se valide séparément (un document validé est un résumé grisé avec « Modifier ») ; 4) on émet un document : devis, acompte, facture finale ou avoir, rattaché à un client, avec numérotation, PDF, et envoi dans la Comptabilité.
La personne veut émettre un devis ou une facture en moins d'une minute une fois le modèle validé, sans revoir le modèle. Ce qui gêne : l'étape « modèles » et l'étape « émission » se mélangent ; la page est longue. Garde les mentions légales écrites par le code (jamais par l'IA), les totaux calculés par le code, scripts/facturation-check.mjs et facturation-emission-check.mjs.
```

---

## Prompt 9 : Clients

```
Retravaille la page Clients. Par projet (en déroulants) : les clients et les prospects, recherche, ajout et modification d'un client, la fiche client (documents générés, échanges), le passage d'un prospect en client, l'export CSV. La personne veut retrouver un client, voir où il en est (devis, facture, dernier échange) et agir. Garde scripts/clients-check.mjs.
```

---

## Prompt 10 : Équipe, Mon compte, Relier mon IA

```
Retravaille trois pages liées au compte.
- Équipe : rôles, invitations, partage de projets, places selon le plan.
- Mon compte : connexion, usage du mois avec les plafonds, carte « Mon IA » (IA reliée, mode, état, limites d'abonnement), agenda externe, mode développeur (jetons API, MCP), suppression du compte avec confirmation par l'email.
- Relier mon IA : trois cartes (Claude, ChatGPT, Gemini) ; pour chacune, clé API (recommandée) ou, avec un avertissement de risque et une case à cocher, abonnement Claude, compte ChatGPT ou abonnement Google (connexion guidée avec lien et code, 60 secondes pour Google, ou fichier collé).
La personne veut relier son IA sans se tromper et comprendre les risques sans lire un roman. Garde les avertissements de risque et leurs versions enregistrées, les secrets jamais réaffichés, scripts/link-check.mjs, google-link-check.mjs, reconnect-check.mjs.
```

---

## Prompt 11 : Réglages

```
Retravaille la page Réglages (public/app.js, src/views.js). Sections : Notifications (canaux Discord, Slack, Telegram, e-mail, quels événements), Dépôts Git (hôtes autorisés, jetons), Garde-fous (plafonds d'envoi, pause, accusé de lecture, pied de page), Budget et modèles IA (selon l'IA : budget en $ avec une clé API, sinon seulement les modèles), Prompts IA (consignes par tâche et par gamme de modèle). La personne veut régler UNE chose et partir. Ce qui gêne : une seule très longue page. Propose une navigation par sections (il existe déjà une table des matières : scripts/settings-toc-check.mjs) et un enregistrement par section sans jamais perdre une saisie (scripts/savebar-check.mjs, forms-keep-check.mjs).
```

---

## Prompt 12 : Assistant et Support

```
Retravaille la page IA (public/chat.js, src/chat*.js). Le menu « Assistant » a deux entrées : l'assistant (ton IA, pour discuter, rédiger, réfléchir ; conversations, modèles, pièces jointes, projet joint) et Support (répond d'après docs/support/ sur iaboss, avec la même IA). Elle affiche les tokens, des suggestions de départ, des limites de pièces jointes. La personne veut poser une question et avoir la réponse, retrouver une ancienne conversation. Garde la confidentialité (ce que l'IA peut lire d'un projet joint), scripts/chat-files-check.mjs et support-check.mjs.
```

---

## Prompt 13 : le site public et les pages légales

```
Retravaille le site public (src/site/*.js, public/site.css) : accueil, Fonctionnement, Tarifs, Docs (API et MCP), mentions légales, confidentialité, CGU, Connexion. L'accueil doit expliquer en dix secondes ce qu'iaboss fait et pour qui, avec la lettre d'exemple du design actuel ; les Tarifs disent clairement qui paie quoi (l'IA est payée directement par la personne à son fournisseur) et les risques d'un abonnement ; les pages légales restent exactes (elles décrivent ce que fait vraiment l'application : tout changement de fonctionnalité met à jour le texte et LEGAL_UPDATED). Garde scripts/site-check.mjs, footer-check.mjs, le contraste et l'accessibilité.
```

---

## Prompt 14 : ce qui traverse toutes les pages

```
Retravaille ce qui est commun à toute l'application :
- La barre du haut (Projets, Mails avec son badge, Calendrier, Comptabilité, Facturation, Clients, Équipe ; à droite Activité, Site internet, Assistant, avatar) : lisibilité, état actif, comportement sur téléphone (les libellés se réduisent), la visite guidée du tableau de bord (src/tour.js, TOUR_STEPS : une étape par onglet, dans l'ordre).
- Les états : chargement (cercle), vide (une phrase qui dit quoi faire), erreur (« Réessayer »), succès (toast « Nom + participe passé »), confirmations (confirmBox), alertes de plafond atteint.
- Le mobile (390 px) : zones tactiles d'au moins 44 px, aucun défilement horizontal, champs de 16 px minimum, tableaux qui deviennent des cartes (public/responsive.css).
- L'accessibilité : navigation au clavier, focus visible, rôles ARIA des déroulants et des fenêtres, contrastes, mouvement réduit.
- L'accueil d'un nouveau compte : /welcome, la page « Relier mon IA », puis la mise en route d'un premier projet.
Propose un plan, puis des PR courtes, sans toucher aux animations sans mon accord.
```
