# MonEspacePro : recherche, choix de montage et storyboard

Produit : MonEspacePro, la carte de fidélité dans Apple Wallet / Google Wallet pour les commerces indépendants (dépôt analysé : https://git.tony-averty.dev/Tony/MonEspacePro, site https://monespacepro.eu).
Vidéo : 27 s, 1080 × 1920, 30 i/s, H.264 + AAC. Deux exports : `instagram-reels.mp4` et `tiktok.mp4`.

## 1. Ce que j'ai compris du produit

- **Public** : commerçants indépendants (boulangeries, cafés, coiffeurs, fleuristes), qui ont encore la carte en carton.
- **Promesse du site** : « La carte de fidélité, directement dans le téléphone de vos clients », sans application côté client, « dès 19 €/mois », « sans engagement », « prêt en quelques minutes ».
- **Parcours réel** (page « Comment ça marche ») : le client scanne le QR de l'affichette → la carte s'ajoute à son Wallet → l'employé crédite en un scan avec l'app MonEspacePro, le solde se met à jour tout seul.
- **Moment le plus visuel** : les tampons qui montent sur la carte jusqu'à « Viennoiserie offerte ». La vidéo est construite autour de lui, avec trois idées seulement : scan client, crédit en un scan, suivi des statistiques.

Il existe déjà une pub en motion design du dépôt (`docs/MonEspacePro-pub-voix-120fps.mp4`, « Fini la carte en carton »). Celle-ci est différente : elle montre le vrai produit (captures du site et de l'app) au lieu de cartes dessinées.

## 2. Ce qui est réel, ce qui est reconstitué

| Élément à l'écran | Origine |
|---|---|
| Carte Wallet « Boulangerie Kerlann » (6 à 10 tampons), téléphone, affichette QR, carte en carton, étapes | **Captures réelles du site** `site/index.html`, rendu mobile dans Chromium (`capture-site.mjs`). Le commerce « Boulangerie Kerlann » est le commerce fictif du site. Pour 6, 8, 9, 10 tampons, on change seulement les pastilles et le compteur avec le CSS du site. |
| Écrans « Scanner » et « Créditer 12,50 € » | Maquettes HTML du site (pas des captures de l'app native), identiques à ce qu'il affiche. |
| Écran « Statistiques » | **Capture réelle de l'app Pro** (`docs/app-ios/captures/statistiques.jpg`), recadrée avant la liste « Meilleurs clients ». Données de démonstration (magasin de démo des vérifications App Review), indiquées à l'écran. |
| Logo | `brand/symbole-blanc.svg` du dépôt. |

**Non fait** : je n'ai pas lancé l'app mobile ni l'API (elles demandent MySQL, Stripe, certificats Wallet et un téléphone), donc pas de capture vidéo de l'app en usage réel. Je n'ai pas non plus vérifié l'envoi réel d'une carte dans un Wallet.
Aucune donnée personnelle : le prénom « Tony » de la capture « Client » et la liste des clients n'apparaissent pas.

## 3. Recherche : vidéos de grandes marques

**Limite importante** : je n'ai pas pu *regarder* ces vidéos (pas de lecture vidéo ni de transcription dans cet environnement). J'ai confirmé par l'API oEmbed de YouTube le titre et la chaîne qui les publie, et j'ai lu leur description dans les résultats de recherche. Aucun timecode n'est donc cité : je ne les ai pas vérifiés. À regarder avant de décider d'aller plus loin (liste de contrôle en fin de section).

| Vidéo | Chaîne (vérifiée) | Ce que je sais |
|---|---|---|
| [« Grow on your own terms with Square »](https://www.youtube.com/shorts/zjh5FwnF6c0) | Square (@square) | Short vertical. D'après sa description : ouvre sur une question (« Fatigué de jongler avec trop d'outils et d'abonnements ? »), puis présente la plateforme tout-en-un et ses trois formules. Question d'accroche + une seule promesse. |
| [« Shopify POS System Explained »](https://www.youtube.com/shorts/iGiVFAtxdII) | Learn With Shopify | Short vertical « explainer » sur une caisse pour petits commerces : un produit, une explication. Contenu non vérifié. |
| [« How to add a Starbucks Card in your account? »](https://www.youtube.com/shorts/QRsGde6CHfo) | Starbucks Philippines (compte régional officiel) | Short vertical sur une carte de fidélité ajoutée dans une app : sujet le plus proche de MonEspacePro. Contenu non vérifié. |

**À regarder (3 min) et noter** : (1) ce qu'on voit à 0–2 s, (2) à quelle seconde le produit apparaît, (3) si le texte accompagne ou remplace la voix, (4) la forme de la dernière image (URL, bouton, ou rien).

## 4. Recherche : recommandations des plateformes

| Source | Ce qu'elle dit | Fiabilité |
|---|---|---|
| [TikTok, « Creative best practices for performance ads »](https://ads.tiktok.com/help/article/creative-best-practices?lang=en) (page lue, mise à jour juin 2025) | Pensée pour TikTok : son/musique, 9:16, au moins 720P, contenu visible dans la zone de sécurité de l'interface. Structure : accroche, points forts, appel à l'action clair. « Accroche dans les 6 premières secondes », « proposition de contenu dans les 3 premières secondes pour le rappel ». Légendes ou texte à l'écran pour donner du contexte ; transitions, stickers, graphismes pour garder l'attention. Style DIY, peu léché, recommandé. | **Officielle**, mais écrite pour les **publicités** TikTok. Appliquée ici par analogie à une publication organique. |
| TikTok, marges exactes de la zone de sécurité | Les pixels ne sont pas dans la page lue ; elle renvoie aux « ad specifications » et à un gabarit. | **Non vérifiées.** J'ai pris une hypothèse (haut 210 px, bas 480 px, droite 140 px) à confronter au gabarit officiel. |
| Meta, zones masquées des Reels (haut 14 %, bas 35 %, côtés 6 %) | Chiffres relayés par des agences et fournisseurs d'outils, qui parlent des **publicités** Reels. Les pages officielles Meta que j'ai essayées (Ads Guide, Business Help Center) répondaient 404 ; celles d'Instagram Creators sont du contenu vidéo sans texte lisible. | **Source tierce, non confirmée** par Meta. Utilisée par prudence : rien d'important dans ces zones. |
| Signaux de classement des Reels (temps de visionnage, envois, likes) | Relayés par des blogs tiers, avec des chiffres qui se contredisent (« 3 à 5 fois plus de valeur pour un envoi », « 40–60 % de portée en plus pour l'original »). | **Non confirmé.** Aucun chiffre de ce type n'est retenu. Je garde seulement : l'originalité (pas de filigrane d'une autre app) et l'intérêt de se faire visionner jusqu'au bout et partager. |

### Décisions de montage qui en découlent

1. **Résultat dès l'image 1** : texte « 1 scan = 1 tampon » + la carte avec ses tampons, puis un tampon s'ajoute à 1,0 s. La proposition est donc claire avant 3 s (TikTok) ; le produit apparaît à 0 s.
2. **Accroche = bénéfice** plutôt que question : c'est ce que montre le mieux une vraie carte Wallet.
3. **Textes courts**, 2 à 5 mots, gros (118 à 170 px), un mot-clé en couleur par phrase : compréhensible sans son.
4. **Rythme** : une nouveauté visuelle environ toutes les 0,5 à 1,3 s (mots qui claquent, tampons, scan, ajouts de tampon), 8 scènes avec des entrées différentes (haut, droite, cercle, gauche, flash, bas, cercle) et des fonds alternés vert / clair / jaune.
5. **Pas d'intro logo** : le logo n'apparaît qu'à la fin.
6. **CTA unique** : « monespacepro.eu » (vérifié : la page répond le 10 nov. 2026).
7. **Pas de montage de code** : uniquement des écrans produit.
8. **Son** : original (synthèse, `audio.py`) donc sans licence ; coupable à la publication.
9. **Style peu léché de TikTok** : pas retenu. Le site et les cartes ont une identité nette (Figtree, vert #0E7A66, jaune #F2B544) ; je garde la cohérence de marque.

### Zones de sécurité utilisées

| Version | Texte | Visuels |
|---|---|---|
| Instagram Reels | entre y = 270 (14 %) et 1248 (65 %), marges latérales 65 px (6 %) | Les objets hauts (cartes, téléphones) commencent dans la zone et **débordent sous 1248 px** : seule la partie basse (QR) passe sous l'interface. |
| TikTok | à partir de y = 210, jusqu'à 1440, marge droite 140 px | même principe, objets plus grands car la zone basse est plus petite (hypothèse) |

## 5. Trois accroches proposées

1. **« 1 scan = 1 tampon »** (retenue) : le bénéfice le plus rapide, visible en une image.
2. « Votre client oublie sa carte en carton. Pas son téléphone. » : part du problème.
3. « La carte de fidélité qui tient dans le Wallet, dès 19 €/mois » : part du prix.

## 6. Déroulé chronométré (identique sur les deux versions)

| Temps | Scène | Texte à l'écran | Image |
|---|---|---|---|
| 0,0–2,4 | Accroche (fond vert) | « 1 scan = 1 tampon » | Carte Wallet à 7/10 ; à 1,0 s elle passe à 8/10, bulle « +1 tampon », éclats, petit flash |
| 2,4–5,8 | Le problème (fond clair) | « Votre carte en carton ? », puis « Oubliée. », « Perdue. », « Jamais pleine. » (barrés) | La carte en carton du site arrive du haut |
| 5,8–9,6 | Le client scanne (vert) | « Le client scanne » → « Aucune appli à installer » | Affichette QR + faisceau de scan, pastille « ✓ Sans application » |
| 9,6–13,4 | La carte arrive (vert clair) | « La carte arrive dans son Wallet » | « Ajouter à Wallet », puis téléphone avec la carte |
| 13,4–17,4 | Le commerçant crédite (jaune) | « Vous scannez » → « Vous saisissez le montant » → « Crédité en un scan » | Écran Scanner, écran 12,50 €, tuile « Crédité » + onde |
| 17,4–20,6 | La récompense (vert) | « Le 10e tampon ? » → « Viennoiserie offerte » | Carte 7 → 8 → 9 → 10 tampons, flash à 18,75 s |
| 20,6–23,4 | Suivi (fond clair) | « Et vous voyez qui revient » | Écran Statistiques de l'app, mention « Données de démonstration » |
| 23,4–27,0 | CTA (vert) | « Dès 19 €/mois », « Sans engagement. Prêt en quelques minutes. », « monespacepro.eu » | Logo, prix qui défile, bouton |

Remarque : « Le 10e tampon ? » vaut pour la carte de démonstration du site (10 tampons) ; chaque commerçant règle son seuil.

## 7. Contrôles faits

- ffprobe sur les deux MP4 : H.264 High, yuv420p, 1080 × 1920, 30 i/s, AAC 48 kHz, 27,0 s.
- Planche d'images extraites des MP4 finaux (12 instants par version) relue : textes non coupés, CTA lisible, aucun texte important dans les zones d'interface, aucune donnée personnelle.
- **Non testé** : lecture dans les apps Instagram et TikTok sur téléphone (aucun accès), rendu sur petit écran réel, comparaison avec le gabarit officiel TikTok.

## 8. Crédits audio

Bande son créée par synthèse (`audio.py`, sinusoïdes et bruit filtré) : pas d'échantillon, pas de musique tierce, aucun crédit à mentionner. Police Figtree (SIL Open Font License) via Google Fonts, copie dans `assets/fonts/`.

## 9. Refaire les exports

```bash
# prérequis : Node 22+, FFmpeg, Python 3 + numpy, Playwright (PLAYWRIGHT_MODULE=/chemin/vers/playwright/index.js si besoin)
bash promo-video/export.sh               # audio + MP4 Reels + MP4 TikTok + couverture
node promo-video/render.mjs --only tt    # une seule version
node promo-video/render.mjs --stills 0,1.2,9 --guides   # images de contrôle avec les zones de sécurité
```

Mettre à jour les captures depuis une copie du dépôt MonEspacePro : `node promo-video/capture-site.mjs <dossier du dépôt>`.

Fichiers sources : `composition/index.html` + `composition/timeline.js` (montage piloté par le temps, `?p=ig|tt&t=12.5` pour figer une image), `composition/cover.html`, `assets/`, `audio.py`, `render.mjs`, `cover.mjs`, `capture-site.mjs`.
