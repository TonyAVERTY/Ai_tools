# Direction artistique et design system d'AiTools

Ce document est la référence du design : il explique le parti pris, puis liste les jetons et les composants. Les valeurs vivent dans
`public/tokens.css` (couleurs, rayons, ombres, durées, typographie) ; `public/site.css` (site public) et `public/app.css` (application)
ne redéfinissent rien. Les règles de travail du dépôt restent celles de `CLAUDE.md` (CSP stricte : ni style ni script en ligne, aucune
ressource externe).

## 1. Le sujet, et ce qu'on en tire

AiTools prépare des lettres commerciales (des mails de prospection personnalisés) et laisse la personne les relire avant de les envoyer
depuis sa propre boîte. Le public : des indépendants et de petites équipes, souvent proches du code (dépôt Git, API), qui n'ont pas de
service commercial. Le ton de la marque : franc, concret, on se tutoie, on dit ce que l'outil ne sait pas faire.

Le vocabulaire visuel vient donc de la **correspondance** : une feuille posée sur un bureau, un texte composé comme du courrier, une
annotation en marge, un fil de conversation. Pas de décor « technologique » (réseau de points, rubans lumineux, bulles).

> Le concept en une phrase : **un bureau bleu-gris sur lequel on pose des feuilles blanches bien composées ; la couleur n'apparaît que
> là où il y a une action, un état, ou le fil de la conversation.**

L'identité existante est conservée : l'indigo du logo (`#1e296a`) et le bleu-cyan du ruban (`#1288b7` → `#0db8c5`). Ce qui change,
c'est leur emploi : l'indigo porte l'action principale, le bleu sert aux liens et au focus, le dégradé n'existe plus que dans le
logo, le fil de la page d'accueil et les barres de progression.

## 2. Ce qu'on évite, et pourquoi (relu contre le plan)

Le plan initial a été confronté à la liste des réflexes génériques ; ce qui suit est ce qui a été **retiré ou changé** :

| Réflexe générique | Ce qui existait | Ce qu'on fait |
|---|---|---|
| Fond animé de particules | réseau de points qui suit le curseur derrière toute l'application | supprimé : le fond est une surface unie |
| Ruban lumineux traversant le texte, bulles « de bière », parallaxe | ruban de page sur tout le site, bulles et parallaxe sur la documentation | supprimés ; le ruban du logo devient un **fil** utile, seulement dans « Comment ça marche » |
| Cartes arrondies identiques partout | quatre cartes avec icône dans une pastille, répétées sur chaque page | du texte composé (liste de définitions, chronologie, colonnes) ; un panneau n'est utilisé que pour une donnée (offre, prospect) |
| Icône dans une pastille teintée | chaque section du projet, chaque bénéfice | retirées ; une icône ne reste que lorsqu'elle remplace un mot (menu, état) |
| Bouton en dégradé cyan | tous les boutons principaux | bouton plein indigo |
| Ombres douces partout, survol qui soulève | `translateY` + ombre sur cartes, boutons, onglets | bordures fines ; aucun soulèvement ; ombre réservée aux fenêtres flottantes |
| Une seule entrée « fade-up » par bloc | `rise` sur chaque carte, chaque section, chaque apparition au défilement | supprimé ; un seul moment orchestré (l'accroche du mail d'exemple se souligne à l'arrivée) |
| Étiquettes en capitales espacées | en-têtes de tableaux, pied de page, tags | casse normale, graisse 600 |
| Titres en `system-ui` | la pile système : chaque visiteur voit une police différente | deux familles embarquées (voir §4) |
| Maquette générique d'interface | carte « Atelier Exemple » avec barre de progression | une **lettre d'exemple** (le produit réel : mail préparé, accroche tirée du site du prospect, relecture avant envoi), signalée comme exemple |

Ce qui est gardé volontairement : le dégradé du logo, les pastilles d'état (un état est une information), la numérotation dans
« Comment ça marche » (c'est une vraie séquence), les mouvements qui répondent à une action (ouverture d'un menu, notification, transition
de page).

## 3. Couleurs

Une seule palette, deux thèmes (clair par défaut, sombre selon le système). Toutes les valeurs sont dans `tokens.css`.

| Rôle | Jeton | Clair | Usage |
|---|---|---|---|
| Bureau | `--bg` | `#f1f3f9` | fond des pages |
| Creux | `--bg-sunk` | `#e6eaf4` | zones en retrait, champs désactivés, bandeau d'état |
| Feuille | `--card` | `#ffffff` | panneaux, champs, fenêtres |
| Encre | `--text` | `#0e1535` | texte |
| Marge | `--muted` | `#4a5782` | texte secondaire, annotations |
| Indigo | `--indigo`, `--primary` | `#1e296a` | action principale, onglet actif, bloc inversé |
| Bleu | `--accent`, `--link` | `#1288b7`, `#0b6f96` | liens, focus, sélection |
| Cyan | `--accent-2` | `#0db8c5` | seulement le fil et la fin du dégradé |
| Filets | `--line`, `--line-strong`, `--control` | `#d5dbeb`, `#b4bed8`, `#6f7ea5` | bordures, séparateurs, contour des champs |
| États | `--ok` `--warn` `--err` `--info` (+ `-bg`) | vert, ambre, rouge, bleu | toujours avec un mot ou une icône, jamais la couleur seule |

Contrastes : chaque couple texte/fond est vérifié à 4,5:1 (clair et sombre) par `test/site.test.js` ; le contour des champs vise 3:1.

## 4. Typographie

Deux familles, libres (SIL OFL), **servies par l'application** (`public/fonts/`, `font-display: swap`, sous-ensemble latin) :

- **Source Serif 4** (variable, graisses 200 à 900) : titres, chiffres de prix, noms de page. Un serif d'édition à fort dessin, qui donne
  au site son ton de courrier posé, loin des grotesques par défaut.
- **Hanken Grotesk** (variable, 100 à 900) : interface et texte courant. Humaniste, très lisible en petits corps et avec les accents
  français.
- Données techniques (adresses, URL, code) : `ui-monospace` du système, aucun fichier de plus.

Échelle (rem ; les titres du site sont fluides) :

| Niveau | Taille | Police | Remarque |
|---|---|---|---|
| Titre de page (site) | `clamp(2.5rem, 5.2vw, 3.9rem)` | Source Serif 4, 600 | interligne 1,05, approche -0,02em |
| Titre de section | `clamp(1.75rem, 3vw, 2.375rem)` | Source Serif 4, 600 | interligne 1,15 |
| Titre de panneau | 1,25 | Source Serif 4, 600 | |
| Texte courant | 1 (1,0625 en lecture longue) | Hanken Grotesk, 400 | interligne 1,6, ligne de 66 caractères au plus |
| Interface | 0,9375 | Hanken Grotesk, 500/600 | boutons, champs, onglets |
| Annotation | 0,8125 à 0,875 | Hanken Grotesk, 400/500 | casse normale, jamais en capitales |

Règles : pas de mot isolé mis en couleur ou en italique dans un titre ; pas de capitales espacées ; chiffres tabulaires pour les prix
et les compteurs ; texte aligné à gauche partout (aucun bloc marketing centré).

## 5. Composition

- **Grille** : conteneur de 1120 px au plus, 12 colonnes sur bureau. Le site utilise des compositions asymétriques (7/5, 4/8) plutôt
  que des rangées de quatre cartes.
- **Rythme vertical** : 96 px entre sections sur bureau, 64 px sur tablette, 48 px sur téléphone ; le texte courant respire à l'intérieur
  d'une section (16 à 24 px entre paragraphes).
- **Alternance de densité** : une section sur trois change de fond (bureau, feuille, bloc indigo) ; un seul bloc inversé par page.
- **Rayons** : 6 px (champs, boutons), 10 px (panneaux), 999 px uniquement pour une pastille d'état, un avatar et les nœuds du fil. Un panneau n'a pas le même rayon
  qu'un bouton.
- **Ombres** : aucune sur les panneaux (la bordure suffit) ; une ombre portée uniquement sous les fenêtres flottantes (menus, dialogues,
  notifications).
- **Une seule chose mémorable par page** : la lettre d'exemple en haut de l'accueil, le fil dans « Comment ça marche », la grille des
  offres dans les tarifs. Tout le reste reste calme.

## 6. Composants

| Composant | Règle |
|---|---|
| Bouton principal | plein indigo, texte blanc, 44 px de haut ; survol : indigo plus clair ; pas de soulèvement, pas de flèche décorative |
| Bouton secondaire | fond feuille, bordure, texte encre ; survol : bordure indigo |
| Lien | bleu soulignement décalé de 3 px ; survol : soulignement épaissi |
| Champ | fond feuille, bordure `--control`, 44 px de haut, focus : anneau bleu de 2 px décalé |
| Pastille d'état | un mot, couleur de l'état en fond clair ; avec l'avatar et les nœuds du fil, seul élément arrondi à 999 px |
| Panneau | feuille blanche, bordure fine, rayon 10 px, titre en Source Serif 4 |
| Liste de sections (projet) | lignes séparées par un filet : titre, sous-titre en marge, chevron ; coche verte quand tout est fait ; pas d'icône |
| Onglets de navigation | texte, soulignement indigo de 2 px pour la page courante ; même principe sur le site et dans l'application |
| Tableau | en-têtes en casse normale, graisse 600, filets horizontaux seulement |
| Fenêtres et menus | seuls éléments avec ombre ; apparition courte (120 ms) |
| États vides | une phrase qui dit quoi faire, un bouton ; pas d'illustration ni de pastille d'icône |
| Notifications | bande verte ou rouge à gauche, verbe d'action identique au bouton qui l'a déclenchée |

## 7. Mouvement

Principe : le mouvement répond à une action ou signale un changement ; il n'est jamais décoratif.

- Transition de page : le contenu arrive par la droite (ou la gauche) selon le sens dans la barre du haut, 380 ms (`public/ajax.js`).
- Menus, dialogues, notifications : 120 à 200 ms.
- Survol : changement de couleur ou de bordure, 120 ms. Aucun soulèvement.
- Un seul moment orchestré : sur l'accueil, l'accroche de la lettre d'exemple se souligne une fois, 500 ms après l'arrivée.
- `prefers-reduced-motion: reduce` coupe tout (règle globale dans `tokens.css`).

## 8. Responsive

Trois paliers : téléphone (< 640 px), tablette (640 à 899 px), bureau (≥ 900 px).
- Téléphone : une colonne ; la lettre d'exemple passe sous le titre, pleine largeur ; la chronologie garde son fil à gauche ; les
  grilles d'offres deviennent des lignes ; la navigation défile horizontalement ; cibles tactiles de 44 px.
- Tablette : deux colonnes lorsque le contenu s'y prête ; la lettre reste sous le titre jusqu'à 900 px.
- Bureau : compositions asymétriques, lettre à droite du titre, sommaire collant dans la documentation.

## 9. Ton des textes

Phrases courtes, verbes d'action, vocabulaire du métier de la personne (client, mail, relance). On ne vend pas : on dit ce qui se passe.
Jamais de chiffre, de témoignage ni de référence inventés : les exemples sont signalés comme tels. Une erreur dit ce qui s'est passé et
quoi faire, sans s'excuser. Un bouton a le même nom que la notification qu'il déclenche (« Enregistrer » → « Enregistré »).

## 10. Vérifier

- `npm run lint && npm test` ; `test/site.test.js` contrôle les contrastes, l'absence de couleur en dur dans `site.css`, les liens.
- `scripts/design-shots.mjs` photographie toutes les pages à trois tailles (avant/après) ; `scripts/responsive-audit.mjs` cherche les
  débordements ; les scripts `scripts/*-check.mjs` rejouent les parcours dans Chromium.

## 11. Audit anti-« générique » (relu à la fin de la refonte)

Dix questions posées aux pages réelles, avec ce qui a été corrigé :

1. *Un fond décoratif ?* Non : surface unie (le canvas de particules, le ruban plein page et les bulles ont été retirés).
2. *Des dégradés partout ?* Non : un trait de logo (le fil) et les barres de progression.
3. *Des cartes identiques répétées ?* Non sur le site (liste typographique, fil, colonnes) ; les panneaux de l'application portent une donnée.
4. *Des ombres et des survols qui soulèvent ?* Non : aucun `translateY` au survol ; ombre seulement sous les fenêtres flottantes.
5. *Des icônes dans des pastilles ?* Non : retirées des sections, des états vides et des titres de page.
6. *Des capitales espacées ?* Non : plus aucun `text-transform: uppercase`.
7. *Un titre marketing interchangeable ?* « Claude écrit tes mails de prospection. Toi, tu les relis et tu les signes. » dit ce que fait l'outil et où est la main.
8. *Un texte creux ou inventé ?* Aucun chiffre ni témoignage ; la lettre d'exemple est signalée « fictive ».
9. *Du mouvement gratuit ?* Un seul moment orchestré (l'accroche surlignée) ; transitions de page et menus répondent à une action ; tout est coupé avec `prefers-reduced-motion`.
10. *Un site qui pourrait être celui d'un autre produit ?* La lettre, le serif d'édition et le fil du logo sont propres à AiTools.

Contrôles faits : `axe-core` (WCAG 2.1 AA + bonnes pratiques) sur 18 pages en clair et en sombre : aucune violation après correction des listes, de l'ordre des titres, d'un contraste de lien et des onglets de la page Mails.
