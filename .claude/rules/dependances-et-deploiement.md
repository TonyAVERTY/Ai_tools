# Dépendances, CI et déploiement

## Dépendances
- Le projet n'a que **4 dépendances directes** (`imapflow`, `mysql2`, `nodemailer`, `pg`) : n'en ajoute pas sans raison écrite (ce qu'elle apporte, pourquoi pas du code maison, maintenance, taille transitive).
- Avant d'ajouter ou de mettre à jour : `npm audit`, **licence** (liste autorisée dans `scripts/license-check.js` : MIT, ISC, Apache-2.0, BSD, MIT-0…, jamais GPL/AGPL/LGPL/SSPL), dernier commit, mainteneurs. Une mise à jour **majeure** se justifie par un test de compatibilité.
- `package-lock.json` est commité ; `npm ci` en CI et en production. Jamais de `curl | sh`.
- Les contrôles `npm run security` (secrets, licences, audit) et le workflow « Sécurité » (secrets dans l'historique, SBOM, sauvegarde réelle) **doivent rester verts** : on corrige la cause, jamais le contrôle.

## Base de données
- Migrations (`src/migrations.js`) : toujours **à la fin** ; rejouables sur MySQL (`when: colMissing(…)`). Jamais une opération destructive ou irréversible sans l'accord du propriétaire, une sauvegarde avant, et la mention dans la PR.
- L'application n'utilise jamais un compte administrateur de base de données.

## Déploiement
- **Ne déploie jamais en production** et ne modifie jamais un service externe (Cloudflare, Stripe, MySQL, DNS, fournisseur d'IA) sans l'accord explicite du propriétaire. Pas de dépense non demandée.
- La CI fusionne ; la mise en production est une action manuelle du propriétaire (`docs/security/DEPLOYMENT_GUIDE.md`).
- Une PR qui change la configuration de production (variable d'environnement, `deploy/`) le dit dans sa description et met à jour `.env.example`, `DEPLOYMENT_GUIDE.md` et `PRODUCTION_CHECKLIST.md`.
- Ne contourne jamais une protection (CSP, CSRF, A2F, limites, `netguard`) pour qu'une fonctionnalité marche.

## Documentation de sécurité
- Une correction ou un risque nouveau se note dans `docs/security/SECURITY_CHANGELOG.md` et, s'il reste ouvert, dans `SECURITY_ACTION_PLAN.md`. Une vérification impossible reste « **non vérifiée** » : ne la déclare jamais réussie.
- Les documents de `docs/security/` sont internes : ils ne sont servis par aucune route (`test/route-security.test.js`) et ne contiennent aucun secret.
