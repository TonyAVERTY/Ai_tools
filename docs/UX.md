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

## Attente et actions en cours

- **Une action lancée par un bouton** : le bouton devient *occupé*. `api()` (`public/app.js`) pose `aria-busy="true"` sur le bouton cliqué ; le CSS
  (`.btn[aria-busy="true"]::before`) affiche un anneau devant le libellé, sans changer le texte ni la largeur de la page. Le bouton est bloqué (un double
  envoi est impossible) et libéré à la fin, **y compris sur échec**. Rien à écrire par bouton.
- Un bouton que ton code désactive avant l'appel (`b.disabled = true; await api(...)`) est marqué occupé quand même ; `api()` ne le réactive pas : c'est à toi.
- N'embarque jamais un spinner caché dans un bouton pour l'afficher à la main.
- **Un contenu qui se charge** : l'anneau commun, `.spinner` (grand, seul) ou `.spin-inline` (petit, devant un texte). Il n'y a qu'un seul anneau
  (plus d'arc SVG ni de `.spin`).
- Mouvement réduit : l'anneau reste visible, immobile.
- Une opération longue (job) montre sa progression dans une barre (`.bar`), pas un anneau.

## Confirmer une action sensible : `confirmBox(message, { confirm, danger })`

- Une seule boîte, celle de l'application (`window.AiTools.confirmBox`, `public/app.js`). **Jamais `window.confirm`** : `test/confirm.test.js` échoue.
- Le message s'écrit « **Question ?** Conséquence. » : la question devient le titre de la boîte, la suite le détail (`confirmBox('Supprimer cette note ?')`,
  `confirmBox('Supprimer cette vidéo ?\nLe fichier sera effacé.')`).
- Le bouton porte **le verbe de l'action** (« Supprimer », « Publier », « Envoyer »…) et jamais « OK » ; « Annuler » est l'autre choix. Rouge (`danger-fill`)
  quand on supprime, efface, retire ou déconnecte ; dans ce cas « Annuler » a le focus par défaut. Échap ou un clic à côté annule.
- JS : `if (!(await confirmBox('…', { confirm: 'Publier' }))) return;`. Formulaire rendu par le serveur : `data-confirm="Question ? Conséquence."`, avec
  `data-confirm-label="Verbe"` quand le verbe de la question ne suffit pas (« Passer en client »). Un formulaire `data-action` n'est confirmé qu'une fois.
- Ne demande pas de confirmation pour une action réversible ou sans conséquence (remettre le pied de page des mails n'en demande pas).

## Ce qui reste à harmoniser (lots suivants)

Squelettes de chargement, « Réessayer » sur les erreurs de chargement,
convention rédactionnelle complète.

## Tests

`scripts/notifications-check.mjs`, `scripts/banners-check.mjs` et `scripts/busy-check.mjs` et `scripts/confirm-check.mjs` (Chromium, 1280 et 390 px, clair et sombre pour les bandeaux) couvrent ce qui précède ; lance-les avec `npm run ui:check -- notifications`, `-- banners`, `-- busy` ou `-- confirm`.
