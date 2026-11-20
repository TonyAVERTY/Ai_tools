// Authentification à deux facteurs : saisie du code à la connexion, activation, désactivation et codes de secours depuis Mon compte.
import { html, redirect, readBody, parseCookies, HttpError } from './http.js';
import { checkOrigin, getPendingSession } from './auth.js';
import { hashSid, encrypt, decrypt } from './crypto.js';
import { newSecret, verifyTotp, newRecoveryCodes, consumeRecovery } from './totp.js';
import { mfaLoginPage, recoveryCodesPage, securityCard } from './mfaviews.js';
import { now } from './db.js';

const MAX_TRIES = 5;
const back = (res, msg) => redirect(res, `/account?e=${encodeURIComponent(msg)}#securite`);

export function registerMfaRoutes(router, app) {
  const { db, cfg } = app;
  const load = (id) => db.prepare('SELECT totp_secret_enc, totp_enabled, totp_recovery, totp_last_step FROM users WHERE id = ?').get(id);
  const hashes = (u) => { try { return JSON.parse(u.totp_recovery || '[]'); } catch { return []; } };

  /**
   * Un code d'application (à usage unique) ou de secours (consommé) est-il bon ? Met à jour l'état du compte. Renvoie true ou false.
   * Les deux sont acceptés partout où l'on demande « un code » : la connexion, la désactivation et le renouvellement.
   */
  async function checkCode(userId, input) {
    const u = await load(userId);
    if (!u?.totp_enabled || !u.totp_secret_enc) return false;
    const step = verifyTotp(decrypt(cfg.secretKey, u.totp_secret_enc), input, { lastStep: u.totp_last_step });
    if (step) {
      // Le pas n'est consommé que s'il est encore plus récent que le dernier : deux requêtes simultanées avec le même code ne passent pas toutes les deux
      const r = await db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?').run(step, userId, step);
      return r.changes > 0;
    }
    const left = consumeRecovery(hashes(u), input);
    if (!left) return false;
    const r = await db.prepare('UPDATE users SET totp_recovery = ? WHERE id = ? AND totp_recovery = ?').run(JSON.stringify(left), userId, u.totp_recovery);
    return r.changes > 0;
  }

  // ---------- Connexion : le code après Google / Apple ----------
  router.get('/login/2fa', async ({ req, res, url }) => {
    if (!(await getPendingSession(db, req))) return redirect(res, '/login');
    html(res, mfaLoginPage({ appUrl: cfg.appUrl, error: url.searchParams.get('e') }));
  }, { public: true, limit: 'mfa' });

  router.post('/login/2fa', async ({ req, res }) => {
    try { checkOrigin(req, cfg); } catch (e) { if (e instanceof HttpError) return redirect(res, '/login'); throw e; }
    const pending = await getPendingSession(db, req);
    if (!pending) return redirect(res, '/login');
    const b = await readBody(req);
    if (await checkCode(pending.userId, b.code)) {
      await db.prepare('UPDATE sessions SET mfa_pending = 0, mfa_tries = 0, expires_at = ? WHERE id = ?').run(now() + 30 * 24 * 3600, hashSid(parseCookies(req).sid));
      return redirect(res, '/');
    }
    await db.prepare('UPDATE sessions SET mfa_tries = mfa_tries + 1 WHERE id = ?').run(pending.id);
    if (pending.tries + 1 >= MAX_TRIES) {
      await db.prepare('DELETE FROM sessions WHERE id = ?').run(pending.id);
      return redirect(res, `/login?e=${encodeURIComponent('Trop de codes erronés : reconnecte-toi pour réessayer')}`);
    }
    redirect(res, `/login/2fa?e=${encodeURIComponent('Code incorrect ou déjà utilisé : réessaie avec le code actuel de ton application')}`);
  }, { public: true, limit: 'mfa' });

  // ---------- Mon compte ----------
  router.post('/account/2fa/start', async ({ res, session }) => {
    const u = await load(session.userId);
    if (u?.totp_enabled) return back(res, 'L\'A2F est déjà activée');
    await db.prepare('UPDATE users SET totp_secret_enc = ? WHERE id = ?').run(encrypt(cfg.secretKey, newSecret()), session.userId);
    redirect(res, '/account#securite');
  }, { limit: 'mfa' });

  router.post('/account/2fa/cancel', async ({ res, session }) => {
    await db.prepare('UPDATE users SET totp_secret_enc = NULL WHERE id = ? AND totp_enabled = 0').run(session.userId);
    redirect(res, '/account#securite');
  }, { limit: 'mfa' });

  router.post('/account/2fa/enable', async ({ req, res, session }) => {
    const b = await readBody(req);
    const u = await load(session.userId);
    if (u?.totp_enabled) return back(res, 'L\'A2F est déjà activée');
    if (!u?.totp_secret_enc) return back(res, 'Activation expirée : recommence en cliquant sur « Activer l\'A2F »');
    const step = verifyTotp(decrypt(cfg.secretKey, u.totp_secret_enc), b.code);
    if (!step) return back(res, 'Code incorrect : vérifie l\'heure de ton téléphone et saisis le code actuel');
    const { codes, hashes: h } = newRecoveryCodes();
    await db.prepare('UPDATE users SET totp_enabled = 1, totp_last_step = ?, totp_recovery = ? WHERE id = ?').run(step, JSON.stringify(h), session.userId);
    html(res, recoveryCodesPage({ user: session.user, codes }));
  }, { limit: 'mfa' });

  router.post('/account/2fa/recovery', async ({ req, res, session }) => {
    const b = await readBody(req);
    if (!(await checkCode(session.userId, b.code))) return back(res, 'Code incorrect : les codes de secours n\'ont pas été renouvelés');
    const { codes, hashes: h } = newRecoveryCodes();
    await db.prepare('UPDATE users SET totp_recovery = ? WHERE id = ?').run(JSON.stringify(h), session.userId);
    html(res, recoveryCodesPage({ user: session.user, codes }));
  }, { limit: 'mfa' });

  router.post('/account/2fa/disable', async ({ req, res, session }) => {
    const b = await readBody(req);
    if (!(await checkCode(session.userId, b.code))) return back(res, 'Code incorrect : l\'A2F reste activée');
    await db.prepare('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_recovery = NULL, totp_last_step = 0 WHERE id = ?').run(session.userId);
    redirect(res, '/account#securite');
  }, { limit: 'mfa' });
}

/** HTML de la carte « Sécurité » de Mon compte (le secret en cours d'activation n'est montré que tant que l'A2F n'est pas activée). */
export async function securityHtml(db, cfg, session) {
  const u = await db.prepare('SELECT totp_secret_enc, totp_enabled, totp_recovery FROM users WHERE id = ?').get(session.userId);
  const enabled = !!u?.totp_enabled;
  let left = 0;
  try { left = JSON.parse(u?.totp_recovery || '[]').length; } catch { /* aucune empreinte lisible : 0 code restant */ }
  return securityCard({ enabled, setup: !enabled && u?.totp_secret_enc ? decrypt(cfg.secretKey, u.totp_secret_enc) : null, email: session.email, recoveryLeft: left });
}
