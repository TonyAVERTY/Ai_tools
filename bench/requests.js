// Demandes étiquetées à la main pour mesurer l'orchestrateur : pour chacune, ce qu'une bonne décision doit être.
// `mode` : rapide | structure | approfondi. `primary` : intention principale. `must` : fiches qui doivent être retenues. `never` : fiches qui ne doivent pas l'être.
// `repo` : dépôt factice de bench/fixtures.js dont le profil est donné à l'orchestrateur (null = aucun dépôt joint).
export const REQUESTS = [
  { id: 'bug-trace', repo: 'web-ts', text: "Le panier plante avec « TypeError: Cannot read properties of undefined (reading 'price') » quand j'ajoute un article en rupture. Trouve la cause et corrige.", primary: 'debug', mode: 'structure', must: ['wf-bug-de-bout-en-bout', 'dev-debogage-cause-racine'], never: ['dev-base-de-donnees'] },
  { id: 'feature-media', repo: 'python-api', text: "Ajoute un endpoint pour exporter les commandes d'un client en CSV, en respectant la pagination et l'authentification existantes.", primary: 'feature', mode: 'structure', must: ['wf-modifier-sans-casser', 'dev-implementer-fonctionnalite', 'dev-tests-et-verification'] },
  { id: 'refactor', repo: 'go-cli', text: 'Refactore le package internal pour séparer la lecture des fichiers de la logique métier, sans changer le comportement.', primary: 'refactor', mode: 'structure', must: ['dev-refactoring-sur'] },
  { id: 'test-fail', repo: 'web-ts', text: "Le test tests/cart.test.ts échoue depuis ce matin avec une erreur d'assertion sur le total. Pourquoi ?", primary: 'debug', mode: 'structure', must: ['dev-debogage-cause-racine'] },
  { id: 'api-compat', repo: 'python-api', text: 'Je dois renommer le champ user_name en username dans la réponse de /users sans casser les clients mobiles existants.', primary: 'api', mode: 'structure', must: ['dev-api-compatibilite'] },
  { id: 'db-schema', repo: 'php-laravel', text: 'Ajoute une colonne phone à la table users avec une migration, et supprime la colonne fax qui ne sert plus.', primary: 'db', mode: 'approfondi', must: ['dev-base-de-donnees'] },
  { id: 'perf', repo: 'python-api', text: "La liste des commandes est très lente avec 50 000 lignes, on dirait un N+1. Optimise l'opération.", primary: 'perf', mode: 'structure', must: ['dev-performance'] },
  { id: 'security', repo: 'web-ts', text: 'Fais une analyse de sécurité du code d\'authentification dans src/auth : injection, gestion des secrets, droits.', primary: 'security', mode: 'approfondi', must: ['dev-securite'] },
  { id: 'low-doc', repo: 'php-laravel', text: 'Explique comment fonctionne le paiement dans ce projet, il n\'y a presque pas de documentation.', primary: 'explain', mode: 'structure', must: ['dev-comprendre-depot'], never: ['wf-modifier-sans-casser', 'dev-securite'] },
  { id: 'ambiguous', repo: 'web-ts', text: 'Améliore ça', primary: 'vague', mode: 'structure', must: ['wf-exigences-floues'], never: ['wf-modifier-sans-casser'] },
  { id: 'simple-explain', repo: 'go-cli', text: 'À quoi sert le fichier cmd/main.go ?', primary: 'explain', mode: 'rapide', maxSkills: 1 },
  { id: 'simple-docs', repo: 'go-cli', text: 'Corrige la faute dans le README : « fonctionalité ».', primary: 'docs', mode: 'rapide', maxSkills: 1, never: ['wf-modifier-sans-casser', 'wf-bug-de-bout-en-bout'] },
  { id: 'ci', repo: 'web-ts', text: 'Le pipeline GitHub Actions échoue à l\'étape build depuis la mise à jour de Node. Que se passe-t-il ?', primary: 'build', mode: 'structure', must: ['dev-ci-build-deploiement'] },
  { id: 'resume', repo: 'web-ts', text: 'On continue : reprends où on en était sur la migration du panier.', primary: 'resume', mode: 'structure', must: ['wf-reprise-de-tache'] },
  { id: 'review', repo: 'python-api', text: 'Relis ce diff avant que je merge la pull request et dis-moi ce qui cloche.', primary: 'review', mode: 'structure', must: ['dev-revue-de-code'] },
  { id: 'business', repo: null, text: "Écris-moi un mail de relance pour mes prospects qui n'ont pas répondu.", domain: 'business' },
];
