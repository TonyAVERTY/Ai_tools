# La page IA : l'assistant (ton IA) et Support
Résumé : le menu Assistant, la différence entre l'assistant (ton IA : Claude, ChatGPT ou Gemini) et Support (aide sur AiTools), conversations, modèles, pièces jointes, projet joint, limites et confidentialité.

## Le menu Assistant
Dans la barre du haut, le bouton **Assistant** s'ouvre au survol de la souris (ou au toucher sur téléphone) avec deux choix :
- **Le nom de ton IA** (**Claude**, **ChatGPT** ou **Gemini** ; sous le nom, « Discute avec ton Claude », « Discute avec ton ChatGPT »…) : l'assistant classique, page `/chat`.
- **Support** (« Une question sur AiTools ? ») : l'aide sur l'application, page `/support`.
Les deux utilisent **l'accès de la personne à son IA** (chaque message est envoyé à Claude, ChatGPT ou Gemini avec sa propre liaison) et ont leurs **conversations séparées** : la liste de gauche ne montre que celles du mode en cours.

## L'assistant (ton IA)
Pour discuter, rédiger un mail de prospection, répondre à un prospect qui trouve ça trop cher, trouver des idées de posts LinkedIn, réfléchir à une stratégie. L'IA ne voit que la conversation et ce que la personne joint.

## Support (aide sur AiTools)
Pour poser une question sur l'application : où cliquer, comment configurer, pourquoi quelque chose ne marche pas. L'IA y répond **d'après la documentation d'AiTools**, qu'elle lit elle-même (fichiers en lecture seule). Elle ne voit ni les projets, ni les prospects, ni les mails, ni les réglages de la personne et ne peut rien faire à sa place : elle explique comment faire. Elle peut répondre « Je ne trouve pas ça dans la documentation » plutôt que d'inventer. Un message d'état indique quand elle consulte la documentation (« Consulte la documentation : … »).
- Suggestions de départ : relier son IA, pourquoi les mails ne partent pas, la liste de mise en route, créer une vidéo de promotion.
- On peut joindre une **capture d'écran** pour montrer un problème.
- Il n'y a pas de bouton « projet » dans le Support.
- Les consignes du Support se modifient dans **Réglages → Prompts IA** (« Support (aide sur AiTools) »).
- Pour tout ce qui sort d'AiTools (rédaction, idées, stratégie), le Support renvoie vers l'assistant (ton IA).

## Utiliser la page
- **Nouvelle conversation** (en haut à gauche) ; la liste montre les conversations, la poubelle d'une ligne **supprime** la conversation (et ses pièces jointes).
- Zone de saisie : **Entrée** envoie, **Maj+Entrée** passe à la ligne. Bouton **Envoyer** ; pendant la réponse, **Arrêter** l'interrompt. La réponse s'écrit au fil de l'eau ; sous une réponse, **Copier** copie le texte.
- **Modèle** : la liste déroulante en haut change le modèle de la conversation (recommandés avec la gamme, économe, intermédiaire ou plus cher, et le symbole $ seulement avec une clé API ; puis les autres modèles). Le choix devient le modèle par défaut de la page.
- Les conversations sont **privées** : propres à chaque compte, supprimées avec lui.

## Pièces jointes (assistant et Support)
Bouton **trombone** (« Joindre une photo, une vidéo ou un fichier »), glisser-déposer sur la page, ou coller une image depuis le presse-papiers.
- Types acceptés : **images** (PNG, JPEG, GIF, WebP), **PDF**, **fichiers texte ou de code** (txt, md, csv, json, log, xml, yml, html, css, js, ts, php, py, sql…) et **vidéos** (MP4, MOV, WebM : quelques images en sont tirées, sans le son). Le type est reconnu d'après le contenu du fichier, pas son nom. SVG, exécutables et archives sont refusés.
- Les limites (nombre par message, taille, espace total) sont dans « Offres, plafonds et limites ».
- Les pastilles au-dessus de la zone de saisie montrent les fichiers prêts ; la croix en retire un avant l'envoi. Une pièce jointe jamais envoyée est supprimée au bout de 24 heures.
- Un message peut n'avoir que des pièces jointes. Les fichiers restent disponibles pour toute la conversation.
- Les vidéos demandent que le serveur ait ffmpeg ; sinon : « Les vidéos ne sont pas prises en charge sur ce serveur. »

## Joindre un projet (assistant seulement)
Bouton **dossier** (« Joindre un projet AiTools ») : l'IA lit le **code du projet en lecture seule** (elle ne peut rien modifier) pour répondre. Réservé au propriétaire du projet et aux administrateurs d'équipe. Le dépôt est mis à jour au premier usage (« Mise à jour du dépôt de … »). Un projet « pas encore analysé » peut quand même être joint. Le projet joint reste attaché d'un message à l'autre ; la croix « Détacher le projet » le retire.

## Limites et erreurs
- Une seule réponse à la fois par compte (« Une réponse est déjà en cours : attends qu'elle se termine »).
- « Le serveur est très sollicité en ce moment : réessaie dans un instant » : charge élevée ou trop de réponses en parallèle.
- « Budget IA atteint » : le plafond en $ réglé dans Réglages (clé API seulement) est atteint.
- « Limite de N réponses par 24 h atteinte » : voir « Offres, plafonds et limites ».
- Erreur de quota ou de jeton : voir « Relier, tester et déconnecter son IA (Claude, ChatGPT ou Gemini) ».
