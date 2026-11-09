# Les projets : cartes, pages à onglets, création, suppression
Résumé : tout sur les projets : la liste en cartes, la page d'un projet et ses neuf onglets (Vue d'ensemble, Prospection, Envoi, Clients, Facturation, Communication, Outils IA, Récapitulatif, Réglages du projet), la création, la réanalyse, la suppression et le partage.

## La page Projets
Barre du haut → **Projets** (adresse `/projets`). Une **carte** par projet (le tien, et ceux qu'une équipe partage avec toi, avec le badge « équipe de … ») :
- le nom, et l'état : **Prêt à prospecter** (tout ce qui est obligatoire est fait) ou **Mise en route 4 sur 6** avec une barre d'avancement et « Étape suivante : … » ;
- le dépôt ;
- **Prospects** (avec « n à contacter ») et **Réponses** (avec « dernier envoi : … ») ; sans prospect : « Aucun prospect pour l'instant » ;
- **À encaisser** : le total des factures de ce projet pas encore encaissées.
Un projet partagé par une équipe affiche « Facturation et Comptabilité restent celles de … ». Sous le titre, « 2 projets sur 2 avec ton offre Démarrage » dit combien de projets l'offre permet. Les plafonds du mois sont dans **Aujourd'hui** (« Ce mois-ci ») et dans **Mon compte → Usage du mois**.

## Créer un projet
Bouton **Nouveau projet** → champs **Nom**, **Dépôt Git** et **Site du produit (facultatif)** → **Créer et analyser** (ou **Annuler**). GitHub est accepté ; les autres serveurs Git doivent d'abord être ajoutés dans **Réglages → Dépôts Git** (avec un token pour un dépôt privé). Le site est demandé dès la création : il remplit `{{site}}` dans les mails (tu pourras le changer dans l'onglet **Réglages du projet**). Le lien du dépôt ne peut plus être modifié après la création : pour changer de dépôt, créer un nouveau projet. Si le plafond de projets de l'offre est atteint, la création est refusée avec un message.

## La page d'un projet : un onglet, une adresse
Clique une carte : la page du projet s'ouvre (adresse `/p/` suivie du numéro du projet). En haut : le fil d'Ariane (**Projets** › nom du projet), le nom, le dépôt, l'état (« Prêt à prospecter » ou « Mise en route 2 sur 9 »), la date de l'analyse et le bouton **Réanalyser** (**Analyser** tant que le projet ne l'est pas). Dessous, les onglets ; sur téléphone, ils deviennent la liste « Section : … ». Chaque onglet a **sa propre adresse**, que tu peux mettre en favori ou envoyer :

| Onglet | Adresse | Ce qu'il contient |
|---|---|---|
| **Vue d'ensemble** | `/p/N` | **Mise en route**, **Fiche projet**, les chiffres **Prospection** et la carte **En cours** |
| **Prospection** (avec le nombre de prospects) | `/p/N/prospection` | **Cible**, **Recherche de prospects**, **Prospects** (liste, Kanban, fiches, import et export CSV) |
| **Envoi** | `/p/N/envoi` | **Modèle de mail**, **Envoi** (avec la boîte de réception et le test A/B), **Relance automatique** |
| **Clients** | `/p/N/clients` | les clients du projet (voir « Clients : liste par projet, fiches, documents et échanges ») |
| **Facturation** | `/p/N/facturation` | les documents du projet (voir « Facturation : modèles de devis, d'acompte, de facture finale et d'avoir ») |
| **Communication** | `/p/N/communication` | **LinkedIn** (à gauche), **Promotion** et **Programmés** (les posts LinkedIn programmés, avec « Voir dans l'agenda ») à droite |
| **Outils IA** | `/p/N/outils` | un menu à gauche (**Évolution et audit**, puis les postes : **Direction**, **Commerce**… **Opérations et qualité**) ; à droite, **Évolution** et **Audit du projet**, ou les tâches du poste choisi |
| **Récapitulatif** | `/p/N/recap` | chiffres business, prospection et courbes (propriétaire et administrateurs) |
| **Réglages du projet** | `/p/N/reglages` | un menu à gauche (**Adresse d'envoi (SMTP)**, **Boîte de réception (IMAP)**, **Dépôt et site**, **Base de données**, **Partage**, **Zone de danger**) et les cartes correspondantes à droite |

Les sections d'un onglet sont déjà ouvertes : plus d'accordéon à déplier. Un membre d'équipe n'a pas les onglets Clients, Facturation, Récapitulatif et Réglages du projet. Le projet d'un autre compte, un numéro qui n'existe pas ou un onglet inconnu répondent « introuvable ». L'ancienne adresse `/projets/N` renvoie vers `/p/N`. Le bouton **Voir** du menu « Activité » et les liens de la page Aujourd'hui mènent au bon onglet.

## La vue d'ensemble
- **Mise en route** : ce qu'il reste à faire pour envoyer tes premiers mails, étape par étape, avec la barre « n étapes sur m ». Les étapes faites sont barrées ; la prochaine à faire a son numéro en jaune et un bouton (**Régler** pour le SMTP et l'IMAP, **Ouvrir** pour les autres) qui mène à l'onglet et à la section concernés. Voir « La liste de mise en route ».
- **Fiche projet** : le résumé écrit par l'analyse, sa date et son commit. Avant l'analyse : « Le dépôt n'est pas encore analysé ».
- **Prospection** : quatre chiffres cliquables : **Prospects**, **À contacter** (vers l'onglet Prospection), **Réponses** (vers Mails), **Clients** (vers l'onglet Clients).
- **En cours** : les tâches IA de ce projet en cours ou en attente, avec leur pourcentage ; sinon « Aucune tâche en cours. ». Le détail vit dans le menu **Activité**.

## Les sections, onglet par onglet
- **Cible** (badge « à valider » tant qu'elle n'est pas validée ; une fois validée, la coche verte de la section apparaît) : description, zone, taille, décideur, secteurs (1 par ligne), requêtes de recherche (1 par ligne) ; bouton **Valider la cible**. Une cible validée est grisée et en lecture seule : **Modifier** la déverrouille, **Mettre à jour** enregistre la nouvelle version, **Annuler** remet la cible validée. Elle n'existe qu'après l'analyse du projet.
- **Recherche de prospects**, **Prospects** : voir les fichiers sur la prospection et le CRM.
- **Modèle de mail**, **Envoi**, **Relance automatique** : voir le fichier sur les mails.
- **Évolution** : idées de fonctionnalités tirées du code, envoyées par mail. **Audit du projet** : rapport qualité et sécurité du code (propriétaires et administrateurs). **Postes et tâches IA** : les postes d'une entreprise (Commerce, Communication, Finance…) et les tâches que l'IA y fait. Voir « Évolution, Audit et Récapitulatif » et « Postes : les tâches IA d'une entreprise ». Le filtre « Poste » de l'ancienne page Projets n'existe plus : chaque poste a ses tâches dans l'onglet Outils IA.
- **LinkedIn** : relier un compte, faire écrire des posts, relire, programmer, publier. **Promotion** : générer une vidéo de design motion.
- **Récapitulatif** : chiffres business et courbes.
- **Dépôt et site** : « Dépôt Git, site du produit et fiche projet ». Le champ **Site du produit** (avec **Enregistrer le site**) reçoit l'adresse du site de ton produit, par exemple `https://monproduit.fr` : elle est ajoutée dans les mails de prospection à la place de `{{site}}` ; laisse le champ vide pour ne pas en mettre (propriétaire et administrateurs). Le dépôt (lecture seule) et la **Fiche projet** y sont aussi. Si une analyse échoue, le message d'erreur s'affiche en haut de la page du projet, avec **Réessayer**.
- **Configuration du projet** : SMTP, boîte de réception (IMAP) et base de données du récapitulatif, plus le bouton **Supprimer le projet** (réservé aux propriétaires et administrateurs).

## Supprimer un projet
Dans **Configuration du projet**, bouton **Supprimer le projet** : seul le propriétaire peut le faire. Cela efface le projet, ses prospects, ses modèles, ses vidéos de promotion et le clone du code. L'opération est irréversible. Les adresses en liste d'opposition y restent.

## Droits dans un projet partagé
- **Membre** : travaille sur les projets partagés (modèles, contacts, recherches, envois, notes), génère des posts LinkedIn et des vidéos de promotion.
- **Administrateur** : en plus, règle le projet (SMTP, boîte de réception, base du récapitulatif, LinkedIn), lance l'audit, supprime des vidéos.
- **Propriétaire** : gère l'équipe, partage et supprime les projets.
Les jobs d'un projet partagé tournent avec l'accès à l'IA du propriétaire.
