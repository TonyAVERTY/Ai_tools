// Onglet « Développeur » de la barre du haut : visible seulement si le compte a activé le mode développeur ET que son offre le permet.
// Même principe que le nom de l'IA (services/ainame.js) : server.js range la réponse le temps de la requête, la barre du haut (layout) la lit.
// Module sans dépendance : les vues l'importent sans tirer la base ni les offres (la décision, elle, est dans developerroutes.js).
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();

/** Exécute `fn` avec ce réglage pour toutes les vues rendues pendant son exécution. */
export const withDevTab = (on, fn) => store.run({ on: !!on }, fn);

/** L'onglet « Développeur » doit-il s'afficher pour la requête en cours ? Non hors requête (tests de vues, jobs). */
export const devTabShown = () => store.getStore()?.on === true;
