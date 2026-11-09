# iaboss : règles de travail pour Claude Code

## Règle n° 1 : la documentation du Support se met à jour avec chaque fonctionnalité

Le mode **Support** de la page IA (menu IA → Support) fait répondre l'IA de l'utilisateur (Claude, ChatGPT ou Gemini) d'après `docs/support/*.md`. Cette documentation est ce que les utilisateurs et leur IA savent de l'application : **si elle est fausse ou incomplète, le Support répond faux.**

**À chaque nouvelle fonctionnalité, nouveau bouton, nouvelle section, nouveau champ, nouvelle page, nouveau réglage, nouvelle tâche IA ou changement de comportement visible, mets à jour `docs/support/` dans le même commit.** Ne termine pas une tâche d'interface sans l'avoir fait, même si personne ne le redemande.

- Écris pour un utilisateur : libellés exacts de l'écran entre « » (le test les compare à l'application), chemin complet (« Réglages → Garde-fous → … »), étapes numérotées, causes d'erreur et remèdes.
- Ajoute aussi la rubrique de dépannage correspondante dans `docs/support/18-depannage-et-faq.md` quand la fonctionnalité peut échouer.
- Un nouveau fichier : commence par `# Titre` puis une ligne `Résumé : …` (l'index du Support est généré à partir de ces deux lignes). Nomme-le `NN-sujet.md`.
- **Ne recopie jamais à la main** ce qui vient du code : offres et plafonds, limites de la page IA et des pièces jointes, vidéos de promotion, liste des modèles, liste des consignes. Ces fichiers sont **générés** par `src/services/supportdocs.js` (`plans-et-limites.md`, `modeles-ia.md`, `taches-ia-et-prompts.md`) ; un nouveau plafond ou un nouveau modèle y apparaît tout seul. Pour ajouter une donnée générée, modifie `generatedDocs()`.
- `test/support-docs.test.js` **échoue** tant qu'un bouton, une section de projet, une rubrique des Réglages, un type de job, une consigne ou une page n'est pas documenté. Quand il échoue, documente (ne contourne pas) ; pour une nouvelle page, ajoute-la aussi à `PAGES` dans ce test. Les libellés « génériques » (Annuler, Enregistrer…) sont exemptés.
- Le test ne voit pas tout (le sens, les règles de gestion, les étapes) : c'est à toi de relire la documentation du sujet et de la corriger.
- Change le comportement d'un bouton ou d'un plafond : corrige la phrase qui le décrit, pas seulement le code.

## Règle n° 2 : la visite guidée suit chaque nouveauté

La visite guidée du tableau de bord (`src/tour.js`, `TOUR_STEPS`) fait découvrir l'application. **À chaque nouvel onglet de la barre du haut, nouvelle page ou nouvelle fonctionnalité importante, ajoute son étape dans `TOUR_STEPS` dans le même commit**, avec un titre, un texte qui explique à quoi ça sert et la cible à éclairer.
- Un onglet dans `NAV` (`src/views.js`) sans étape qui vise `.pills a[href="…"]` **fait échouer `test/tour.test.js`** : ajoute l'étape, ne contourne pas le test. Les étapes suivent l'ordre des onglets.
- Ajoute le sélecteur de la cible dans le tableau `has` de `test/tour.test.js`, et relance `scripts/tour-check.mjs` (rendu dans Chromium).
- La documentation du Support liste les étapes toute seule (générée depuis `TOUR_STEPS`) : ne la recopie pas.

## Autres règles du dépôt

- **Migrations** (`src/migrations.js`) : on ajoute **toujours à la fin** de la liste (la version est l'index). Jamais d'insertion au milieu : une base déjà migrée sauterait la migration. Les `ALTER TABLE` MySQL doivent être rejouables (`when: colMissing(…)`). La CI rejoue toute la suite sur MariaDB 10.11 (job `mysql`, `npm run test:mysql`) ; MySQL 8 n'est pas testé : le dire dans la PR si la migration y change quelque chose.
- **Front** : `public/app.js` garde les outils communs (exposés dans `window.AiTools` : `$`, `$$`, `api`, `esc`, `every`, `listen`…) ; chaque fonctionnalité volumineuse vit dans un fichier `public/app-<nom>.js`, chargé après lui (à déclarer dans `src/server.js` et `src/views.js`, et à ajouter à la liste des fichiers lus par `test/support-docs.test.js`). `ajax.js` relance ces scripts à chaque navigation : tout ce qui est branché sur `document`, `window` ou un minuteur passe par `listen` / `every` / `later`.
- **CSP stricte** : aucun `style="…"` ni `<script>` en ligne dans le HTML, aucune ressource externe. Les couleurs viennent des jetons de `public/tokens.css` (jamais en dur dans `public/site.css`).
- **Rédaction de l'interface** (`docs/UX.md`, « Rédaction ») : on tutoie ; un succès se dit « Nom + participe passé » sans point ni « ! » ; une erreur dit ce qui n'a pas marché puis la suite après « : » (le point final est ajouté à l'affichage) ;
  boutons à l'infinitif (Enregistrer, Ajouter / Créer, Supprimer / Retirer / Effacer ont chacun leur sens). `test/wording.test.js` échoue sur « avec succès », un « ! », un point sur un succès ou un « vous » : corrige le texte, ne contourne pas le test.
- **Animations** (`docs/UX.md`, « Animations ») : aucune n'est ajoutée, changée ni retirée sans l'accord du propriétaire du produit, présentée une par une ; une animation en boucle n'anime que `transform` et `opacity` (`test/motion.test.js`) ;
  un gain de performance s'annonce mesuré avant et après.
- **Icônes** : `src/icons.js` (sprite par page) ; une icône utilisée doit exister.
- **Secrets** : jamais dans le dépôt ni dans les journaux ; chiffrés en base ; jamais réaffichés.
- **Isolation** : toute donnée métier est filtrée par `user_id` ; un compte ne voit jamais celles d'un autre (réponse « introuvable »).
- **Vérifications avant commit** : `npm run lint` puis `npm test` ; pour l'interface, vérifier dans Chromium (scripts `scripts/*-check.mjs`, `scripts/responsive-audit.mjs`, `scripts/contrast-audit.mjs` : contraste clair/sombre de chaque texte, barre du bas, débordement) : `npm run ui:check` les lance toutes (`npm run ui:check -- promo` pour un filtre) avec `PLAYWRIGHT_MODULE` et `PLAYWRIGHT_CHROMIUM` ; la CI les exécute aussi (job `ui`). Dire clairement ce qui n'a pas pu être testé (MySQL, bwrap, Safari, vrai Claude).
- **Intelligence de Claude** (`docs/INTELLIGENCE.md`) : les fiches de méthode sont dans `knowledge/skills` (métier et développement) et `knowledge/stacks`, lues par `src/services/skills.js` ; ne les recopie jamais dans `prompts.js`. Une fiche de développement suit le contrat de 12 éléments (`test/skills.test.js`), doit être atteignable par une demande de `bench/requests.js` (`test/orchestrator.test.js`) et n'ajoute aucune propriété d'en-tête inventée. Une règle de l'orchestrateur ou du profil de dépôt qui change se prouve par un cas étiqueté dans `bench/`, pas par une exception. Aucune supériorité sur Claude seul n'est annoncée sans `node scripts/bench.mjs --live` exécuté ; Claude n'a pas de `Bash` ni d'`Edit` dans l'application (ne pas l'affaiblir).
- **Commits** : Conventional Commits, petits et logiques, jamais directement sur `main`/`master`.
