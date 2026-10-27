---
nom: video-promo-motion
titre: Vidéo de promotion en motion design
resume: Scénario, rythme, lisibilité et contraintes techniques d'une courte vidéo générée en HTML animé.
taches: promo
---
Une vidéo de promotion courte raconte une seule chose : le problème, puis ce que le produit change.

Scénario (adapte au temps disponible) :
- Premières secondes : le problème ou la promesse, en une phrase lisible tout de suite.
- Milieu : 2 à 3 scènes qui montrent le produit en action avec des formes simples (cartes, lignes, compteurs).
- Fin : le nom du produit et une action claire, tenue assez longtemps pour être lue.

Lisibilité : un texte par scène, 8 mots environ, corps de texte grand (lisible sur un téléphone), fort contraste, rien qui bouge pendant qu'on lit. Une seule famille de polices système, deux couleurs maximum plus le fond.
Rythme : chaque scène dure assez pour être lue (compte une seconde de plus que la lecture à voix haute). Les transitions sont simples (fondu, glissement) et cohérentes.
Technique : tout est dans un seul document HTML, l'animation dépend uniquement du temps `t` passé à `renderFrame(t)` ; pas de ressource externe, pas de hasard non déterministe, pas de dépendance à l'horloge réelle.
N'invente aucune statistique, aucun client et aucun logo.
