// Fonctionnalités réservées à une offre (FEATURES dans limits.js) : à la place du bloc, une carte qui dit à partir de quelle offre il est
// disponible et mène aux tarifs (un appel à l'action pour passer à l'offre). Le serveur refuse aussi le lancement (assertFeature) :
// ces cartes ne sont que la vitrine, jamais la protection.
import { esc } from './http.js';
import { ic } from './icons.js';
import { FEATURES, PLAN_LABELS } from './limits.js';

/** Carte qui remplace un bloc verrouillé. `title` : le nom du bloc tel que l'utilisateur le connaît. */
export function lockedCard(key, title = FEATURES[key].label) {
  const plan = PLAN_LABELS[FEATURES[key].plan];
  return `<section class="sheet locked-card" aria-labelledby="lk-${key}"><div class="locked-h">${ic('lock')}<h2 id="lk-${key}">${esc(title)}</h2><span class="badge">Offre ${esc(plan)}</span></div>
  <p class="muted">Disponible à partir de l'offre <b>${esc(plan)}</b>. Ce que tu as déjà créé reste visible, rien n'est supprimé.</p>
  <div class="row-actions"><a class="btn primary" href="/tarifs">Passer à l'offre ${esc(plan)}</a></div></section>`;
}

/** Petit lien à la place d'un bouton verrouillé (export, par exemple). */
export const lockedLink = (key, label) => `<a class="btn small locked-link" href="/tarifs" title="Disponible à partir de l'offre ${esc(PLAN_LABELS[FEATURES[key].plan])}">${ic('lock')}${esc(label)} · offre ${esc(PLAN_LABELS[FEATURES[key].plan])}</a>`;

/** Page entière à la place d'une page verrouillée. */
export const lockedPageBody = (key, title, intro = '') => `<div class="pj-page"><div class="ph"><div class="t"><h1>${esc(title)}</h1></div></div>${intro ? `<p class="muted">${esc(intro)}</p>` : ''}${lockedCard(key, title)}</div>`;
