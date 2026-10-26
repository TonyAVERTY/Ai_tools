# Relier, tester et déconnecter son accès Claude
Résumé : les trois façons de relier Claude (clé API, abonnement, jeton), le risque de l'abonnement, les limites d'utilisation de la session de 5 h et de la semaine, et les erreurs courantes.

## Pourquoi
Toutes les tâches IA d'AiTools (analyse, recherche, rédaction, page IA, support, vidéos) tournent avec **le Claude de la personne**. Elle paie Anthropic directement ; AiTools ne facture pas l'IA. Le secret (clé ou jeton) est chiffré, utilisé seulement pour ses propres jobs, et n'est jamais réaffiché (seuls les 4 derniers caractères d'une clé API le sont).

## Les trois façons de relier (page « Relier Claude »)
La page met en avant la **Clé API Anthropic** (badge « Recommandée », champ et bouton sur une ligne). En dessous, un bloc « Avec ton abonnement Claude (Pro, Max) » porte le badge **Risque pour ton compte** et regroupe les deux autres façons, chacune sur sa ligne : **Se connecter avec Claude** et **Jeton collé à la main**. Si le service a désactivé la connexion par abonnement, seule la clé API est proposée.
1. **Clé API Anthropic (recommandée)** : crée une clé sur console.anthropic.com, colle-la dans « Clé API » puis clique **Vérifier et relier**. La vérification ne consomme pas de tokens. On paie à l'usage, directement chez Anthropic.
2. **Se connecter avec Claude** : utilise l'abonnement Claude (Pro, Max). Une fenêtre « Avant de continuer » avertit du risque ; coche « J'ai compris et j'accepte ce risque » puis **Continuer**. Un lien de connexion s'affiche : connecte-toi à Claude (**Ouvrir Claude**), recopie le code affiché dans « Code affiché par Claude », puis **Terminer la connexion**.
3. **Jeton collé à la main** (bouton « Coller un jeton ») : pour les cas où la connexion directe ne passe pas. Sur sa propre machine, lancer `claude setup-token`, se connecter, copier le jeton affiché, cocher la case d'acceptation du risque et le coller dans « Jeton d'abonnement », puis **Relier avec mon jeton**. La vérification lance un appel minimal : quelques tokens sont décomptés de l'abonnement.

## Le risque de l'abonnement
Utiliser un abonnement Claude (Pro, Max) à travers une application tierce peut contrevenir aux conditions d'utilisation d'Anthropic et entraîner la suspension ou la fermeture du compte Claude. AiTools ne peut en être tenu responsable. La clé API reste l'option recommandée. L'acceptation du risque est enregistrée avec sa date et la version du texte.

## Voir, tester, déconnecter (Avatar → Mon compte → « Liaison Claude »)
La carte affiche : le **Mode** (clé API ou abonnement), l'**État** (« Valide » ou « À revalider »), la date de liaison, les 4 derniers caractères d'une clé API, et la date d'acceptation du risque pour un abonnement. Elle contient aussi les **Limites d'utilisation** et un seul bouton : **Déconnecter**.
- **Déconnecter** efface le secret chiffré et annule les jobs IA en attente ou en cours. Pour changer de mode ou de clé, on se déconnecte puis on relie de nouveau (la page « Relier Claude » remplace l'accès précédent).
- État « À revalider » : le secret a été refusé (clé révoquée, jeton expiré…). Déconnecte puis relie Claude.

## Limites d'utilisation de Claude (carte « Liaison Claude »)
Avec un **abonnement**, la carte montre deux barres : **Session de 5 h** et **Semaine de 7 jours**, avec le pourcentage utilisé et l'heure de remise à zéro. Orange à partir de 80 %, rouge à 100 %.
- « Relevé en direct chez Anthropic » : compte tout l'usage de Claude, y compris hors AiTools (claude.ai, Claude Code).
- Sinon : « Dernière mesure faite pendant un job AiTools », avec la raison du repli (Anthropic limite les relevés, refuse le relevé avec ce jeton, ne répond pas, etc.).
- Avec une **clé API** : il n'y a pas de limite de session ni de semaine, Anthropic facture ce qui est consommé.
- La même mesure s'affiche dans la ligne d'état sous la barre du haut (« Claude session 5h », « Claude semaine »).
- Quand le quota est serré (au-delà de 85 %), les jobs non urgents (analyse, évolutions) attendent en file et repartent seuls ; la prospection et les envois continuent. Une alerte part à 80 % puis 95 % si un canal de notification est configuré.

## Erreurs courantes
- « Not logged in » / « Invalid bearer token » : le jeton est expiré ou révoqué → Déconnecter puis relier.
- « Claude usage limit reached » : le quota du compte Claude est atteint → attendre la remise à zéro indiquée.
- « Anthropic limite les relevés : nouvel essai dans une minute » : seulement l'affichage des limites, rien n'est cassé.
- Aucun job IA ne démarre : vérifier « Mon compte → Liaison Claude → État ».
