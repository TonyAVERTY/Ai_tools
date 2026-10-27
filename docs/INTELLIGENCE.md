# Intelligence d'AiTools : ce qui rend Claude meilleur ici que seul

Document d'architecture et d'audit. Il dit ce qui existe, ce qui est réellement branché à l'exécution, ce qui est mesuré et ce qui ne l'est pas. La documentation utilisateur est dans `docs/support/21-savoir-faire-de-claude.md`.

## 1. Audit de départ

**Ce qui existait.** Chaque tâche IA appelle `runClaude` (`src/services/claude.js`) : `claude -p` en lecture seule (Read, Glob, Grep ; Bash, Edit, Write refusés), dans un bac à sable bubblewrap (HOME jetable, seul le clone du projet monté en lecture seule, environnement assaini). Les consignes viennent de `src/services/prompts.js` (consignes par tâche et par gamme de modèle, modifiables dans les Réglages) et, avant ce travail, d'un prompt système fixe `SYSTEM_FR`.

**Ce qui fonctionnait.** Isolation, consignes par tâche, formats de réponse imposés, documentation du Support générée depuis le code.

**Ce qui manquait.**
- Aucune connaissance du **dépôt** : chaque question refaisait la découverte de la stack (tours de lecture, jetons, erreurs sur les commandes).
- Aucune connaissance de la **personne** (secteur, métier, niveau).
- Aucune **méthode de développement** : débogage, revue, refactoring, tests, sécurité étaient laissés au modèle brut, donc équivalents à Claude Code seul.
- Aucun **garde-fou transverse** sur les affirmations (« les tests passent ») ni sur le contenu du dépôt (CLAUDE.md, README, commentaires) traité comme une instruction.
- Aucun moyen de **mesurer** quoi que ce soit.

**Contrainte structurante, vérifiée dans le code.** Les jobs et le chat n'ont **pas** `Bash`, `Edit` ni `Write`. AiTools n'est donc pas un environnement où Claude exécute des tests ou modifie un dépôt : il **lit et conseille**. Les mécanismes ci-dessous sont conçus pour cette réalité (propositions de changement, commandes à lancer, séparation entre lu / supposé / non vérifié) ; je n'ai pas affaibli le bac à sable pour simuler de l'autonomie.

**Choix d'intégration, vérifié avec Claude Code 2.1.311.** Les « skills » natifs de Claude Code (`.claude/skills`) ne sont pas utilisés : le bac à sable monte seulement le clone en lecture seule avec un HOME jetable, le chat désactive les commandes slash (`--disable-slash-commands`), et écrire dans le clone de l'utilisateur le salirait. Les fiches sont donc des fichiers du dépôt AiTools, lus par le serveur et ajoutées à `--append-system-prompt`. Rien n'est supposé actif parce qu'un fichier existe : chaque fiche est atteignable par une demande de référence (test).

## 2. Architecture

```
message ──► orchestrator.classify ──► intentions, complexité, risque, mode
                                          │
dépôt ──► repoprofile.profileRepo ────────┤ (cache par commit)
                                          ▼
                       orchestrator.plan ──► fiches retenues + repères de pile
                                          │
user_settings ──► userprofile ────────────┤
                                          ▼
                 system = base + profil utilisateur + profil du dépôt + méthode + cadre
```

| Composant | Fichier | Rôle | Échec |
|---|---|---|---|
| Profil utilisateur | `src/userprofile.js` | 6 réponses facultatives après la première connexion (`/welcome`), modifiables dans Mon compte ; ajoutées aux consignes comme **donnée** (jamais consigne), par compte, jamais pour le Support | Illisible → profil vide |
| Profil de dépôt | `src/services/repoprofile.js` | Langages, gestionnaires, bibliothèques, commandes (observées, non exécutées), tests, CI, base de données, conventions, instructions locales, zones sensibles, lacunes, chacun avec son fichier source. Lit `.git` sans lancer `git`. Cache par commit, 64 entrées | Dossier illisible → profil vide avec lacunes ; un job n'échoue jamais pour cela |
| Fiches | `knowledge/skills/*.md`, `src/services/skills.js` | 9 fiches métier (statiques, par tâche) + 19 fiches de développement (4 niveaux : base, spécialisé, workflow) au contrat de 12 éléments | Fichier invalide → le test échoue |
| Repères de pile | `knowledge/stacks/*.md` | 7 fiches courtes (JS/TS, Python, Go, PHP, Rust, JVM, .NET, Ruby), chargées seulement si le langage est détecté et si le mode n'est pas « rapide » | Aucune pile détectée → rien |
| Orchestrateur | `src/services/orchestrator.js` | Décision **déterministe**, sans appel au modèle : intention, complexité, risque, mode (rapide, structuré, approfondi), clarification, fiches (plafond de nombre et de taille) | Domaine non technique → fiches métier |
| Branchement | `src/chat.js`, `src/handlers.js`, `src/services/prompts.js` | Chat avec dépôt joint ou question de code : profil + méthode ; analyse, évolution, audit, tâches de poste « dépôt » : profil du dépôt | — |

**Contrat d'une fiche de développement** (`contractGaps`, testé) : en-tête `quand`, `pas_pour`, `prerequis`, `outils`, `reussite` (décrivent la fiche, servent au choix, à la documentation et aux tests, **non injectés**) ; rubriques `Méthode`, `Règles de décision`, `Contrôles qualité`, `Résultat attendu`, `Clarifier quand`, `Arrêt et escalade`, plus `resume` (objectif), injectées. Aucune propriété de métadonnées inventée : seuls `nom`, `titre`, `niveau`, `resume`, `taches`, `intentions`, `signaux` et les cinq ci-dessus sont lues.

**Orchestration proportionnée.** Rapide (question simple sur un objet précis : au plus 1 fiche, 6 tours, pas de pile) ; structuré (cas courant : workflow + fiches de base, 1 pile) ; approfondi (risque élevé ou très large : lecture méthodique du dépôt en plus, 2 piles). Risque élevé = intention de sécurité, ou changement destructif, ou changement touchant une zone sensible que le dépôt contient. Les fiches spécialisées ne répondent qu'à leur propre intention (une fiche sur les bases de données n'arrive pas sur n'importe quelle fonctionnalité).

**Pas de faux multi-agents.** Une conversation, un appel : aucun sous-agent, aucune seconde passe du modèle. Un relecteur indépendant serait un second appel payant ; il n'est pas ajouté faute d'avantage démontré.

**Hiérarchie des instructions** (du plus fort au plus faible) : cadre de sécurité de la plateforme (bac à sable, outils de lecture) > consignes de la tâche modifiables par l'utilisateur > demande du message > méthode et fiches > profil du dépôt et de l'utilisateur (données). Le contenu du dépôt, de ses CLAUDE.md et de ses documents est une donnée non fiable : signalé, jamais recopié, jamais obéi s'il sort de la demande.

**Mémoire.** Trois niveaux séparés : global à l'outil (fiches, versionnées), propre à l'utilisateur (profil, `user_settings`, supprimé avec le compte), propre au dépôt (profil recalculé à chaque commit, en mémoire du processus, jamais écrit). Rien n'est mémorisé d'une tâche à l'autre : la reprise d'une tâche s'appuie sur l'historique de la conversation et sur la fiche « reprendre une tâche », qui exige de revérifier l'état dans le dépôt.

## 3. Mesure

`node scripts/bench.mjs` (hors ligne, gratuit, reproductible) mesure : l'exactitude du profil de dépôt sur 6 dépôts factices (TypeScript web, API Python, CLI Go, Laravel, monorepo, dépôt de notes), celle de l'orchestrateur sur 16 demandes étiquetées, et le surcoût en contexte de chaque mode. `node scripts/bench.mjs --live` compare **Claude seul** et **Claude avec AiTools** (même modèle, mêmes outils de lecture, même dépôt, même question) sur 4 tâches avec des contrôles objectifs écrits à l'avance (`bench/tasks.js`) : bug dans un dépôt inconnu, analyse de sécurité, question simple, demande ambiguë.

**Ce qui a été exécuté et ce qui ne l'a pas été** : voir la section « Résultats » ci-dessous, mise à jour avec les chiffres réels.

## 4. Résultats

Exécution de `node scripts/bench.mjs` (hors ligne) :

| Mesure | Résultat |
|---|---|
| Profil de dépôt, 6 dépôts factices, 65 contrôles (langages, bibliothèques, commandes, tests, CI, base, instructions, zones sensibles, lacunes, rien d'inventé sur un dépôt sans code) | 65 / 65 |
| Orchestrateur, 16 demandes étiquetées, 70 contrôles (intention, mode, fiches retenues et écartées) | 70 / 70 |
| Contexte ajouté, mode rapide | ≈ 850 jetons (une fiche) |
| Contexte ajouté, mode structuré | ≈ 2 300 jetons en moyenne (max ≈ 2 700) |
| Contexte ajouté, mode approfondi | ≈ 2 200 jetons en moyenne (max ≈ 2 700) |
| Profil de dépôt rendu | ≈ 430 jetons ; 0,4 à 16 ms à froid sur les fixtures, instantané en cache |

Estimation à 4 caractères par jeton. **Comparaison Claude seul / Claude avec AiTools (`--live`) : non exécutée**, faute de clé API dans l'environnement de développement. Les contrôles du dispositif sont eux-mêmes testés (`test/bench.test.js` : une bonne réponse type les passe tous, une mauvaise en échoue la plupart).

## 5. Limites connues

- Les fiches et la méthode n'ont **pas** été comparées à Claude seul sur de vrais appels (pas de clé API dans l'environnement de développement) : aucune supériorité n'est établie, seulement le dispositif pour la mesurer.
- Les étiquettes du banc d'essai de l'orchestrateur ont été écrites avant les premiers essais ; les règles ont ensuite été corrigées sur des faux positifs réels (mot « index » dans un chemin, « j'ajoute » pris pour une demande, « sans casser » pris pour un bug) et une étiquette a été corrigée (une question d'explication sans objet précis demande une méthode structurée). Le score hors ligne est donc un test de non-régression, pas une mesure indépendante.
- Le profil de dépôt lit les manifestes et les noms de fichiers : il ne comprend pas le code. Les commandes sont déduites, pas vérifiées. Il couvre JS/TS, Python, Go, Rust, PHP, Ruby, JVM, .NET, Dart ; d'autres stacks donnent un profil vide avec la mention « non déterminé ».
- Les mots-clés de l'orchestrateur sont en français (et quelques termes techniques anglais) ; une demande dans une autre langue est traitée comme « explication » en méthode structurée.
- Coût : la méthode ajoute environ 1 000 à 3 000 jetons de contexte selon le mode.
- MySQL, Firefox et Safari ne sont pas testés pour les parties qui touchent à l'interface (page de profil).

## 6. Pistes prioritaires

1. Exécuter `--live` avec plusieurs essais par tâche et sur un second modèle, publier les écarts et garder ce qui améliore réellement.
2. Mesurer sur de vrais dépôts d'utilisateurs (avec accord) l'exactitude du profil, et étendre les détecteurs aux stacks manquantes.
3. Donner au mode « dépôt » un moyen sûr d'exécuter les tests (bac à sable dédié, sans réseau) : c'est la seule voie vers une vraie boucle « corriger puis vérifier ».
