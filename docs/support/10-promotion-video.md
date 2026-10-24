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
5. Sous le formulaire, le nombre d'images à produire s'affiche (images par seconde × durée). Le maximum est 1 800 images : au-delà, le message « Trop d'images » apparaît et le bouton **Générer la vidéo** se bloque. Réduire la durée ou les images par seconde.
6. Clique **Générer la vidéo**. La tâche tourne en arrière-plan (« Activité ») : « Claude conçoit la vidéo… » puis « Rendu de la vidéo : image N/M ». Compte quelques minutes (selon la durée et les images par seconde). Une notification « Vidéo de promotion prête » s'affiche à la fin.

## Les vidéos produites
Chaque vidéo apparaît dans la liste de l'onglet avec un lecteur, son sujet (« Présentation du projet » si aucun), sa durée, ses images par seconde, son format, son poids et sa date. Boutons **Télécharger** (fichier MP4) et **Supprimer** (réservé aux administrateurs du projet). Les vidéos sont visibles par les personnes qui ont accès au projet. 20 vidéos au plus par compte : en supprimer une pour en produire une nouvelle. Elles sont supprimées avec le projet ou le compte.

## Comment ça marche (pour comprendre les erreurs)
Claude écrit une scène animée, sans aucun outil. Elle est ensuite dessinée **image par image** sur le serveur d'AiTools (navigateur sans interface, sans accès au réseau, dans un bac à sable) puis assemblée en MP4 (H.264). Si la scène écrite par Claude a un défaut (erreur de code, rien qui bouge…), elle lui est renvoyée **une fois** avec le message d'erreur pour correction.

## Modifier les consignes
**Réglages → Prompts IA → « Vidéo de promotion (design motion) »** : la direction artistique (ton, rythme, mouvements, palette) est modifiable, par gamme de modèle. Le contrat technique (document HTML, dimensions, durée) reste automatique pour ne pas casser le rendu.

## Problèmes fréquents
- « Chromium n'est pas installé sur ce serveur » / « ffmpeg n'est pas installé » : l'onglet est indisponible tant que l'administrateur du service n'a pas installé ces outils.
- « La scène écrite par Claude ne passe pas au rendu : … » : Claude n'a pas réussi à produire une scène valable après une correction → relancer, ou changer de modèle (Opus ou Fable pour des scènes plus complexes) dans Réglages.
- « Tu as déjà 20 vidéos » : supprimer une vidéo.
- Le job reste en attente : plafond de jobs IA atteint, quota Claude serré ou charge du serveur ; le message dans « Activité » donne la raison.
- La vidéo ne se lit pas dans le navigateur : la télécharger et l'ouvrir avec un lecteur vidéo.
