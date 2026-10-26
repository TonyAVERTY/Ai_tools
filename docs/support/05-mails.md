# Mails : modèle, envoi par lots, relance, page Mails, garde-fous
Résumé : écrire et valider un modèle de mail, envoyer par lots avec les garde-fous, relance automatique dans le même fil, test A/B, page Mails (statuts), accusé de lecture et désinscription.

## Le modèle de mail (Prospecter → Modèle de mail)
- Boutons : **Générer avec l'IA** (Claude rédige à partir de la fiche et de la cible), **Enregistrer**, **Valider le modèle**. Seul un modèle **validé** peut être envoyé.
- Champs : **Objet**, **Objet B** (facultatif : active le test A/B, les envois alternent entre les deux objets) et **Corps**.
- Variables à insérer : `{{entreprise}}`, `{{ville}}`, `{{accroche}}`, `{{expediteur}}`. Le lien de désinscription est ajouté automatiquement (sauf si tu l'as retiré dans Réglages → Garde-fous, **Retirer le pied de page des mails**, avec ses risques) dans chaque mail.
- Après une modification, il faut **valider de nouveau** le modèle.
- **Aperçu** : le bouton **Aperçu** (à côté d'Enregistrer, dans le modèle de mail comme dans le modèle de relance) ouvre une fenêtre qui montre **exactement ce que le prospect recevra**, sans rien envoyer ni enregistrer (il utilise le texte en cours dans les champs, même non enregistré). On y voit : **De**, **À**, **Objet**, le mail mis en forme (onglet « Mail ») et sa **Version texte**. Le menu **Voir avec** permet de choisir un de tes prospects (ses vraies données, son vrai lien de désinscription) ou « Un exemple fictif ». Avec un « Objet B », les boutons **Objet A** / **Objet B** montrent chaque variante. Pour la relance, un objet vide s'affiche comme « Re: » + l'objet du premier mail. Des **avertissements** signalent ce qu'on ne voit pas toujours : variable inconnue (par exemple `{{nom}}`), accroche ou ville vide pour le prospect choisi, nom d'expéditeur ou adresse d'envoi non réglés. L'aperçu d'un projet exige que le corps du mail ne soit pas vide ; il se garde 15 minutes.
- **Test A/B** : le taux de réponse de chaque objet s'affiche sous le bouton Envoyer ; l'objet gagnant est annoncé dans le rapport hebdomadaire dès 10 envois par objet.

## Envoyer (Prospecter → Envoi)
1. **Mails à envoyer** : le nombre voulu (un lot fait 100 mails au plus).
2. Bouton **Envoyer** : une confirmation est demandée à chaque envoi.
3. L'envoi tourne en arrière-plan (« Activité ») : « Envoi terminé : N envoyé(s), M échec(s) ».
Conditions pour que ça parte : un **SMTP** enregistré dans « Configuration du projet », un **modèle validé**, des prospects « À contacter », un plafond mensuel de mails non atteint, pas de pause d'envoi.

## Garde-fous d'envoi
- **Plafond par projet sur 24 h** (champ « Plafond mails / 24 h », 200 au maximum) dans « Configuration du projet », et **plafond global sur 24 h** (300 au maximum) dans **Réglages → Garde-fous**. Un lot fait 100 mails au plus.
- **Délai aléatoire entre deux mails** : entre « Délai min » et « Délai max » (20 et 60 secondes par défaut), réglables dans Réglages → Garde-fous.
- **Un prospect n'est contacté qu'une seule fois.**
- **Liste d'opposition** : jamais de mail à une adresse désinscrite, en refus, ou invalide, quel que soit le projet.
- **Pause d'envoi** : si trop de mails sont rejetés, AiTools met les envois en pause pour protéger la réputation du domaine ; un bandeau rouge l'explique sur la page Projets, et une notification « Envois mis en pause » peut être reçue.
- **Désinscription** : chaque mail contient un lien de désinscription (et les en-têtes « List-Unsubscribe » en un clic). Un clic ajoute l'adresse à la liste d'opposition.

## Relance automatique (Prospecter → Relance automatique)
- Case **« Relancer une fois les prospects sans réponse »** et champ **« Après (jours) »** (7 par défaut), puis **Enregistrer**.
- Une seule relance par prospect, dans **le même fil** (« Re: » + objet du premier mail).
- Elle part seulement si : le modèle de relance est validé ; la boîte IMAP a été lue avec succès il y a moins de 2 heures (sinon on risquerait de relancer quelqu'un qui a répondu) ; on est en heures ouvrées, du lundi au vendredi de 9h à 18h (heure de Paris) ; les plafonds quotidiens ne sont pas atteints.
- Le **modèle de relance** a son propre bloc (« Modèle de relance » : Générer avec l'IA, Enregistrer, Valider le modèle). Variables : `{{entreprise}}`, `{{ville}}`, `{{expediteur}}`. Objet vide = « Re: » + objet du premier mail.

## La page Mails (barre du haut → Mails)
Deux vues : **Envoyés** et **Réponses**. Filtre par projet. Les statuts d'un mail : **Envoyé**, **Lu (accusé)**, **Répondu**, **Rejeté**, **Refus**, **Non envoyé**. Une barre de chiffres au-dessus de la liste donne le nombre de mails dans chaque état (et **Tous**) : un clic sur un chiffre filtre la liste, et les états d'échec (Rejeté, Refus, Non envoyé) passent en rouge dès qu'il y en a. Chaque ligne montre la date, le destinataire (entreprise et adresse), l'objet avec le projet et le type (Premier mail ou Relance), et l'état ; pour un mail **Non envoyé**, la cause de l'échec s'affiche sous l'état. Un mail préparé mais pas encore confirmé n'est pas compté comme envoyé. L'aide **Comment sont comptés « Lu » et « Répondu » ?** (en bas de la liste) détaille les deux points suivants. S'il n'y a encore rien, la page l'explique : **Ouvrir mes projets** mène à la section « Prospecter » d'un projet pour les envois, et **Régler la boîte de réception** à la configuration IMAP du projet pour les réponses. **Voir tous** réaffiche la liste quand un filtre ne donne aucun résultat.
- « Lu » vient de l'accusé de lecture standard, que le destinataire accepte ou non d'envoyer : c'est un minimum, jamais un « non lu ». Il n'y a volontairement aucun pixel espion ni lien traqué (délivrabilité et consentement RGPD).
- « Répondu » vient de la boîte de réception du projet (IMAP).
- Vue **Réponses** : chaque réponse est classée par intention. Pour une réponse qui propose un rendez-vous ou accepte un appel, un volet propose un titre et une date et un bouton **Ajouter à mon calendrier** (aussi **Google Agenda** et **Fichier .ics**), et une **réponse suggérée** à relire puis envoyer depuis sa propre messagerie.

## Accusé de lecture
Dans **Réglages → Garde-fous**, la case « Demander un accusé de lecture dans les mails de prospection » ajoute la demande standard d'accusé. La messagerie du destinataire lui demande s'il l'accepte.

## Problèmes fréquents
- **Le bouton Envoyer ne fait rien / refuse** : lire le message (SMTP manquant, modèle non validé, plafond atteint, pause d'envoi, aucun prospect « À contacter »).
- **Les mails partent mais arrivent en spam** : voir « Dépannage » (SPF, DKIM, DMARC, réchauffer l'adresse, lots modestes).
- **Erreur SMTP** : vérifier hôte, port, utilisateur, mot de passe (voir « Configuration du projet »).
