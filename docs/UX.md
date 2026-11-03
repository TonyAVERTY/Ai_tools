# Conventions UX : comportements communs

Ce document est la référence des **comportements** (ce que fait l'interface quand on agit, attend ou se trompe). Les couleurs, rayons,
typographies et composants visuels sont dans `docs/DESIGN.md` ; ici, ce qui doit se comporter pareil partout. Principe : **une action
équivalente = une expérience équivalente**, sans uniformiser ce qui est différent (une suppression irréversible n'est pas une simple navigation).

Réutilise ce qui existe ; n'ajoute pas un second mécanisme pour le même besoin.

## Notifications d'une action : `toast(message, kind)`

- `window.AiTools.toast(msg, 'ok' | 'error')` (défini dans `public/app.js`, utilisé par tous les `app-*.js` et par `ajax.js`).
- Un succès disparaît après 4,2 s, une erreur après 8 s ; chaque notification a une croix de fermeture.
- Elles s'empilent dans `.toasts` (trois au plus, la plus ancienne part) ; le même message ne s'empile pas, sa durée repart.
- Annoncées aux lecteurs d'écran : `role="alert"` pour une erreur, `role="status"` sinon.
- Elles survivent à une navigation sans rechargement (`ajax.js` remet le conteneur).
- À utiliser pour **le résultat d'une action sur la page où l'on est**. Pour un résultat affiché après un rechargement ou une redirection, ou un
  état qui doit rester lisible, voir les bandeaux (`.msg msg-ok / msg-err`).

## Bandeaux de résultat : `banner(kind, texte)` (`src/banner.js`)

- Pour ce qui s'affiche dans la page après un rechargement ou une redirection (« Réglages enregistrés », erreur d'un formulaire, avertissement) :
  `banner('ok' | 'err' | 'warn', texte)`. Une seule apparence (`.msg msg-ok | msg-err | msg-warn`), une icône avec le texte, `role="alert"` pour une
  erreur et `role="status"` sinon. Le texte est échappé. **N'écris pas un bandeau à la main** : `test/banner.test.js` échoue.
- Une erreur est un bandeau `err` (jamais `warn` : un avertissement dit « attention », une erreur dit « ça n'a pas marché »).
- Seule exception : un conteneur que le navigateur remplit (caché au départ, ex. `data-claude-error`) garde son balisage `class="msg msg-err" … hidden`.
- Phrase complète avec point final dans un bandeau (« Ta situation est enregistrée. ») ; court et sans point dans un toast (« Prospect ajouté »).
- Les bulles du chat s'appellent `.chat-msg` : `.msg` est réservé au bandeau.
- Hors périmètre : `public/site.css` a sa propre classe `.msg` pour le site public (connexion).

## Erreurs

Une erreur dit **ce qui s'est passé** et **quoi faire** ; jamais « Failed to fetch », un code brut ni une trace.
- `api()` (`public/app.js`) renvoie le message du serveur quand il y en a un. Sinon : réseau coupé → « Connexion impossible : réessaie dans un instant. » ;
  500 → « Erreur interne : réessaie dans un instant. » ; 403 → « Tu n'as pas accès à cette action. » ; 404 → « Introuvable : recharge la page. » ;
  429 → « Trop de demandes : attends un instant puis réessaie. ». `window.AiTools.httpErrorText(status)` et `networkErrorText()` donnent ces textes.
- Session expirée (401) : retour à `/login?e=…` avec « Ta session a expiré : reconnecte-toi. » (pas de redirection muette).
- Ne jamais présenter une action comme réussie quand elle a échoué : on affiche le succès **après** la réponse.

## Rédaction

- Succès : **« Nom + participe passé »** (« Prospect ajouté », « SMTP enregistré », « Note supprimée »). Pas de « ! », pas de « avec succès ».
- Erreur : une phrase qui commence par ce qui n'a pas marché, suivie de la suite à donner après « : » (« Connexion impossible : réessaie dans un instant. »).
- On tutoie ; on garde les termes métier de l'application.

## Ce qui reste à harmoniser (lots suivants)

Indicateur dans le bouton occupé, squelettes de chargement, « Réessayer » sur les erreurs de chargement,
boîte de confirmation commune à la place des `confirm()` natifs, convention rédactionnelle complète.

## Tests

`scripts/notifications-check.mjs` et `scripts/banners-check.mjs` (Chromium, 1280 et 390 px, clair et sombre pour les bandeaux) couvrent ce qui précède ; lance-les avec `npm run ui:check -- notifications` ou `-- banners`.
