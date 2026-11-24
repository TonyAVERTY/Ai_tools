# Règles de sécurité permanentes (iaboss)

Ces règles s'appliquent à **toute** modification. Elles viennent de l'audit (`docs/security/`). Ne les affaiblis jamais pour faire passer un test ou une fonctionnalité : corrige la fonctionnalité.
Une fonctionnalité qui marche mais qui introduit un risque de sécurité non traité n'est **pas terminée**.

## Données venant de l'extérieur
- Tout ce qui vient d'un utilisateur, d'un fichier, d'une API, d'un site web, d'un dépôt Git, d'une réponse de prospect ou d'un modèle d'IA est **non fiable**.
- **Validation côté serveur**, toujours (type, longueur, liste blanche). Une validation du navigateur n'est jamais une protection.
- SQL : **requêtes préparées**, jamais de concaténation. Un fragment dynamique (tri, colonne) vient d'une **liste blanche**.
- HTML : tout est échappé (`esc` côté serveur, `esc` d'`AiTools` côté navigateur). Jamais de `style="…"` ni de `<script>` en ligne (CSP stricte, `default-src 'self'`). Les couleurs viennent de `public/tokens.css`.
- Commandes : `spawn` sans shell, arguments en tableau, jamais de chaîne construite avec une donnée externe.
- Fichiers : jamais un chemin fourni par l'utilisateur ; `file` en base est un nom, pas un chemin. Type vérifié à la signature, taille bornée.
- Sorties réseau vers un hôte choisi par l'utilisateur : par `src/netguard.js` (ports, DNS résolu, adresses privées refusées, IP épinglée). Jamais de `fetch` direct vers une adresse venant d'une donnée.
- Redirections : cible fixe ou liste blanche (jamais une adresse reçue).

## Accès et permissions
- **Refus par défaut.** Toute route est authentifiée, sauf celles de la liste blanche de `test/route-security.test.js`. Ajouter une route publique = la déclarer dans ce test **après relecture de sécurité** : ne jamais « adapter » le test pour le faire passer.
- Toute donnée métier est filtrée par `user_id` (ou par un projet du compte, ou par le rôle d'équipe). Une ressource d'un autre compte répond « introuvable » (404), jamais 403.
- Le back-office (`admin: true`) répond 404 aux non-administrateurs et **exige l'A2F** (`ADMIN_REQUIRE_MFA`). Ne jamais désactiver ces contrôles.
- Toute écriture authentifiée passe par `checkOrigin` (en-tête `Origin`). Aucune écriture en GET.
- Un bouton masqué n'est pas un contrôle d'accès : le contrôle est dans la route.
- Une nouvelle route d'écriture ou d'export a une **limite de débit** (`src/limits.js`).

## Secrets
- **Jamais** de secret dans le code, les tests, la documentation, les journaux, les messages d'erreur, les URL, les commits ou les réponses (clé d'IA, mot de passe, jeton, `SECRET_KEY`, clé privée, webhook).
- En base : chiffré (`encrypt`) ou en empreinte SHA-256 ; **jamais réaffiché** après saisie. Affiché une seule fois à la création si nécessaire (jeton d'API).
- Une fausse valeur de test est assemblée à l'exécution ou porte un marqueur évident (`AbCdEf`, `hunter2`, `exemple`) : `scripts/secret-scan.js` doit rester vert.
- Un secret exposé est **révoqué et remplacé** (`docs/security/INCIDENT_RESPONSE.md`). Le supprimer du code ne suffit pas.
- `.env` n'est jamais commité ; `.env.example` ne contient aucune valeur confidentielle.

## Journaux
- Jamais de mot de passe, de jeton, de code A2F, de secret, de contenu de mail ni d'adresse e-mail dans un journal. Pour la sécurité : `securityLog()` (`src/securitylog.js`) : événement + numéro de compte + IP tronquée.
- Les erreurs renvoyées au client ne contiennent aucun détail technique (`HttpError` avec `expose` seulement pour un message destiné à l'utilisateur).

## Tests (obligatoires)
- Toute fonctionnalité **sensible** (authentification, session, droits, paiement, export, suppression, jeton, fichier, appel sortant, IA) arrive avec ses tests de sécurité : refus sans compte, refus pour un autre compte, entrée malveillante, absence de fuite de secret. Montre qu'un test échoue sans le correctif quand tu corriges une vulnérabilité.
- Ne désactive, ne saute ni n'assouplis jamais un test de sécurité pour obtenir du vert.
- Avant de terminer : `npm run lint`, `npm test`, `npm run security` ; pour l'interface `npm run ui:check`.
