# Dépannage et questions fréquentes
Résumé : les problèmes les plus fréquents (liaison Claude, jobs bloqués, mails qui ne partent pas ou arrivent en spam, prospects, LinkedIn, vidéo, agenda) avec cause et solution, plus une FAQ.

## Je ne peux rien lancer, la page me renvoie à « Relier Claude »
La liaison Claude est absente ou invalide. Relier un accès (voir « Relier, tester et déconnecter son accès Claude »). État « À revalider » : Déconnecter puis relier de nouveau.

## Mon job reste « En attente »
Lire le message « En attente : … » dans le menu **Activité**. Raisons possibles : budget IA atteint (clé API) ; quota Claude serré (au-delà de 85 %) ; charge élevée du serveur ; job programmé « Cette nuit » ; déjà un job IA en cours pour le compte. Il repart seul. On peut l'**Annuler** depuis Activité.

## « Plafond atteint » ou refus de création
Un plafond mensuel de l'offre (projets, prospects, mails, jobs IA, places d'équipe) est atteint. Le compteur est dans « Mon compte → Usage du mois » ; les plafonds se renouvellent le 1er du mois. Voir « Offres, plafonds et limites » et la page Tarifs.

## « Trop de requêtes : réessaie dans … »
Le serveur limite le rythme des actions pour se protéger d'une boucle ou d'un abus. Une action isolée n'est jamais concernée : le message apparaît seulement après un très grand nombre d'enregistrements ou de clics en peu de temps (plus de 600 écritures en 10 minutes pour un même compte, avec des seuils plus bas sur certaines actions comme les vidéos, le chat ou la liaison Claude). Attends la durée indiquée dans le message, puis recommence. Les lectures (consulter une page, une liste) ne sont pas limitées. Si le message revient en usage normal, signale-le à l'administrateur.

## Le bouton Envoyer refuse ou rien ne part
Vérifier dans l'ordre : 1) SMTP enregistré (« Configuration du projet ») ; 2) modèle de mail **validé** (« Valider le modèle ») ; 3) des prospects au statut « À contacter » ; 4) pas de bandeau rouge de pause d'envoi sur la page Projets ; 5) plafond de mails du projet (24 h), plafond global (Réglages → Garde-fous) et plafond mensuel de l'offre ; 6) pas de job d'envoi déjà en cours ; 7) le message d'erreur du job dans Activité (erreur SMTP : identifiants, port).

## Mes mails arrivent en spam
Configurer SPF, DKIM et DMARC pour le domaine d'envoi ; envoyer de petits lots au début et augmenter progressivement ; garder des délais entre les mails ; éviter les liens et pièces jointes dans le premier mail ; soigner l'accroche. AiTools ajoute déjà un lien de désinscription dans le pied de page des mails.

## Le filtre par poste cache une section que je cherche
Choisis **Tous les postes** dans la liste **Poste**, en haut de la page Projets : le filtre choisi est mémorisé dans ton navigateur et s'applique à tous tes projets. Un poste ne montre que ses sections (Commerce : Cible et Prospecter ; Communication : LinkedIn et Promotion ; Produit : Évolution ; Développement : Audit du projet ; Direction : Récapitulatif) plus **Postes et tâches IA**. Voir « Postes et filtre par poste : les tâches IA d'une entreprise ».

## Une tâche d'un poste ne démarre pas, échoue ou n'a pas de résultat
- « Analyse le projet d'abord » : lance l'analyse du projet (la fiche sert de contexte à toutes les tâches).
- « Cette tâche est déjà prévue ou en cours » : attends sa fin dans le menu **Activité**, ou **Annuler** puis relance.
- La tâche reste « En attente » : ton offre fait tourner un nombre limité de jobs IA à la fois (un seul avec l'offre gratuite ; les offres payantes en font tourner plusieurs, voir « Offres, plafonds et limites »), et les tâches des postes patientent quand le quota Claude est serré (voir « Mon job reste En attente »).
- « Réservé aux administrateurs du projet » : les tâches qui lisent le dépôt (Développement, registre RGPD) ne sont pas ouvertes aux simples membres.
- **Voir le résultat** n'apparaît qu'une fois la tâche terminée ; un échec affiche son message à la place. Le livrable est un brouillon : relis-le, surtout en juridique, finance et ressources humaines.

## Retirer le pied de page des mails (désinscription et origine de l'adresse)
**Réglages → Garde-fous → Pied de page des mails de prospection → Retirer le pied de page des mails** (confirmation demandée). Lis l'avertissement : sans lien de désinscription ni origine de l'adresse, tu t'exposes à des problèmes légaux (RGPD, CNIL) et à des blocages par Gmail ou Outlook. **Remettre le pied de page** le rétablit en un clic. Si des destinataires se plaignent de ne pas pouvoir se désinscrire, c'est la première chose à remettre.

## « Cette adresse ne peut pas être ajoutée » en ajoutant ou modifiant un prospect
L'adresse existe déjà dans ce projet (cherche-la dans la liste, avec la recherche) ou elle ne doit pas être contactée (désinscription ou refus enregistrés, tous comptes confondus). Le message est le même dans les deux cas : AiTools ne dit pas lequel. Autres refus : « Adresse email invalide », « Score : un nombre de 1 à 10 », « Adresse du site invalide » (attendu : https://exemple.fr), plafond de prospects de l'offre atteint (voir « Offres, plafonds et limites »).

## Je ne peux pas modifier l'adresse email d'un prospect
Elle est verrouillée dès que le prospect a été contacté (statut autre que « À contacter ») : les mails, relances et réponses y sont rattachés. Ajoute un nouveau prospect avec la bonne adresse. Les autres informations restent modifiables.

## L'aperçu du mail ne s'affiche pas ou affiche une alerte
- « Le corps du mail est vide » : écris le modèle ou clique « Générer avec l'IA » avant de cliquer **Aperçu**.
- « Aperçu expiré » : relance l'aperçu (il se garde 15 minutes).
- Les alertes jaunes (variable inconnue, accroche vide, nom d'expéditeur ou adresse d'envoi non réglés) montrent ce que le prospect verrait en moins bien : corrige le modèle ou la configuration du projet. Le lien de désinscription d'un exemple fictif est un lien d'exemple, il ne fonctionne pas.

## Les réponses n'apparaissent pas
Configurer la **Boîte de réception (IMAP)** (« Enregistrer et tester ») et cliquer **Vérifier maintenant** dans la section Envoi (lecture automatique toutes les 15 minutes). Sans IMAP, les réponses ne sont pas détectées et les relances automatiques ne partent pas.

## La relance automatique ne part pas
Elle exige : modèle de relance validé ; IMAP lu avec succès il y a moins de 2 heures ; heures ouvrées (lundi-vendredi 9h-18h, heure de Paris) ; plafonds non atteints ; case « Relancer une fois… » cochée.

## La recherche ne trouve rien ou peu de prospects
Cible trop étroite ou requêtes de recherche trop vagues : revoir la section **Cible** (secteurs, zone, requêtes, une par ligne), valider, relancer. Vérifier aussi le plafond de prospects de l'offre.

## Le dépôt ne se clone pas
Dépôt privé : ajouter un token dans **Réglages → Dépôts Git** (lecture seule). Autre serveur Git que GitHub : l'ajouter d'abord (URL du serveur et token). L'adresse doit être publique (les adresses internes sont refusées).

## L'analyse a échoué ou la fiche est incomplète
Relancer avec **Analyser** (ou **Réanalyser** si une fiche existe déjà). Vérifier la liaison Claude, le quota Claude, et l'accès au dépôt.

## Je ne vois pas certaines sections ou certains boutons
Ils dépendent du rôle dans le projet : Configuration du projet, Audit, Récapitulatif, connexion LinkedIn et publication sont réservés aux administrateurs et au propriétaire ; supprimer un projet est réservé au propriétaire (voir le fichier sur les projets). Un membre d'équipe ne voit pas le SMTP ni l'IMAP.

## LinkedIn : « connexion expirée » ou Publier grisé
Cliquer **Reconnecter**. Publier grisé : aucune page choisie alors que le compte ne peut pas publier sur le profil (**Choisir une page**). Voir le fichier sur LinkedIn.

## La vidéo de promotion échoue
Avec « Ajouter une voix » : si le message nomme le fournisseur de voix (« Google Traduction », « ElevenLabs », « Google Cloud » ou « Microsoft Azure »), c'est lui qui ne répond pas ou qui refuse la clé : essayer un autre fournisseur, vérifier la clé (« Retirer la clé » puis « Enregistrer la clé »), ou décocher la voix. Pour des voix plus naturelles : ElevenLabs, ou Piper (locale, sans clé) si l'administrateur l'a installée. Les extraits (« Écouter un extrait ») permettent de tester un fournisseur sans lancer de vidéo.
Lire le message du job : outils manquants sur le serveur (Chromium, ffmpeg), plafond de 20 vidéos, scène refusée après correction (relancer ou changer de modèle). Si le message parle d'un « Trop de vide », d'une « Image figée » ou de « Titres trop petits », c'est le contrôle qualité automatique : relancer, choisir un « Style » précis dans l'onglet Promotion, ou passer sur Opus ou Fable. Voir le fichier sur la Promotion.

## L'agenda externe ne se met pas à jour
Les agendas se rafraîchissent tout seuls mais lentement (Google : 12 à 24 heures). Pour voir un changement tout de suite, retirer puis rajouter l'abonnement, ou régénérer le lien (Créer mon lien d'agenda).

## Une question hors du cadre d'AiTools
Pour rédiger un mail, trouver des idées de posts, réfléchir à une stratégie commerciale : menu **Assistant → Claude**.

## FAQ rapide
- **Qui paie l'IA ?** La personne, directement chez Anthropic (clé API : à l'usage ; abonnement : son abonnement Claude). AiTools facture seulement son offre.
- **AiTools modifie-t-il mon code ?** Non : le dépôt est cloné et lu en lecture seule.
- **Puis-je changer le dépôt d'un projet ?** Non : créer un nouveau projet.
- **Combien de temps dure une recherche ou une vidéo ?** Quelques minutes ; l'avancement est dans Activité.
- **Où voir ce que j'ai consommé ?** « Mon compte → Usage du mois », la carte « Consommation Claude » de la page Projets et « Mon compte → Liaison Claude → Limites d'utilisation ».
- **Comment arrêter les notifications ?** Réglages → Notifications : décocher les événements ou retirer le canal.
- **Comment supprimer mes données ?** « Mon compte → Zone de danger → Supprimer mon compte et mes données ».
- **Y a-t-il une application mobile ?** Non : le site s'adapte aux téléphones.
- **Qui contacter si la documentation ne répond pas ?** L'administrateur du service d'AiTools.

## Claude ignore la méthode attendue ou la réponse sort du cadre
Les fiches de méthode (voir « Savoir-faire de Claude dans AiTools ») sont des repères : la consigne de la tâche dans « Réglages → Prompts IA » l'emporte en cas de contradiction.
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
- **« La dernière demande à Claude a échoué »** : la réponse de Claude était inutilisable ou ton compte Claude n'est pas relié (voir « Relier Claude »). Rien n'a été modifié : clique de nouveau sur **Générer un modèle de document** (ou sur **Relancer la préparation** après la validation du devis).
- **Les prix des exemples sont faux** : sans « Tes tarifs habituels », ce sont des prix d'exemple. Renseigne tes tarifs, puis **Recommencer depuis le début**, ou utilise « Affiner avec Claude » pour les corriger.
- **« Tes documents sont prêts » a disparu** : tu as affiné un document, il repasse à « À valider ». Valide-le de nouveau.
- **Un projet n'apparaît pas** : la page n'affiche que les projets de ton compte.
- **Rien n'est prérempli** : Claude n'a rien trouvé d'écrit dans le dépôt (pas de mentions légales, de contact ou de tarifs) ou l'analyse date d'avant cette fonction. Clique **Réanalyser** dans la « Fiche projet », ou remplis à la main : la première fois suffit, les autres projets reprennent ton identité (« Repris d'un autre de tes projets »).
- **Une valeur préremplie est fausse** : corrige-la avant **Enregistrer les informations** ; Claude peut se tromper de société si le dépôt en cite plusieurs.
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

## « Analyse en échec : Secret de liaison illisible : relie de nouveau ton accès Claude »
Le serveur ne peut pas déchiffrer ton accès Claude : le plus souvent, l'administrateur a changé la clé de chiffrement (`SECRET_KEY`) après ta liaison. La fenêtre « Claude est déconnecté » apparaît alors : clique sur **Reconnecter Claude** et relie de nouveau ton accès (jeton d'abonnement ou clé API), puis relance l'analyse. Rien d'autre n'est perdu.

## La fenêtre « Claude est déconnecté » s'affiche
Claude a refusé ton accès (jeton expiré ou révoqué, clé API supprimée). Clique sur **Reconnecter Claude** pour relier un nouvel accès ; **Plus tard** ferme simplement la fenêtre.

## Le mail de prospection ne contient pas le lien de mon site
Renseigne l'adresse dans **En-tête → Site du produit** (puis **Enregistrer le site**), clique sur **Générer avec l'IA** dans « Modèle de mail » : le nouveau texte contient `{{site}}`, remplacée à l'envoi par ton adresse. Un modèle déjà généré avant cela n'a pas `{{site}}` : régénère-le, ou ajoute toi-même `{{site}}` dans le corps, puis **Valider le modèle** de nouveau. L'**Aperçu** montre le lien tel qu'il partira.

## « Modèle à corriger avant validation » ou une virgule en début de ligne dans le mail
Le bouton **Valider le modèle** refuse un modèle cassé : variable inconnue ou mal fermée (`{{site` sans les deux accolades), ligne qui commence par une virgule ou un point-virgule. Corrige la ligne indiquée (le message donne son numéro), puis valide de nouveau. Une virgule en début de ligne vient souvent d'une variable vide, par exemple `{{expediteur}}, MonProduit` sans **Nom expéditeur** réglé : renseigne le **Nom expéditeur** dans **Configuration du projet → SMTP**, ou mets la variable et le nom du produit sur deux lignes. À l'envoi et dans l'aperçu, ces restes sont de toute façon retirés. Si **Générer avec l'IA** dit « la relecture n'a pas pu être faite », relis le mail toi-même avant de le valider.

## « Modèle en échec : Expected property name or '}' in JSON … »
Claude avait cité une variable (comme `{{site}}`) dans une phrase avant de donner le mail, et l'application a pris cette accolade pour le début du mail. C'est corrigé : l'application ignore maintenant ce qui n'est pas du JSON valide et retient le vrai mail. Si tu vois encore ce message, clique de nouveau sur **Générer avec l'IA** : Claude répond un peu différemment à chaque fois.

## L'Objet B est vide après « Générer avec l'IA »
Claude n'a pas proposé de second objet, ou l'a rendu identique à l'objet A : il n'y a alors pas de test A/B. Clique de nouveau sur **Générer avec l'IA**, ou écris toi-même l'**Objet B** (les envois alternent ensuite entre A et B ; le taux de réponse de chaque objet s'affiche sous le bouton Envoyer).

## Mon choix de modèle (Haiku, Sonnet, Opus) n'a pas l'air pris en compte
1. Vérifie qu'il est enregistré : après **Enregistrer les réglages**, le message « Réglages enregistrés » s'affiche et la liste montre ton choix quand tu rouvres les Réglages.
2. Le modèle s'applique aux tâches lancées **après** l'enregistrement : une tâche déjà en cours garde le sien.
3. Regarde le **modèle réellement utilisé** dans le menu **Activité** (pastille à côté du nom du job) ou, sur le projet, dans la zone de la tâche (« Modèle : … »).
4. Chaque tâche suit son réglage : **prospection** (recherche de prospects et accroches), **analyse de projet** (analyse du dépôt), **rédaction** (modèles de mail et relances, relecture, posts LinkedIn, devis…). Le modèle de la page IA se règle dans la page IA.

## Le mail propose une démonstration (ou un essai, un rendez-vous…) qui n'existe pas
Claude n'a le droit de proposer que ce que la fiche projet dit exister, et l'**Aperçu** avertit quand le mail parle d'une démonstration, d'un essai, d'un devis, d'un appel, d'un rendez-vous ou d'une garantie absents de la fiche. Si ton modèle a été généré avant ce contrôle, clique de nouveau sur **Générer avec l'IA** puis **Valider le modèle**, ou retire la phrase à la main. Si la proposition existe vraiment (une démonstration, par exemple), ajoute-la d'abord à la fiche projet en relançant **Réanalyser** après l'avoir écrite dans le dépôt (par exemple dans le README).

## « LinkedIn a refusé la connexion »
Le message précise maintenant la cause : produits manquants dans l'application LinkedIn (« onglet Produits »), adresse de retour non déclarée (« onglet Auth → URL de redirection autorisées »), identifiants de l'application faux, ou compte sans droit sur la page. Suis le remède indiqué dans le message, puis recommence la connexion depuis le projet. Les détails sont dans « LinkedIn » (Problèmes fréquents).

