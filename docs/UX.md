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

## Formulaires : une erreur ne vide jamais ce qui a été saisi

Un formulaire que le serveur refuse **garde ses champs, reste à l'écran et le bouton se réactive** ; l'erreur s'affiche en notification (`public/ajax.js`).
- Une route qui refuse une saisie répond **4xx** avec un message (`HttpError(400, '…', { expose: true })`) ou **redirige vers la même page avec `?e=message`** : `ajax.js` traite les deux
  pareil (il ne remplace pas la page, l'adresse ne reçoit pas de « ?e= »). Une redirection vers une **autre** page, ou sans `e`, reste une navigation normale (succès : `?ok=…`).
- Un formulaire écrit en JS (`api()`) ne vide ses champs **qu'après** la réponse ; le chat remet le texte et les pièces jointes si l'envoi échoue.
- Sans JavaScript (ou formulaire `data-noajax` / avec fichier), la page est rechargée avec le bandeau d'erreur : les champs sont alors perdus. Ne pas en dépendre.
- `scripts/forms-keep-check.mjs` le vérifie dans Chromium (Clients, Calendrier, 1280 et 390 px).

## Rédaction

Tout ce que l'application écrit à l'utilisateur suit ces règles. `test/wording.test.js` vérifie celles qui se mesurent (marquées ✔) ; le reste se relit à la main.

**Registre**
- ✔ **On tutoie** l'utilisateur (« tes prospects », « ton projet »). Seuls les mails écrits **pour** un prospect ou un client (prospection, relance, devis) vouvoient. Un exemple de mail montré dans l'interface vouvoie aussi, objet compris.
- On garde les termes métier de l'application (« Cible », « Mise en route », « Prospects »), partout les mêmes.

**Messages**
- ✔ **Succès** : « Nom + participe passé » (« Prospect ajouté », « SMTP enregistré », « Note supprimée »). **Sans point final**, sans « ! », sans « avec succès ».
- ✔ **Erreur** : une phrase qui dit ce qui n'a pas marché, puis la suite à donner après « : » (« Connexion impossible : réessaie dans un instant. »). Elle **finit par un point** : `api()` (le message de l'erreur qu'il lance, donc tout ce qui affiche `err.message` :
  notification, bloc « Réessayer », formulaire, chat), `toast(…, 'error')` et `banner('err', …)` l'ajoutent si le message n'en a pas (`window.AiTools.sentence(msg)`),
  inutile de réécrire les messages du serveur. Un message affiché sans passer par l'un d'eux (un `fetch` direct) appelle `sentence()` lui-même. Pas de « ! », jamais de code ni de trace.
- **Avertissement** (`warn`) : « attention », pas « ça n'a pas marché » (voir « Bandeaux de résultat »).
- Une consigne dit quoi faire (« Choisis une voix »), pas ce qui manque (« Aucune voix choisie »).

**Boutons et liens**
- Un **verbe à l'infinitif** + l'objet quand il faut le préciser (« Ajouter un client », « Enregistrer », « Envoyer un test »). Une majuscule initiale, pas de point, pas de « ! ».
- **Enregistrer** (jamais « Sauvegarder »), **Modifier** (jamais « Éditer »), **Envoyer** pour un mail. Une tâche porte le verbe de ce qu'elle fait (« Analyser le projet », « Générer la vidéo », « Lancer la recherche »).
- **Ajouter** un élément dans une liste qui existe (une ligne, une note, un prospect, un événement) ; **Créer** quelque chose qui n'existait pas comme objet à part (un compte, une équipe, un jeton).
- **Annuler** abandonne ce qu'on était en train de faire sans rien changer ; **Fermer** ferme une information ou une fenêtre sans enjeu.
- **Supprimer** détruit une donnée pour de bon ; **Retirer** enlève un élément d'une liste ou coupe un lien sans détruire ce à quoi il renvoie (« Retirer ce client de la liste » : ses documents restent) ;
  **Effacer** vide un champ ou remet à zéro ; **Déconnecter** coupe la liaison avec un service externe. Ces verbes déclenchent la confirmation « danger » (voir « Confirmer une action sensible »).

**Typographie**
- ✔ Pas de « avec succès » ni de « ! » dans un message. À relire à la main : « … » (un seul caractère) plutôt que trois points ; « guillemets français » pour citer un libellé de l'écran ; « 1 Mo », « 64 % » avec une espace.

## Attente et actions en cours

- **Une action lancée par un bouton** : le bouton devient *occupé*. `api()` (`public/app.js`) pose `aria-busy="true"` sur le bouton cliqué ; le CSS
  (`.btn[aria-busy="true"]::before`) affiche un anneau devant le libellé, sans changer le texte ni la largeur de la page. Le bouton est bloqué (un double
  envoi est impossible) et libéré à la fin, **y compris sur échec**. Rien à écrire par bouton.
- Un bouton que ton code désactive avant l'appel (`b.disabled = true; await api(...)`) est marqué occupé quand même ; `api()` ne le réactive pas : c'est à toi.
- N'embarque jamais un spinner caché dans un bouton pour l'afficher à la main.
- **Un contenu qui se charge** : toujours **l'anneau commun devant « Chargement… »**, jamais du texte seul et pas de squelette (choix fait avec le propriétaire du produit). Côté serveur :
  `loadingBlock()` (`src/loading.js`) pour un bloc de page, `loadingBlock('Chargement…', { small: true })` pour une liste ou une ligne ; côté navigateur : `window.AiTools.loadingHtml(texte, { small })`.
  Même balisage : `<span class="loading" role="status">` avec `.spinner` (grand) ou `.spin-inline` (petit). `test/loading.test.js` échoue si un « Chargement… » s'écrit sans son anneau.
  Il n'y a qu'un seul anneau dans l'application (plus d'arc SVG ni de `.spin`).
- **Un contenu qui n'a pas pu se charger** : jamais un cercle qui tourne pour toujours, jamais « Recharge la page » seul. Côté navigateur : `window.AiTools.loadFailed(zone, message, réessayer, { small })`
  (`public/app.js`) met un bloc `.load-error` (`role="alert"`) avec le message déjà traduit (`err.message` d'`api()`, ou `httpErrorText(status)` / `networkErrorText()` pour un `fetch` direct)
  et un bouton **Réessayer** qui remet l'anneau puis rappelle `réessayer`. Un `fetch` direct teste `r.ok` (sinon une erreur du serveur passe pour une liste vide) et renvoie à la connexion sur 401.
  `scripts/retry-check.mjs` le vérifie dans Chromium pour chaque zone (mise en route, LinkedIn, Promotion, Récap, clients, chat).
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

## Animations

**Aucune animation n'est ajoutée, changée ni retirée sans l'accord du propriétaire du produit**, présentée une par une : l'élément, le comportement actuel, la proposition, la valeur pour l'utilisateur, le coût.
- **En boucle (`infinite`) : seulement `transform` et `opacity`.** Jamais `left`, `width`, `height` ni `box-shadow` : le navigateur referait la mise en page ou repeindrait à chaque image, pendant toute la durée d'une tâche
  (mesuré : 181 mises en page en 3 s avec `left` / `width`, aucune avec `transform`). Un halo se fait avec un pseudo-élément dont seule l'opacité varie (`.pulse::after`). `test/motion.test.js` échoue sinon.
- Courtes (quelques centaines de ms), sans nouvelle dépendance. Le mouvement réduit coupe **toutes** les animations et transitions CSS (règle globale de `tokens.css`) ; une animation écrite en JS (`element.animate`) teste `matchMedia('(prefers-reduced-motion: reduce)')` elle-même.
- Un gain de performance s'annonce mesuré : avant et après, sur plusieurs passes (bureau et téléphone ralenti). Un essai qui n'apporte rien est abandonné, pas gardé « au cas où » (changement de page : lancer l'animation
  après la relance des scripts n'a pas réduit les saccades et retardait le contenu de 40 à 140 ms).
- `scripts/motion-check.mjs` vérifie dans Chromium que ces animations bougent et ne déclenchent aucune mise en page.
- **Retours d'action** (une fois, jamais en boucle ; tous dans le bloc « sans mouvement réduit » de `app.css`, donc absents quand l'utilisateur demande moins de mouvement) :
  - un bouton `.btn` s'enfonce au clic (`:active`, échelle .97 en 80 ms) ;
  - le contenu qui arrive à la place du cercle de chargement ou du bloc « Réessayer » apparaît en fondu de 150 ms (`.reveal`, opacité seule). C'est un observateur par zone (`LOAD_ZONES` dans `app.js`) : pour une nouvelle zone qui se charge
    après coup, ajoute son sélecteur à cette liste. Un cercle remplacé par un autre cercle, ou une mise à jour ultérieure de la zone, ne fait pas de fondu ;
  - la coche d'une étape de « Mise en route » qui vient d'être faite, et le badge « config ✓ » quand tout l'est, apparaissent d'un petit saut (`wiz-pop`) : jamais au premier affichage, seulement pour ce qui vient de changer ;
  - la ligne qu'on vient d'ajouter (prospect en vue liste, événement du calendrier, note d'une fiche prospect) est surlignée 1,5 s (`.row-new`, le style des nouvelles tâches du menu « Activité »). Côté serveur, la redirection porte le numéro
    (`?nouveau=ID` pour un événement ; `?ok=note` pour une note, la plus récente est surlignée) ; un numéro qui n'est pas dans la liste du compte ne surligne rien.
  - `scripts/feedback-check.mjs` vérifie tout cela dans Chromium, en mouvement normal et réduit ; `test/feedback.test.js` vérifie le surlignage côté serveur.
- Non retenu : un liseré qui se vide sur la notification pour montrer le temps restant (proposé, pas validé : du bruit visuel de plus).

## Tests

`scripts/notifications-check.mjs`, `scripts/banners-check.mjs` et `scripts/busy-check.mjs`, `scripts/confirm-check.mjs` et `scripts/loading-check.mjs` (Chromium, 1280 et 390 px, clair et sombre pour les bandeaux) couvrent ce qui précède ; lance-les avec `npm run ui:check -- notifications`, `-- banners`, `-- busy`, `-- confirm` ou `-- loading`.
