---
nom: dev-frontend-accessibilite
titre: Interface web : cohérence, états et accessibilité
niveau: specialise
resume: Modifier une interface en réutilisant ses composants et en couvrant les états et l'accessibilité de base.
intentions: ui, feature, review, debug
signaux: frontend
quand: écran, composant, formulaire, style, comportement côté navigateur.
pas_pour: code serveur sans rendu, outil en ligne de commande.
prerequis: le système de composants ou de styles du dépôt, ses jetons de design (couleurs, espacements, polices), ses règles de sécurité du navigateur.
outils: Glob des composants et feuilles de style, Grep des classes et variables existantes, Read d'un écran voisin.
reussite: le nouvel écran ressemble aux autres, couvre ses états (vide, chargement, erreur, long contenu) et se manipule au clavier.
---
### Méthode
1. Regarde un écran voisin : structure, composants, classes, jetons de design, gestion des formulaires et des erreurs. Reproduis-les ; n'ajoute pas de bibliothèque d'interface.
2. Couvre les états : vide (avec la prochaine action), chargement, erreur (cause et remède), succès, très long texte, petit écran.
3. Accessibilité de base : éléments natifs (bouton, lien, champ) plutôt que des div cliquables, libellés associés aux champs, ordre de titres, focus visible, contraste, navigation au clavier, texte alternatif utile, annonces pour les mises à jour dynamiques.
4. Respecte les contraintes du dépôt : politique de sécurité du contenu (pas de script ou style en ligne si elle l'interdit), pas de ressource externe, couleurs issues des jetons et non écrites en dur.
5. Mouvement et préférences : respecte les préférences de réduction de mouvement et de thème si le dépôt les gère.
### Règles de décision
Composant existant presque adapté : étends-le plutôt que d'en créer un second. Texte de l'interface : mots de l'utilisateur, verbes d'action explicites, même vocabulaire partout. Doute sur une règle de style : suis le fichier de conventions du dépôt.
### Contrôles qualité
Aucun style ou couleur en dur contraire aux conventions ; formulaire utilisable sans souris ; message d'erreur qui dit quoi faire ; test ou vérification visuelle proposée (capture à plusieurs largeurs, outil d'accessibilité du dépôt si présent).
### Résultat attendu
Les changements de composants, de styles et de textes, la liste des états couverts, et la vérification à lancer (tests, outil d'audit d'accessibilité) avec ce qui n'a pas été vérifié visuellement.
### Clarifier quand
Aucune maquette ni référence visuelle et plusieurs mises en page plausibles.
### Arrêt et escalade
Le changement exige de refondre le système de design ou d'ajouter une dépendance visuelle lourde : propose-le séparément.
