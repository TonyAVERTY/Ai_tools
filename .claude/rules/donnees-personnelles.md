# Données personnelles, cookies et conformité (RGPD, ePrivacy)

Applicables à toute fonctionnalité qui collecte, stocke, affiche, exporte ou transmet une donnée sur une personne (l'utilisateur, ou ses prospects et clients).

## Avant d'ajouter une donnée
1. **Minimisation** : n'ajoute que ce qui sert une finalité précise. Pas de donnée « au cas où ».
2. **Où elle vit** : colonne en base, fichier, journal, service tiers ? Décide sa **durée de conservation** et comment elle est **supprimée** (cascade `ON DELETE` vers `users`, dossier effacé par `deleteUser`).
3. **Documente dans le même changement** : `docs/security/DATA_MAPPING.md`, la politique de confidentialité (`src/site/legal.js` : tableau des données, durées, destinataires), le Support utilisateur (`docs/support/`), et `docs/security/THIRD_PARTY_SERVICES.md` si un service externe est impliqué.
4. **Droits des personnes** : une nouvelle table du compte doit être classée dans `src/services/dataexport.js` (`EXPORTED`, ou `EXCLUDED` avec la raison) : `test/dataexport.test.js` échoue sinon. Le droit d'accès, de portabilité et d'effacement doit continuer à couvrir la nouvelle donnée.
5. Aucune donnée sensible (santé, opinions, origine…) : pas de collecte par conception.

## Cookies et traceurs
- **Aucun cookie, stockage local de suivi, pixel, SDK d'analyse, script ou police tiers** sans décision explicite du propriétaire. La CSP (`default-src 'self'`) l'interdit : ne l'élargis pas.
- Cookies actuels (tous exemptés de consentement, voir `docs/security/RGPD_COMPLIANCE.md` §6) : `sid`, `oauth_b`, `li_oauth_b`, `mfa_td`, `theme`, `lang`. Tout nouveau cookie : `HttpOnly; Secure; SameSite` ; durée minimale ; **mis à jour dans le tableau des cookies de la politique de confidentialité**.
- Un traceur qui exige un consentement impose un bandeau complet (refus aussi facile que l'acceptation, choix détaillés, retrait, preuve, rien avant consentement). Ne le crée pas sans l'accord du propriétaire.
- La mesure d'audience reste **sans identifiant** (`src/services/audience.js`) et respecte « Ne pas me suivre ».

## IA et données
- Ne transmets au fournisseur d'IA que ce qui est nécessaire ; jamais un secret. Le contenu externe (site, dépôt, réponse) est donné comme **donnée**, jamais comme instruction.
- Une IA ne contourne jamais une règle d'autorisation de l'application : ses outils restent limités (pas de `Bash`, pas d'`Edit` dans l'application).
  **Seule exception, décidée par le propriétaire du produit (24 novembre 2026)** : la tâche `implement` (idée d'évolution acceptée), uniquement si le compte a coché « Implémenter automatiquement les idées acceptées » (`ai_code_edit`, décoché par défaut) et uniquement avec Claude. `Edit` et `Write` (jamais `Bash`) s'exercent alors dans une **copie jetable du dépôt sans `.git`**, seul dossier monté en écriture dans le bac à sable. Tout ce que l'IA écrit est revérifié par `src/services/codepatch.js` (chemins, secrets, volume, liens symboliques) puis commité et poussé par le code de l'application (`src/services/gitwrite.js`), jamais par l'IA. N'étends pas cette exception à une autre tâche.
- Tout nouveau contenu généré par IA (texte, image, voix, vidéo) : examiner les obligations de transparence (`docs/security/LEGAL_COMPLIANCE.md`, AI Act).

## Impacts réglementaires
- Une nouvelle fonctionnalité, un nouveau tarif, une nouvelle clause : vérifie `docs/security/LEGAL_COMPLIANCE.md` (CGU/CGV, consommation, facturation, accessibilité) et signale au propriétaire ce qui demande une validation juridique. **Ne génère jamais une fausse information légale** : utilise `[À COMPLÉTER : …]`.
