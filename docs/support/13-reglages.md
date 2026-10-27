# Réglages : notifications, dépôts Git, garde-fous, modèles, prompts
Résumé : toutes les sections de la page Réglages (Notifications et canaux Discord, Slack, Telegram, e-mail ; Dépôts Git ; Garde-fous ; Budget et modèles IA ; Prompts IA) et leurs champs.

On y accède par l'avatar → **Réglages**. Un sommaire à gauche (« Notifications », « Dépôts Git », « Garde-fous », « Budget et modèles IA », « Prompts IA ») suit la lecture. Toutes les sections de la page forment un seul formulaire : le bouton **Enregistrer les réglages**, dans la barre fixée en bas de l'écran, enregistre d'un coup les notifications, les dépôts Git, les garde-fous, les modèles et les prompts (il n'y a plus de bouton d'enregistrement par section) ; les liens et jetons sont chiffrés et jamais réaffichés.

## Notifications
Où et quand AiTools prévient : réponses de prospects, jobs terminés ou en erreur, alertes.
- **Email de réception (évolutions, rapport hebdo)** : l'adresse qui reçoit les évolutions et le rapport hebdomadaire. Ces mails partent de l'adresse d'AiTools (SMTP du serveur).
- Case **Rapport hebdo le lundi à 8h (mail + canaux ci-dessous)** et bouton **Envoyer le rapport maintenant** (pour tester). Le rapport résume, par projet et sur 7 jours : prospects trouvés, mails et relances envoyés, réponses et taux de réponse, clients, adresses invalides, objet gagnant du test A/B, coût IA.
- **Canaux** : ajouter un canal avec le bouton « Ajouter un canal » : **Discord** (un webhook par salon, 5 au plus), **Slack** (webhook entrant), **Telegram** (bot et conversation), **E-mail** (une adresse de réception). Pour chaque canal : « 1. Quelles notifications veux-tu y recevoir ? » puis les informations de connexion. Plusieurs canaux Discord permettent de séparer (réponses d'un côté, erreurs de l'autre). Un bouton **Envoyer un test** vérifie un canal.
- Les notifications au choix : **Recherche, analyse, envoi ou évolutions terminés** ; **Job en erreur** ; **Réponse d'un prospect** ; **Relances envoyées** ; **Serveur très chargé : tes jobs attendent** ; **Envois mis en pause (trop de mails rejetés)** ; **Budget IA atteint** ; **Quota Claude proche de la limite, ou job reporté** ; **Rapport hebdo**.
- Où trouver le lien : Slack → Apps → Incoming Webhooks ; Discord → salon → Modifier → Intégrations → Webhooks → Nouveau webhook → Copier l'URL ; Telegram → créer un bot avec @BotFather (jeton), écrire au bot puis lire l'identifiant de conversation avec @userinfobot. Le canal E-mail exige que le SMTP du serveur soit configuré.

## Dépôts Git
GitHub est toujours accepté. Pour un **dépôt privé** : champ **Token (dépôts privés, lecture seule)** de github.com, puis **Tester ce token**. Conseil : un token à portée limitée (« Only select repositories » et la permission « Contents : Read-only »). Inutile pour un dépôt public. Pour un **autre serveur Git** : « Ajouter un serveur Git » avec **URL du serveur** et **Token (lecture repo)** (5 serveurs au plus). Chaque token ne sert qu'à son serveur.

## Garde-fous
- **Plafond global mails / 24 h** (300 au maximum), tous projets confondus.
- **Délai min** et **Délai max entre 2 mails** (secondes, aléatoire entre les deux).
- Case **Demander un accusé de lecture dans les mails de prospection**.
- **Pied de page des mails de prospection** : par défaut, chaque mail se termine par « Vous recevez ce message car l'adresse … est publiée publiquement (source) » et un lien **Ne plus recevoir de messages**. Le bouton **Retirer le pied de page des mails** les supprime de tous tes mails (premiers mails et relances, tous tes projets). Un message d'**attention** est affiché dans la page et une **confirmation** est demandée avant le retrait, car :
  - **Légal** : en prospection par e-mail, le RGPD et la CNIL demandent d'informer la personne de l'origine de son adresse et de lui offrir un moyen simple et gratuit de refuser les messages ; la responsabilité est la tienne (sanctions possibles) ;
  - **Réputation** : sans lien de désinscription, les destinataires cliquent « Spam », et Gmail ou Outlook peuvent bloquer l'adresse et le domaine d'envoi ;
  - **Désinscriptions** : sans le lien « Ne plus recevoir de messages », rien dans le mail ne permet de se désinscrire : la personne doit te répondre, et tu marques toi-même le prospect en « Refus ».
  Une fois retiré, le bouton **Remettre le pied de page** le rétablit tout de suite (sans confirmation). Le réglage est immédiat : il n'a pas besoin du bouton « Enregistrer les réglages ». L'**Aperçu** d'un mail montre toujours ce qui partira, avec un avertissement quand le pied de page est retiré.
Voir aussi le plafond par projet dans « Configuration du projet ».

## Budget et modèles IA
- Avec un **abonnement Claude**, la section s'appelle **Modèles IA** : rien n'est facturé en plus, le garde-fou est le quota Claude affiché en haut.
- Avec une **clé API**, la section s'appelle **Budget IA** : **Plafond sur 24 h glissantes** et **Plafond sur 30 jours glissants** (en $, équivalent coût API remonté par Claude). Plafond atteint : les jobs IA restent en file et repartent seuls quand la fenêtre glisse ; les envois et relances continuent. Un job en cours n'est jamais coupé.
- Trois choix de modèle : **Modèle pour la prospection**, **Modèle pour l'analyse de projet**, **Modèle pour la rédaction (mails, relances, posts LinkedIn)**. Liste en deux parties : recommandés (Haiku économe, Sonnet intermédiaire, Opus plus cher) puis autres modèles. Le symbole de coût relatif ($, $$, $$$) n'apparaît qu'avec une clé API Anthropic (facturée à l'usage) : avec un abonnement Claude, seule la gamme est écrite, sans aucun symbole de prix. Haiku suffit pour la plupart des projets. Voir « Modèles Claude proposés ». Le modèle de la page IA se choisit dans la page IA.

## Prompts IA
Les consignes que Claude reçoit pour chaque tâche. Onglets **Tous les modèles**, **Haiku**, **Sonnet**, **Opus**, **Fable** ; bouton **Revenir au texte par défaut** par tâche. Le contexte du projet et le format de réponse restent ajoutés automatiquement. Voir « Tâches IA et consignes (prompts) modifiables » pour la liste.
