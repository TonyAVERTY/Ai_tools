// Google reCAPTCHA v3 : vérification côté serveur du jeton produit par le navigateur après consentement.
// Sans clés configurées (RECAPTCHA_SITE_KEY / RECAPTCHA_SECRET), reCAPTCHA est désactivé : développement seulement.
// Il n'existe aucun indicateur pour contourner la vérification quand les clés sont présentes.
import { HttpError } from './http.js';

export const CAPTCHA_ACTION = 'login';
const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

const refus = (status, message, code) => new HttpError(status, message, { expose: true, code });

/**
 * Valide le jeton reçu avec le formulaire de connexion. `app.fetch` est injectable (aucun appel réel dans les tests).
 * Refuse : jeton absent (400), refusé par Google, expiré, d'une autre action ou d'un autre site, ou score trop bas (403),
 * Google injoignable (503 : on ne laisse pas passer faute de réponse).
 * @returns {Promise<{skipped: true} | {score: number}>}
 */
export async function verifyCaptcha(app, token) {
  const rc = app.cfg.recaptcha;
  if (!rc) return { skipped: true };
  const t = typeof token === 'string' ? token.trim() : '';
  if (!t) throw refus(400, 'Vérification anti-robot manquante : charge-la, puis réessaie.', 'captcha_missing');
  if (t.length > 4096) throw refus(403, 'Vérification anti-robot invalide : recharge la page.', 'captcha_invalid');
  let data;
  try {
    const r = await (app.fetch || fetch)(VERIFY_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: rc.secret, response: t }), signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch {
    throw refus(503, 'La vérification anti-robot est indisponible pour le moment : réessaie dans un instant.', 'captcha_unavailable');
  }
  if (!data?.success) throw refus(403, 'Vérification anti-robot refusée (invalide ou expirée) : recharge la page et réessaie.', 'captcha_invalid');
  if (data.action !== CAPTCHA_ACTION) throw refus(403, 'Vérification anti-robot invalide : recharge la page.', 'captcha_invalid');
  if (data.hostname !== new URL(app.cfg.appUrl).hostname) throw refus(403, 'Vérification anti-robot invalide : recharge la page.', 'captcha_invalid');
  const score = Number(data.score);
  if (!(score >= rc.minScore)) {
    throw refus(403, "Vérification anti-robot : ton activité a été jugée suspecte. Réessaie plus tard, ou écris-nous si cela se répète.", 'captcha_low_score');
  }
  return { score };
}
