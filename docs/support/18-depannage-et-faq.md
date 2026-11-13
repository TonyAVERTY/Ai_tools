# Dépannage et questions fréquentes
Résumé : les problèmes les plus fréquents (liaison de l'IA, jobs bloqués, mails qui ne partent pas ou arrivent en spam, prospects, LinkedIn, vidéo, agenda) avec cause et solution, plus une FAQ.

## Je ne peux rien lancer, la page me renvoie à « Relier mon IA »
La liaison de ton IA est absente ou invalide. Relier un accès (voir « Relier, tester et déconnecter son IA (Claude, ChatGPT ou Gemini) »). État « À revalider » : relier de nouveau.

## Gemini : « Clé API refusée par Google », ou mes données de prospects partent chez Google
La clé est fausse, supprimée ou limitée : crée-en une nouvelle sur aistudio.google.com. Avec une **clé gratuite**, Google peut utiliser les données envoyées pour améliorer ses produits et des personnes peuvent les relire : n'y mets pas de données de prospects, et active la facturation sur ton projet Google pour un vrai usage.

## ChatGPT : aucun lien ne s'affiche, ou mes tâches attendent chacune leur tour
Aucun lien : active la connexion par code d'appareil dans les paramètres de sécurité de ton compte ChatGPT, ou utilise « Coller le fichier ». Les tâches qui s'enchaînent sont normales avec un compte ChatGPT : une seule tourne à la fois pour ton compte (avec une clé API, elles tournent ensemble).

## Une tâche terminée n'affiche plus qu'une ligne (résultat, « Voir », tokens)
C'est voulu pour alléger la page : sous une recherche, un envoi ou une relance terminés, le résultat, le bouton **Voir** (le détail de la tâche) et le nombre de tokens tiennent sur une même ligne. Rien n'est perdu : **Voir** ouvre le détail complet, et le menu « Activité » garde l'historique. Une **analyse** terminée n'affiche plus rien sous les onglets du projet (la fiche projet, juste en dessous, est son résultat) : « Voir » et les tokens n'apparaissent que pendant l'analyse (à côté d'**Annuler**) ou si elle a échoué (à côté de **Réessayer**) ; le détail d'une analyse terminée se retrouve dans « Activité ».

## « Se connecter avec Google » : le lien ne s'affiche pas, ou « Google a refusé le code »
- **Je ne vois pas l'option** : elle est désactivée par défaut. L'administrateur doit l'activer sur le serveur (et y installer Antigravity CLI, `agy`).
- **« Google n'a pas donné de lien de connexion »** : `agy` n'est pas installé ou pas joignable sur le serveur. Préviens l'administrateur.
- **« Google a refusé le code »** ou **« Le délai de Google est passé »** : Antigravity CLI n'attend le code que 60 secondes. Clique **Nouveau lien**, et recopie le code dès que Google l'affiche (en entier, sans espace).
- **« Connexion refusée par Google (expirée ou révoquée) »** pendant une tâche : reconnecte-toi avec **Se connecter avec Google**.
- **Mon compte Google est limité** : Google n'a pas tranché la règle sur l'usage depuis une autre application. Repasse à la clé API Google AI Studio.

## Avec ChatGPT, la carte « Consommation ChatGPT » dit « indisponible » ou ne montre pas mes limites
- **« ton accès ChatGPT sera renouvelé au prochain job iaboss »** : l'accès enregistré a expiré. iaboss ne le renouvelle pas tout seul (le renouvellement appartient à Codex) : lance une tâche IA, la carte revient ensuite.
- **« OpenAI refuse le relevé en direct »** : relie-toi de nouveau avec « Se connecter avec ChatGPT ».
- **« le relevé en direct est indisponible » / « réponse inattendue »** : la lecture des limites passe par une adresse interne d'OpenAI qui peut changer. Les tokens « via iaboss » restent exacts ; tes vraies limites se lisent aussi dans ChatGPT ou avec « /status » dans Codex.

## Avec ChatGPT ou Gemini, je ne vois pas les tokens pendant la tâche
C'est normal : ChatGPT et Gemini ne communiquent leurs tokens qu'**à la fin** de la tâche, contrairement à Claude qui les envoie au fil de l'eau. Pendant la tâche, la ligne dit « Tokens comptés à la fin de la tâche » (dans « Activité » et dans « Voir »). Le total apparaît dès que la tâche est terminée, et reste affiché même si elle échoue. Si le total reste à 0 après la fin d'une tâche réussie, signale-le à l'administrateur : l'IA n'a pas renvoyé sa mesure.

## Un document de facturation validé n'a plus d'aperçu ni de bouton « Valider »
C'est voulu : un document validé est grisé et réduit à un résumé pour qu'on ne le change pas par erreur. « Voir en grand » ouvre l'aperçu complet. Pour le changer, clique **Modifier** sur le document : il repassera à « À valider » après ta demande.

## Je ne peux plus écrire dans la cible de mon projet
Elle est **validée** : une cible validée est grisée et en lecture seule pour qu'on ne la change pas par erreur. Clique **Modifier** (section **Cible** du projet), change les champs, puis **Mettre à jour** ; **Annuler** remet la cible validée. Les prospects déjà trouvés ne changent pas : la nouvelle cible sert aux prochaines recherches.

## Je ne peux plus écrire dans mon modèle de mail ou de relance
Il est **validé** : un modèle validé est verrouillé (grisé, en lecture seule) pour qu'on ne le change pas par erreur. Clique **Modifier** pour le déverrouiller, change le texte, puis **Valider le modèle** (ou **Enregistrer** pour le garder en brouillon, ou **Annuler** pour revenir au texte validé). **Générer avec l'IA** réapparaît aussi avec **Modifier**.

## La barre « Changer | Modifier » n'apparaît pas quand je sélectionne une phrase
Elle n'existe que dans l'**Aperçu**, sur l'onglet **Version texte** (pas dans l'onglet « Mail » mis en forme), et seulement pour une phrase **du modèle** : ni l'en-tête (De, À, Objet), ni le pied de page, ni une phrase qui apparaît deux fois dans le modèle, ni une sélection coupée au milieu d'un nom d'entreprise. Sélectionne une phrase entière du corps du mail. Si « Changer » répond que ton IA n'a pas pu proposer une autre phrase, la raison est écrite (budget IA atteint, IA déconnectée, proposition inutilisable) : clique **Réessayer** ou **Fermer**, ou utilise **Modifier**, puis **Modifier à la main**, pour retoucher la phrase toi-même.

## L'aperçu signale « des réponses toutes faites » (« oui, non ou plus tard »)
Une personne écrit sa réponse avec ses mots, elle ne choisit pas dans une liste : « Est-ce un sujet chez vous : oui, non ou plus tard ? » lui fait remplir un formulaire. Garde une seule question simple (« Est-ce un sujet chez vous ? ») et retire les choix, quels que soient les mots : « oui, non ou plus tard » comme « maintenant, plus tard ou pas du tout ». Le bouton **Changer** refuse lui aussi les propositions qui énumèrent des réponses, et en redemande une autre une fois. Les consignes par défaut du mail et de la relance le demandent maintenant, et la génération corrige elle-même ce défaut une fois (voir « Forme corrigée à la génération » dans la page des mails) ; un modèle déjà généré garde son texte : sélectionne la phrase dans l'**Aperçu** et clique **Changer**, ou régénère-le avec **Générer avec l'IA**. Si tu as personnalisé la consigne de la relance (Réglages → Prompts IA), c'est ton texte qui s'applique.

## Le mail généré n'a ni « Bonjour » ni formule de politesse
L'aperçu l'écrit : « Le mail ne commence pas par une formule d'appel » ou « Aucune formule de politesse avant la signature ». Si le mail commence par « Bonjour » suivi du nom de l'entreprise (« Bonjour Une Bonne Bouteille, »), il l'écrit aussi : on salue une personne, pas une entreprise, donc « Bonjour, » tout court. Ajoute « Bonjour, » seul sur la première ligne et « Bien cordialement, » avant ta signature, ou clique de nouveau sur **Générer avec l'IA** : les consignes par défaut demandent maintenant l'appel, la politesse et la signature pour le premier mail comme pour la relance. Si tu as personnalisé la consigne du mail ou de la relance (Réglages → Prompts IA), c'est ton texte qui s'applique : ajoutes-y ces trois éléments ou clique **Revenir au texte par défaut**.

## « Aucun mail n'est parti : ton IA juge que le texte n'a pas de sens »
Avant l'envoi, ton IA relit chaque mail rempli avec les vraies valeurs, par lots de 10. Elle a jugé qu'une phrase ne veut rien dire (souvent un nom d'entreprise collé dans une tournure qui ne le porte pas) : le mail ne part pas, rien n'est perdu et les prospects restent « à contacter ». Ouvre **Aperçu** sur le modèle : l'IA relit le mail avant de te le montrer, le corrige dans le modèle et explique pourquoi (si le modèle est validé et grisé, clique d'abord **Modifier**) ; relis, **Enregistrer**, **Valider le modèle**, puis relance l'envoi. Si seuls certains prospects sont refusés, le journal des mails (« Non envoyé : le texte n'a pas de sens (…) ») dit lesquels : la cause est alors leur accroche ou leur nom, à corriger dans leur fiche.

## « Relecture par l'IA impossible » : l'envoi ne part pas
L'envoi vérifie le sens de chaque mail avec ton IA : quand elle ne peut pas répondre (budget IA atteint, IA déconnectée, réponse illisible), **rien ne part** plutôt que d'envoyer un texte non relu. Le message donne la raison. Reconnecte ton IA (voir « Je ne peux rien lancer »), attends que le budget se libère (Réglages → Budget IA) ou relance un peu plus tard : les prospects restent « à contacter ».

## La page « Aujourd'hui » : une ligne manque, ou la liste est vide
- **Une réponse de prospect n'y est pas** : seules les réponses **non lues** y figurent, et seulement si la boîte de réception (IMAP) du projet est connectée. Vérifie « Connecter ta boîte de réception » dans la liste de mise en route du projet.
- **Une ligne a disparu après « Marquer traité »** : c'est voulu, elle disparaît au rechargement. Clique sur **Annuler** avant de quitter la page pour la garder.
- **Une tâche IA en échec n'est plus là** : la liste ne montre que les 48 dernières heures ; l'historique complet est dans le menu « Activité ».
- **Le message « Ligne non mise à jour »** : le serveur n'a pas pu enregistrer ; la ligne est revenue à son état d'avant, réessaie.
- **Pas de rendez-vous dans l'agenda du jour** : seul le calendrier d'iaboss est lu, pas un agenda externe.

## Mon job reste « En attente »
Lire le message « En attente : … » dans le menu **Activité**. Raisons possibles : budget IA atteint (clé API) ; quota Claude serré (au-delà du seuil de « Réglages → Garde-fous → Pause des tâches IA à partir de », 85 % par défaut) ; charge élevée du serveur ; job programmé « Cette nuit » ; déjà un job IA en cours pour le compte. Il repart seul. On peut l'**Annuler** depuis Activité.

## Une section ou une liste n'a pas pu se charger : « Réessayer »
Quand une partie de la page se charge après coup (la section **LinkedIn**, **Promotion** ou **Récapitulatif** d'un projet, la liste de la page **Clients**, le menu **Joindre un projet iaboss** de la page IA), un petit cercle accompagne « Chargement… ». Si la requête échoue, le cercle laisse la place à **un message et un bouton « Réessayer »** : le cercle ne tourne jamais pour toujours.
1. Lis le message : « **Connexion impossible : réessaie dans un instant.** » (réseau coupé), « **Erreur interne : réessaie dans un instant.** » (problème du serveur), « **Tu n'as pas accès à cette action.** » (ton rôle sur le projet ne le permet pas) ou « **Introuvable : recharge la page.** ».
2. Clique sur **Réessayer** : le cercle revient et la demande repart. Si elle échoue encore, le message revient et tu peux recliquer.
3. Si le message persiste après plusieurs essais, recharge la page ; s'il revient, signale-le avec l'heure et le nom de la section.
Une session expirée ne montre pas ce message : tu reviens directement à la page de connexion (voir « Un message s'affiche en bas à droite »).

## « Plafond atteint » ou refus de création
Un plafond mensuel de l'offre (projets, prospects, mails, jobs IA, places d'équipe) est atteint. Le compteur est dans « Mon compte → Usage du mois » ; les plafonds se renouvellent le 1er du mois. Voir « Offres, plafonds et limites » et la page Tarifs.

## Un message s'affiche en bas à droite : que veut-il dire ?
Après une action, une notification apparaît en bas à droite. Un **succès** (« Prospect ajouté », « SMTP enregistré ») disparaît tout seul après quelques secondes. Une **erreur** reste plus longtemps (environ 8 secondes) ; la croix **×** la ferme tout de suite. Plusieurs notifications s'empilent (trois au plus) et le même message ne s'affiche qu'une fois.
- « **Connexion impossible : réessaie dans un instant.** » : l'application n'a pas pu joindre le serveur (réseau coupé ou serveur indisponible). Rien n'a été enregistré : vérifie ta connexion puis recommence.
- « **Erreur interne : réessaie dans un instant.** » : le serveur a rencontré un problème. Recommence ; si cela se répète, signale-le avec l'heure.
- « **Tu n'as pas accès à cette action.** » : ton rôle sur le projet ne le permet pas (voir « Équipe »).
- « **Introuvable : recharge la page.** » : l'élément a été supprimé ou déplacé depuis l'affichage de la page.
- **Quand tu envoies un formulaire et que l'application le refuse** (par exemple « Le SIRET compte 14 chiffres (laisse vide pour un particulier). » dans « Ajouter un client », ou « Choisis une date entre hier et dans trois ans » dans « Ajouter un événement »), tu restes sur la page : **ce que tu as saisi est conservé**, le formulaire reste ouvert et le bouton redevient utilisable. Corrige le champ indiqué puis renvoie. Si la page s'est rechargée et que les champs sont vides, ton navigateur n'a pas pu envoyer le formulaire sans recharger (JavaScript désactivé, ou envoi d'un fichier) : ressaisis-les.
- « **Ta session a expiré : reconnecte-toi.** » : tu reviens à la page de connexion ; après la connexion, retourne sur la page où tu étais.

## Se connecter et analyser la base : une erreur s'affiche, ou aucune table n'est recommandée
Sous **Se connecter et analyser** (Configuration du projet → Base de données), le message dit ce qui bloque :
- « **Connexion refusée : vérifie l'hôte et le port de la base.** » : l'adresse ou le port sont faux, ou la base n'accepte pas les connexions extérieures (pare-feu).
- « **Hôte introuvable** » : l'adresse n'existe pas. Les adresses internes ou privées sont refusées pour des raisons de sécurité.
- « **Identifiants refusés : vérifie l'utilisateur et le mot de passe.** » : le compte ou le mot de passe est faux (laisse **Mot de passe** vide pour garder celui qui est enregistré).
- « **Base introuvable** » / « **Ce compte n'a pas le droit de lire cette base** » : vérifie le nom dans **Base** et les droits de lecture du compte.
- « **Délai dépassé : la base ne répond pas** » : pare-feu ou mauvais port.
- « **Aucune table trouvée** » : la base est vide, ou le compte ne voit aucune table.
- Aucune table n'est marquée « (recommandé) » : tes tables n'ont pas de nom reconnaissable. Choisis-les toi-même dans les listes ; l'aperçu te dit tout de suite si c'est la bonne.
- L'aperçu du revenu est trop grand ou trop petit d'un facteur 100 : change **Montants en** (euros / centimes).
- L'aperçu affiche « indisponible » pour un chiffre : le compte ne peut pas lire cette table, ou la colonne choisie n'est pas un nombre.

## Une fenêtre me demande de confirmer
Avant une action difficile à défaire (supprimer un projet, un prospect, une vidéo ou une conversation, retirer le pied de page des mails, publier un post, envoyer un lot de mails…), iaboss ouvre une fenêtre : le titre est la question, la ligne dessous dit la conséquence. Le bouton porte le nom de l'action (« Supprimer le projet », « Publier »…) et il est **rouge** quand elle supprime ou retire quelque chose. **Annuler**, la touche Échap ou un clic en dehors de la fenêtre abandonnent sans rien changer. Pour une action qui se rattrape facilement, il n'y a pas de confirmation.

## « Trop de requêtes : réessaie dans … »
Le serveur limite le rythme des actions pour se protéger d'une boucle ou d'un abus. Une action isolée n'est jamais concernée : le message apparaît seulement après un très grand nombre d'enregistrements ou de clics en peu de temps (plus de 600 écritures en 10 minutes pour un même compte, avec des seuils plus bas sur certaines actions comme les vidéos, le chat ou la liaison de l'IA). Attends la durée indiquée dans le message, puis recommence. Les lectures (consulter une page, une liste) ne sont pas limitées. Si le message revient en usage normal, signale-le à l'administrateur.

## Le bouton Envoyer refuse ou rien ne part
Vérifier dans l'ordre : 1) SMTP enregistré (« Configuration du projet ») ; 2) modèle de mail **validé** (« Valider le modèle ») ; 3) des prospects au statut « À contacter » ; 4) pas de bandeau rouge de pause d'envoi sur la page Projets ; 5) plafond de mails du projet (24 h), plafond global (Réglages → Garde-fous) et plafond mensuel de l'offre ; 6) pas de job d'envoi déjà en cours ; 7) le message d'erreur du job dans Activité (erreur SMTP : identifiants, port).

## Mes mails arrivent en spam
Configurer SPF, DKIM et DMARC pour le domaine d'envoi ; envoyer de petits lots au début et augmenter progressivement ; garder des délais entre les mails ; éviter les liens et pièces jointes dans le premier mail ; soigner l'accroche. iaboss ajoute déjà un lien de désinscription dans le pied de page des mails.

## Où est passé le filtre par poste, ou une section que je cherche ?
Le filtre « Poste » de la page Projets n'existe plus. Un projet a maintenant des onglets (**Vue d'ensemble**, **Prospection**, **Envoi**, **Clients**, **Facturation**, **Communication**, **Outils IA**, **Récapitulatif**, **Réglages du projet**), chacun avec ses sections déjà ouvertes : Cible, Recherche de prospects et Prospects dans Prospection ; Modèle de mail, Envoi et Relance automatique dans Envoi ; LinkedIn et Promotion dans Communication ; Évolution, Audit du projet et Postes et tâches IA dans Outils IA ; SMTP, IMAP, base de données et suppression dans Réglages du projet. Voir « Les projets : cartes, pages à onglets, création, suppression ».

## Une tâche d'un poste ne démarre pas, échoue ou n'a pas de résultat
- « Analyse le projet d'abord » : lance l'analyse du projet (la fiche sert de contexte à toutes les tâches).
- « Cette tâche est déjà prévue ou en cours » : attends sa fin dans le menu **Activité**, ou **Annuler** puis relance.
- La tâche reste « En attente » : ton offre fait tourner un nombre limité de jobs IA à la fois (un seul avec l'offre gratuite ; les offres payantes en font tourner plusieurs, voir « Offres, plafonds et limites »), et les tâches des postes patientent quand le quota Claude est serré (voir « Mon job reste En attente »).
- « Réservé aux administrateurs du projet » : les tâches qui lisent le dépôt (Développement, registre RGPD) ne sont pas ouvertes aux simples membres.
- **Voir le résultat** n'apparaît qu'une fois la tâche terminée ; un échec affiche son message à la place. Le livrable est un brouillon : relis-le, surtout en juridique, finance et ressources humaines.

## Retirer le pied de page des mails (désinscription et origine de l'adresse)
**Réglages → Garde-fous → Pied de page des mails de prospection → Retirer le pied de page des mails** (confirmation demandée). Lis l'avertissement : sans lien de désinscription ni origine de l'adresse, tu t'exposes à des problèmes légaux (RGPD, CNIL) et à des blocages par Gmail ou Outlook. **Remettre le pied de page** le rétablit en un clic. Si des destinataires se plaignent de ne pas pouvoir se désinscrire, c'est la première chose à remettre.

## « Cette adresse ne peut pas être ajoutée » en ajoutant ou modifiant un prospect
L'adresse existe déjà dans ce projet (cherche-la dans la liste, avec la recherche) ou elle ne doit pas être contactée (désinscription ou refus enregistrés, tous comptes confondus). Le message est le même dans les deux cas : iaboss ne dit pas lequel. Autres refus : « Adresse email invalide », « Score : un nombre de 1 à 10 », « Adresse du site invalide » (attendu : https://exemple.fr), plafond de prospects de l'offre atteint (voir « Offres, plafonds et limites »).

## Je ne peux pas modifier l'adresse email d'un prospect
Elle est verrouillée dès que le prospect a été contacté (statut autre que « À contacter ») : les mails, relances et réponses y sont rattachés. Ajoute un nouveau prospect avec la bonne adresse. Les autres informations restent modifiables.

## L'aperçu du mail ne s'affiche pas ou affiche une alerte
- « Le corps du mail est vide » : écris le modèle ou clique « Générer avec l'IA » avant de cliquer **Aperçu**.
- « Aperçu expiré » : relance l'aperçu (il se garde 15 minutes).
- Les alertes jaunes (variable inconnue, accroche vide, nom d'expéditeur ou adresse d'envoi non réglés) montrent ce que le prospect verrait en moins bien : corrige le modèle ou la configuration du projet. Le lien de désinscription d'un exemple fictif est un lien d'exemple, il ne fonctionne pas.

## Dans « Mails », un mail déplié dit « Contenu non conservé » ou ne donne pas la raison du rejet
- **Contenu non conservé** : ce mail est parti avant que la page Mails garde les textes. Les nouveaux envois sont tous consultables.
- **« Le serveur du destinataire n'a pas donné de raison. »** sur un mail **Rejeté** : le rapport de rejet reçu ne contenait pas de motif lisible. Vérifie aussi que la boîte de réception du projet est reliée (Réglages du projet → boîte de réception, IMAP) : sans elle, les rejets ne sont pas détectés et le mail reste « Envoyé ».
- **« Détail indisponible »** : la connexion a coupé ou ta session a expiré ; replie puis déplie le mail, ou recharge la page.

## Les réponses n'apparaissent pas
Configurer la **Boîte de réception (IMAP)** (« Enregistrer et tester ») et cliquer **Vérifier maintenant** dans la section Envoi (lecture automatique toutes les 15 minutes). Sans IMAP, les réponses ne sont pas détectées et les relances automatiques ne partent pas.

## La relance automatique ne part pas
Elle exige : modèle de relance validé ; IMAP lu avec succès il y a moins de 2 heures ; heures ouvrées (lundi-vendredi 9h-18h, heure de Paris) ; plafonds non atteints ; case « Relancer une fois… » cochée.

## La recherche ne trouve rien ou peu de prospects
Cible trop étroite ou requêtes de recherche trop vagues : revoir la section **Cible** (secteurs, zone, requêtes, une par ligne), valider, relancer. Vérifier aussi le plafond de prospects de l'offre.

## Le dépôt ne se clone pas
Dépôt privé : ajouter un token dans **Réglages → Dépôts Git** (lecture seule). Autre serveur Git que GitHub : l'ajouter d'abord (URL du serveur et token). L'adresse doit être publique (les adresses internes sont refusées).

## L'analyse a échoué ou la fiche est incomplète
Relancer avec **Analyser** (ou **Réanalyser** si une fiche existe déjà). Vérifier la liaison de ton IA, son quota (barre de limites de Claude) et l'accès au dépôt.

## Je ne vois pas certaines sections ou certains boutons
Ils dépendent du rôle dans le projet : Configuration du projet, Audit, Récapitulatif, connexion LinkedIn et publication sont réservés aux administrateurs et au propriétaire ; supprimer un projet est réservé au propriétaire (voir le fichier sur les projets). Un membre d'équipe ne voit pas le SMTP ni l'IMAP.

## LinkedIn : « connexion expirée » ou Publier grisé
Cliquer **Reconnecter**. Publier grisé : aucune page choisie alors que le compte ne peut pas publier sur le profil (**Choisir une page**). Voir le fichier sur LinkedIn.

## Les cases « Plateforme cible » changent mes réglages
Cocher une plateforme (Instagram Reels, TikTok, YouTube Shorts ou LinkedIn) règle le format, les images par seconde et la durée de l'onglet Promotion : c'est voulu. Une seule case reste cochée à la fois. Pour garder tes propres valeurs, **modifie les champs après avoir coché** (la case reste cochée et l'IA adapte toujours la vidéo à la plateforme), ou ne coche rien. Décocher ne rend pas les valeurs d'avant : retape-les. Si le bouton **Générer la vidéo** se bloque avec « Trop d'images », c'est que tu as monté les images par seconde ou la durée au-delà du maximum après avoir coché : redescends l'un des deux.

## « Écouter un extrait » échoue avec une voix ElevenLabs (502)
Le message affiché dit la cause :
- **« ElevenLabs : voix premium (👑) non incluse dans ton plan… »** : les voix avec une **couronne 👑** viennent de la **bibliothèque partagée** d'ElevenLabs (la plupart des voix françaises de la liste) ; l'API ne les accorde qu'aux **plans payants**. Le message nomme la voix, et la voix garde sa couronne dans la liste. Choisis une **voix sans couronne** (par exemple Adam, Alice, Bella ou Bill, qui parlent aussi français avec la langue « Français ») ou passe à un plan payant chez ElevenLabs.
- **« a refusé la clé API »** : la clé est fausse, révoquée ou son quota du mois est épuisé (voir « Retirer la clé » puis « Enregistrer la clé »).
- **« quota ou débit dépassé »** : trop de demandes d'un coup, ou quota épuisé.
- **« ne répond pas »** : le serveur n'atteint pas `api.elevenlabs.io` (l'administrateur doit autoriser cette sortie).
- **« a refusé la requête (404 : … voice … not found) »** : cette voix n'existe plus dans ton compte ; recharge la page pour rafraîchir la liste.

## Il manque une voix ElevenLabs dans la liste
La liste n'affiche qu'une sélection de ta bibliothèque ElevenLabs : 3 voix françaises gratuites, 2 françaises premium 👑, 2 anglaises gratuites et 1 anglaise premium. Une voix premium n'y figure pas si sa langue ne se lit pas dans ses étiquettes ou son nom (accent « standard » seul, par exemple) ou si d'autres plus soignées passent avant elle ; une voix gratuite est choisie parmi les voix de base de ton compte. Dans ElevenLabs, ajoute-lui une étiquette de langue ou un accent (« french », « parisian », « american »…) ; elle apparaît au prochain chargement de la liste.

## La vidéo de promotion échoue
Avec « Ajouter une voix » : si le message nomme le fournisseur de voix (« Google Traduction », « ElevenLabs », « Google Cloud » ou « Microsoft Azure »), c'est lui qui ne répond pas ou qui refuse la clé : essayer un autre fournisseur, vérifier la clé (« Retirer la clé » puis « Enregistrer la clé »), ou décocher la voix. Pour des voix plus naturelles : ElevenLabs, ou Piper (locale, sans clé) si l'administrateur l'a installée. Les extraits (« Écouter un extrait ») permettent de tester un fournisseur sans lancer de vidéo.
Lire le message du job : outils manquants sur le serveur (Chromium, ffmpeg), plafond de 20 vidéos, scène refusée après correction (relancer ou changer de modèle). Si le message parle d'un « Trop de vide », d'une « Image figée » ou de « Titres trop petits », c'est le contrôle qualité automatique : relancer, choisir un « Style » précis dans l'onglet Promotion, ou passer sur Opus ou Fable. Voir le fichier sur la Promotion.

## L'agenda externe ne se met pas à jour
Les agendas se rafraîchissent tout seuls mais lentement (Google : 12 à 24 heures). Pour voir un changement tout de suite, retirer puis rajouter l'abonnement, ou régénérer le lien (Créer mon lien d'agenda).

## Une question hors du cadre d'iaboss
Pour rédiger un mail, trouver des idées de posts, réfléchir à une stratégie commerciale : menu **Assistant** (l'entrée de ton IA).

## FAQ rapide
- **Qui paie l'IA ?** La personne, directement chez son fournisseur d'IA : Anthropic, OpenAI ou Google (clé API : à l'usage ; abonnement ou compte : son abonnement Claude, ChatGPT ou Google AI, ce dernier seulement si le service l'a activé). iaboss facture seulement son offre.
- **iaboss modifie-t-il mon code ?** Non : le dépôt est cloné et lu en lecture seule.
- **Puis-je changer le dépôt d'un projet ?** Non : créer un nouveau projet.
- **Combien de temps dure une recherche ou une vidéo ?** Quelques minutes ; l'avancement est dans Activité.
- **Où voir ce que j'ai consommé ?** « Mon compte → Usage du mois », la carte « Consommation » de la page Projets (suivie du nom de ton IA : « Consommation Gemini », par exemple) et « Mon compte → Mon IA → Limites d'utilisation ».
- **Comment arrêter les notifications ?** Réglages → Notifications : décocher les événements ou retirer le canal.
- **Comment supprimer mes données ?** « Mon compte → Zone de danger → Supprimer mon compte et mes données ».
- **Y a-t-il une application mobile ?** Non : le site s'adapte aux téléphones. Sur un écran étroit, les cinq onglets de la barre du haut (Aujourd'hui, Projets, Mails, Agenda, Compta) tiennent sur une ligne. Facturation, Clients et Équipe sont dans le menu de l'avatar.
- **Qui contacter si la documentation ne répond pas ?** L'administrateur du service d'iaboss.

## L'IA ignore la méthode attendue ou la réponse sort du cadre
Les fiches de méthode (voir « Savoir-faire de l'IA dans iaboss ») sont des repères : la consigne de la tâche dans « Réglages → Prompts IA » l'emporte en cas de contradiction.
1. Vérifie la consigne de la tâche dans « Réglages → Prompts IA » : une consigne modifiée peut aller à l'encontre de la méthode.
2. Clique « Revenir au texte par défaut » pour comparer.
3. Choisis un modèle plus capable pour cette tâche dans « Réglages → Budget et modèles IA » si le résultat reste approximatif.

## Comptabilité : une ligne ne s'enregistre pas, un export est vide
- **« Joins le justificatif »** : chaque ligne exige une preuve. Joins un PDF ou une image (JPG, PNG, WebP, GIF) dans « Ajouter une ligne », puis **Enregistrer la ligne**.
- **« Le justificatif doit être un PDF ou une image »** : le fichier est reconnu à son contenu, pas à son nom. Photographie ou exporte la facture en PDF.
- **« Fichier trop gros » ou « Espace plein »** : réduis la photo, ou exporte puis supprime d'anciennes lignes (les limites sont dans « Offres, plafonds et limites »).
- **« La date est dans le futur »** : ajoute la ligne le jour où l'argent est reçu ou payé.
- **« Le montant est invalide »** : écris seulement des chiffres, avec une virgule pour les centimes (« 49,90 »).
- **Je ne vois pas « Tout exporter » ni « Journal CSV »** : ces boutons apparaissent après la première ligne. L'archive contient les justificatifs de la période choisie dans « Tes chiffres » : choisis « Toute la période » pour tout exporter.
- **Le montant à déclarer me semble faux** : le guide « Faire ma déclaration » ne compte que les « Paiement reçu » (moins les « Remboursement versé à un client ») dans la période. Vérifie la date des lignes (le jour de l'encaissement), le type et ta situation (« Faire ma déclaration » → « Modifier mes réponses »).
- **Je ne sais pas si je suis micro-entrepreneur ou en société** : choisis « Je ne sais pas encore » puis « Faire ma déclaration » : le guide explique comment retrouver ton statut.
- **Les plafonds affichés ne sont pas les miens** : ce sont des valeurs de référence indiquées avec leur année ; vérifie sur service-public.fr.

## Facturation
- **Pas de bouton « Générer un modèle de document »** : des informations légales manquent ou sont invalides. Ouvre le projet, **Remplir les informations**, corrige les champs signalés (SIRET à 14 chiffres, code postal à 5 chiffres, IBAN valide, e-mail correct ; capital et immatriculation pour une société ; n° de TVA si tu factures la TVA), puis **Enregistrer les informations**.
- **« La dernière demande à Claude a échoué »** (le nom suit ton IA) : la réponse de l'IA était inutilisable ou ton IA n'est pas reliée (voir « Relier, tester et déconnecter son IA (Claude, ChatGPT ou Gemini) »). Rien n'a été modifié : clique de nouveau sur **Générer un modèle de document** (ou sur **Relancer la préparation** après la validation du devis).
- **Les prix des exemples sont faux** : sans « Tes tarifs habituels », ce sont des prix d'exemple. Renseigne tes tarifs, puis **Recommencer depuis le début**, ou utilise « Affiner avec Claude » (le nom suit ton IA) pour les corriger.
- **« Tes documents sont prêts » a disparu** : tu as affiné un document, il repasse à « À valider ». Valide-le de nouveau.
- **Les documents n'ont pas les couleurs, la police ou le logo de mon projet** : regarde l'encadré **Style des documents**. « Aucun style trouvé dans le dépôt » : l'IA n'a pas trouvé de couleur ; une note dit pourquoi une police ou un logo est ignoré (police WOFF2 ou illisible, logo SVG sans Chromium sur le serveur, fichier trop lourd). Mets un logo PNG ou JPEG et une police `.ttf` dans le dépôt, puis **Recommencer depuis le début** pour relire le style.
- **« À vérifier » ou « Non relu » dans « Relecture par l'IA »** : « À vérifier » = l'IA refusait encore le document au troisième essai, il est livré tel quel : relis-le. « Non relu » = la relecture n'a pas pu avoir lieu (« pdftoppm n'est pas installé sur ce serveur », quota de l'IA atteint…) ; les documents restent utilisables.
- **Un projet n'apparaît pas** : la page n'affiche que les projets de ton compte.
- **Rien n'est prérempli** : l'IA n'a rien trouvé d'écrit dans le dépôt (pas de mentions légales, de contact ou de tarifs) ou l'analyse date d'avant cette fonction. Clique **Réanalyser** dans la « Fiche projet », ou remplis à la main : la première fois suffit, les autres projets reprennent ton identité (« Repris d'un autre de tes projets »).
- **Une valeur préremplie est fausse** : corrige-la avant **Enregistrer les informations** ; l'IA peut se tromper de société si le dépôt en cite plusieurs.
- **« Indique le nom du client. » / « Indique l'adresse du client. »** à l'émission : ces deux champs sont obligatoires. « Le SIRET du client compte 14 chiffres » : corrige-le ou laisse-le vide pour un particulier.
- **Je ne peux pas choisir un type dans « Générer un document »** : seuls les modèles **validés** se génèrent (« à valider d'abord » sinon). Si tu viens d'affiner un modèle, valide-le de nouveau.
- **Ma facture émise n'apparaît pas dans mes chiffres de la Comptabilité** : c'est voulu. Elle est dans « Factures émises, à encaisser » et ne compte qu'une fois marquée payée (**Marquer payée**, avec la date d'encaissement).
- **Je n'ai pas la carte « Factures émises, à encaisser »** : aucune facture n'a été émise, ou elles ont toutes été marquées payées. Si tu n'as pas encore répondu aux questions de situation de la Comptabilité, fais-le d'abord : la page n'affiche le reste qu'après.
- **Numéro de facture déjà pris / « Numérotation en cours »** : deux émissions simultanées se sont croisées, réessaie.
- **Ma facture émise n'est pas dans la Comptabilité** : la case « Joindre automatiquement à la comptabilité » était décochée au moment de la génération (état « Non jointe à la comptabilité » dans « Documents émis »). Ajoute la ligne à la main dans « Comptabilité » (**Ajouter une ligne**) avec le PDF en justificatif.
- **Mon client n'apparaît pas dans la liste « Client »** : les clients sont enregistrés **par projet**, au moment où tu génères un document. Génère-lui un premier document dans ce projet, il sera proposé ensuite. S'il a été retiré (**Retirer**), saisis-le de nouveau.
- **« Ajoute au moins une ligne au devis »** : un devis se génère avec ce que ton client commande. Remplis au moins une ligne dans « Ce que ton client commande » (désignation, quantité, prix unitaire HT).
- **« Choisis le devis auquel ce document se rattache »** : un acompte, une facture finale ou un avoir reprennent le client et les lignes d'un devis déjà généré. Génère d'abord le devis (type « Devis »), puis choisis-le dans « Devis de référence ».
- **« Les acomptes dépasseraient le total du devis »** / **« Ce devis est déjà entièrement facturé par les acomptes »** : la somme des acomptes (et de la facture finale) ne peut pas dépasser le devis. Baisse la « Part de l'acompte (%) ».
- **« Un avoir ne peut pas dépasser la facture corrigée »** : baisse le « Montant à rembourser TTC (€) », ou laisse-le vide pour créditer toute la facture.

## Clients
- **Un client ou un prospect n'apparaît pas dans la liste** : ouvre le bon projet (les clients sont rangés par projet) et vide le champ « Rechercher un client ou un prospect ». Un prospect passé au statut « Client » apparaît dans « Clients ».
- **Je ne vois aucun échange dans la fiche client** : les échanges sont retrouvés par le prospect dont le client vient ou par l'**adresse e-mail** du client. Renseigne « E-mail » dans « Informations » puis « Enregistrer ». Seuls les mails du même projet apparaissent.
- **« Un client porte déjà ce nom dans ce projet. »** : change le nom, ou ouvre la fiche existante (cherche son nom).
- **« L'adresse e-mail n'est pas valide. » / « Le SIRET compte 14 chiffres. »** : corrige le champ, ou laisse-le vide.
- **J'ai retiré un client par erreur** : ajoute-le de nouveau (**Ajouter un client**). Ses documents n'ont pas été supprimés : ils sont dans « Facturation » (et dans la Comptabilité s'ils y avaient été joints).

## Les mails d'iaboss (invitations, rapports, alertes) : de quelle adresse partent-ils ?
Ils partent de l'adresse d'envoi du serveur (noreply@iaboss.fr). Si tu réponds à l'un d'eux, ta réponse arrive sur l'adresse de contact (contact@iaboss.fr). Les alertes d'erreur envoyées aux administrateurs partent de la boîte dédiée (erreur@iaboss.fr). Les trois boîtes partagent le même mot de passe, réglé par l'administrateur du serveur : tu n'as rien à configurer dans l'application. Les mails de prospection, eux, partent toujours du SMTP du projet.

## Je ne vois plus le bouton « Enregistrer les réglages »
C'est normal : la barre du bas n'apparaît que lorsqu'un champ des Réglages a été modifié. Une fois les réglages enregistrés (message « Réglages enregistrés »), elle se masque. Modifie un champ et elle revient.

## Le bouton « Envoyer le rapport maintenant » semble ne rien faire
Le résultat s'affiche dans une petite bulle en bas à droite, pendant quelques secondes. Si rien ne s'affiche : vérifie que l'**Email de réception** est renseigné et enregistré. Si le serveur de mail ne répond pas, une erreur apparaît au bout de 15 à 30 secondes (l'administrateur consulte alors les journaux du serveur : mauvais hôte ou port SMTP, identifiant ou mot de passe refusé).

## J'ai cliqué deux fois sur un bouton : l'action est-elle partie deux fois ?
Non. Les clics répétés sur un même bouton (double clic, rafale) sont ignorés : une seule demande part. Pendant l'envoi, le bouton est grisé, puis il redevient cliquable une fois la réponse reçue. Si une action ne part pas, attends la fin de l'envoi précédent, puis reclique une seule fois.

## « Analyse en échec : Git : EACCES: permission denied, mkdir '/data/repos/…' »
Le serveur ne peut pas écrire dans son dossier de données (réglage `DATA_DIR` de l'administrateur) : les dépôts ne peuvent donc pas être clonés. C'est à l'administrateur du serveur de pointer `DATA_DIR` vers un dossier qui appartient à l'utilisateur qui fait tourner iaboss, puis de redémarrer. Une fois corrigé, clique de nouveau sur **Analyser**.

## « Analyse en échec : Secret de liaison illisible : relie de nouveau ton accès à l'IA »
Le serveur ne peut pas déchiffrer ton accès à l'IA : le plus souvent, l'administrateur a changé la clé de chiffrement (`SECRET_KEY`) après ta liaison. Avec ChatGPT ou Gemini, le message porte le nom de ton IA à la place de « Claude ». La fenêtre « Claude est déconnecté » (au nom de ton IA) apparaît alors : clique sur **Reconnecter Claude** (« Reconnecter ChatGPT », « Reconnecter Gemini ») et relie de nouveau ton accès (clé API, jeton d'abonnement ou connexion), puis relance l'analyse. Rien d'autre n'est perdu.

## La fenêtre « Claude est déconnecté » s'affiche
Ton IA (Claude, ChatGPT ou Gemini : la fenêtre porte son nom) a refusé ton accès (jeton ou connexion expirés ou révoqués, clé API supprimée). Clique sur **Reconnecter Claude** (ou le nom de ton IA) pour relier un nouvel accès ; **Plus tard** ferme simplement la fenêtre.

## Le mail de prospection ne contient pas le lien de mon site
Renseigne l'adresse dans **En-tête → Site du produit** (puis **Enregistrer le site**), clique sur **Générer avec l'IA** dans « Modèle de mail » : le nouveau texte contient `{{site}}`, remplacée à l'envoi par ton adresse. Un modèle déjà généré avant cela n'a pas `{{site}}` : régénère-le, ou ajoute toi-même `{{site}}` dans le corps, puis **Valider le modèle** de nouveau. L'**Aperçu** montre le lien tel qu'il partira.

## « Modèle à corriger avant validation » ou une virgule en début de ligne dans le mail
Le bouton **Valider le modèle** refuse un modèle cassé : variable inconnue ou mal fermée (`{{site` sans les deux accolades), ligne qui commence par une virgule ou un point-virgule. Corrige la ligne indiquée (le message donne son numéro), puis valide de nouveau. Une virgule en début de ligne vient souvent d'une variable vide, par exemple `{{expediteur}}, MonProduit` sans **Nom expéditeur** réglé : renseigne le **Nom expéditeur** dans **Configuration du projet → SMTP**, ou mets la variable et le nom du produit sur deux lignes. À l'envoi et dans l'aperçu, ces restes sont de toute façon retirés. Si **Générer avec l'IA** dit « la relecture n'a pas pu être faite », relis le mail toi-même avant de le valider.

## « Modèle en échec : Expected property name or '}' in JSON … »
L'IA avait cité une variable (comme `{{site}}`) dans une phrase avant de donner le mail, et l'application a pris cette accolade pour le début du mail. C'est corrigé : l'application ignore maintenant ce qui n'est pas du JSON valide et retient le vrai mail. Si tu vois encore ce message, clique de nouveau sur **Générer avec l'IA** : l'IA répond un peu différemment à chaque fois.

## L'Objet B est vide après « Générer avec l'IA »
L'IA n'a pas proposé de second objet, ou l'a rendu identique à l'objet A : il n'y a alors pas de test A/B. Clique de nouveau sur **Générer avec l'IA**, ou écris toi-même l'**Objet B** (les envois alternent ensuite entre A et B ; le taux de réponse de chaque objet s'affiche sous le bouton Envoyer).

## Mon choix de modèle (Haiku, Sonnet, Opus) n'a pas l'air pris en compte
1. Vérifie qu'il est enregistré : après **Enregistrer les réglages**, le message « Réglages enregistrés » s'affiche et la liste montre ton choix quand tu rouvres les Réglages.
2. Le modèle s'applique aux tâches lancées **après** l'enregistrement : une tâche déjà en cours garde le sien.
3. Regarde le **modèle réellement utilisé** dans le menu **Activité** (pastille à côté du nom du job) ou, sur le projet, dans la zone de la tâche (« Modèle : … »).
4. Chaque tâche suit son réglage : **prospection** (recherche de prospects et accroches), **analyse de projet** (analyse du dépôt), **rédaction** (modèles de mail et relances, relecture, posts LinkedIn, devis…). Le modèle de la page IA se règle dans la page IA.

## Le mail propose une démonstration (ou un essai, un rendez-vous…) qui n'existe pas
L'IA n'a le droit de proposer que ce que la fiche projet dit exister, et l'**Aperçu** avertit quand le mail parle d'une démonstration, d'un essai, d'un devis, d'un appel, d'un rendez-vous ou d'une garantie absents de la fiche. Si ton modèle a été généré avant ce contrôle, clique de nouveau sur **Générer avec l'IA** puis **Valider le modèle**, ou retire la phrase à la main. Si la proposition existe vraiment (une démonstration, par exemple), ajoute-la d'abord à la fiche projet en relançant **Réanalyser** après l'avoir écrite dans le dépôt (par exemple dans le README).

## « LinkedIn a refusé la connexion »
Le message précise maintenant la cause : produits manquants dans l'application LinkedIn (« onglet Produits »), adresse de retour non déclarée (« onglet Auth → URL de redirection autorisées »), identifiants de l'application faux, ou compte sans droit sur la page. Suis le remède indiqué dans le message, puis recommence la connexion depuis le projet. Les détails sont dans « LinkedIn » (Problèmes fréquents).

## L'image d'un post Instagram est vide, banale ou refusée
- Message **« Chromium n'est pas installé sur ce serveur »** : l'image est rendue par Chromium sur le serveur ; l'administrateur doit l'installer (variable CHROMIUM_BIN). La newsletter n'en a pas besoin.
- Message **« L'image écrite par Claude ne passe pas au rendu »** : trois essais d'image ont été refusés au contrôle (script, adresse externe, texte qui déborde, image vide). Réessaie avec un sujet plus précis.
- Bannière **« À vérifier avant de publier »** : le directeur artistique (second contrôle) a relevé des défauts que les essais n'ont pas corrigés. Lis-les, puis **Régénérer un autre post**.
- Couleurs ou polices qui ne ressemblent pas à ton produit : l'IA les lit dans le dépôt ; sans interface dans le dépôt elle reste sobre. Détails dans « Instagram et newsletter : posts, images et lettres d'information ».

## Je viens de payer une offre et mon plan n'a pas changé
L'activation arrive par un message signé de Stripe, en général en quelques secondes : recharge « Mon compte ». Au bout de quelques minutes sans changement, écris-nous avec l'email de ton compte. Détails dans « Abonnement et paiement : choisir, changer ou résilier son offre ».

## Mon quota part trop vite dans la page IA
Chaque message renvoie à l'IA le début de la conversation. Pour une longue conversation, tape **/compacter** dans la zone de saisie : elle est résumée et le quota baisse. Ou ouvre une **nouvelle conversation** (**/nouveau**). Voir « Les commandes / » dans « La page IA : Claude et Support ».
- « Rien à compacter : la conversation est encore courte » : il faut au moins 4 messages.
- « Pas de conversation en cours » : écris d'abord un message.

## Une tâche IA s'est arrêtée à cause de la limite de mon IA
Coche **Relancer automatiquement les tâches IA arrêtées par une limite** dans « Réglages → Garde-fous » : la tâche repart seule après la remise à zéro du quota (3 relances au plus). Sans l'option, relance-la toi-même avec « Réessayer ». Si rien ne repart, regarde le journal de la tâche : une erreur de liaison (jeton refusé) ou un plafond de l'offre atteint n'est pas relancé.
