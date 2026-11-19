---
nom: video-promo-motion
titre: Vidéo de promotion : mouvement et technique
resume: Comment une scène HTML animée par renderFrame(t) bouge comme un studio de motion design : vitesse, flou de mouvement, raccords, son calé, un événement par seconde.
taches: promo
---
Une image fixe, on la survole ; un mouvement, on le suit. Tout est une fonction du temps `t`, jamais de l'horloge réelle.

Technique : un document HTML autonome ; `window.renderFrame(t)` place TOUS les éléments depuis `t` (transformations et opacité), sans ressource externe ni hasard. Tailles en U = 1 % du petit côté de l'image ; taille d'un élément mesurée une fois, à la création.

Les 4 réglages du pro (obligatoires) :
1. Vitesse : lent, rapide, lent. Rien ne démarre d'un coup, rien ne s'arrête net : chaque déplacement accélère puis freine (E.inOut, E.expo pour une grande entrée, E.back pour un léger dépassement à l'arrivée). Jamais de mouvement linéaire ni d'apparition sèche.
2. Flou de mouvement : ce qui va vite laisse une traînée, sinon l'image saccade. Un élément qui parcourt plus de 30 U en moins de 0,4 s reçoit un flou proportionnel à sa vitesse (put(n,{blur}) : 1 à 2 U au plus vite, 0 à l'arrêt). Un élément immobile n'est jamais flou.
3. Raccords : on ne coupe pas. Un élément du plan qui finit survit et devient le plan suivant (la carte qui sort devient l'écran qui entre, le mot clé grossit et devient le titre suivant). Le plan suivant commence 0,3 à 0,6 s avant la fin du précédent ; deux titres lisibles ne se superposent jamais.
4. Son : il tombe pile sur l'image. Avec une voix, chaque mot du titre apparaît quand la voix le dit (2,5 mots par seconde depuis le début de la phrase), ni avant ni après.

Une chose à chaque seconde : des mots qui arrivent mot par mot (0,15 à 0,25 s d'écart), des cartes qui s'ouvrent, des traits qui se dessinent, des compteurs qui tournent (seulement des valeurs fournies). Au moins un événement utile par seconde dans le contenu, pas seulement le fond ; aucune image immobile plus d'une seconde, sauf le plan final (au moins 2 s), sans faire trembler les textes. Un plan dure 4 à 6 s, une idée par plan. Jamais plus de 3 changements brusques de luminosité par seconde.

Contrôle :
- La scène de référence est déjà adaptée à la durée : garde sa conversion de temps unique.
- Tout état se recalcule depuis t ; masque les plans inactifs ; t=8 puis t=0 redonne le début.
- À chaque changement de plan, vérifie début − 0,15 s, début, début + 0,15 s, milieu et fin : ni flash, ni écran vide, ni reste du plan précédent, ni saut.
- Des agents inspectent les captures du MP4 : leurs défauts sont des corrections obligatoires.
