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
  { id: 'welcome', title: 'Bienvenue dans iaboss', text: "Voici une visite d'une minute pour te repérer. Tout ce qui n'est pas éclairé est mis de côté : on te montre une chose à la fois. Tu peux arrêter quand tu veux avec « Passer la visite » ou la touche Échap." },
  { id: 'aujourdhui', target: '.pills a[href="/"]', title: "Aujourd'hui : ce qui t'attend", text: "Ta page d'accueil. Elle rassemble ce qui demande ton attention (réponses de prospects à traiter, actions prévues, tâches IA terminées ou en échec), l'agenda du jour, l'argent à encaisser et l'usage de ton offre. Rien à chercher : ouvre-la le matin, traite la liste, et le reste attend." },
  { id: 'projets', target: '.pills a[href="/projets"]', title: 'Projets : ton point de départ', text: "Un projet, c'est un produit ou un service que tu veux faire connaître, relié à son dépôt Git. Chaque projet rassemble sa cible, ses prospects, ses mails, ses posts LinkedIn et ses tâches IA." },
  { id: 'mails', target: '.pills a[href="/mails"]', title: 'Mails : envois et réponses', text: "Tous les mails envoyés depuis tes projets, ceux qui n'ont pas pu partir avec la cause, les mails lus et les réponses reçues. Un clic sur un chiffre filtre la liste." },
  { id: 'calendrier', target: '.pills a[href="/calendar"]', title: 'Agenda : ce qui est prévu', text: "Tes rendez-vous, tes relances et tes posts LinkedIn programmés. Quand un prospect répond, iaboss te propose d'ajouter un rendez-vous. Tu peux aussi l'afficher dans Google Agenda, Apple Calendrier ou Outlook." },
  { id: 'compta', target: '.pills a[href="/compta"]', title: 'Compta : tes justificatifs et ta déclaration', text: "Ajoute tes paiements et tes dépenses avec leur facture, vois tes chiffres par projet, exporte tes justificatifs pour ton comptable, et laisse-toi guider pour faire ta déclaration : où, quand et quels montants saisir." },
  { id: 'facturation', target: 'details.user .user-pop a[href="/facturation"]', open: 'details.user', title: 'Facturation : devis, acomptes, factures et avoirs', text: "Pour chaque projet, renseigne tes informations légales (une partie est préremplie d'après ton projet), laisse ton IA te proposer trois exemples de devis, choisis et valide les modèles. Tu génères ensuite de vrais documents en PDF : un devis avec les lignes de ce que ton client commande, puis les acomptes, la facture finale et les avoirs qui s'y rattachent. Une facture peut être ajoutée toute seule à la Comptabilité." },
  { id: 'clients', target: 'details.user .user-pop a[href="/clients"]', open: 'details.user', title: 'Clients : tes clients et tes prospects', text: "Les projets se déroulent comme sur le tableau de bord : tu y trouves tes clients et tes prospects, avec une recherche. La fiche d'un client rassemble ses coordonnées modifiables, les documents que tu lui as générés et tous vos échanges (mails, réponses, notes). Un prospect passe en client en un clic." },
  { id: 'equipe', target: 'details.user .user-pop a[href="/team"]', open: 'details.user', title: 'Équipe : travailler à plusieurs', text: "Invite des collègues sur des projets partagés, avec un rôle (membre ou administrateur). Ils n'ont pas besoin de leur propre accès à une IA : ils utilisent le tien, uniquement sur les projets que tu partages." },
  { id: 'atraiter', target: '.td-todo', title: 'À traiter : ta liste du jour', text: "Chaque ligne est une réponse, une action ou une tâche IA qui t'attend. Un bouton t'emmène à la bonne fiche, « Marquer traité » la retire de la liste (tu peux annuler), et les filtres Réponses, Actions et IA isolent un type. Quand la liste est vide, il n'y a rien d'urgent." },
  { id: 'chiffres', target: '.td-usage', title: 'Tes chiffres du mois', text: "Projets, prospects, mails envoyés et tâches IA, avec les plafonds de ton offre. Ils repartent de zéro le 1er de chaque mois, et rien n'est perdu quand un plafond est atteint." },
  { id: 'nouveau', target: '[data-new-project]', title: 'Crée ton premier projet', text: "Clique ici pour ouvrir Projets, puis sur « Nouveau projet » : donne un nom et l'adresse du dépôt Git. Ton IA lit le code pour comprendre ce que tu vends, puis iaboss propose une cible, cherche des prospects et rédige les mails. Chaque étape te demande ta validation." },
  { id: 'assistant', target: '.ia-menu > summary', also: '.ia-menu .ia-pop', open: '.ia-menu', title: 'Assistant : ton IA et Support', text: "L'entrée qui porte le nom de ton IA (Claude, ChatGPT ou Gemini) est une conversation avec ton propre accès : tu peux y joindre un projet, des photos ou des PDF. « Support » répond à tes questions sur iaboss à partir de sa documentation." },
  { id: 'conso', target: '[data-claude-card]', title: 'Ta consommation d\'IA', text: "Avec un abonnement Claude, cette carte montre où en est ton quota (session de 5 h et semaine) et quand il se réinitialise ; avec une clé API, ce que tes tâches ont coûté. Elle apparaît dès qu'une mesure existe. Les tâches en cours apparaissent dans « Activité », en haut à droite." },
  { id: 'compte', target: 'details.user > summary', also: 'details.user .user-pop', open: 'details.user', title: 'Ton compte et les réglages', text: "« Mon compte » : ton profil, la liaison avec ton IA, ton agenda et le mode développeur. « Réglages » : budgets, garde-fous, consignes de l'IA. Tu peux revoir cette visite à tout moment avec « Visite guidée »." },
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
