// Raccourcis clavier : la liste, une seule source lue par la page « Raccourcis clavier » (src/shortcuts.js) et par public/app-shortcuts.js via l'attribut data-go du <body>.
// Module sans dépendance : views.js (la mise en page) le lit, et la page a elle-même besoin de views.js.

/** « g » puis une lettre : aller à une page. [lettre, adresse, libellé de la page]. */
export const GO = [
  ['a', '/', "Aujourd'hui"], ['p', '/projets', 'Projets'], ['m', '/mails', 'Mails'], ['c', '/calendar', 'Agenda'], ['o', '/compta', 'Compta'],
  ['f', '/facturation', 'Facturation'], ['l', '/clients', 'Clients'], ['e', '/team', 'Équipe'], ['r', '/settings', 'Réglages'], ['u', '/account', 'Mon compte'],
  ['i', '/chat', 'Assistant IA'], ['s', '/support', 'Support'],
];

/** Les autres raccourcis. [touches (alternatives séparées par « ou »), ce que ça fait]. */
export const OTHERS = [
  [['/', 'Ctrl K', '⌘ K'], 'Rechercher une page, un projet, un prospect, un client ou un mail'],
  [['n'], 'Créer un nouveau projet (ouvre « Nouveau projet »)'],
  [['j'], "Ouvrir ou fermer « Activité » (les tâches de l'IA en cours)"],
  [['1 – 9'], "Dans un projet : ouvrir l'onglet de ce rang dans la barre du projet (1 Vue d'ensemble, 2 Prospection, 3 Envoi…)"],
  [['?'], 'Afficher cette page des raccourcis'],
  [['Échap'], 'Fermer le menu, la recherche ou la fenêtre ouverte'],
];

/** Valeur de l'attribut data-go du <body> : « a:/;p:/projets;… » (les adresses n'ont ni « ; » ni « : »). */
export const goAttr = () => GO.map(([k, href]) => `${k}:${href}`).join(';');
