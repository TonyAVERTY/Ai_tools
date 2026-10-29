# Promotion : générer une vidéo de design motion
Résumé : l'onglet Promotion d'un projet : choisir le sujet, les images par seconde, la durée et le format, comment la vidéo est produite, la lire, la télécharger, la supprimer, et les limites.

## À quoi ça sert
Claude conçoit une **courte vidéo de design motion** (texte animé, formes, mouvements, sans son) qui présente le projet ou un sujet précis, prête à publier sur les réseaux.

## Utiliser l'onglet (Projet → Promotion)
Le projet doit être **analysé** (sinon : « Analyse d'abord le projet : Claude s'appuie sur sa fiche »).
1. **Sujet** (facultatif) : ce dont parle la vidéo. **Laisse vide : Claude présente le projet** (ce qu'il est, pour qui, ce qu'il change).
2. **Images par seconde** : de 10 à 60 (30 par défaut). Plus il y en a, plus le mouvement est fluide et plus le rendu est long.
3. **Durée (secondes)** : de 3 à 60 (15 par défaut).
4. **Format** : Paysage 16:9, Vertical 9:16 (réseaux) ou Carré 1:1.
5. **Style** : la direction artistique. « Automatique » (par défaut) choisit une allure d'après le projet, toujours la même pour un même projet ; sinon « Sombre et lumineux » (fond nuit, halos), « Dégradé vif » (grand dégradé saturé, accent jaune), « Clair et net » (fond clair teinté, cartes blanches) ou « Chaud et humain » (cuivre et braise). Chaque style impose ses couleurs exactes à Claude : plus de fond blanc vide.
6. **Ajouter une voix** (case à cocher, facultative) : fait lire la vidéo à voix haute. Cocher la case affiche :
   - **Fournisseur** : « Microsoft Edge (gratuit) » (sans clé ni compte, voix neuronales, plusieurs voix par langue, la meilleure qualité) ou « Google Traduction (gratuit) » (une voix par langue, plus simple). Aucun compte ni clé à saisir.
   - **Voix** : la liste change avec le fournisseur. **La voix choisit la langue** : Claude écrit le texte lu (et les textes affichés) dans cette langue (français, anglais, espagnol, allemand, italien, portugais).
   - **Écouter un extrait** : joue une phrase d'essai avec la voix choisie, sans consommer de tâche IA. « Chargement de l'extrait… » puis « Lecture… » ; si le service ne répond pas, le message d'erreur s'affiche à la place.
7. Sous le formulaire, le nombre d'images à produire s'affiche (images par seconde × durée). Le maximum est 1 800 images : au-delà, le message « Trop d'images » apparaît et le bouton **Générer la vidéo** se bloque. Réduire la durée ou les images par seconde.
8. Clique **Générer la vidéo**. La tâche tourne en arrière-plan (« Activité ») : « Claude conçoit la vidéo… » puis « Rendu de la vidéo : image N/M ». Compte quelques minutes (selon la durée et les images par seconde). Une notification « Vidéo de promotion prête » s'affiche à la fin.

## Comment la voix est fabriquée
Quand « Ajouter une voix » est cochée, Claude écrit en plus de la scène un **script de voix** : une phrase par plan, avec la seconde où elle commence. Le serveur le vérifie, fait lire chaque phrase par le fournisseur choisi (étape « Voix : phrase N/M » dans « Activité »), puis pose les voix sur la vidéo (« Ajout de la voix à la vidéo… »). Deux voix ne se chevauchent jamais : une phrase trop longue repousse la suivante. Si la voix dépasse la durée de la vidéo, Claude doit raccourcir ses phrases (un seul essai) ; au second essai la fin est coupée et une remarque le signale. Sans la case, la vidéo reste sans son.
**Confidentialité** : le texte lu (écrit par Claude d'après la fiche du projet) est envoyé au fournisseur choisi pour être transformé en audio. Ce sont des services gratuits non officiels, sans clé : ils peuvent changer, être lents ou refuser des demandes.

## Les vidéos produites
Chaque vidéo apparaît dans la liste de l'onglet avec un lecteur, son sujet (« Présentation du projet » si aucun), sa durée, ses images par seconde, son format, son poids et sa date. Boutons **Télécharger** (fichier MP4) et **Supprimer** (réservé aux administrateurs du projet). Les vidéos sont visibles par les personnes qui ont accès au projet. 20 vidéos au plus par compte : en supprimer une pour en produire une nouvelle. Elles sont supprimées avec le projet ou le compte.

## Comment ça marche (pour comprendre les erreurs)
Claude écrit une scène animée, sans aucun outil. Elle est ensuite dessinée **image par image** sur le serveur d'AiTools (navigateur sans interface, sans accès au réseau, dans un bac à sable) puis assemblée en MP4 (H.264). Si la scène écrite par Claude a un défaut (erreur de code, rien qui bouge…), elle lui est renvoyée **une fois** avec le message d'erreur pour correction.

## Ce que la vidéo contient
Claude compose une affiche animée : un fond vivant (halos qui dérivent, grille discrète), de grands titres qui entrent mot par mot, des maquettes d'écran dessinées qui montent, trois bénéfices avec leurs icônes, puis un plan final avec le nom du produit et, si le projet en a un, l'adresse du site (« Site du produit » dans la configuration du projet). Les plans se répartissent sur toute la durée. Rien n'est inventé : pas de chiffre, de client ni de démonstration qui ne figure pas dans la fiche du projet. Les savoir-faire « direction artistique », « mouvement » et « scénario » de la vidéo sont lus automatiquement (voir « Savoir-faire de Claude »).

## Contrôle qualité automatique
Avant de dessiner les images, le serveur **mesure** la scène (taille des titres et des textes, remplissage de l'image, position verticale du contenu, fond blanc uni, écrans vides, dernier plan, éléments qui bougent). Au premier essai, une scène trop vide, trop statique ou mal cadrée est renvoyée à Claude avec la liste précise des défauts ; au second essai, elle est rendue quand même et les remarques restent dans le résultat de la tâche (« notes »).

## Modifier les consignes
**Réglages → Prompts IA → « Vidéo de promotion (design motion) »** : la direction artistique (ton, rythme, mouvements, palette) est modifiable, par gamme de modèle. Le contrat technique (document HTML, dimensions, durée) reste automatique pour ne pas casser le rendu.

## Problèmes fréquents
- « Chromium n'est pas installé sur ce serveur » / « ffmpeg n'est pas installé » : l'onglet est indisponible tant que l'administrateur du service n'a pas installé ces outils.
- « La scène écrite par Claude ne passe pas au rendu : … » : Claude n'a pas réussi à produire une scène valable après une correction → relancer, ou changer de modèle (Opus ou Fable pour des scènes plus complexes) dans Réglages.
- « La scène … est Trop de vide / Image figée / Titres trop petits » : le contrôle qualité a refusé deux fois la scène ; relancer, choisir un style précis ou un modèle plus puissant (Opus ou Fable).
- « Microsoft Edge (gratuit) ne répond pas » ou « Google Traduction a refusé la requête » : le service de voix est indisponible ou bloque le serveur. Essayer l'autre fournisseur ou relancer plus tard ; sans la case « Ajouter une voix », la vidéo se fait quand même. L'administrateur doit autoriser la sortie du serveur vers les fournisseurs (Microsoft Edge : speech.platform.bing.com ; Google Traduction : translate.google.com).
- « Il manque le script de la voix » / « La voix dure … de plus que la vidéo » : Claude a mal formé ou trop allongé la voix ; c'est renvoyé une fois pour correction. Si ça persiste, augmenter la durée de la vidéo ou changer de modèle.
- « Tu as déjà 20 vidéos » : supprimer une vidéo.
- Le job reste en attente : plafond de jobs IA atteint, quota Claude serré ou charge du serveur ; le message dans « Activité » donne la raison.
- La vidéo ne se lit pas dans le navigateur : la télécharger et l'ouvrir avec un lecteur vidéo.
