---
nom: video-promo-motion
titre: Vidéo de promotion : mouvement et technique
resume: Comment une scène HTML animée par renderFrame(t) bouge bien : temps, courbes, décalages, mouvement continu, transitions et contraintes techniques.
taches: promo
---
Une vidéo de promotion est une affiche animée : tout est une fonction du temps `t`, jamais de l'horloge réelle.

Technique (obligatoire) :
- Un seul document HTML autonome ; `window.renderFrame(t)` place TOUS les éléments à partir de `t` (position, taille, opacité, texte visible). Aucune ressource externe, aucun hasard non déterministe, aucune dépendance à la vitesse de la machine.
- Mesure en U = 1 % du petit côté de l'image : les tailles se règlent en U, la scène tient alors en vertical, en paysage et en carré.
- Place chaque élément par transformation (translate, scale, rotate) et opacité ; mesure sa taille une fois, à la création (un élément masqué n'a plus de taille).

Mouvement qui donne de la vie :
- Courbes : ease-out à l'entrée, ease-in-out aux transitions, léger dépassement (overshoot, back) pour les éléments qui « atterrissent », expo pour les grandes entrées. Jamais de mouvement linéaire.
- Décalage (stagger) : les éléments d'un groupe entrent l'un après l'autre (0,15 à 0,25 s), les mots d'un titre aussi.
- Mouvement continu : le fond respire (halos qui dérivent, grille qui défile), les cartes flottent de quelques pixels, les compteurs et les barres avancent, les traits se dessinent (stroke-dashoffset). Il n'y a jamais d'image immobile plus de deux secondes.
- Transitions : le plan suivant commence 0,3 à 0,6 s avant la fin du précédent ; un élément qui sort glisse et se floute, un élément qui entre arrive de la direction opposée. Une transition réutilise un objet (la carte qui sort devient la carte qui entre) plutôt que de couper.
- Rythme : un plan dure 4 à 6 s ; une idée par plan ; le plan final reste au moins 2 s.
Pas de clignotement : jamais plus de 3 changements brusques de luminosité par seconde.

Contrat de mouvement et de contrôle :
- La scène de référence reçue est déjà adaptée à la durée demandée : garde sa conversion de temps unique, ne recale pas chaque nombre une deuxième fois.
- Tout état doit être recalculé depuis t. Masque explicitement tous les plans inactifs. Un appel à t=8 suivi de t=0 doit produire le même début qu'un premier appel à t=0.
- Les mouvements de fond ne suffisent pas : anime le contenu qui explique le produit (carte qui se trie, ligne qui se complète, notification qui arrive). Prévois un événement utile toutes les 1 à 2 secondes, sans faire trembler en permanence les textes.
- Une transition ne superpose jamais deux titres lisibles au même endroit. Une sortie peut chevaucher l'entrée du décor suivant ; le texte principal, lui, reste distinct.
- À chaque changement de plan, vérifie début − 0,15 s, début, début + 0,15 s, milieu et fin. Aucun flash, écran vide, élément restant du plan précédent ou saut de position.
- Contrôle le rendu, pas seulement le code : des agents inspectent les captures horodatées extraites du MP4. Leurs défauts sont des corrections obligatoires, jamais une invitation à ajouter simplement des halos.
