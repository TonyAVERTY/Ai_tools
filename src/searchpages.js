// Pages de l'application trouvables depuis la recherche globale (⌘K) : pages du menu, du compte et onglets de chaque projet.
// Les mots-clés complètent le libellé (« devis » mène à Facturation). Les onglets réservés à la personne qui gère le projet ne sont proposés qu'à elle.
import { TABS } from './projectviews.js';

const MAX = 6;
/** Minuscules, sans accents ni apostrophes courbes : « Récapitulatif » et « recap » se retrouvent. */
const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'").toLowerCase();

// [adresse, libellé, mots-clés]
export const SITE_PAGES = [
  ['/', "Aujourd'hui", 'accueil tableau de bord a traiter'],
  ['/projets', 'Projets', 'liste des projets creer nouveau'],
  ['/mails', 'Mails', 'reponses boite de reception messages'],
  ['/calendar', 'Agenda', 'calendrier rendez-vous evenements'],
  ['/compta', 'Compta', 'comptabilite depenses recettes justificatifs tva'],
  ['/facturation', 'Facturation', 'devis factures avoirs acompte documents'],
  ['/clients', 'Clients', 'carnet de clients'],
  ['/team', 'Équipe', 'membres invitations partage'],
  ['/chat', 'Assistant', 'ia claude chat conversation questions'],
  ['/support', 'Support', 'aide documentation faq'],
  ['/settings', 'Réglages', 'parametres prompts modeles consignes garde-fous'],
  ['/account', 'Mon compte', 'profil abonnement offre plan identifiants'],
  ['/link', "Relier mon IA", 'claude chatgpt gemini connexion jeton'],
  ['/developer', 'Développeur', 'api mcp jetons acces'],
];

const tabKeywords = { prospection: 'prospects recherche', envoi: 'mails relance modele smtp', clients: 'clients', facturation: 'devis factures', communication: 'linkedin instagram newsletter promotion video', outils: 'evolution audit postes', recap: 'recapitulatif statistiques', reglages: 'configuration smtp imap suppression' };

/**
 * @param {string} q  recherche (2 lettres au moins)
 * @param {{ id: number, name: string, user_id?: number }[]} projects  projets accessibles
 * @param {number} userId
 * @returns {{ title: string, sub: string, href: string }[]}
 */
export function searchPages(q, projects = [], userId = 0) {
  const needle = plain(q).trim();
  if (needle.length < 2) return [];
  const hit = (label, words) => plain(label).includes(needle) || plain(words).includes(needle);
  const out = SITE_PAGES.filter(([, label, words]) => hit(label, words)).map(([href, label]) => ({ title: label, sub: 'Page', href }));
  for (const p of projects) {
    const manage = Number(p.user_id) === Number(userId);
    for (const [slug, label, restricted] of TABS) {
      if (restricted && !manage) continue;
      if (!slug) continue; // la vue d'ensemble, c'est le projet lui-même (déjà dans « Projets »)
      if (hit(label, tabKeywords[slug] || '')) out.push({ title: `${label} · ${p.name}`, sub: 'Page du projet', href: `/p/${p.id}/${slug}` });
    }
  }
  return out.slice(0, MAX);
}
