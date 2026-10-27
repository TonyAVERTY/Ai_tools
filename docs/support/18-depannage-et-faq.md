# Dépannage et questions fréquentes
Résumé : les problèmes les plus fréquents (liaison Claude, jobs bloqués, mails qui ne partent pas ou arrivent en spam, prospects, LinkedIn, vidéo, agenda) avec cause et solution, plus une FAQ.

## Je ne peux rien lancer, la page me renvoie à « Relier Claude »
La liaison Claude est absente ou invalide. Relier un accès (voir « Relier, tester et déconnecter son accès Claude »). État « À revalider » : Déconnecter puis relier de nouveau.

## Mon job reste « En attente »
Lire le message « En attente : … » dans le menu **Activité**. Raisons possibles : budget IA atteint (clé API) ; quota Claude serré (au-delà de 85 %) ; charge élevée du serveur ; job programmé « Cette nuit » ; déjà un job IA en cours pour le compte. Il repart seul. On peut l'**Annuler** depuis Activité.

## « Plafond atteint » ou refus de création
Un plafond mensuel de l'offre (projets, prospects, mails, jobs IA, places d'équipe) est atteint. Le compteur est dans « Mon compte → Usage du mois » ; les plafonds se renouvellent le 1er du mois. Voir « Offres, plafonds et limites » et la page Tarifs.

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
Relancer avec **Réanalyser**. Vérifier la liaison Claude, le quota Claude, et l'accès au dépôt.

## Je ne vois pas certaines sections ou certains boutons
Ils dépendent du rôle dans le projet : Configuration du projet, Audit, Récapitulatif, connexion LinkedIn et publication sont réservés aux administrateurs et au propriétaire ; supprimer un projet est réservé au propriétaire (voir le fichier sur les projets). Un membre d'équipe ne voit pas le SMTP ni l'IMAP.

## LinkedIn : « connexion expirée » ou Publier grisé
Cliquer **Reconnecter**. Publier grisé : aucune page choisie alors que le compte ne peut pas publier sur le profil (**Choisir une page**). Voir le fichier sur LinkedIn.

## La vidéo de promotion échoue
Lire le message du job : outils manquants sur le serveur (Chromium, ffmpeg), plafond de 20 vidéos, scène refusée après correction (relancer ou changer de modèle). Voir le fichier sur la Promotion.

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
- **Le montant à déclarer me semble faux** : le guide « Faire ma déclaration » ne compte que les « Paiement reçu » (moins les « Remboursement versé à un client ») dans la période. Vérifie la date des lignes (le jour de l'encaissement), le type et ta situation dans « Ma situation ».
- **Je ne sais pas si je suis micro-entrepreneur ou en société** : choisis « Je ne sais pas encore » puis « Faire ma déclaration » : le guide explique comment retrouver ton statut.
- **Les plafonds affichés ne sont pas les miens** : ce sont des valeurs de référence indiquées avec leur année ; vérifie sur service-public.fr.
