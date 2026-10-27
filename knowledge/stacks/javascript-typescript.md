---
nom: javascript-typescript
titre: Repères JavaScript et TypeScript
langages: JavaScript, TypeScript
---
- Gestionnaire : celui du fichier de verrouillage (package-lock.json → npm, pnpm-lock.yaml → pnpm, yarn.lock → yarn). Ne mélange jamais deux gestionnaires.
- Les commandes utiles sont dans les « scripts » du package.json ; lis-les avant d'en proposer. Ne suppose pas qu'un script existe.
- Modules : « type: module » ou extension .mjs = import/export ; sinon require. Respecte celui du dépôt.
- TypeScript : lis tsconfig.json (strict, chemins, cible) ; n'affaiblis pas le typage (any, assertions) pour faire passer une vérification.
- Pièges : promesses non attendues, erreurs async avalées, mutation partagée, comparaisons de dates et de nombres flottants, dépendances de développement utilisées en production.
- Monorepo (workspaces) : travaille dans le paquet concerné et utilise ses scripts.
