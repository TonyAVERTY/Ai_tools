// Faux lanceur d'IA pour les tests d'envoi de mails : chaque mail relu (« contrôle du sens », voir src/services/mailsense.js) a un sens.
// `withSense(app)` répond lui-même à cette question et laisse tout le reste au lanceur habituel (le faux binaire Claude du test).
import { makeClaude } from '../../src/handlers.js';

export const senseOk = async (userId, o = {}) => ({
  ok: true, subtype: 'success', costUsd: 0, tokensIn: 0, tokensOut: 0, turns: 1,
  text: JSON.stringify({ results: [...String(o.prompt).matchAll(/\[id=(\d+)\]/g)].map((m) => ({ id: Number(m[1]), ok: true })) }),
});

export const withSense = (app) => {
  const real = makeClaude(app);
  return (userId, o = {}) => (String(o.prompt).includes('CONTRÔLE DU SENS') ? senseOk(userId, o) : real(userId, o));
};
