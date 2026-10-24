# Sécurité, isolation des données et confidentialité
Résumé : comment AiTools protège les secrets et l'isolation entre comptes, ce que Claude peut lire, la conformité des mails (RGPD, désinscription) et où lire la politique de confidentialité.

## Isolation des comptes
Toutes les données (projets, prospects, mails, conversations, vidéos, réglages) sont rattachées à un compte : un autre compte ne peut ni les voir ni les modifier (il reçoit « introuvable »). Un membre d'équipe ne voit que les projets partagés avec lui.

## Secrets
Clé API ou jeton Claude, mots de passe SMTP/IMAP/base, tokens Git, liens de webhooks, jetons LinkedIn : **chiffrés** en base, jamais réaffichés (au plus les 4 derniers caractères d'une clé API) et jamais écrits dans les journaux. La connexion se fait par Google ou Apple : AiTools ne stocke aucun mot de passe de compte.

## Ce que Claude peut faire
- Claude s'exécute avec le compte de la personne dans un **bac à sable** : dossier de travail propre à chaque compte, aucun accès aux fichiers d'un autre compte, environnement assaini.
- Il lit le code d'un projet en **lecture seule** et ne modifie jamais le dépôt.
- La page IA et le Support n'ont aucun outil, sauf les outils de lecture (Read, Glob, Grep) sur ce que la personne joint, sur le projet joint, ou sur la documentation (Support).
- Les adresses saisies (SMTP, IMAP, base de données, serveurs Git) sont vérifiées : les adresses internes ou privées sont refusées.

## Protection des envois
- Désinscription en un clic dans chaque mail ; liste d'opposition commune ; un prospect n'est contacté qu'une fois ; plafonds et délais ; pause automatique si trop de rejets.
- La source publique de l'email est stockée et rappelée dans le pied de mail.
- Pas de suivi d'ouverture espion (ni pixel ni lien traqué).
- Les mails de prospection ne visent que des **adresses professionnelles publiées** par l'entreprise.

## Données personnelles
La personne qui utilise AiTools est responsable des prospects qu'elle contacte (elle est responsable de traitement pour ces données) ; AiTools est responsable de traitement pour les données de son compte. La suppression du compte efface tout (sauf la liste d'opposition commune, conservée pour respecter les oppositions). La **Politique de confidentialité**, les **Mentions légales** et les **CGU** sont accessibles depuis le pied de page du site public ; elles détaillent les données collectées, leurs durées de conservation et les destinataires (dont Anthropic, via l'accès Claude de la personne).

## Bonnes pratiques
- Préférer la **clé API** à l'abonnement Claude (voir le risque dans le fichier sur la liaison Claude).
- Utiliser des tokens Git en lecture seule et limités aux dépôts voulus.
- Un compte d'accès à la base du récapitulatif en lecture seule.
- Ne jamais coller une clé, un jeton ou un mot de passe dans une conversation (y compris avec le Support) : s'il a été collé, le révoquer et en créer un nouveau.
