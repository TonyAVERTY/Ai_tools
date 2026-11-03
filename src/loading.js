// Contenu qui se charge : l'anneau commun (.spinner, grand, ou .spin-inline, petit) devant « Chargement… ». Un seul indicateur dans l'application :
// le même que celui du bouton occupé (voir docs/UX.md). Côté navigateur : window.AiTools.loadingHtml (public/app.js), même balisage.
import { esc } from './http.js';

/** `loadingBlock()` pour un bloc de page qui se remplit ; `loadingBlock('Chargement…', { small: true })` pour une liste ou une ligne. Le texte est échappé. */
export const loadingBlock = (text = 'Chargement…', { small = false } = {}) =>
  `<span class="loading${small ? ' small' : ''}" role="status"><span class="${small ? 'spin-inline' : 'spinner'}" aria-hidden="true"></span><span>${esc(text)}</span></span>`;
