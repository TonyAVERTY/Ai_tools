# LinkedIn : relier un compte, écrire, programmer, publier
Résumé : la section LinkedIn d'un projet : connexion d'un compte, choix du profil ou d'une page, génération d'un post par Claude, relecture, programmation, publication et historique.

## Disponibilité
La section « LinkedIn » est dans chaque projet. Si le service n'a pas activé LinkedIn, elle dit : « LinkedIn n'est pas activé sur ce service : l'administrateur doit renseigner les clés de l'application LinkedIn ». Rien à faire côté utilisateur dans ce cas.

## Relier un compte
Bouton **Connecter LinkedIn** (réservé aux administrateurs du projet ; un membre doit demander à un administrateur). AiTools demande seulement le droit de **publier un post** sur le profil (et, si le service l'a activé, sur une page que la personne administre). Rien n'est jamais publié sans un clic de confirmation.
- Badge **connecté** ou **connexion expirée** avec la date de validité. Un compte expiré se reconnecte avec **Reconnecter** ; **Déconnecter** retire la liaison.
- **Publier sur** : le profil ou une page. Quand les pages sont disponibles, boutons **Choisir une page** / **Changer**. Si le compte ne peut pas publier sur le profil, il faut choisir une page. Dans « Où publier ? », on choisit **Mon profil** ou une page puis **Choisir** ; **Actualiser la liste** relit les pages administrées chez LinkedIn. Pour publier sur une page, il faut parfois **reconnecter LinkedIn** (nouvelle autorisation).

## Faire écrire un post
1. Le projet doit être analysé (sinon : « Analyse le projet d'abord »).
2. Champ **« De quoi doit parler le post ? »** (facultatif, 500 caractères) : laisse vide et Claude choisit un angle utile pour le public visé.
3. Bouton **Générer un post** (ou **Régénérer un autre post** : Claude change l'angle, l'accroche et la structure par rapport aux brouillons précédents).
Le post suit une structure : accroche seule sur sa ligne, courts paragraphes, question finale, 3 emojis et 3 hashtags au plus, sans inventer de chiffre ni de témoignage. Les consignes se modifient dans **Réglages → Prompts IA** (« Post LinkedIn »).

## Relire, programmer, publier
- **Brouillon (modifiable)** avec un compteur de caractères. Boutons **Enregistrer** (garde les modifications), **Copier** (copie le texte).
- **Publier sur …** : confirmation « Il sera visible publiquement par tout le monde » (réservé aux administrateurs). Le texte affiché est celui qui part.
- **Programmer la publication** : choisir une date et une heure (heure de Paris) puis **Programmer** (réservé aux administrateurs). Le post part tout seul, dans les 15 minutes qui suivent l'heure choisie. Un post programmé est en lecture seule : **Annuler la programmation** pour le modifier, ou **Publier maintenant**.
- En cas d'échec d'une publication programmée, le message d'erreur s'affiche sous le post.
- **Posts publiés** : l'historique, avec la date et l'endroit de publication.
- Les posts programmés apparaissent aussi dans le **Calendrier** et dans l'agenda externe.

## Problèmes fréquents
- Le bouton Publier est grisé : aucune page choisie alors que le compte ne peut pas publier sur le profil.
- « Connexion expirée » : cliquer **Reconnecter**.
- Un membre ne voit pas Connecter / Publier : réservé aux administrateurs du projet.
