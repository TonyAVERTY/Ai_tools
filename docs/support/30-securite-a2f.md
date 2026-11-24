# Sécurité : l'authentification à deux facteurs (A2F)
Résumé : activer l'A2F dans Mon compte, se connecter avec un code, utiliser et renouveler les codes de secours, désactiver l'A2F, et que faire si on perd son téléphone.

## À quoi ça sert
La connexion se fait avec Google ou Apple, sans mot de passe. L'A2F ajoute un second contrôle : après le retour de Google ou d'Apple, iaboss demande un **code à 6 chiffres** qui change toutes les 30 secondes et que seule ton application d'authentification connaît. Quelqu'un qui aurait accès à ton compte Google ou Apple ne peut donc pas entrer dans iaboss sans ton téléphone.

## L'activer (Mon compte → Sécurité : A2F)
1. Ouvre **Mon compte** (avatar → Mon compte), rubrique **Sécurité : A2F**, puis clique sur **Activer l'A2F**.
2. Dans ton application d'authentification (Google Authenticator, Authy, 1Password, Bitwarden…), **scanne le QR code** affiché. Tu ne peux pas scanner ? Clique sur **Clé de configuration** sous le QR code : une fenêtre affiche la clé avec un bouton **Copier**, à saisir dans l'application (type de clé : temporelle, 6 chiffres, 30 secondes). Sur téléphone, le lien « ouvre directement l'application » l'ajoute sans scanner.
3. Saisis le code que l'application affiche dans « Code à 6 chiffres », puis clique sur **Activer l'A2F**.
4. iaboss affiche alors **10 codes de secours**, une seule fois. Copie-les (bouton **Copier**) et range-les dans un gestionnaire de mots de passe, puis clique sur **J'ai conservé mes codes**.
Le bouton **Annuler** abandonne l'activation en cours (la clé affichée est effacée).

## Se connecter avec l'A2F
Après avoir choisi Google ou Apple, la page « Code de vérification » s'ouvre : saisis le code de ton application, puis **Valider**. Tu peux aussi saisir un code de secours (chaque code ne sert qu'une fois).
- Pour ne pas retaper le code à chaque connexion sur ton propre ordinateur, coche **Faire confiance à cet appareil pendant 30 jours** avant de valider : un cookie (voir la politique de confidentialité) dispense du code sur ce navigateur pendant 30 jours. Ne le fais jamais sur un ordinateur partagé.
- Un code ne marche qu'une fois : si tu viens de t'en servir, attends que l'application en affiche un nouveau.
- Après **5 codes erronés**, la connexion est annulée : il faut repasser par Google ou Apple. Au total, **10 codes** au plus sont acceptés à l'essai par compte et par tranche de 15 minutes (connexion, désactivation et codes de secours confondus), puis il faut attendre. Sans code valide en moins de 10 minutes, la connexion expire aussi.
- L'API (mode développeur) et le serveur MCP utilisent des jetons, pas ce code : l'A2F n'y change rien.

## Administrateurs
Un compte administrateur doit avoir activé l'A2F pour ouvrir la page **Administration** : sans elle, le lien renvoie vers Mon compte → Sécurité : A2F avec un message. L'exploitant du service peut lever cette exigence avec la variable `ADMIN_REQUIRE_MFA=false` (déconseillé en production).

## Les champs de code
Le champ « Code à 6 chiffres » n'accepte que des chiffres et **jamais plus de 6** : si tu tapes ou colles plus, le surplus est ignoré (tu peux coller « 123 456 » tel que ton application l'affiche). Pour utiliser un **code de secours**, clique sur **Utiliser un code de secours** sous le champ : il accepte alors 11 caractères (« xxxxx-xxxxx », chiffres et lettres de a à f). **Utiliser le code de mon application** te ramène au mode normal.

## Appareils de confiance
La carte indique « Appareils de confiance » : le nombre de navigateurs dispensés de code. **Oublier mes appareils de confiance** les retire tous (le code est redemandé partout). Désactiver l'A2F ou renouveler les codes de secours les oublie aussi.

## Codes de secours
La carte indique « Codes de secours restants : n sur 10 ». Pour en obtenir 10 nouveaux (les anciens cessent de marcher), saisis un code de ton application ou un code de secours dans le **même** champ **Code à 6 chiffres** (il sert aux deux actions : « Régénérer les codes de secours » et « Désactiver l'A2F »), puis clique sur **Régénérer les codes de secours**.

## La désactiver
Dans la même carte, saisis un code de ton application (ou un code de secours) dans le champ **Code à 6 chiffres** puis clique sur **Désactiver l'A2F** et confirme. Le compte n'est plus protégé que par Google ou Apple ; la clé et les codes de secours sont effacés.

## Téléphone perdu ou application effacée
Connecte-toi avec un **code de secours**, puis va dans Mon compte → Sécurité : A2F, désactive l'A2F et réactive-la avec ta nouvelle application. Si tu n'as plus de code de secours, écris au support du service depuis l'adresse de ton compte : sans code, personne ne peut lever l'A2F à ta place depuis l'application.
