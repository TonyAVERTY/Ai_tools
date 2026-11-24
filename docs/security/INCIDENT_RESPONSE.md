# Procédure de gestion des incidents de sécurité

Date : 24 novembre 2026. À lire **avant** d'en avoir besoin. Un incident est tout événement qui compromet ou risque de compromettre la confidentialité, l'intégrité ou la disponibilité des données ou du service.

## 1. Les 5 premières minutes (garder son calme, ne rien effacer)

1. **Noter l'heure** à laquelle tu as pris connaissance de l'incident : c'est le point de départ du délai de 72 heures de la CNIL.
2. **Ne rien supprimer** : ni journaux, ni fichiers suspects, ni compte. Copier les preuves (captures, journaux) dans un dossier hors du serveur.
3. **Contenir** (voir §3) sans éteindre le serveur si ce n'est pas nécessaire.
4. Ouvrir un fichier d'incident (date, ce qui est connu, ce qui a été fait, par qui).

## 2. Où chercher les faits

| Source | Commande ou lieu | Contient |
|---|---|---|
| Journal de sécurité | `pm2 logs iaboss --lines 2000 \| grep '"type":"security"'` | Événements `mfa_failed`, `mfa_locked`, `mfa_disabled`, `admin_mfa_required`, `login_failed`, `data_exported`, `account_deleted` : jamais de secret, numéro de compte et IP tronquée |
| Journal d'administration | Page Administration (en bas) ; table `admin_audit` | Actions d'administrateur (suspension, plan, suppression) |
| Erreurs | Alertes e-mail (`ERROR_ALERT_TO`) ; `pm2 logs iaboss --err` | Erreurs et arrêts du processus |
| Serveur web | Journaux Nginx / Cloudflare | Adresses IP, pages, codes de retour |
| Base | Table `sessions`, `api_tokens` (dernier usage), `trusted_devices` | Sessions et jetons actifs |

## 3. Actions de confinement selon le cas

| Situation | Actions immédiates |
|---|---|
| **Secret exposé** (clé, mot de passe, jeton commité, collé dans une conversation) | **Le révoquer et le remplacer, même si on pense qu'il n'a pas servi.** Mot de passe MySQL : le changer, mettre à jour `.env`, redémarrer. `SECRET_KEY` compromise : voir §5 (rotation lourde). Clé d'IA, jeton Stripe, webhook : à révoquer chez le fournisseur |
| **Compte utilisateur compromis** | Page Administration : **Suspendre** le compte (ferme ses sessions, arrête ses jobs). Demander à la personne de révoquer ses jetons d'API et de délier/rebrancher son IA. Si c'est un compte avec A2F : désactiver et réactiver après vérification de l'identité |
| **Compte administrateur compromis** | Retirer l'adresse de `ADMIN_EMAILS`, redémarrer ; changer le mot de passe du fournisseur de connexion ; relire le journal d'administration ; considérer que **tous** les comptes ont pu être touchés |
| **Fuite de la base ou d'une sauvegarde** | Changer le mot de passe MySQL ; vider les sessions (`DELETE FROM sessions`) ; vérifier que les sauvegardes sont chiffrées (si oui, la clé privée est-elle en lieu sûr ?) ; les secrets en base sont chiffrés mais **la fuite de `SECRET_KEY` avec la base les expose** |
| **Intrusion sur le serveur** | Isoler la machine du réseau si possible ; ne pas la nettoyer avant d'avoir copié les preuves ; restaurer depuis une sauvegarde saine sur une machine propre ; renouveler **tous** les secrets |
| **Abus d'envoi (spam depuis un compte)** | Suspendre le compte ; l'application met déjà en pause les envois quand trop de mails sont rejetés ; informer l'utilisateur |
| **Attaque par déni de service** | Cloudflare : mode « Under Attack », règle de rate limiting ; `pm2 logs` pour repérer l'adresse ; ne pas augmenter les limites de l'application |

## 4. Violation de données personnelles : faut-il notifier ?

Une **violation de données personnelles** = destruction, perte, altération, divulgation ou accès non autorisé à des données personnelles.

1. **Évaluer le risque** pour les personnes (quelles données, combien de personnes, chiffrées ou non, déjà exploitées ?). Les données de prospects sont des adresses professionnelles de tiers : leur divulgation est un risque à prendre au sérieux.
2. **Notification à la CNIL** : obligatoire **sauf si la violation n'est pas susceptible d'engendrer un risque** pour les droits et libertés des personnes ; délai : **72 heures maximum après la prise de connaissance** (art. 33 du RGPD). Se fait en ligne sur le site de la CNIL (téléservice de notification). Si tout n'est pas connu à 72 heures, notifier en deux temps.
3. **Information des personnes concernées** si le risque est **élevé** (art. 34).
4. **Information des clients** : les utilisateurs d'iaboss sont responsables de traitement pour les données de leurs prospects ; en tant que sous-traitant, **les prévenir sans délai** pour qu'ils puissent remplir leurs propres obligations.
5. **Registre des violations** (art. 33(5)) : consigner **toutes** les violations, notifiées ou non : faits, effets, mesures prises.

`[À COMPLÉTER : modèle de courrier d'information aux utilisateurs, validé par un juriste]`

## 5. Rotation de `SECRET_KEY` (cas grave)

`SECRET_KEY` chiffre les secrets stockés en base (clés d'IA, SMTP des projets, jetons). La changer rend les anciens illisibles : **les utilisateurs devront reconnecter leur IA, leur SMTP, leurs canaux**. À ne faire qu'en cas de compromission avérée : 1) sauvegarder ; 2) changer la valeur dans `.env` ; 3) redémarrer ; 4) informer les utilisateurs ; 5) leur demander de ressaisir leurs secrets (l'application affiche « illisible, à ressaisir »).

## 6. Demandes d'exercice de droits (RGPD)

| Étape | Délai |
|---|---|
| Accusé de réception (e-mail à l'adresse de contact de la politique de confidentialité) | Immédiat |
| Vérifier l'identité (la demande doit venir de l'adresse du compte, ou preuve équivalente) | Avant d'agir |
| Accès / portabilité : indiquer Mon compte → « Télécharger mes données » ; envoyer les **fichiers** (justificatifs, pièces jointes) sur demande | Sous un mois |
| Effacement : indiquer Mon compte → suppression ; pour un tiers (prospect), l'inscrire à la liste d'opposition et transmettre à l'expéditeur | Sous un mois |
| Conserver la demande et la réponse | 3 ans |

## 7. Signalement d'une vulnérabilité par un tiers

L'adresse de contact des mentions légales sert aussi de point de signalement. Répondre sous 5 jours ouvrés, corriger, remercier. `[À COMPLÉTER : fichier /.well-known/security.txt à publier avec l'adresse et la politique de divulgation]` (décision de l'éditeur).

## 8. Après l'incident

Rédiger le retour d'expérience (cause, détection, délai, mesures), ouvrir les corrections dans `SECURITY_ACTION_PLAN.md`, ajouter le test qui aurait détecté le problème, mettre à jour `SECURITY_CHANGELOG.md`.
