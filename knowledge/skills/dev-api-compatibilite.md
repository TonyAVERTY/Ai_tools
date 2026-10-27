---
nom: dev-api-compatibilite
titre: Concevoir ou modifier une API en préservant la compatibilité
niveau: specialise
resume: Ajouter ou changer des routes, des contrats et des formats sans casser les clients existants.
intentions: api, feature, refactor, review
signaux: api
quand: nouvelle route ou nouveau champ, changement de format, de code d'erreur, de comportement par défaut, versionnage, bibliothèque ou SDK public.
pas_pour: code interne sans appelant externe ni contrat publié.
prerequis: la liste des routes ou fonctions publiques, leur documentation ou spécification (OpenAPI, README), les clients connus.
outils: Grep des routes et des usages côté client, Read des gestionnaires et des schémas, Glob des tests de contrat et de la documentation.
reussite: un client écrit pour l'ancien contrat continue de fonctionner, le nouveau contrat est documenté et testé.
---
### Méthode
1. Identifie le contrat actuel : routes, méthodes, paramètres, corps, réponses, codes d'erreur, en-têtes, authentification, limites. Cherche la spécification et les tests de contrat.
2. Classe le changement : ajout facultatif (compatible), ajout obligatoire, renommage, suppression, changement de type ou de sémantique (cassants).
3. Préfère l'ajout compatible : champ facultatif avec valeur par défaut, nouvelle route, nouvelle valeur ignorée par les anciens clients. Un cassant passe par une nouvelle version ou une période de transition annoncée.
4. Garde la cohérence avec le reste de l'API : nommage, pagination, format d'erreur, authentification, codes HTTP.
5. Mets à jour la spécification, la documentation et les tests ; ajoute un test qui rejoue l'ancien contrat.
### Règles de décision
Même sémantique, nouveau nom : garde l'ancien comme alias déprécié. Erreurs : un code stable et un message lisible, jamais de détail interne. Validation : stricte en entrée, tolérante aux champs inconnus quand le contrat le permet. Droits : toute nouvelle route applique l'autorisation comme ses voisines.
### Contrôles qualité
Les anciens appels de la documentation passent encore. Le format d'erreur est identique aux autres routes. Aucun champ sensible ajouté aux réponses.
### Résultat attendu
Le contrat avant et après (tableau court), les fichiers à changer, les tests de compatibilité, la note de migration pour les clients.
### Clarifier quand
Les clients de l'API sont inconnus et le changement pourrait les casser.
### Arrêt et escalade
Changement cassant sans possibilité de transition : présente l'impact et obtiens la décision avant de poursuivre.
