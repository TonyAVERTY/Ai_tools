# Réponses, statuts des prospects et CRM
Résumé : détection des réponses par IMAP, les statuts d'un prospect, liste et Kanban, filtres, fiche prospect (prochaine action, notes, historique), import et export CSV.

## Détecter les réponses (boîte IMAP)
Dans « Configuration du projet → Boîte de réception (IMAP) », renseigne l'hôte (vide = désactivé), le port, l'utilisateur et le mot de passe (vides = mêmes identifiants que le SMTP), puis **Enregistrer et tester**. iaboss lit la boîte toutes les 15 minutes, et à la demande avec **« Vérifier maintenant »** (dans la section Envoi).
- Une réponse fait passer le prospect en **« A répondu »**. Elle est rattachée par le fil de discussion, puis par l'adresse, puis par le domaine professionnel s'il est unique.
- Les absences, réponses automatiques et newsletters sont ignorées.
- Les mails rejetés (bounces) passent le prospect en **« Rejeté »** et l'adresse en liste d'opposition.
- Aucun token d'IA n'est consommé pour lire la boîte.

## Les statuts d'un prospect
**À contacter**, **Contacté**, **A répondu**, **Client**, **Refus**, **Rejeté**, **Adresse invalide**.
Marquer un prospect en **Refus** ajoute son adresse à la liste d'opposition (une confirmation est demandée).

## La liste des prospects (onglet Prospection → Prospects)
- Deux affichages, en haut à droite du titre **Prospects** : **Liste** et **Kanban**, avec le bouton **Ajouter un prospect** à côté.
- Des **puces** filtrent d'un clic : **Tous 48**, **À contacter 22**, **Contacté 21**, **A répondu 3**, **Actions à faire 1** (prospects dont la prochaine action est due). Les nombres comptent tout le projet, quels que soient les autres filtres.
- **Recherche** (champ « Rechercher ») par entreprise, email, ville ou secteur.
- **Plus de filtres** (replié) : la liste des **statuts** (tous, y compris Client, Refus, Rejeté), le **score minimum** (≥ 5, ≥ 7, ≥ 9), la case **« Actions à faire »** et le **tri** (score, plus récents, dernier contact, entreprise A → Z). Pagination par 100 ; sous la liste, « 1 à 4 sur 48 », **Exporter (CSV)** et **Importer un CSV**.
- Le tableau montre, pour chaque prospect : **Entreprise** (avec son email), **Ville**, **Score** (surligné en jaune à partir de 9), **Statut** (un menu : on le change d'un clic, avec la date du dernier envoi dessous) et **Prochaine action** (avec « À faire » quand elle est due). Sur téléphone, la ville et la prochaine action passent dans la fiche.
- **Kanban** : une colonne par statut ; on glisse une carte pour changer son statut, ou on utilise le menu de statut de la carte (au clavier). Une carte montre l'entreprise, l'email, la ville, le score et la prochaine action. Les filtres (les pastilles « Tous », « À contacter », « Contacté », « A répondu », « Actions à faire », la recherche) s'appliquent aussi au Kanban : quand ils ne laissent aucun prospect, le tableau le dit (« Aucun prospect ne correspond à ces filtres ») et **Voir tous les prospects** les retire. Si le Kanban paraît vide, regarde d'abord quelle pastille est sélectionnée. Chaque colonne montre **3 cartes** au départ ; **Voir +** (avec le nombre de cartes restantes) en affiche 3 de plus, et le bouton disparaît quand il n'y en a plus. La colonne garde la même hauteur et défile avec sa barre de défilement. Le nombre de cartes affichées est conservé quand tu changes un statut, et remis à 3 quand tu changes de filtre.

## Ajouter un prospect à la main
Dans l'onglet **Prospection → Prospects**, bouton **Ajouter un prospect** : un formulaire s'ouvre sous les boutons de la liste. Champs : **Email** (obligatoire), **Entreprise** (si elle est vide, c'est le domaine de l'adresse qui est utilisé), **Site**, **Ville**, **Secteur**, **Score (1 à 10)**, **Accroche** (la phrase qui ouvre le mail) et **Origine de l'adresse** (où tu l'as trouvée ; si elle est vide, iaboss écrit « Ajout manuel du JJ/MM/AAAA » : l'origine d'un contact est toujours renseignée, pour le RGPD). Clique **Ajouter le prospect** (ou **Annuler** pour refermer le formulaire). Dans la vue **Liste**, la ligne du nouveau prospect est surlignée un instant et amenée à l'écran si elle était cachée (elle peut être sur une autre page de la liste selon le tri choisi : cherche-la par son nom).
- Le prospect est créé avec le statut **À contacter**. Il apparaît tout de suite dans la liste et le Kanban.
- Il est refusé si l'adresse est invalide, si le site n'est pas une adresse web correcte, si le score n'est pas un nombre de 1 à 10, **si l'adresse existe déjà dans ce projet** ou **si elle ne doit pas être contactée** (liste d'opposition). Dans les deux derniers cas le message est volontairement le même : « Cette adresse ne peut pas être ajoutée » ; la liste d'opposition étant commune à tous les comptes, iaboss ne révèle jamais pourquoi.
- Le plafond de **prospects** de l'offre s'applique (voir « Offres, plafonds et limites ») : une fois atteint, l'ajout est refusé avec un message.
- Les membres d'une équipe peuvent ajouter des prospects sur les projets partagés.

## La fiche d'un prospect
Un clic sur le nom de l'entreprise ouvre la **page de la fiche** (`/p/<projet>/contact/<contact>`, avec un fil d'Ariane « Projets › nom du projet › entreprise » pour revenir) au lieu d'une fenêtre. Elle montre en haut les boutons **Répondre** (ouvre ton logiciel de mail), **Passer en client** et **Faire un devis** (ouvre la Facturation du projet), puis « Dernière réponse » (quand le prospect évoque une date ou un appel, le même volet que dans Mails propose **Ajouter à mon calendrier**, avec un titre et une date à corriger), « Échanges » (la chronologie : réponse, lecture, mails envoyés, notes, premier repérage ; **Voir le mail envoyé** et **Voir la réponse** déplient le texte exact, et un prospect « Rejeté » affiche la raison du rejet ; bouton **Ajouter une note**), « Prochaine action », « Accroche » et « Informations ». La fiche contient : accroche et origine de l'email (avec les boutons **Générer une accroche** / **Régénérer l'accroche**), **Informations** (voir ci-dessous), **Historique** (premier mail avec sa variante A/B, relance, réponse, échecs d'envoi), **Prochaine action** (champs « Quoi » et « Quand », boutons **Enregistrer** et **Effacer**, un rappel à 9h heure de Paris alimente le filtre « Actions à faire ») et **Notes** libres (**Ajouter la note**). Bouton **Fermer** pour revenir.

### Modifier les informations d'un prospect
Dans la fiche, la section **Informations** contient tous les champs : **Entreprise** (obligatoire), **Email**, **Site**, **Ville**, **Secteur**, **Score (1 à 10)**, **Accroche** et **Origine de l'adresse**. Modifie ce que tu veux puis clique **Enregistrer les informations** : la liste se met à jour. Un champ vidé est effacé.
- **L'adresse email ne se change que tant que le prospect est « À contacter »** : une fois contacté, des mails, des relances et des réponses sont rattachés à cette adresse, elle est donc verrouillée (champ en lecture seule, avec une explication). Pour une autre adresse, ajoute un nouveau prospect.
- La nouvelle adresse est refusée si elle existe déjà dans le projet ou si elle ne doit pas être contactée (même message que pour l'ajout).
- Le statut se change depuis la liste ou le Kanban (menu de statut ou glisser-déposer), la prochaine action et les notes ont leurs propres blocs dans la fiche.

### Supprimer un prospect
Dans la fiche, en bas, bouton **Supprimer ce prospect** : une confirmation est demandée. Le prospect et ses **notes** sont supprimés définitivement. Les mails déjà envoyés **restent dans la page Mails** (journal d'envoi), simplement détachés du prospect. Supprimer ne met pas l'adresse en liste d'opposition : pour ne plus jamais la contacter, passe plutôt le prospect en **Refus**. Les membres d'une équipe peuvent supprimer des prospects sur les projets partagés.

## Exporter en CSV
Lien **Exporter (CSV)** : format Excel français (séparateur `;`, UTF-8 avec BOM). L'export reprend les filtres affichés. Les cellules qui commencent par `=`, `+`, `-` ou `@` sont neutralisées pour qu'Excel ne les exécute pas.

## Importer un CSV
Bouton **Importer un CSV** : 2000 lignes au plus. Colonnes reconnues (en français ou en anglais) : entreprise, email, site, ville, secteur, score, source, accroche. L'encodage UTF-8 ou Windows-1252 est détecté (les fichiers d'Excel passent tels quels). Les doublons et les adresses en liste d'opposition sont ignorés ; un rapport ligne par ligne s'affiche. L'origine de chaque contact est toujours renseignée (« Import CSV du JJ/MM/AAAA » par défaut), pour le RGPD.

## Liste d'opposition (Réglages → Liste d'opposition)
Une personne qui se désinscrit, refuse ou dont l'adresse est invalide n'est plus jamais contactée ni proposée, quel que soit le compte ou le projet. La liste est commune à tous les comptes et personne ne peut la consulter : on ne voit que le statut de ses propres prospects. Elle subsiste après la suppression d'un compte.
