# Sécurité : l'authentification à deux facteurs (A2F)
Résumé : activer l'A2F dans Mon compte, se connecter avec un code, utiliser et renouveler les codes de secours, désactiver l'A2F, et que faire si on perd son téléphone.

## À quoi ça sert
La connexion se fait avec Google ou Apple, sans mot de passe. L'A2F ajoute un second contrôle : après le retour de Google ou d'Apple, iaboss demande un **code à 6 chiffres** qui change toutes les 30 secondes et que seule ton application d'authentification connaît. Quelqu'un qui aurait accès à ton compte Google ou Apple ne peut donc pas entrer dans iaboss sans ton téléphone.

## L'activer (Mon compte → Sécurité : A2F)
1. Ouvre **Mon compte** (avatar → Mon compte), rubrique **Sécurité : A2F**, puis clique sur **Activer l'A2F**.
2. Dans ton application d'authentification (Google Authenticator, Authy, 1Password, Bitwarden…), ajoute un compte avec la **Clé de configuration** affichée (bouton **Copier**). Sur téléphone, le lien « ouvre directement l'application » l'ajoute sans rien taper. Type de clé : temporelle, 6 chiffres, 30 secondes.
3. Saisis le code que l'application affiche dans « Code à 6 chiffres », puis clique sur **Activer l'A2F**.
4. iaboss affiche alors **10 codes de secours**, une seule fois. Copie-les (bouton **Copier**) et range-les dans un gestionnaire de mots de passe, puis clique sur **J'ai conservé mes codes**.
Le bouton **Annuler** abandonne l'activation en cours (la clé affichée est effacée).

## Se connecter avec l'A2F
Après avoir choisi Google ou Apple, la page « Code de vérification » s'ouvre : saisis le code de ton application, puis **Valider**. Tu peux aussi saisir un code de secours (chaque code ne sert qu'une fois).
- Un code ne marche qu'une fois : si tu viens de t'en servir, attends que l'application en affiche un nouveau.
- Après **5 codes erronés**, la connexion est annulée : il faut repasser par Google ou Apple. Sans code valide en moins de 10 minutes, la connexion expire aussi.
- L'API (mode développeur) et le serveur MCP utilisent des jetons, pas ce code : l'A2F n'y change rien.

## Codes de secours
La carte indique « Codes de secours restants : n sur 10 ». Pour en obtenir 10 nouveaux (les anciens cessent de marcher), saisis un code de ton application puis clique sur **Régénérer les codes de secours**.

## La désactiver
Dans la même carte, saisis un code de ton application (ou un code de secours) puis clique sur **Désactiver l'A2F** et confirme. Le compte n'est plus protégé que par Google ou Apple ; la clé et les codes de secours sont effacés.

## Téléphone perdu ou application effacée
Connecte-toi avec un **code de secours**, puis va dans Mon compte → Sécurité : A2F, désactive l'A2F et réactive-la avec ta nouvelle application. Si tu n'as plus de code de secours, écris au support du service depuis l'adresse de ton compte : sans code, personne ne peut lever l'A2F à ta place depuis l'application.
