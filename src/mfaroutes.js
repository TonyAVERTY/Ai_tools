// Authentification à deux facteurs : saisie du code à la connexion, activation, désactivation et codes de secours depuis Mon compte.
import { html, redirect, readBody, parseCookies, setCookie, HttpError } from './http.js';
import { THEMES, THEME_COOKIE } from './theme.js';
import { checkOrigin, getPendingSession, createSession } from './auth.js';
import { clientIp } from './ratelimit.js';
import { securityLog } from './securitylog.js';
import { hashSid, encrypt, decrypt, randomId } from './crypto.js';
import { newSecret, verifyTotp, newRecoveryCodes, consumeRecovery } from './totp.js';
import { mfaLoginPage, recoveryCodesPage, securityCard } from './mfaviews.js';
import { now } from './db.js';

const MAX_TRIES = 5;
const TRUST_COOKIE = 'mfa_td';
const TRUST_TTL = 30 * 24 * 3600;
const back = (res, msg) => redirect(res, `/account?e=${encodeURIComponent(msg)}#securite`);

export function registerMfaRoutes(router, app) {
  const { db, cfg } = app;

  // Thème de l'interface : un cookie de préférence (1 an), choisi par la personne ; « Automatique » l'efface
  router.post('/account/theme', async ({ req, res }) => {
    const v = (await readBody(req)).theme;
    if (THEMES.includes(v)) setCookie(res, THEME_COOKIE, v, { maxAge: 365 * 24 * 3600 });
    else setCookie(res, THEME_COOKIE, '', { maxAge: 0 });
    redirect(res, '/account#affichage');
  });

  const load = (id) => db.prepare('SELECT totp_secret_enc, totp_enabled, totp_recovery, totp_last_step FROM users WHERE id = ?').get(id);
  const hashes = (u) => { try { return JSON.parse(u.totp_recovery || '[]'); } catch { return []; } };

  const ipOf = (req) => clientIp(req, cfg.trustProxy);

  /** Passe une session « en attente » à l'état connecté. Un NOUVEL identifiant est émis (jamais celui qui existait avant la preuve du second facteur). */
  const promote = async (req, res, pending) => {
    await db.prepare('DELETE FROM sessions WHERE id = ?').run(pending.id);
    await createSession(db, res, pending.userId);
    securityLog('session_rotated', { userId: pending.userId, ip: ipOf(req) });
    return redirect(res, '/');
  };

  /** Comme checkCode, avec un plafond par compte (10 codes / 15 min, d'où qu'ils viennent) et le journal de sécurité. Lève 429 au-delà du plafond. */
  async function codeOk(userId, input, req) {
    if (!app.limiter.check('mfa_code', { userId }).ok) {
      securityLog('mfa_locked', { userId, ip: ipOf(req) });
      throw new HttpError(429, 'Trop de codes essayés : réessaie dans quelques minutes', { expose: true });
    }
    const ok = await checkCode(userId, input);
    if (!ok) securityLog('mfa_failed', { userId, ip: ipOf(req) });
    return ok;
  }

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
    if (r.changes > 0) securityLog('mfa_recovery_used', { userId });
    return r.changes > 0;
  }

  // ---------- Connexion : le code après Google / Apple ----------
  // Appareil de confiance : un cookie aléatoire (HttpOnly, 30 jours) dont seule l'empreinte est en base ; il dispense du code sur CE navigateur, pour CE compte
  const trusted = async (userId, req) => {
    const t = parseCookies(req)[TRUST_COOKIE];
    return !!t && !!(await db.prepare('SELECT 1 x FROM trusted_devices WHERE token_hash = ? AND user_id = ? AND expires_at > ?').get(hashSid(t), userId, now()));
  };
  router.get('/login/2fa', async ({ req, res, url }) => {
    const pending = await getPendingSession(db, req);
    if (!pending) return redirect(res, '/login');
    if (await trusted(pending.userId, req)) return promote(req, res, pending);
    html(res, mfaLoginPage({ appUrl: cfg.appUrl, error: url.searchParams.get('e') }));
  }, { public: true, limit: 'mfa' });

  router.post('/login/2fa', async ({ req, res }) => {
    try { checkOrigin(req, cfg); } catch (e) { if (e instanceof HttpError) return redirect(res, '/login'); throw e; }
    const pending = await getPendingSession(db, req);
    if (!pending) return redirect(res, '/login');
    const b = await readBody(req);
    let good = false;
    try { good = await codeOk(pending.userId, b.code, req); } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      await db.prepare('DELETE FROM sessions WHERE id = ?').run(pending.id);
      return redirect(res, `/login?e=${encodeURIComponent(e.message)}`);
    }
    if (good) {
      if (b.trust === 'on') {
        const token = randomId();
        await db.prepare('INSERT INTO trusted_devices(token_hash, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)').run(hashSid(token), pending.userId, now(), now() + TRUST_TTL);
        setCookie(res, TRUST_COOKIE, token, { maxAge: TRUST_TTL });
        securityLog('mfa_device_trusted', { userId: pending.userId, ip: ipOf(req) });
      }
      return promote(req, res, pending);
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
    securityLog('mfa_enabled', { userId: session.userId, ip: ipOf(req) });
    html(res, recoveryCodesPage({ user: session.user, codes }));
  }, { limit: 'mfa' });

  router.post('/account/2fa/recovery', async ({ req, res, session }) => {
    const b = await readBody(req);
    try { if (!(await codeOk(session.userId, b.code, req))) return back(res, 'Code incorrect : les codes de secours n\'ont pas été renouvelés'); } catch (e) { if (e instanceof HttpError) return back(res, e.message); throw e; }
    const { codes, hashes: h } = newRecoveryCodes();
    await db.prepare('UPDATE users SET totp_recovery = ? WHERE id = ?').run(JSON.stringify(h), session.userId);
    await db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(session.userId); // codes renouvelés : les appareils sont à confirmer de nouveau
    securityLog('mfa_recovery_regenerated', { userId: session.userId, ip: ipOf(req) });
    html(res, recoveryCodesPage({ user: session.user, codes }));
  }, { limit: 'mfa' });

  router.post('/account/2fa/forget', async ({ res, session }) => {
    await db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(session.userId);
    redirect(res, '/account#securite');
  }, { limit: 'mfa' });

  router.post('/account/2fa/disable', async ({ req, res, session }) => {
    const b = await readBody(req);
    try { if (!(await codeOk(session.userId, b.code, req))) return back(res, 'Code incorrect : l\'A2F reste activée'); } catch (e) { if (e instanceof HttpError) return back(res, e.message); throw e; }
    await db.prepare('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_recovery = NULL, totp_last_step = 0 WHERE id = ?').run(session.userId);
    await db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(session.userId);
    securityLog('mfa_disabled', { userId: session.userId, ip: ipOf(req) });
    redirect(res, '/account#securite');
  }, { limit: 'mfa' });
}

/** HTML de la carte « Sécurité » de Mon compte (le secret en cours d'activation n'est montré que tant que l'A2F n'est pas activée). */
export async function securityHtml(db, cfg, session) {
  const u = await db.prepare('SELECT totp_secret_enc, totp_enabled, totp_recovery FROM users WHERE id = ?').get(session.userId);
  const enabled = !!u?.totp_enabled;
  let left = 0;
  try { left = JSON.parse(u?.totp_recovery || '[]').length; } catch { /* aucune empreinte lisible : 0 code restant */ }
  const devices = enabled ? Number((await db.prepare('SELECT COUNT(*) n FROM trusted_devices WHERE user_id = ? AND expires_at > ?').get(session.userId, now())).n) : 0;
  return securityCard({ devices, enabled, setup: !enabled && u?.totp_secret_enc ? decrypt(cfg.secretKey, u.totp_secret_enc) : null, email: session.email, recoveryLeft: left });
}
