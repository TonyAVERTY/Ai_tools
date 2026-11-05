# Relier, tester et déconnecter son IA (Claude, ChatGPT ou Gemini)
Résumé : choisir son IA (Claude, ChatGPT ou Gemini) sur la page « Relier mon IA », les façons de la relier (clé API, abonnement, compte), le risque de l'abonnement, la clé Gemini gratuite et ses limites de confidentialité, changer d'IA, les limites d'utilisation de Claude et les erreurs courantes.

## Pourquoi
Toutes les tâches IA d'AiTools (analyse, recherche, rédaction, page IA, support, vidéos) tournent avec **l'IA de la personne** : Claude (Anthropic), ChatGPT (OpenAI) ou Gemini (Google). Elle paie son fournisseur directement ; AiTools ne facture pas l'IA. Le secret (clé, jeton ou connexion) est chiffré, utilisé seulement pour ses propres jobs, et n'est jamais réaffiché (seuls les 4 derniers caractères d'une clé API le sont). Une seule IA est active par compte à la fois.

## Choisir son IA (page « Relier mon IA »)
La page montre trois cartes avec le logo de chaque IA : **Claude** (Anthropic), **ChatGPT** (OpenAI) et **Gemini** (Google). Chaque carte dit en une ligne comment s'y connecter. **Clique sur une carte** : les options de connexion de cette IA s'ouvrent en dessous. L'IA déjà reliée porte le badge « Connectée ». Une carte grisée « Pas encore disponible sur ce serveur » veut dire que l'administrateur n'a pas encore installé l'outil de cette IA : choisis-en une autre.
Quand on relie une autre IA, l'accès précédent est remplacé et son secret effacé. Les choix de modèle (analyse, prospection, rédaction, page IA) repartent alors du **modèle par défaut de la nouvelle IA** (les modèles ne sont pas les mêmes d'une IA à l'autre), et les consignes personnalisées de l'ancienne IA sont gardées, masquées, et reviennent si on revient à elle.

## Claude : les trois façons de relier
Dans la carte **Claude**, la page met en avant la **Clé API Anthropic** (badge « Recommandée », champ et bouton sur une ligne). En dessous, un bloc « Avec ton abonnement Claude (Pro, Max) » porte le badge **Risque pour ton compte** et regroupe les deux autres façons, chacune sur sa ligne : **Se connecter avec Claude** et **Jeton collé à la main**. Si le service a désactivé la connexion par abonnement, seule la clé API est proposée.
1. **Clé API Anthropic (recommandée)** : crée une clé sur console.anthropic.com, colle-la dans « Clé API » puis clique **Vérifier et relier**. La vérification ne consomme pas de tokens. On paie à l'usage, directement chez Anthropic.
2. **Se connecter avec Claude** : utilise l'abonnement Claude (Pro, Max). Une fenêtre « Avant de continuer » avertit du risque ; coche « J'ai compris et j'accepte ce risque » puis **Continuer**. Un lien de connexion s'affiche : connecte-toi à Claude (**Ouvrir Claude**), recopie le code affiché dans « Code affiché par Claude », puis **Terminer la connexion**. Pendant la préparation du lien (« Je prépare ton lien… ») puis la récupération du jeton (« Je récupère ton jeton… »), une barre avec un pourcentage s'affiche. C'est une **estimation** : elle monte selon la durée habituelle, reste sous 100 % tant que Claude n'a pas répondu (parfois plusieurs dizaines de secondes) et passe à 100 % dès que le jeton est reçu, car Claude ne donne pas d'avancement réel. Si elle disparaît avec un message d'erreur, le code a été refusé ou a expiré : recommence depuis le début.
3. **Jeton collé à la main** (bouton « Coller un jeton ») : pour les cas où la connexion directe ne passe pas. Sur sa propre machine, lancer `claude setup-token`, se connecter, copier le jeton affiché, cocher la case d'acceptation du risque et le coller dans « Jeton d'abonnement », puis **Relier avec mon jeton**. La vérification lance un appel minimal : quelques tokens sont décomptés de l'abonnement.

## ChatGPT : clé API ou compte ChatGPT
Dans la carte **ChatGPT** (OpenAI), même présentation que Claude.
1. **Clé API OpenAI (recommandée)** : crée une clé sur platform.openai.com/api-keys, colle-la dans « Clé API » puis clique **Vérifier et relier**. La vérification ne consomme pas de tokens. On paie à l'usage, directement chez OpenAI.
2. **Se connecter avec ChatGPT** : utilise ton compte ChatGPT (Plus, Pro, Business). Une fenêtre « Avant de continuer » avertit du risque ; coche « J'ai compris et j'accepte ce risque » puis **Continuer**. Un **lien** et un **code** s'affichent : clique **Ouvrir ChatGPT**, connecte-toi, saisis le code sur la page. Il n'y a rien à recopier dans AiTools : la fenêtre attend ta validation (« J'attends ta validation… »), se ferme toute seule et la connexion est enregistrée. Dans les paramètres de sécurité de ton compte ChatGPT, la **connexion par code d'appareil** doit être activée, sinon aucun lien ne s'affiche. Le lien et le code valent 15 minutes.
3. **Fichier de connexion collé** (bouton « Coller le fichier ») : pour les cas où la connexion directe ne passe pas. Sur sa propre machine, lancer `codex login`, se connecter, puis coller le contenu complet du fichier `~/.codex/auth.json` dans « Contenu du fichier de connexion », cocher la case d'acceptation du risque et cliquer **Relier avec mon fichier**.
La vérification d'un compte ChatGPT lance un appel minimal : quelques tokens sont décomptés de l'abonnement.
**Avec un compte ChatGPT, tes tâches passent l'une après l'autre** (une seule à la fois pour ton compte) : si tu en lances plusieurs, elles attendent leur tour au lieu de tourner ensemble. C'est voulu : ChatGPT renouvelle lui-même ta connexion et elle ne supporte pas deux usages en même temps. Elle peut te demander de te reconnecter de temps en temps, rarement.

## Gemini : clé API Google AI Studio
Dans la carte **Gemini** (Google), un seul mode : la **Clé API Google AI Studio**. Google ne permet plus de se connecter avec un compte pour ce type d'usage, il n'y a donc pas de connexion par compte. Crée une clé sur aistudio.google.com, colle-la dans « Clé API » et clique **Vérifier et relier** (la vérification ne consomme pas de tokens).
- **Une clé gratuite suffit pour essayer** : elle fonctionne avec les modèles Flash (par exemple Gemini 3.5 Flash-Lite), avec des limites quotidiennes fixées par Google. Elle ne donne pas accès aux modèles Pro ni à Gemini 4.
- **Avec une clé gratuite, Google peut utiliser les données envoyées pour améliorer ses produits, et des personnes peuvent les relire.** N'y mets pas de données de prospects (noms, adresses e-mail, sites). Pour un vrai usage, **active la facturation sur ton projet Google** : tes données ne sont alors plus utilisées pour améliorer ses produits. AiTools ne peut pas savoir si ta clé est gratuite ou payante : l'avertissement s'affiche toujours.

## Le risque de l'abonnement
Utiliser un abonnement Claude (Pro, Max) ou un compte ChatGPT à travers une application tierce peut contrevenir aux conditions d'utilisation d'Anthropic ou d'OpenAI et entraîner la suspension ou la fermeture du compte. AiTools ne peut en être tenu responsable. La clé API reste l'option recommandée. L'acceptation du risque est enregistrée avec sa date et la version du texte.

## Voir, changer, déconnecter (Avatar → Mon compte → « Mon IA »)
La carte « Mon IA » affiche : l'**IA** reliée (Claude, ChatGPT ou Gemini), le **Mode** (clé API ou abonnement), l'**État** (« Valide » ou « À revalider »), la date de liaison, les 4 derniers caractères d'une clé API, et la date d'acceptation du risque pour un abonnement. Elle contient aussi les **Limites d'utilisation**, le lien **Changer d'IA** (il ouvre la page « Relier mon IA ») et le bouton **Déconnecter**.
- **Déconnecter** efface le secret chiffré et annule les jobs IA en attente ou en cours. Pour changer de mode, de clé ou d'IA, on relie de nouveau depuis la page « Relier mon IA » (elle remplace l'accès précédent).
- État « À revalider » : le secret a été refusé (clé révoquée, jeton ou connexion expirés…). Relie de nouveau ton IA.

## Limites d'utilisation (carte « Mon IA »)
Avec un **abonnement** Claude, la carte montre deux barres : **Session de 5 h** et **Semaine de 7 jours**, avec le pourcentage utilisé et l'heure de remise à zéro. Orange à partir de 80 %, rouge à 100 %.
- « Relevé en direct chez Anthropic » : compte tout l'usage de Claude, y compris hors AiTools (claude.ai, Claude Code).
- Sinon : « Dernière mesure faite pendant un job AiTools », avec la raison du repli (Anthropic limite les relevés, refuse le relevé avec ce jeton, ne répond pas, etc.).
- Avec une **clé API** : il n'y a pas de limite de session ni de semaine, le fournisseur facture ce qui est consommé.
- La même mesure s'affiche dans la carte « Consommation Claude » de la page Projets (« Claude session 5 h », « Claude semaine »).
- Quand le quota est serré (au-delà de 85 %), les jobs non urgents (analyse, évolutions) attendent en file et repartent seuls ; la prospection et les envois continuent. Une alerte part à 80 % puis 95 % si un canal de notification est configuré.
- ChatGPT et Gemini n'ont pas de barre de limites : seule l'estimation du coût, avec une clé API.

## Erreurs courantes
- « Not logged in » / « Invalid bearer token » (Claude) : le jeton est expiré ou révoqué → relier de nouveau.
- « Claude usage limit reached » : le quota du compte Claude est atteint → attendre la remise à zéro indiquée.
- « Anthropic limite les relevés : nouvel essai dans une minute » : seulement l'affichage des limites, rien n'est cassé.
- « Clé API refusée par Google » ou « Clé API refusée par OpenAI » : la clé est fausse, supprimée ou limitée → en créer une nouvelle. « Impossible de joindre Google (ou OpenAI) pour vérifier la clé » : problème de réseau, la clé n'est pas jugée, réessaie.
- ChatGPT, aucun lien ne s'affiche : active la connexion par code d'appareil dans les paramètres de sécurité de ton compte ChatGPT, ou colle ton fichier de connexion (« Coller le fichier »).
- Aucun job IA ne démarre : vérifier « Mon compte → Mon IA → État ».

## Quand ton IA se déconnecte toute seule
Si ton IA refuse ton accès pendant une tâche (jeton d'abonnement expiré ou révoqué, clé API supprimée, connexion ChatGPT révoquée), ou si le serveur ne peut plus lire ton secret de liaison (après un changement de la clé de chiffrement du serveur), la liaison est marquée **invalide** et une fenêtre **« Claude est déconnecté »** s'ouvre sur la page où tu te trouves. Elle propose le bouton **Reconnecter Claude**, qui ouvre la page de liaison, et **Plus tard** pour la fermer (elle ne revient pas sur la même page ; en changeant de page, la page de liaison s'affiche d'office tant qu'aucune IA n'est reliée). Les tâches IA restent à l'arrêt jusqu'à la reconnexion, puis tu peux relancer celles qui ont échoué (par exemple **Analyser**).
