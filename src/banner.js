// Bandeau de résultat commun : ce qui s'affiche en haut ou dans le corps d'une page après un rechargement ou une redirection
// (« Réglages enregistrés », une erreur de formulaire, un avertissement). Une seule apparence (`.msg msg-ok | msg-err | msg-warn`),
// une icône avec le texte (jamais la couleur seule) et le bon `role` : `alert` pour une erreur (lue tout de suite), `status` sinon.
// Pour le résultat d'une action sur la page où l'on est, c'est le toast de public/app.js qui sert (voir docs/UX.md).
import { esc } from './http.js';
import { ic } from './icons.js';

const KINDS = { ok: { icon: 'check', role: 'status' }, err: { icon: 'alert', role: 'alert' }, warn: { icon: 'alert', role: 'status' } };

/** `banner('ok', 'Réglages enregistrés')` ; `{ strong: true }` met le texte en gras. Le texte est échappé : jamais de HTML venant d'une donnée. */
export function banner(kind, text, { strong = false } = {}) {
  const k = KINDS[kind];
  if (!k) throw new Error(`banner : type inconnu « ${kind} »`);
  const t = esc(kind === 'err' && !/[.!?…]$/.test(String(text)) ? `${text}.` : text); // une erreur est une phrase : elle finit par un point (comme le toast d'erreur)
  return `<p class="msg msg-${kind}" role="${k.role}">${ic(k.icon)}<span>${strong ? `<b>${t}</b>` : t}</span></p>`;
}
