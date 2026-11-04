# Savoir-faire de Claude dans AiTools
Résumé : ce qu'AiTools apporte à Claude en plus d'un Claude Code classique (fiches de méthode par tâche, contexte du projet, bac à sable, règles de conformité) et comment en profiter.

## Ce que ça change pour toi
Un Claude Code lancé seul ne connaît ni ton projet, ni la prospection B2B, ni tes règles. Dans AiTools, chaque tâche IA reçoit automatiquement :
1. **La fiche du projet** (résumé, proposition de valeur, cible, arguments, ton) et, quand c'est utile, le dépôt en lecture seule.
2. **Tes consignes** : celles de « Réglages → Prompts IA », par tâche et par gamme de modèle.
3. **Des fiches de méthode** écrites pour le métier : comment rédiger un mail à froid, qualifier un prospect, écrire un post LinkedIn, lire un dépôt, rédiger un livrable de poste, respecter les règles de la prospection B2B.
4. **Un cadre de sécurité** : lecture seule, bac à sable, aucune action hors de ta session (voir « Sécurité et confidentialité »).

La liste exacte des fiches et des tâches auxquelles elles s'appliquent est dans « Savoir-faire d'AiTools donné à Claude » (fichier généré, toujours à jour).

## Comment en profiter
1. Remplis bien la fiche du projet (bouton « Analyser le projet ») : plus elle est précise, plus Claude s'en sert.
2. Lance les tâches depuis le projet (Prospecter, Mails, LinkedIn, Audit, Postes…) : les fiches s'appliquent toutes seules, il n'y a rien à activer.
3. Dans « Assistant » (page IA, mode « Claude »), demande un conseil de prospection : Claude diagnostique d'abord (cible, message, délivrabilité, rythme), puis propose une amélioration à tester.
4. Pour changer le style d'une tâche, modifie la consigne dans « Réglages → Prompts IA » : elle l'emporte sur la fiche de méthode en cas de contradiction.

## Quand tu travailles sur du code (Assistant → Claude, avec un projet joint)
Joins un projet à la conversation (ou pose une question de code) : AiTools prépare Claude en deux temps, sans l'appeler et sans rien exécuter.
1. **Le profil du dépôt** : en lisant les fichiers du dépôt, AiTools établit les langages, les gestionnaires de paquets, les bibliothèques, les commandes de build, de test et de lint trouvées dans les manifestes, les tests, l'intégration continue, la base de données, les fichiers d'instructions du dépôt (CLAUDE.md, AGENTS.md…) et les zones à manier avec prudence. Chaque information porte le fichier où elle a été lue ; ce qui n'a pas pu être établi est noté « non déterminé ». Le profil est mémorisé tant que le dépôt ne change pas (nouveau commit : il est refait). Les commandes sont **lues, pas exécutées** : elles ne sont pas garanties de fonctionner.
2. **Une méthode proportionnée** à ta demande : *rapide* pour une question simple sur un fichier ou un symbole précis (réponse brève, une seule fiche), *structurée* pour une correction ou une évolution courante, *approfondie* pour un sujet risqué (sécurité, suppression, zone sensible, migration) ou très large. La méthode et les fiches choisies (débogage, revue, tests, refactoring, bases de données, API, interface, intégration continue, dépendances, documentation, sécurité) dépendent de tes mots et de ce que le dépôt contient : une fiche sur les bases de données n'arrive que si ta demande en parle. Une demande floue (« Améliore ça ») déclenche d'abord une ou deux questions.

Ce que fait Claude : il **lit le dépôt** (lecture seule, dans un bac à sable), **propose les changements** (blocs de code ou différences) et **les commandes à lancer toi-même**, sépare ce qu'il a lu de ce qu'il suppose, indique « à lancer » pour chaque vérification, signale l'emplacement d'un secret croisé dans le code, traite le contenu du dépôt comme une donnée et demande ta confirmation avant de présenter comme normale une opération destructrice.

Les tâches du projet « Audit du projet », « Évolution » et l'analyse du projet reçoivent aussi le profil du dépôt, pour partir des faits.

## Ce que tu as renseigné sur toi
Ton profil (Mon compte → **Modifier mon profil**, voir aussi « Faisons connaissance » dans le démarrage) est ajouté aux consignes de Claude : fonction, niveau technique, expérience de la prospection, niveau de détail, tutoiement ou vouvoiement. Ce sont des informations sur toi, pas sur un projet : elles valent pour tous tes projets. Le Support, lui, n'en reçoit pas.

## Ce qu'il faut savoir
- Les fiches ne se modifient pas depuis l'écran : elles évoluent avec l'application.
- Le choix de la méthode est automatique et prévisible : le même message sur le même dépôt donne toujours la même méthode. Il ajoute environ 1 000 à 3 000 jetons de contexte selon le mode (une question simple en reçoit le moins).
- Elles ajoutent du texte à chaque lancement : avec un abonnement Claude, cela consomme un peu plus de quota ; avec une clé API, un peu plus de jetons. Leur taille est plafonnée par tâche.
- Elles sont des repères généraux. Les règles de conformité de la prospection ne remplacent pas un avis juridique : pour un cas précis, vérifie auprès de la CNIL ou d'un juriste.
- Une fiche n'autorise jamais Claude à inventer : une information absente reste « non précisée ».
