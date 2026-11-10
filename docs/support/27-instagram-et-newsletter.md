# Instagram et newsletter : posts, images et lettres d'information
Résumé : publier ou programmer un post ou une story sur ton compte Instagram professionnel, et générer un post Instagram (légende, hashtags, texte alternatif et image dessinée d'après le vrai design du projet) et une newsletter (objet, aperçu, texte) depuis l'onglet Communication d'un projet ; relire, modifier, copier, télécharger. Rien n'est publié ni envoyé par iaboss.

## Où les trouver
Page du projet → onglet **Communication** : les sections **Instagram** et **Newsletter**, à côté de **LinkedIn** et **Promotion**. Elles n'existent plus dans l'onglet **Outils IA** (ni la tâche « Posts pour Instagram, X et Facebook », ni la tâche « Newsletter » des postes). Il faut que le projet soit **analysé** : sinon la section dit « Analyse le projet d'abord ». Un membre de l'équipe peut générer et modifier.

## Instagram : un post, de A à Z
1. Dans **Instagram**, écris si tu veux **De quoi doit parler le post ? (facultatif)**. Vide, l'IA choisit un angle utile pour ton public.
2. Choisis le **Format de l'image** : Carré 1:1 (1080 × 1080), Portrait 4:5 (1080 × 1350) ou Story 9:16 (1080 × 1920).
3. Clique **Générer un post**. Compte quelques minutes : la tâche « Post Instagram » apparaît dans **Activité**.
4. Elle travaille en plusieurs temps (la recherche web et la lecture du dépôt sont **deux appels séparés** : pendant qu'elle lit des pages web, l'IA n'a pas accès à ton code) :
   - elle **cherche sur le web** ce qui marche dans le secteur de ton produit : de grandes marques du même secteur et les formats qui performent. Instagram demande souvent une connexion : si une page ne s'ouvre pas, elle s'appuie sur d'autres sources (articles, sites des marques) et ne prétend pas avoir vu un post qu'elle n'a pas lu. Elle n'en copie ni logo, ni texte, ni mise en page ;
   - elle **lit ton dépôt** (en lecture seule) pour retrouver le **vrai design** de ton produit : couleurs exactes, polices, formes, logo, allure des écrans ;
   - elle **dessine l'image** en HTML et CSS, sans script ni ressource externe, que le serveur transforme en PNG ;
   - un **directeur artistique** (un second contrôle indépendant) regarde l'image rendue et la juge comme un designer : point focal, lisibilité, fidélité à la marque, finition. En dessous de 7/10 ou au moindre défaut majeur, l'image repart en correction avec ses remarques. Trois essais au plus.
5. Le brouillon apparaît : l'**image**, sa note, la **Légende (modifiable)** et les **Hashtags**. Sur grand écran l'image est à gauche et le texte à droite (sur téléphone, l'image puis le texte). Le **Texte alternatif de l'image** (pour les lecteurs d'écran) et la rubrique « Ce que Claude a retenu de ton secteur » (le secteur retenu, les marques et pratiques observées, les principes retenus) sont repliés dans « Détails : texte alternatif et… » : un clic les déplie.
6. Relis, modifie, puis :
   - **Télécharger l'image** : le PNG, à publier tel quel ;
   - **Copier la légende** : la légende suivie des hashtags ;
   - **Enregistrer** : garde tes modifications de texte (l'image ne change pas) ;
   - **Supprimer** : retire le post et son image (après confirmation).
7. **Régénérer un autre post** crée un nouveau brouillon avec un autre angle : les légendes déjà produites sont données à l'IA pour qu'elle ne les reprenne pas. Les 20 derniers brouillons sont gardés ; **Brouillons précédents** liste les autres, **Reprendre** en rouvre un.

## Publier ou programmer sur Instagram
Quand l'administrateur du service a activé Instagram, le brouillon propose **Publier sur Instagram** sous la légende. Sinon, iaboss ne publie pas : télécharge l'image, copie la légende et publie depuis l'application Instagram.

1. **Connecter Instagram** (administrateur du projet) : le bouton est dans la section **Instagram**, à côté de **Générer un post**, même quand tu n'as encore généré aucun post. Il t'envoie sur Instagram, où tu autorises iaboss à publier. Le compte doit être **professionnel** (compte business ou créateur : Instagram → Paramètres → Type de compte et outils). Un compte personnel est refusé. Au retour, le message « Compte Instagram relié au projet » s'affiche et le badge **connecté** avec ton @nom apparaît. Un compte par projet. Cette même barre affiche ensuite le @nom du compte, **Reconnecter** si la connexion a expiré et **Déconnecter**.
2. **Publier en** : **Post (avec la légende)** ou **Story (l'image seule, sans légende)**. Pour une story, choisis le format **Story 9:16** à la génération.
3. **Publier maintenant** (après confirmation : le post est public) ou **Programmer** : choisis la date et l'heure (heure de ton navigateur), puis **Programmer**. iaboss publie lui-même à l'heure dite, dans les 15 minutes qui suivent, et jusqu'à 75 jours à l'avance.
4. Un brouillon **programmé** ou **publié** n'est plus modifiable : **Annuler la programmation** le remet en brouillon. Une fois publié, **Voir sur Instagram** ouvre le post.
5. **Déconnecter** retire le compte du projet ; ce qui était programmé repasse en brouillon avec la raison. Les brouillons sont conservés.

À savoir : la connexion dure 60 jours et iaboss la **renouvelle tout seul** ; si elle ne peut pas l'être, tu es prévenu (notification « Instagram à reconnecter ») : clique **Reconnecter** avant l'expiration, sinon les posts programmés ne partent pas. Si une publication échoue (jeton refusé, image refusée, limite quotidienne d'Instagram), le brouillon revient avec la raison et tu es prévenu : rien n'est réessayé en boucle. Instagram limite à 100 publications par jour et par compte. Les administrateurs du projet publient ; un membre simple génère et modifie.

Si, au troisième essai, l'image n'atteint toujours pas le niveau demandé, elle est quand même livrée avec une bannière **À vérifier avant de publier** qui liste les points faibles relevés : corrige-les (tu peux régénérer) avant de publier. Si le contrôle du directeur artistique est lui-même en panne, la bannière le dit.

## Newsletter
1. Dans **Newsletter**, écris si tu veux **De quoi doit parler la newsletter ? (facultatif)**, puis clique **Générer une newsletter**. Comme pour Instagram, l'IA commence par chercher sur le web les newsletters qui performent dans le secteur de ton produit et celles de grandes entreprises du même secteur (« Recherche d'inspiration dans ton secteur… ») ; si cette recherche échoue, la newsletter est écrite quand même. La tâche « Newsletter » apparaît dans **Activité**.
2. Le brouillon donne un **Objet**, un **Texte d'aperçu** et le **Texte (Markdown, modifiable)** : introduction, deux ou trois sections avec intertitre, un appel à l'action, une formule de politesse. Rien d'inventé : pas de chiffre, de client ni de tarif qui ne figure pas dans la fiche du projet.
3. Modifie, puis **Enregistrer**, **Copier le texte** (l'objet puis le texte) ou **Télécharger en HTML** (une version prête à coller dans un outil d'envoi ou à ouvrir dans un navigateur, avec des styles en ligne, sans script).
4. **Régénérer une autre newsletter** change le sujet, l'objet et la structure. **Brouillons précédents** / **Reprendre** : comme pour Instagram.

**iaboss n'envoie pas la newsletter** : colle le texte dans ton outil d'envoi (ou télécharge la version HTML). Pense au consentement des destinataires et au lien de désinscription obligatoire dans tout envoi commercial.

## Combien ça coûte
Chaque génération est une **tâche IA** : elle compte dans « Jobs IA ce mois-ci » de ton offre et dans ton budget (voir « Mon compte → Usage et offre »). Le post Instagram en consomme plus que la newsletter : recherche web, lecture du dépôt, jusqu'à trois dessins et trois contrôles. Elle utilise le modèle choisi dans « Réglages → Budget et modèles IA » (modèle d'analyse), mais **jamais un modèle plus petit que Sonnet** pour le post Instagram : si tu as choisi Haiku, c'est Sonnet qui dessine l'image, parce qu'un petit modèle produit des mises en page sans finition (cette montée de gamme compte dans ton budget). Un modèle plus puissant (Opus) est gardé. Les consignes de rédaction se modifient dans « Réglages → Prompts IA » (« Post Instagram » et « Newsletter ») ; le format de réponse, la recherche du design et le contrat technique de l'image restent imposés.

## Problèmes fréquents
- **« Instagram n'est pas activé sur ce service »** (ou le bouton **Connecter Instagram** n'apparaît pas) : l'administrateur doit renseigner INSTAGRAM_APP_ID et INSTAGRAM_APP_SECRET (connexion directe avec Instagram), ou META_APP_ID, META_APP_SECRET et META_LOGIN_CONFIG_ID, dans le .env du serveur, puis redémarrer le service (guide d'installation, section Instagram).
- **« Meta refuse l'adresse de retour »** : dans developers.facebook.com → ton application → Facebook Login for Business → Paramètres, ajoute exactement l'adresse indiquée dans le message dans « URI de redirection OAuth valides ».
- **« Meta ne reconnaît pas la configuration » / « l'application »** : l'administrateur vérifie META_LOGIN_CONFIG_ID, META_APP_ID et META_APP_SECRET.
- **« Aucun compte Instagram professionnel n'a été autorisé »** : recommence, et quand Meta propose de choisir un compte Instagram, sélectionne le tien (compte professionnel : business ou créateur ; avec la connexion unifiée, lié à une Page Facebook).
- **« Meta n'a pas accordé le droit de publier »** : la configuration de connexion de l'application doit inclure l'autorisation instagram_content_publish ; recommence en acceptant tout.
- **« Instagram a refusé le jeton (expiré ou révoqué) »** : clique **Reconnecter**.
- **« Instagram n'a pas accepté l'image »** : l'image doit être joignable depuis Internet (le service doit avoir une adresse publique en HTTPS) ; régénère le post si le problème persiste.
- **Le compte est connecté mais « Instagram refuse l'action »** : tant que l'application Meta est en mode développement, le compte qui se connecte doit avoir un rôle dans l'application (administrateur, développeur ou testeur).
- **« Chromium n'est pas installé sur ce serveur »** : l'image est rendue par Chromium côté serveur. L'administrateur du service doit l'installer (variable CHROMIUM_BIN). La newsletter n'en a pas besoin.
- **« Analyse le projet d'abord »** : lance l'analyse du projet (onglet Vue d'ensemble), puis réessaie.
- **« L'image écrite par Claude ne passe pas au rendu »** : trois documents d'image de suite ont été refusés (script, adresse externe, image sans texte ou unie). Un élément qui dépasse du cadre n'est pas refusé : c'est un choix de composition courant (un produit rogné par le bord) ; le directeur artistique juge si un texte est coupé. Réessaie ; précise le sujet si besoin.
- **Les couleurs ou les polices ne ressemblent pas à mon produit** : l'IA cherche le design dans le dépôt (fichiers de styles, thème, logo). Si le dépôt n'a presque pas d'interface (une API, un outil en ligne de commande), elle reprend le nom et l'ambiance trouvés dans la documentation. Les polices web ne sont pas installées sur le serveur : elles sont remplacées par une police système proche.
- **L'image est correcte mais banale** : régénère avec une direction plus précise (un cas d'usage, un avant/après, un chiffre réel de ta fiche).
