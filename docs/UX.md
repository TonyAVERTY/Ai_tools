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

Bandeaux de résultat (`.msg` redéfini pour le chat), indicateur dans le bouton occupé, squelettes de chargement, « Réessayer » sur les erreurs de chargement,
boîte de confirmation commune à la place des `confirm()` natifs, convention rédactionnelle complète.

## Tests

`scripts/notifications-check.mjs` (Chromium, 1280 et 390 px) couvre ce qui précède ; lance-le avec `npm run ui:check -- notifications`.
