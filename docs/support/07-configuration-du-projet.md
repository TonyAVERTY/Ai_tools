# Configuration du projet : SMTP, boîte IMAP, base de données
Résumé : les trois formulaires de « Configuration du projet » (SMTP d'envoi, boîte de réception IMAP, base de données du récapitulatif, choisie sans écrire de requête), leurs champs, et les erreurs fréquentes.

La section **Configuration du projet** est réservée au propriétaire et aux administrateurs du projet. Les mots de passe sont chiffrés et jamais réaffichés (un champ vide avec « •••••• (inchangé) » signifie qu'un mot de passe est déjà enregistré).

## SMTP d'envoi de ce projet
Chaque projet envoie les mails de prospection et les relances **depuis sa propre adresse** (une boîte par projet). Les mails d'iaboss (rapport hebdomadaire, évolutions, invitations) partent, eux, du serveur d'iaboss.
Champs : **Hôte** (par exemple smtp.exemple.fr), **Port** (587 par défaut), **Utilisateur**, **Mot de passe**, **Email expéditeur**, **Nom expéditeur**, **Plafond mails / 24 h (max 200)**. Bouton **Enregistrer SMTP**.
Sans SMTP, la mention « Aucun SMTP : renseigne celui de l'adresse d'envoi de ce projet » s'affiche et rien ne peut partir.

## Boîte de réception (IMAP)
Sert à détecter les réponses et les adresses invalides. Champs : **Hôte IMAP** (vide = désactivé), **Port** (993 par défaut), **Utilisateur** (vide = identique au SMTP), **Mot de passe** (vide = identique au SMTP). Bouton **Enregistrer et tester**.

## Base de données (récapitulatif)
Sert à alimenter l'onglet **Récapitulatif** avec les chiffres business du produit (utilisateurs, clients payants, revenu). Utiliser un compte en **lecture seule**. **Tu n'écris aucune requête** : iaboss lit la structure de ta base, te propose les bonnes tables et affiche un aperçu des chiffres.

Étapes :
1. Remplis **Type** (MySQL / MariaDB ou PostgreSQL), **Hôte**, **Port**, **Base**, **Utilisateur**, **Mot de passe** et, si besoin, la case **SSL**.
2. Clique **Se connecter et analyser**. iaboss se connecte en lecture seule, repère les tables d'après leurs noms et leurs colonnes, et remplit trois listes : **Table des utilisateurs**, **Table des clients payants** et **Table des paiements**. La table qui lui paraît la bonne est **présélectionnée et marquée « (recommandé) »** ; les autres tables de ta base sont dans la liste, et **Ne pas suivre** désactive un chiffre.
3. Sous chaque liste, une phrase dit ce qui sera compté (par exemple « Compte les lignes de « subscriptions » dont « status » vaut « active » »). Pour les paiements, iaboss choisit la **Colonne du montant** (en écartant les taxes et les remises) et devine l'unité dans **Montants en** (euros ou centimes) : change-la si l'aperçu est faux.
4. Une ligne **Aperçu** montre les chiffres obtenus (« 5 utilisateurs · 2 clients payants · 197,00 € de revenu ») et se met à jour quand tu changes une liste.
5. Bouton **Enregistrer BDD**. Les données business commencent le jour de la configuration : l'historique ne peut pas être reconstitué avant.

Ce qui est lu : seulement le nom des tables et des colonnes, quelques valeurs de statut (pour reconnaître « active » ou « paid ») et des totaux (nombre de lignes, somme d'une colonne). Rien n'est modifié dans ta base. L'analyse repose sur les noms (« users », « utilisateurs », « subscriptions », « paiements »…) : si tes tables s'appellent autrement, aucune n'est recommandée et tu choisis toi-même dans la liste.

Un projet configuré avant avec des requêtes écrites à la main continue de fonctionner ; un message l'indique. Choisis tes tables pour les remplacer (elles passent alors avant).

## Sécurité des adresses saisies
Les hôtes saisis (SMTP, IMAP, base, serveurs Git) sont vérifiés : les adresses internes ou privées sont refusées, et la connexion se fait sur l'adresse vérifiée.

## Erreurs fréquentes
- **Impossible de se connecter au SMTP** : vérifier l'hôte, le port (587 STARTTLS ou 465 SSL selon le fournisseur), l'utilisateur (souvent l'adresse mail complète) et le mot de passe (parfois un « mot de passe d'application »).
- **Les mails arrivent en spam** : configurer SPF, DKIM et DMARC pour le domaine d'envoi, envoyer de petits lots au début et faire monter progressivement le volume.
- **IMAP : « Enregistrer et tester » échoue** : mêmes vérifications ; l'hôte IMAP n'est souvent pas le même que l'hôte SMTP.
- **Récapitulatif vide** : la base n'est pas configurée, ou une requête ne renvoie pas un seul nombre.
