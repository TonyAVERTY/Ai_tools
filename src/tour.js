// Visite guidée du tableau de bord : une suite d'étapes qui éclairent un élément à la fois (le reste de la page est assombri) et l'expliquent.
// Source unique : le texte des étapes sert à la fois à l'écran (public/tour.js) et à la documentation du Support (générée, voir supportdocs.js).
// Elle démarre toute seule une fois, juste après les questions de bienvenue ; « Visite guidée » dans le menu du compte la relance à volonté.
import { getSetting, setSetting } from './db.js';
import { json, readBody } from './http.js';
import { needsWelcome } from './userprofile.js';

const KEY = 'tour_state'; // 'done' | 'skipped'

/**
 * `target` : sélecteur CSS de l'élément à éclairer (sans cible : étape centrée). `also` : autre élément éclairé avec lui (ex. le menu déplié).
 * `open` : <details> à déplier pendant l'étape. Une étape dont la cible n'est pas à l'écran (ex. pas de chiffres du mois) est sautée.
 */
export const TOUR_STEPS = [
  { id: 'welcome', title: 'Bienvenue dans AiTools', text: "Voici une visite d'une minute pour te repérer. Tout ce qui n'est pas éclairé est mis de côté : on te montre une chose à la fois. Tu peux arrêter quand tu veux avec « Passer la visite » ou la touche Échap." },
  { id: 'projets', target: '.pills a[href="/"]', title: 'Projets : ton point de départ', text: "Un projet, c'est un produit ou un service que tu veux faire connaître, relié à son dépôt Git. Chaque projet rassemble sa cible, ses prospects, ses mails, ses posts LinkedIn et ses tâches IA." },
  { id: 'mails', target: '.pills a[href="/mails"]', title: 'Mails : envois et réponses', text: "Tous les mails envoyés depuis tes projets, ceux qui n'ont pas pu partir avec la cause, les mails lus et les réponses reçues. Un clic sur un chiffre filtre la liste." },
  { id: 'calendrier', target: '.pills a[href="/calendar"]', title: 'Calendrier : ce qui est prévu', text: "Tes rendez-vous, tes relances et tes posts LinkedIn programmés. Quand un prospect répond, AiTools te propose d'ajouter un rendez-vous. Tu peux aussi l'afficher dans Google Agenda, Apple Calendrier ou Outlook." },
  { id: 'equipe', target: '.pills a[href="/team"]', title: 'Équipe : travailler à plusieurs', text: "Invite des collègues sur des projets partagés, avec un rôle (membre ou administrateur). Ils n'ont pas besoin de leur propre accès à Claude : ils utilisent le tien, uniquement sur les projets que tu partages." },
  { id: 'chiffres', target: '.ukpis', title: 'Tes chiffres du mois', text: "Projets, prospects, mails envoyés et tâches IA, avec les plafonds de ton offre. Ils repartent de zéro le 1er de chaque mois, et rien n'est perdu quand un plafond est atteint." },
  { id: 'nouveau', target: '[data-new-toggle]', title: 'Crée ton premier projet', text: "Clique ici, donne un nom et l'adresse du dépôt Git. Claude lit le code pour comprendre ce que tu vends, puis AiTools propose une cible, cherche des prospects et rédige les mails. Chaque étape te demande ta validation." },
  { id: 'assistant', target: '.ia-menu > summary', also: '.ia-menu .ia-pop', open: '.ia-menu', title: 'Assistant : Claude et Support', text: "« Claude » est une conversation avec ton propre Claude : tu peux y joindre un projet, des photos ou des PDF. « Support » répond à tes questions sur AiTools à partir de sa documentation." },
  { id: 'barre', target: '#sys', title: 'La barre système', text: "Elle montre où en est ton quota Claude et ce que consomment les tâches lancées par AiTools. Les tâches en cours apparaissent dans « Activité », en haut à droite." },
  { id: 'compte', target: 'details.user > summary', also: 'details.user .user-pop', open: 'details.user', title: 'Ton compte et les réglages', text: "« Mon compte » : ton profil, la liaison avec Claude, ton agenda et le mode développeur. « Réglages » : budgets, garde-fous, consignes de l'IA. Tu peux revoir cette visite à tout moment avec « Visite guidée »." },
  { id: 'fin', title: "À toi de jouer", text: "Commence par « Nouveau projet ». Si tu bloques, l'Assistant en mode « Support » est là pour t'aider." },
];

/** La visite démarre-t-elle d'elle-même ? Une seule fois par compte, et seulement une fois les questions de bienvenue passées. */
export async function needsTour(db, userId) {
  return !(await needsWelcome(db, userId)) && !(await getSetting(db, userId, KEY, null));
}

/** Données de la visite, en JSON sûr à placer dans <script type="application/json"> (aucun « < » brut). */
export const tourJson = () => JSON.stringify(TOUR_STEPS).replace(/</g, '\\u003c');

export function registerTourRoutes(router, app) {
  const { db } = app;
  // Fin de la visite (terminée ou passée) : elle ne redémarre plus toute seule
  router.post('/tour/complete', async ({ req, res, session }) => {
    const b = await readBody(req);
    await setSetting(db, session.userId, KEY, b.state === 'skipped' ? 'skipped' : 'done');
    json(res, { ok: true });
  });
}
