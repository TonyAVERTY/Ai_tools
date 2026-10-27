# AiTools : règles de travail pour Claude Code

## Règle n° 1 : la documentation du Support se met à jour avec chaque fonctionnalité

Le mode **Support** de la page IA (menu IA → Support) fait répondre le Claude de l'utilisateur d'après `docs/support/*.md`. Cette documentation est ce que les utilisateurs et leur IA savent de l'application : **si elle est fausse ou incomplète, le Support répond faux.**

**À chaque nouvelle fonctionnalité, nouveau bouton, nouvelle section, nouveau champ, nouvelle page, nouveau réglage, nouvelle tâche IA ou changement de comportement visible, mets à jour `docs/support/` dans le même commit.** Ne termine pas une tâche d'interface sans l'avoir fait, même si personne ne le redemande.

- Écris pour un utilisateur : libellés exacts de l'écran entre « » (le test les compare à l'application), chemin complet (« Réglages → Garde-fous → … »), étapes numérotées, causes d'erreur et remèdes.
- Ajoute aussi la rubrique de dépannage correspondante dans `docs/support/18-depannage-et-faq.md` quand la fonctionnalité peut échouer.
- Un nouveau fichier : commence par `# Titre` puis une ligne `Résumé : …` (l'index du Support est généré à partir de ces deux lignes). Nomme-le `NN-sujet.md`.
- **Ne recopie jamais à la main** ce qui vient du code : offres et plafonds, limites de la page IA et des pièces jointes, vidéos de promotion, liste des modèles, liste des consignes. Ces fichiers sont **générés** par `src/services/supportdocs.js` (`plans-et-limites.md`, `modeles-claude.md`, `taches-ia-et-prompts.md`) ; un nouveau plafond ou un nouveau modèle y apparaît tout seul. Pour ajouter une donnée générée, modifie `generatedDocs()`.
- `test/support-docs.test.js` **échoue** tant qu'un bouton, une section de projet, une rubrique des Réglages, un type de job, une consigne ou une page n'est pas documenté. Quand il échoue, documente (ne contourne pas) ; pour une nouvelle page, ajoute-la aussi à `PAGES` dans ce test. Les libellés « génériques » (Annuler, Enregistrer…) sont exemptés.
- Le test ne voit pas tout (le sens, les règles de gestion, les étapes) : c'est à toi de relire la documentation du sujet et de la corriger.
- Change le comportement d'un bouton ou d'un plafond : corrige la phrase qui le décrit, pas seulement le code.

## Autres règles du dépôt

- **Migrations** (`src/migrations.js`) : on ajoute **toujours à la fin** de la liste (la version est l'index). Jamais d'insertion au milieu : une base déjà migrée sauterait la migration. Les `ALTER TABLE` MySQL doivent être rejouables (`when: colMissing(…)`). Les tests de migration ne tournent que sur SQLite : le dire dans la PR.
- **CSP stricte** : aucun `style="…"` ni `<script>` en ligne dans le HTML, aucune ressource externe. Les couleurs viennent des jetons de `public/tokens.css` (jamais en dur dans `public/site.css`).
- **Icônes** : `src/icons.js` (sprite par page) ; une icône utilisée doit exister.
- **Secrets** : jamais dans le dépôt ni dans les journaux ; chiffrés en base ; jamais réaffichés.
- **Isolation** : toute donnée métier est filtrée par `user_id` ; un compte ne voit jamais celles d'un autre (réponse « introuvable »).
- **Vérifications avant commit** : `npm run lint` puis `npm test` ; pour l'interface, vérifier dans Chromium (scripts `scripts/*-check.mjs`, `scripts/responsive-audit.mjs`). Dire clairement ce qui n'a pas pu être testé (MySQL, bwrap, Safari, vrai Claude).
- **Intelligence de Claude** (`docs/INTELLIGENCE.md`) : les fiches de méthode sont dans `knowledge/skills` (métier et développement) et `knowledge/stacks`, lues par `src/services/skills.js` ; ne les recopie jamais dans `prompts.js`. Une fiche de développement suit le contrat de 12 éléments (`test/skills.test.js`), doit être atteignable par une demande de `bench/requests.js` (`test/orchestrator.test.js`) et n'ajoute aucune propriété d'en-tête inventée. Une règle de l'orchestrateur ou du profil de dépôt qui change se prouve par un cas étiqueté dans `bench/`, pas par une exception. Aucune supériorité sur Claude seul n'est annoncée sans `node scripts/bench.mjs --live` exécuté ; Claude n'a pas de `Bash` ni d'`Edit` dans l'application (ne pas l'affaiblir).
- **Commits** : Conventional Commits, petits et logiques, jamais directement sur `main`/`master`.
