# Mode développeur : API, jetons et serveur MCP
Résumé : activer le mode développeur, créer des jetons, utiliser l'API REST et le serveur MCP pour piloter AiTools depuis ses scripts ou depuis Claude, et où lire la documentation technique.

## Activer
Avatar → **Mon compte** → carte « Mode développeur » → bouton **Activer** (ou la page **Développeur**) puis **Activer le mode développeur**. Tant qu'il est désactivé, aucun jeton ne fonctionne ni sur l'API ni sur le MCP. Une fois activé, la page affiche les adresses de l'API et du serveur MCP, les liens vers leur documentation et les **jetons**.

## Jetons (page Développeur → « Jetons d'API »)
Un jeton donne accès **à son propre compte** avec les droits cochés, et à rien d'autre. 5 jetons au plus : en supprimer un avant d'en créer un autre.
- Créer : champ **Nom du jeton** (par exemple « Claude Desktop »), puis les **Droits** à cocher, puis **Créer un jeton**. Droits : **read** (lire les projets, prospects, réponses et statistiques, coché par défaut), **write** (modifier : ajouter des prospects et des notes, changer un statut ou une prochaine action), **jobs** (lancer des tâches : analyse, recherche, régénération d'accroche, audit, envoi de mails).
- Le jeton (qui commence par `aitk_`) n'est affiché qu'une fois, sur la page « Jeton créé : copie-le maintenant » : le copier tout de suite. Ne jamais le mettre dans une page web, un dépôt ou un message ; le partager revient à donner accès au compte.
- Le tableau montre le nom, le début du jeton, ses droits, la date de création et le dernier usage. Bouton **Supprimer** pour révoquer un jeton.
- **Désactiver le mode développeur** (bouton en bas de la page Développeur) : tant qu'il est désactivé, aucun jeton ne fonctionne, ni sur l'API ni sur le MCP.

## Utiliser l'API et le MCP
- **API REST** (JSON, en-tête `Authorization: Bearer <jeton>`) : projets, prospects, réponses, mails, tâches. Premier appel : `GET /api/v1/me`.
- **Serveur MCP** : relie Claude (ou un autre client MCP) au panel pour lire, classer et agir avec les droits donnés au jeton.
- Documentation technique complète sur le site public : pages **/docs** (démarrage), **/docs/api** (API REST) et **/docs/mcp** (serveur MCP), accessibles depuis le lien « Docs » du site ou depuis la page Développeur.
- Limite : 120 requêtes par minute et par compte ; au-delà, l'appel reçoit une erreur de limite.
