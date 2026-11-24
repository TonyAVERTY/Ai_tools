# Audit des licences et de la propriété intellectuelle

Date : 24 novembre 2026. Outils : `npm run security:licenses` (contrôle automatique à chaque PR, `scripts/license-check.js`), `npm run sbom` (inventaire CycloneDX, `sbom.cdx.json`, produit par la CI et conservé 30 jours).

## 1. Dépendances de production (49 paquets, directs et transitifs)

| Licence | Nombre | Exemples | Usage commercial fermé |
|---|---|---|---|
| MIT | 43 | `imapflow`, `mysql2`, `pg`, `iconv-lite` | Autorisé (attribution : conserver la notice) |
| ISC | 2 | `pg-int8`, `split2` | Autorisé |
| Apache-2.0 | 1 | `long` | Autorisé (conserver la notice et la licence) |
| MIT-0 | 1 | `nodemailer` | Autorisé, sans attribution |
| MIT **ou** EUPL-1.1+ | 1 | `@zone-eu/mailsplit` | Double licence : **on choisit MIT**, autorisé |

Aucune GPL, AGPL, LGPL, SSPL ni licence inconnue. **Dépendances directes** : `imapflow`, `mysql2`, `nodemailer`, `pg` (quatre seulement ; tout le reste de l'application est du code maison, sans framework). Pas de dépendance de développement dans le paquet de production : l'image de déploiement s'installe avec `npm ci --omit=dev`.

À chaque ajout de dépendance : relire sa licence, sa maintenance (dernier commit, mainteneurs), sa taille transitive ; le contrôle en CI échoue sur toute licence non autorisée (liste dans `scripts/license-check.js`).

## 2. Polices, icônes, images

| Élément | Source dans le dépôt | Licence | Statut |
|---|---|---|---|
| Police **Fraunces** | `public/fonts/fraunces.woff2` + `LICENSE-fraunces.txt` | SIL Open Font License 1.1 (vérifié dans le fichier de licence) : usage commercial et embarquement autorisés, la police ne se revend pas seule | ✅ licence jointe |
| Police **Instrument Sans** | `public/fonts/instrument-sans.woff2` + `LICENSE-instrument-sans.txt` | SIL Open Font License 1.1 (vérifié dans le fichier de licence) | ✅ licence jointe |
| Icônes | `src/icons.js` (sprite SVG intégré) | Dessinées pour le projet ? **Origine non documentée** | 🟡 `[À COMPLÉTER : origine et licence des icônes]` |
| Logos et visuels (`public/img/*`) | `logo*.png`, `banner.jpg`, `icon.jpg`, `linkedin_banner.jpg`… | Création de l'éditeur ? **Origine non documentée** | 🟡 `[À COMPLÉTER : auteur et droits des visuels]` |
| Captures d'écran (`capture-mails-*.png`) | Montrent l'application elle-même | Propriété de l'éditeur | ✅ |

## 3. Marques et contenus de tiers

- « Claude », « Anthropic », « ChatGPT », « OpenAI », « Gemini », « Google », « Apple », « Stripe », « Discord », « LinkedIn », « Instagram » : marques de leurs propriétaires, citées pour désigner les services compatibles (mention dans les mentions légales). Ne pas utiliser leurs logos sans vérifier leurs chartes.
- **Contenus générés par IA** (textes, images, vidéos, voix) : les conditions des fournisseurs d'IA et des services de voix s'appliquent à l'utilisateur ; les CGU doivent dire qui détient les droits sur ces sorties. 🟡 À faire valider par un juriste.
- **Code des projets de l'utilisateur** : lu en lecture seule par l'IA, jamais publié ni partagé entre comptes.

## 4. Licence du code d'iaboss lui-même

`package.json` ne déclare aucune licence (`license` absent) : le code est **propriétaire par défaut**. 🟡 `[À COMPLÉTER : mention « Tous droits réservés » ou licence choisie]` avant tout partage du dépôt. Si le dépôt devient privé (décision en cours), aucune action de licence n'est urgente.
