# Configuration du projet : SMTP, boîte IMAP, base de données
Résumé : les trois formulaires de « Configuration du projet » (SMTP d'envoi, boîte de réception IMAP, base de données du récapitulatif), leurs champs, et les erreurs fréquentes.

La section **Configuration du projet** est réservée au propriétaire et aux administrateurs du projet. Les mots de passe sont chiffrés et jamais réaffichés (un champ vide avec « •••••• (inchangé) » signifie qu'un mot de passe est déjà enregistré).

## SMTP d'envoi de ce projet
Chaque projet envoie les mails de prospection et les relances **depuis sa propre adresse** (une boîte par projet). Les mails d'AiTools (rapport hebdomadaire, évolutions, invitations) partent, eux, du serveur d'AiTools.
Champs : **Hôte** (par exemple smtp.exemple.fr), **Port** (587 par défaut), **Utilisateur**, **Mot de passe**, **Email expéditeur**, **Nom expéditeur**, **Plafond mails / 24 h (max 200)**. Bouton **Enregistrer SMTP**.
Sans SMTP, la mention « Aucun SMTP : renseigne celui de l'adresse d'envoi de ce projet » s'affiche et rien ne peut partir.

## Boîte de réception (IMAP)
Sert à détecter les réponses et les adresses invalides. Champs : **Hôte IMAP** (vide = désactivé), **Port** (993 par défaut), **Utilisateur** (vide = identique au SMTP), **Mot de passe** (vide = identique au SMTP). Bouton **Enregistrer et tester**.

## Base de données (récapitulatif)
Sert à alimenter l'onglet **Récapitulatif** avec les chiffres business du produit (utilisateurs, clients payants, revenu). Utiliser un compte en **lecture seule** ; chaque requête doit renvoyer **un seul nombre**.
Champs : **Type** (MySQL / MariaDB ou PostgreSQL), **Hôte**, **Port**, **Base**, **Utilisateur**, **Mot de passe**, case **SSL**, puis trois requêtes : **Nb utilisateurs** (par exemple `SELECT COUNT(*) FROM users`), **Nb clients payants**, **Revenu total (€)**. Bouton **Enregistrer BDD**. Les données business commencent le jour de la configuration : l'historique ne peut pas être reconstitué avant.

## Sécurité des adresses saisies
Les hôtes saisis (SMTP, IMAP, base, serveurs Git) sont vérifiés : les adresses internes ou privées sont refusées, et la connexion se fait sur l'adresse vérifiée.

## Erreurs fréquentes
- **Impossible de se connecter au SMTP** : vérifier l'hôte, le port (587 STARTTLS ou 465 SSL selon le fournisseur), l'utilisateur (souvent l'adresse mail complète) et le mot de passe (parfois un « mot de passe d'application »).
- **Les mails arrivent en spam** : configurer SPF, DKIM et DMARC pour le domaine d'envoi, envoyer de petits lots au début et faire monter progressivement le volume.
- **IMAP : « Enregistrer et tester » échoue** : mêmes vérifications ; l'hôte IMAP n'est souvent pas le même que l'hôte SMTP.
- **Récapitulatif vide** : la base n'est pas configurée, ou une requête ne renvoie pas un seul nombre.
